import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { getProvider, parseProviderId } from '../agents/providers/registry.js'
import type { AgentType } from '../agents/types.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import {
  AutomationExecutor,
  type AutomationExecutorOptions,
} from './executor.js'
import {
  AutomationScheduler,
  InvalidAutomationCronExpressionError,
  MissingAutomationSkillError,
  ParentCommanderNotFoundError,
} from './scheduler.js'
import {
  AutomationStore,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from './store.js'
import type {
  Automation,
  AutomationQuestTrigger,
  AutomationStatus,
  AutomationTrigger,
} from './types.js'

const AUTOMATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const COMMANDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

interface CommanderLookupStore {
  get(commanderId: string): Promise<unknown | null>
}

export interface AutomationsRouterOptions extends Pick<AutomationExecutorOptions, 'agentSessionFactory' | 'monitorOptions' | 'now'> {
  store?: AutomationStore
  executor?: AutomationExecutor
  scheduler?: AutomationScheduler
  schedulerInitialized?: Promise<void>
  commanderStore?: CommanderLookupStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

export interface AutomationsRouterResult {
  router: Router
  scheduler: AutomationScheduler
  store: AutomationStore
  ready: Promise<void>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseAutomationId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed || !AUTOMATION_ID_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function parseCommanderId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null
  }
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  if (!trimmed || !COMMANDER_ID_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function parseNonEmptyString(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseOptionalString(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) {
    return undefined
  }
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseOptionalTrigger(raw: unknown): AutomationTrigger | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  return raw === 'schedule' || raw === 'quest' || raw === 'manual'
    ? raw
    : null
}

function parseOptionalStatus(raw: unknown): AutomationStatus | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  return raw === 'active' || raw === 'paused' || raw === 'completed' || raw === 'cancelled'
    ? raw
    : null
}

function parseOptionalAgentType(raw: unknown): AgentType | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  const agentType = parseProviderId(raw)
  return agentType && getProvider(agentType)?.capabilities.supportsAutomation
    ? agentType
    : null
}

function parseOptionalSessionType(raw: unknown): 'stream' | 'pty' | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  return raw === 'stream' || raw === 'pty'
    ? raw
    : null
}

function parseOptionalTimezone(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) {
    return undefined
  }
  if (typeof raw !== 'string') {
    return null
  }
  const timezone = raw.trim()
  if (!timezone) {
    return undefined
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return null
  }
  return timezone
}

function parseOptionalWorkDir(raw: unknown): string | null | undefined {
  const workDir = parseOptionalString(raw)
  if (workDir === undefined) {
    return undefined
  }
  if (workDir === null) {
    return null
  }
  return workDir.startsWith('/') ? workDir : null
}

function parseOptionalSkillList(raw: unknown): string[] | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    return null
  }
  const nextSkills: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return null
    }
    nextSkills.push(entry.trim())
  }
  return nextSkills
}

function parseOptionalObservations(raw: unknown): string[] | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    return null
  }
  const observations: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return null
    }
    const trimmed = entry.trim()
    if (trimmed) {
      observations.push(trimmed)
    }
  }
  return observations
}

function parseOptionalQuestTrigger(raw: unknown): AutomationQuestTrigger | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!isObject(raw) || raw.event !== 'completed') {
    return null
  }
  const commanderId = raw.commanderId === undefined ? undefined : parseCommanderId(raw.commanderId)
  if (raw.commanderId !== undefined && !commanderId) {
    return null
  }
  return {
    event: 'completed',
    ...(commanderId ? { commanderId } : {}),
  }
}

function parsePositiveInteger(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined
  }
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function parseOptionalPermissionMode(raw: unknown): 'default' | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  return raw === 'default' ? 'default' : null
}

function parsePagination(raw: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(minimum, Math.min(maximum, parsed))
    }
  }
  return fallback
}

function toIsoString(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null
  }
  return value.toISOString()
}

