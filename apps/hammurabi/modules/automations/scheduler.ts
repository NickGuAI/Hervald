import cron from 'node-cron'
import { resolveCommanderPaths } from '../commanders/paths.js'
import { resolveSkill } from '../sentinels/skills.js'
import { AutomationQuestEventBus, type AutomationQuestCompletedEvent } from './quest-event-bus.js'
import { AutomationExecutor, type AutomationExecutionResult } from './executor.js'
import {
  AutomationStore,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from './store.js'
import type {
  Automation,
  AutomationStatus,
} from './types.js'

interface CronScheduledJob {
  stop?: () => void
  destroy?: () => void
  getNextRun?: () => Date | null
}

export interface CronScheduler {
  schedule(
    expression: string,
    task: () => Promise<void> | void,
    options?: { name?: string; timezone?: string },
  ): CronScheduledJob
  validate(expression: string): boolean
}

interface CommanderLookupStore {
  get(commanderId: string): Promise<unknown | null>
}

export interface AutomationSchedulerOptions {
  store?: AutomationStore
  scheduler?: CronScheduler
  executor?: AutomationExecutor
  commanderStore?: CommanderLookupStore
  questEventBus?: AutomationQuestEventBus
}

export class InvalidAutomationCronExpressionError extends Error {
  constructor(public readonly expression: string) {
    super(`Invalid cron expression: ${expression}`)
    this.name = 'InvalidAutomationCronExpressionError'
  }
}

export class ParentCommanderNotFoundError extends Error {
  constructor(public readonly commanderId: string) {
    super(`Parent commander ${commanderId} not found`)
    this.name = 'ParentCommanderNotFoundError'
  }
}

export class MissingAutomationSkillError extends Error {
  constructor(public readonly skillName: string) {
    super(`Skill "${skillName}" not found`)
    this.name = 'MissingAutomationSkillError'
  }
}

function defaultScheduler(): CronScheduler {
  return {
    schedule(expression, task, options) {
      return cron.schedule(expression, task, {
        name: options?.name,
        timezone: options?.timezone,
      })
    },
    validate(expression) {
      return cron.validate(expression)
    },
  }
}

function canBeScheduled(status: AutomationStatus): boolean {
  return status === 'active'
}

export class AutomationScheduler {
  private readonly store: AutomationStore
  private readonly scheduler: CronScheduler
  private readonly executor: AutomationExecutor
  private readonly commanderStore?: CommanderLookupStore
  private readonly questEventBus: AutomationQuestEventBus
  private readonly activeJobs = new Map<string, CronScheduledJob>()
  private readonly internalJobs = new Map<string, CronScheduledJob>()
  private questUnsubscribe: (() => void) | null = null

  constructor(options: AutomationSchedulerOptions = {}) {
    this.store = options.store ?? new AutomationStore()
    this.scheduler = options.scheduler ?? defaultScheduler()
    this.executor = options.executor ?? new AutomationExecutor({ store: this.store })
    this.commanderStore = options.commanderStore
    this.questEventBus = options.questEventBus ?? new AutomationQuestEventBus()
  }

  async initialize(): Promise<void> {
    this.stopAutomationJobs()
    await this.store.ensureLoaded()
    const automations = await this.store.list()
    for (const automation of automations) {
      if (automation.trigger === 'schedule' && canBeScheduled(automation.status)) {
        this.registerJob(automation)
      }
    }
    this.questUnsubscribe?.()
    this.questUnsubscribe = this.questEventBus.subscribe(async (event) => {
      await this.handleQuestCompleted(event)
    })
  }

  async listAutomations(filter: { parentCommanderId?: string | null; status?: AutomationStatus } = {}): Promise<Automation[]> {
    return this.store.list(filter)
  }

  async getAutomation(automationId: string): Promise<Automation | null> {
    return this.store.get(automationId)
  }

  isCronExpressionValid(expression: string): boolean {
    return this.scheduler.validate(expression)
  }

  async createAutomation(input: CreateAutomationInput): Promise<Automation> {
    this.assertValidInput(input)
    await this.assertParentCommanderExists(input.parentCommanderId)
    await this.assertSkillsExist(input.skills ?? [], input.parentCommanderId ?? undefined)
    const created = await this.store.create(input)
    if (created.trigger === 'schedule' && canBeScheduled(created.status)) {
      this.registerJob(created)
    }
    return created
  }

  async updateAutomation(automationId: string, patch: UpdateAutomationInput): Promise<Automation | null> {
    if (patch.trigger === 'schedule' && patch.schedule) {
      this.assertValidExpression(patch.schedule)
    }
    if (patch.skills) {
      const existing = await this.store.get(automationId)
      await this.assertSkillsExist(patch.skills, patch.parentCommanderId ?? existing?.parentCommanderId ?? undefined)
    }
    const updated = await this.store.update(automationId, patch)
    if (!updated) {
      return null
    }
    this.unregisterJob(automationId)
    if (updated.trigger === 'schedule' && canBeScheduled(updated.status)) {
      this.registerJob(updated)
    }
    return updated
  }

  async deleteAutomation(automationId: string): Promise<boolean> {
    this.unregisterJob(automationId)
    return this.store.delete(automationId, { removeFiles: true })
  }

  async runAutomation(
    automationId: string,
    source: 'schedule' | 'quest' | 'manual' = 'manual',
  ): Promise<AutomationExecutionResult | null> {
    return this.executor.executeAutomation(automationId, source)
  }

  getNextRun(automationId: string): Date | null {
    const nextRun = this.activeJobs.get(automationId)?.getNextRun?.()
    if (!(nextRun instanceof Date) || Number.isNaN(nextRun.getTime())) {
      return null
    }
    return nextRun
  }

  registerInternalSchedule(
    name: string,
    expression: string,
    task: () => Promise<void> | void,
    options?: { timezone?: string },
  ): void {
    this.assertValidExpression(expression)
    this.internalJobs.get(name)?.stop?.()
    this.internalJobs.get(name)?.destroy?.()
    this.internalJobs.set(name, this.scheduler.schedule(expression, task, {
      name,
      timezone: options?.timezone,
    }))
  }

  private assertValidInput(input: CreateAutomationInput): void {
    if (input.trigger === 'schedule') {
      if (!input.schedule) {
        throw new InvalidAutomationCronExpressionError('(missing schedule)')
      }
      this.assertValidExpression(input.schedule)
      return
    }
    if (input.trigger === 'quest' && !input.questTrigger) {
      throw new Error('questTrigger is required when trigger=quest')
    }
  }

  private assertValidExpression(expression: string): void {
    if (!this.scheduler.validate(expression)) {
      throw new InvalidAutomationCronExpressionError(expression)
    }
  }

  private async assertParentCommanderExists(parentCommanderId: string | null | undefined): Promise<void> {
    if (!parentCommanderId || !this.commanderStore) {
      return
    }
    const commander = await this.commanderStore.get(parentCommanderId)
    if (!commander) {
      throw new ParentCommanderNotFoundError(parentCommanderId)
    }
  }

  private async assertSkillsExist(skills: readonly string[], parentCommanderId?: string): Promise<void> {
    if (skills.length === 0) {
      return
    }
    const commanderSkillsDir = parentCommanderId
      ? resolveCommanderPaths(parentCommanderId).skillsRoot
      : undefined
    for (const skillName of skills) {
      const resolved = await resolveSkill(skillName, commanderSkillsDir)
      if (!resolved) {
        throw new MissingAutomationSkillError(skillName)
      }
    }
  }

  private registerJob(automation: Automation): void {
    if (!automation.schedule) {
      return
    }
    this.unregisterJob(automation.id)
    this.activeJobs.set(
      automation.id,
      this.scheduler.schedule(
        automation.schedule,
        async () => {
          await this.handleScheduledTick(automation.id)
        },
        {
          name: `automation-${automation.id}`,
          timezone: automation.timezone,
        },
      ),
    )
  }

  private unregisterJob(automationId: string): void {
    const existing = this.activeJobs.get(automationId)
    if (!existing) {
      return
    }
    existing.stop?.()
    existing.destroy?.()
    this.activeJobs.delete(automationId)
  }

  private stopAutomationJobs(): void {
    for (const [automationId] of this.activeJobs) {
      this.unregisterJob(automationId)
    }
  }

  private async handleScheduledTick(automationId: string): Promise<void> {
    const automation = await this.store.get(automationId)
    if (!automation || automation.trigger !== 'schedule' || !canBeScheduled(automation.status)) {
      this.unregisterJob(automationId)
      return
    }
    if (automation.maxRuns && (automation.totalRuns ?? 0) >= automation.maxRuns) {
      await this.updateAutomation(automation.id, { status: 'completed' })
      return
    }
    try {
      await this.executor.executeAutomation(automation.id, 'schedule')
    } catch (error) {
      console.error('[automations] Scheduled automation execution failed:', error)
    }
  }

  private async handleQuestCompleted(event: AutomationQuestCompletedEvent): Promise<void> {
    const automations = await this.store.list({ trigger: 'quest', status: 'active' })
    for (const automation of automations) {
      const questTrigger = automation.questTrigger
      if (!questTrigger || questTrigger.event !== 'completed') {
        continue
      }
      if (questTrigger.commanderId && questTrigger.commanderId !== event.commanderId) {
        continue
      }
      try {
        await this.executor.executeAutomation(automation.id, 'quest')
      } catch (error) {
        console.error('[automations] Quest-trigger automation execution failed:', error)
      }
    }
  }
}