function toAutomationResponse(automation: Automation, scheduler: AutomationScheduler): Automation & { nextRun: string | null } {
  return {
    ...automation,
    nextRun: toIsoString(scheduler.getNextRun(automation.id)),
  }
}

function isCronError(error: unknown): error is InvalidAutomationCronExpressionError {
  return error instanceof InvalidAutomationCronExpressionError
}

function isMissingSkillError(error: unknown): error is MissingAutomationSkillError {
  return error instanceof MissingAutomationSkillError
}

function isMissingParentError(error: unknown): error is ParentCommanderNotFoundError {
  return error instanceof ParentCommanderNotFoundError
}

export function createAutomationsRouter(options: AutomationsRouterOptions = {}): AutomationsRouterResult {
  const router = Router()
  const store = options.store ?? new AutomationStore()
  const executor = options.executor ?? new AutomationExecutor({
    store,
    now: options.now,
    monitorOptions: options.monitorOptions,
    agentSessionFactory: options.agentSessionFactory,
    internalToken: options.internalToken,
  })
  const scheduler = options.scheduler ?? new AutomationScheduler({
    store,
    executor,
    commanderStore: options.commanderStore,
  })
  const initialized = options.schedulerInitialized ?? scheduler.initialize()
  if (!options.schedulerInitialized) {
    void initialized.catch((error) => {
      console.error('[automations] Failed to initialize scheduler:', error)
    })
  }

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/', requireReadAccess, async (req, res) => {
    const parentCommanderId = req.query.parentCommanderId === undefined
      ? undefined
      : (req.query.parentCommanderId === '' || req.query.parentCommanderId === 'null'
        ? null
        : parseCommanderId(req.query.parentCommanderId))
    if (req.query.parentCommanderId !== undefined && req.query.parentCommanderId !== '' && req.query.parentCommanderId !== 'null' && !parentCommanderId) {
      res.status(400).json({ error: 'parentCommanderId must be a valid commander id when provided' })
      return
    }
    const trigger = parseOptionalTrigger(req.query.trigger)
    if (trigger === null) {
      res.status(400).json({ error: 'trigger must be schedule, quest, or manual when provided' })
      return
    }
    const status = parseOptionalStatus(req.query.status)
    if (status === null) {
      res.status(400).json({ error: 'status must be active, paused, completed, or cancelled when provided' })
      return
    }

    try {
      await initialized
      const automations = await store.list({
        ...(parentCommanderId !== undefined ? { parentCommanderId } : {}),
        ...(trigger ? { trigger } : {}),
        ...(status ? { status } : {}),
      })
      res.json(automations.map((automation) => toAutomationResponse(automation, scheduler)))
    } catch {
      res.status(500).json({ error: 'Failed to list automations' })
    }
  })

  router.post('/', requireWriteAccess, async (req, res) => {
    const name = parseNonEmptyString(req.body?.name)
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const trigger = parseOptionalTrigger(req.body?.trigger)
    if (!trigger) {
      res.status(400).json({ error: 'trigger must be schedule, quest, or manual' })
      return
    }
    const instruction = parseNonEmptyString(req.body?.instruction)
    if (!instruction) {
      res.status(400).json({ error: 'instruction is required' })
      return
    }
    const agentType = parseOptionalAgentType(req.body?.agentType)
    if (!agentType) {
      res.status(400).json({ error: 'agentType must be a supported provider' })
      return
    }
    const permissionMode = parseOptionalPermissionMode(req.body?.permissionMode)
    if (permissionMode === null) {
      res.status(400).json({ error: 'permissionMode must be default when provided' })
      return
    }
    const parentCommanderId = req.body?.parentCommanderId === null
      ? null
      : (req.body?.parentCommanderId === undefined ? undefined : parseCommanderId(req.body?.parentCommanderId))
    if (req.body?.parentCommanderId !== undefined && req.body?.parentCommanderId !== null && !parentCommanderId) {
      res.status(400).json({ error: 'parentCommanderId must be a valid commander id when provided' })
      return
    }
    const schedule = parseOptionalString(req.body?.schedule)
    const questTrigger = parseOptionalQuestTrigger(req.body?.questTrigger)
    if (trigger === 'schedule' && !schedule) {
      res.status(400).json({ error: 'schedule is required when trigger=schedule' })
      return
    }
    if (trigger === 'quest' && !questTrigger) {
      res.status(400).json({ error: 'questTrigger is required when trigger=quest' })
      return
    }
    if (questTrigger === null) {
      res.status(400).json({ error: 'questTrigger must be { event: completed, commanderId? } when provided' })
      return
    }
    const status = parseOptionalStatus(req.body?.status)
    if (status === null) {
      res.status(400).json({ error: 'status must be active, paused, completed, or cancelled when provided' })
      return
    }
    const timezone = parseOptionalTimezone(req.body?.timezone)
    if (timezone === null) {
      res.status(400).json({ error: 'timezone must be a valid IANA timezone when provided' })
      return
    }
    const workDir = parseOptionalWorkDir(req.body?.workDir)
    if (workDir === null) {
      res.status(400).json({ error: 'workDir must be an absolute path when provided' })
      return
    }
    const skills = parseOptionalSkillList(req.body?.skills)
    if (skills === null) {
      res.status(400).json({ error: 'skills must be an array of non-empty strings when provided' })
      return
    }
    const observations = parseOptionalObservations(req.body?.observations)
    if (observations === null) {
      res.status(400).json({ error: 'observations must be an array of strings when provided' })
      return
    }
    const sessionType = parseOptionalSessionType(req.body?.sessionType)
    if (sessionType === null) {
      res.status(400).json({ error: 'sessionType must be stream or pty when provided' })
      return
    }
    const maxRuns = parsePositiveInteger(req.body?.maxRuns)
    if (maxRuns === null) {
      res.status(400).json({ error: 'maxRuns must be a positive integer when provided' })
      return
    }
    const description = parseOptionalString(req.body?.description)
    if (description === null) {
      res.status(400).json({ error: 'description must be a string when provided' })
      return
    }
    const machine = parseOptionalString(req.body?.machine)
    if (machine === null) {
      res.status(400).json({ error: 'machine must be a string when provided' })
      return
    }
    const model = parseOptionalString(req.body?.model)
    if (model === null) {
      res.status(400).json({ error: 'model must be a string when provided' })
      return
    }
    const createInput: CreateAutomationInput = {
      name,
      trigger,
      instruction,
      agentType,
      ...(permissionMode ? { permissionMode } : {}),
      ...(parentCommanderId !== undefined ? { parentCommanderId } : {}),
      ...(schedule ? { schedule } : {}),
      ...(questTrigger ? { questTrigger } : {}),
      ...(status ? { status } : {}),
      ...(description ? { description } : {}),
      ...(timezone ? { timezone } : {}),
      machine: machine ?? '',
      ...(workDir ? { workDir } : {}),
      ...(model ? { model } : {}),
      ...(sessionType ? { sessionType } : {}),
      ...(skills ? { skills } : {}),
      ...(observations ? { observations } : {}),
      ...(typeof req.body?.seedMemory === 'string' ? { seedMemory: req.body.seedMemory } : {}),
      ...(maxRuns ? { maxRuns } : {}),
    }

    try {
      await initialized
      const created = await scheduler.createAutomation(createInput)
      res.status(201).json(toAutomationResponse(created, scheduler))
    } catch (error) {
      if (isCronError(error)) {
        res.status(400).json({ error: 'Invalid cron expression' })
        return
      }
      if (isMissingParentError(error) || isMissingSkillError(error)) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(500).json({ error: 'Failed to create automation' })
    }
  })

  router.get('/:id', requireReadAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    try {
      await initialized
      const automation = await scheduler.getAutomation(automationId)
      if (!automation) {
        res.status(404).json({ error: 'Automation not found' })
        return
      }
      res.json(toAutomationResponse(automation, scheduler))
    } catch {
      res.status(500).json({ error: 'Failed to load automation' })
    }
  })

  router.patch('/:id', requireWriteAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    const body = isObject(req.body) ? req.body : {}
    const patch: UpdateAutomationInput = {}

    if ('name' in body) {
      const name = parseNonEmptyString(body.name)
      if (!name) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      patch.name = name
    }
    if ('trigger' in body) {
      const trigger = parseOptionalTrigger(body.trigger)
      if (!trigger) {
        res.status(400).json({ error: 'trigger must be schedule, quest, or manual' })
        return
      }
      patch.trigger = trigger
    }
    if ('schedule' in body) {
      const schedule = parseOptionalString(body.schedule)
      if (schedule === null) {
        res.status(400).json({ error: 'schedule must be a non-empty string when provided' })
        return
      }
      patch.schedule = schedule
    }
    if ('questTrigger' in body) {
      if (body.questTrigger === null) {
        patch.questTrigger = null
      } else {
        const questTrigger = parseOptionalQuestTrigger(body.questTrigger)
        if (!questTrigger) {
          res.status(400).json({ error: 'questTrigger must be { event: completed, commanderId? }' })
          return
        }
        patch.questTrigger = questTrigger
      }
    }
    if ('instruction' in body) {
      const instruction = parseNonEmptyString(body.instruction)
      if (!instruction) {
        res.status(400).json({ error: 'instruction must be a non-empty string' })
        return
      }
      patch.instruction = instruction
    }
    if ('agentType' in body) {
      const agentType = parseOptionalAgentType(body.agentType)
      if (!agentType) {
        res.status(400).json({ error: 'agentType must be a supported provider' })
        return
      }
      patch.agentType = agentType
    }
    if ('permissionMode' in body) {
      const permissionMode = parseOptionalPermissionMode(body.permissionMode)
      if (permissionMode === null) {
        res.status(400).json({ error: 'permissionMode must be default when provided' })
        return
      }
      patch.permissionMode = permissionMode
    }
    if ('status' in body) {
      const status = parseOptionalStatus(body.status)
      if (!status) {
        res.status(400).json({ error: 'status must be active, paused, completed, or cancelled' })
        return
      }
      patch.status = status
    }
    if ('description' in body) {
      const description = parseOptionalString(body.description)
      if (description === null) {
        res.status(400).json({ error: 'description must be a string when provided' })
        return
      }
      patch.description = description
    }
    if ('timezone' in body) {
      const timezone = parseOptionalTimezone(body.timezone)
      if (timezone === null) {
        res.status(400).json({ error: 'timezone must be a valid IANA timezone when provided' })
        return
      }
      patch.timezone = timezone
    }
    if ('machine' in body) {
      const machine = parseOptionalString(body.machine)
      if (machine === null) {
        res.status(400).json({ error: 'machine must be a string when provided' })
        return
      }
      patch.machine = machine ?? ''
    }
    if ('workDir' in body) {
      const workDir = parseOptionalWorkDir(body.workDir)
      if (workDir === null) {
        res.status(400).json({ error: 'workDir must be an absolute path when provided' })
        return
      }
      patch.workDir = workDir
    }
    if ('model' in body) {
      if (body.model === null) {
        patch.model = null
      } else {
        const model = parseOptionalString(body.model)
        if (model === null) {
          res.status(400).json({ error: 'model must be a string when provided' })
          return
        }
        patch.model = model
      }
    }
    if ('sessionType' in body) {
      if (body.sessionType === null) {
        patch.sessionType = null
      } else {
        const sessionType = parseOptionalSessionType(body.sessionType)
        if (!sessionType) {
          res.status(400).json({ error: 'sessionType must be stream or pty when provided' })
          return
        }
        patch.sessionType = sessionType
      }
    }
    if ('skills' in body) {
      const skills = parseOptionalSkillList(body.skills)
      if (skills === null) {
        res.status(400).json({ error: 'skills must be an array of non-empty strings' })
        return
      }
      patch.skills = skills
    }
    if ('observations' in body) {
      const observations = parseOptionalObservations(body.observations)
      if (observations === null) {
        res.status(400).json({ error: 'observations must be an array of strings' })
        return
      }
      patch.observations = observations
    }
    if ('seedMemory' in body) {
      if (typeof body.seedMemory !== 'string') {
        res.status(400).json({ error: 'seedMemory must be a string when provided' })
        return
      }
      patch.seedMemory = body.seedMemory
    }
    if ('maxRuns' in body) {
      if (body.maxRuns === null) {
        patch.maxRuns = null
      } else {
        const maxRuns = parsePositiveInteger(body.maxRuns)
        if (!maxRuns) {
          res.status(400).json({ error: 'maxRuns must be a positive integer when provided' })
          return
        }
        patch.maxRuns = maxRuns
      }
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'At least one updatable field is required' })
      return
    }

    try {
      await initialized
      const updated = await scheduler.updateAutomation(automationId, patch)
      if (!updated) {
        res.status(404).json({ error: 'Automation not found' })
        return
      }
      res.json(toAutomationResponse(updated, scheduler))
    } catch (error) {
      if (isCronError(error)) {
        res.status(400).json({ error: 'Invalid cron expression' })
        return
      }
      if (isMissingSkillError(error)) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(500).json({ error: 'Failed to update automation' })
    }
  })

  router.delete('/:id', requireWriteAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    try {
      await initialized
      const deleted = await scheduler.deleteAutomation(automationId)
      if (!deleted) {
        res.status(404).json({ error: 'Automation not found' })
        return
      }
      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'Failed to delete automation' })
    }
  })

  router.post('/:id/run', requireWriteAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    try {
      await initialized
      const result = await scheduler.runAutomation(automationId, 'manual')
      if (!result) {
        const existing = await scheduler.getAutomation(automationId)
        if (!existing) {
          res.status(404).json({ error: 'Automation not found' })
          return
        }
        res.status(409).json({ error: 'Automation could not be triggered in its current state' })
        return
      }
      res.status(201).json({
        automation: toAutomationResponse(result.automation, scheduler),
        historyEntry: result.historyEntry,
      })
    } catch {
      res.status(500).json({ error: 'Failed to trigger automation' })
    }
  })

  router.get('/:id/history', requireReadAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    try {
      await initialized
      const automation = await scheduler.getAutomation(automationId)
      if (!automation) {
        res.status(404).json({ error: 'Automation not found' })
        return
      }
      const limit = parsePagination(req.query.limit, 50, 1, 200)
      const offset = parsePagination(req.query.offset, 0, 0, 10_000)
      const { entries, total } = await store.listHistory(automationId, { limit, offset })
      res.json({ entries, total, limit, offset })
    } catch {
      res.status(500).json({ error: 'Failed to list automation history' })
    }
  })

  router.get('/:id/memory', requireReadAccess, async (req, res) => {
    const automationId = parseAutomationId(req.params.id)
    if (!automationId) {
      res.status(400).json({ error: 'Invalid automation id' })
      return
    }
    try {
      await initialized
      const automation = await scheduler.getAutomation(automationId)
      if (!automation) {
        res.status(404).json({ error: 'Automation not found' })
        return
      }
      const memory = (await store.readMemory(automationId)) ?? ''
      res.json({ automationId, memory })
    } catch {
      res.status(500).json({ error: 'Failed to read automation memory' })
    }
  })

  return {
    router,
    scheduler,
    store,
    ready: initialized,
  }
}
