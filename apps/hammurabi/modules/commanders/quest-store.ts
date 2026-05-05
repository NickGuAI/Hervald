import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseClaudePermissionMode,
} from '../agents/session/input.js'
import { resolveCommanderDataDir } from './paths.js'
import type { AutomationQuestEventBus } from '../automations/quest-event-bus.js'

export type CommanderQuestStatus = 'pending' | 'active' | 'done' | 'failed'
export type CommanderQuestSource = 'manual' | 'github-issue' | 'idea' | 'voice-log'
export type QuestArtifactType = 'github_issue' | 'github_pr' | 'url' | 'file'

export interface QuestArtifact {
  type: QuestArtifactType
  label: string
  href: string
}

export interface CommanderQuestContract {
  cwd: string
  permissionMode: 'default'
  agentType: string
  skillsToUse: string[]
}

export interface CommanderQuest {
  id: string
  commanderId: string
  claimedByConversationId?: string
  createdAt: string
  completedAt?: string
  status: CommanderQuestStatus
  source: CommanderQuestSource
  instruction: string
  githubIssueUrl?: string
  note?: string
  artifacts?: QuestArtifact[]
  contract: CommanderQuestContract
}

interface PersistedCommanderQuests {
  quests: CommanderQuest[]
}

export interface CreateCommanderQuestInput {
  commanderId: string
  claimedByConversationId?: string
  createdAt?: string
  status: CommanderQuestStatus
  source: CommanderQuestSource
  instruction: string
  githubIssueUrl?: string
  note?: string
  artifacts?: QuestArtifact[]
  contract: CommanderQuestContract
}

export interface UpdateCommanderQuestInput {
  claimedByConversationId?: string | null
  status?: CommanderQuestStatus
  source?: CommanderQuestSource
  instruction?: string
  githubIssueUrl?: string | null
  note?: string | null
  artifacts?: QuestArtifact[] | null
  contract?: CommanderQuestContract
}

export class QuestAlreadyClaimedError extends Error {
  readonly claimedBy: string | null
  readonly status: CommanderQuestStatus

  constructor({
    claimedBy,
    status,
  }: {
    claimedBy: string | null
    status: CommanderQuestStatus
  }) {
    super('Quest already claimed')
    this.name = 'QuestAlreadyClaimedError'
    this.claimedBy = claimedBy
    this.status = status
  }
}

export class QuestUpdateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestUpdateError'
  }
}

const QUEST_STATUSES = new Set<CommanderQuestStatus>(['pending', 'active', 'done', 'failed'])
const QUEST_SOURCES = new Set<CommanderQuestSource>(['manual', 'github-issue', 'idea', 'voice-log'])
const QUEST_ARTIFACT_TYPES = new Set<QuestArtifactType>(['github_issue', 'github_pr', 'url', 'file'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isQuestStatus(value: unknown): value is CommanderQuestStatus {
  return typeof value === 'string' && QUEST_STATUSES.has(value as CommanderQuestStatus)
}

function isQuestSource(value: unknown): value is CommanderQuestSource {
  return typeof value === 'string' && QUEST_SOURCES.has(value as CommanderQuestSource)
}

function isQuestArtifactType(value: unknown): value is QuestArtifactType {
  return typeof value === 'string' && QUEST_ARTIFACT_TYPES.has(value as QuestArtifactType)
}

function normalizeQuestArtifact(raw: unknown): QuestArtifact | null {
  if (!isObject(raw)) {
    return null
  }

  if (!isQuestArtifactType(raw.type)) {
    return null
  }

  const label = asTrimmedString(raw.label)
  const href = asTrimmedString(raw.href)
  if (!label || !href) {
    return null
  }

  return {
    type: raw.type,
    label,
    href,
  }
}

function normalizeQuestArtifacts(raw: unknown): QuestArtifact[] | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const artifacts: QuestArtifact[] = []
  for (const entry of raw) {
    const artifact = normalizeQuestArtifact(entry)
    if (!artifact) {
      return null
    }
    artifacts.push(artifact)
  }

  return artifacts
}

function normalizeSkillsToUse(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const skills: string[] = []
  for (const entry of raw) {
    const skill = asTrimmedString(entry)
    if (!skill) {
      return null
    }
    skills.push(skill)
  }

  return skills
}

function validateClaimStateForCreate(
  status: CommanderQuestStatus,
  claimedByConversationId: string | undefined,
): void {
  if (status === 'active') {
    if (!claimedByConversationId) {
      throw new Error('active quests require claimedByConversationId')
    }
    return
  }

  if (claimedByConversationId) {
    throw new Error('claimedByConversationId is only valid for active quests')
  }
}

interface QuestMigrationRecord {
  id: string
  commanderId: string
  aliasLiteral: string
}

const PERMISSION_MODE_ALIAS_LITERALS = new Set([
  'dangerouslySkipPermissions',
  'bypassPermissions',
  'acceptEdits',
])

function coerceStoredPermissionMode(
  raw: unknown,
): { value: unknown; aliasLiteral?: string } {
  if (typeof raw !== 'string') {
    return { value: raw }
  }

  const trimmed = raw.trim()
  if (!PERMISSION_MODE_ALIAS_LITERALS.has(trimmed)) {
    return { value: raw }
  }

  return {
    value: 'default',
    aliasLiteral: trimmed,
  }
}

function normalizeContract(
  raw: unknown,
): { contract: CommanderQuestContract | null; aliasLiteral?: string } {
  if (!isObject(raw)) {
    return { contract: null }
  }

  const permissionModeInput = coerceStoredPermissionMode(raw.permissionMode)
  if (permissionModeInput.aliasLiteral !== undefined) {
    raw.permissionMode = permissionModeInput.value
  }

  const cwd = asTrimmedString(raw.cwd)
  const permissionMode = parseClaudePermissionMode(raw.permissionMode)
  const agentType = asTrimmedString(raw.agentType)
  const skillsToUse = normalizeSkillsToUse(raw.skillsToUse)
  if (!cwd || permissionMode === null || !agentType || skillsToUse === null) {
    return { contract: null }
  }

  return {
    contract: {
      cwd,
      permissionMode,
      agentType,
      skillsToUse,
    },
    aliasLiteral: permissionModeInput.aliasLiteral,
  }
}

function parseQuest(
  raw: unknown,
  migrations?: QuestMigrationRecord[],
): CommanderQuest | null {
  if (!isObject(raw)) {
    return null
  }

  const id = asTrimmedString(raw.id)
  const commanderId = asTrimmedString(raw.commanderId)
  const claimedByConversationId = asTrimmedString(raw.claimedByConversationId) ?? undefined
  const createdAt = asTrimmedString(raw.createdAt)
  const completedAt = asTrimmedString(raw.completedAt) ?? undefined
  const instruction = asTrimmedString(raw.instruction)
  const { contract, aliasLiteral } = normalizeContract(raw.contract)
  const artifacts = normalizeQuestArtifacts(raw.artifacts) ?? []

  if (
    !id ||
    !commanderId ||
    !createdAt ||
    !isQuestStatus(raw.status) ||
    !isQuestSource(raw.source) ||
    !instruction ||
    !contract
  ) {
    return null
  }

  const githubIssueUrl = asTrimmedString(raw.githubIssueUrl) ?? undefined
  const note = asTrimmedString(raw.note) ?? undefined

  if (aliasLiteral !== undefined && migrations) {
    migrations.push({ id, commanderId, aliasLiteral })
  }

  return {
    id,
    commanderId,
    ...(claimedByConversationId ? { claimedByConversationId } : {}),
    createdAt,
    ...(completedAt ? { completedAt } : {}),
    status: raw.status,
    source: raw.source,
    instruction,
    ...(githubIssueUrl ? { githubIssueUrl } : {}),
    ...(note ? { note } : {}),
    artifacts,
    contract,
  }
}

interface ParsedCommanderQuests extends PersistedCommanderQuests {
  migrationsApplied: QuestMigrationRecord[]
}

function parsePersistedQuests(raw: unknown): ParsedCommanderQuests {
  const migrationsApplied: QuestMigrationRecord[] = []
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : (isObject(raw) && Array.isArray(raw.quests) ? raw.quests : [])

  const quests = candidates
    .map((entry) => parseQuest(entry, migrationsApplied))
    .filter((entry): entry is CommanderQuest => entry !== null)

  return { quests, migrationsApplied }
}

function cloneQuest(quest: CommanderQuest): CommanderQuest {
  return {
    ...quest,
    ...(quest.claimedByConversationId ? { claimedByConversationId: quest.claimedByConversationId } : {}),
    ...(quest.completedAt ? { completedAt: quest.completedAt } : {}),
    artifacts: (quest.artifacts ?? []).map((artifact) => ({ ...artifact })),
    contract: {
      ...quest.contract,
      skillsToUse: [...quest.contract.skillsToUse],
    },
  }
}

function sortQuests(quests: CommanderQuest[]): CommanderQuest[] {
  // Preserve file insertion order when timestamps collide so heartbeat summaries
  // remain stable across fast back-to-back quest creation in tests and UI flows.
  return [...quests].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    isObject(error) &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  )
}

export function defaultQuestStoreDataDir(): string {
  return resolveCommanderDataDir()
}

export class QuestStore {
  private readonly dataDir: string
  private readonly eventBus?: AutomationQuestEventBus
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    config:
      | string
      | {
        dataDir?: string
        eventBus?: AutomationQuestEventBus
      } = defaultQuestStoreDataDir(),
  ) {
    if (typeof config === 'string') {
      this.dataDir = path.resolve(config)
      this.eventBus = undefined
      return
    }

    this.dataDir = path.resolve(config.dataDir ?? defaultQuestStoreDataDir())
    this.eventBus = config.eventBus
  }

  getCommanderFilePath(commanderId: string): string {
    return this.resolveCommanderFilePath(commanderId)
  }

  async list(commanderId: string): Promise<CommanderQuest[]> {
    await this.mutationQueue
    const quests = await this.readQuestsForCommander(commanderId)
    return sortQuests(quests).map((quest) => cloneQuest(quest))
  }

  async listPending(commanderId: string, limit = Number.POSITIVE_INFINITY): Promise<CommanderQuest[]> {
    const pending = (await this.list(commanderId))
      .filter((quest) => quest.status === 'pending')
    if (!Number.isFinite(limit)) {
      return pending
    }

    const boundedLimit = Math.max(0, Math.floor(limit))
    return pending.slice(0, boundedLimit)
  }

  async claimNext(
    commanderId: string,
    conversationId: string,
  ): Promise<CommanderQuest | null> {
    const safeCommanderId = asTrimmedString(commanderId)
    const safeConversationId = asTrimmedString(conversationId)
    if (!safeCommanderId) {
      throw new Error('commanderId is required')
    }
    if (!safeConversationId) {
      throw new Error('conversationId is required')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      const ordered = sortQuests(quests)
      const existingClaim = ordered.find(
        (quest) => quest.status === 'active' && quest.claimedByConversationId === safeConversationId,
      )
      if (existingClaim) {
        return this.claimLocked(safeCommanderId, existingClaim.id, safeConversationId, ordered)
      }

      const nextQuest = ordered.find((quest) => quest.status === 'pending')
      if (!nextQuest) {
        return null
      }

      return this.claimLocked(safeCommanderId, nextQuest.id, safeConversationId, ordered)
    })
  }

  async claim(
    commanderId: string,
    questId: string,
    conversationId: string,
  ): Promise<CommanderQuest | null> {
    const safeCommanderId = asTrimmedString(commanderId)
    const safeQuestId = asTrimmedString(questId)
    const safeConversationId = asTrimmedString(conversationId)
    if (!safeCommanderId || !safeQuestId) {
      throw new Error('commanderId and questId are required')
    }
    if (!safeConversationId) {
      throw new Error('conversationId is required')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      return this.claimLocked(safeCommanderId, safeQuestId, safeConversationId, quests)
    })
  }

  async create(input: CreateCommanderQuestInput): Promise<CommanderQuest> {
    const commanderId = asTrimmedString(input.commanderId)
    const claimedByConversationId = asTrimmedString(input.claimedByConversationId) ?? undefined
    const instruction = asTrimmedString(input.instruction)
    const createdAt = asTrimmedString(input.createdAt) ?? new Date().toISOString()
    const githubIssueUrl = asTrimmedString(input.githubIssueUrl) ?? undefined
    const note = asTrimmedString(input.note) ?? undefined
    let artifacts: QuestArtifact[] = []
    if (input.artifacts !== undefined) {
      const parsedArtifacts = normalizeQuestArtifacts(input.artifacts)
      if (!parsedArtifacts) {
        throw new Error('artifacts is invalid')
      }
      artifacts = parsedArtifacts
    }
    const { contract } = normalizeContract(input.contract)
    if (!commanderId) {
      throw new Error('commanderId is required')
    }
    if (!isQuestStatus(input.status)) {
      throw new Error(`Invalid quest status: ${String(input.status)}`)
    }
    if (!isQuestSource(input.source)) {
      throw new Error(`Invalid quest source: ${String(input.source)}`)
    }
    if (!instruction) {
      throw new Error('instruction is required')
    }
    if (!contract) {
      throw new Error('contract is invalid')
    }
    validateClaimStateForCreate(input.status, claimedByConversationId)

    const nextQuest: CommanderQuest = {
      id: randomUUID(),
      commanderId,
      ...(claimedByConversationId ? { claimedByConversationId } : {}),
      createdAt,
      status: input.status,
      source: input.source,
      instruction,
      ...(githubIssueUrl ? { githubIssueUrl } : {}),
      ...(note ? { note } : {}),
      artifacts,
      contract,
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(commanderId)
      quests.push(nextQuest)
      await this.writeQuestsForCommander(commanderId, quests)
      return cloneQuest(nextQuest)
    })
  }

  async update(
    commanderId: string,
    questId: string,
    update: UpdateCommanderQuestInput,
  ): Promise<CommanderQuest | null> {
    const safeCommanderId = asTrimmedString(commanderId)
    const safeQuestId = asTrimmedString(questId)
    if (!safeCommanderId || !safeQuestId) {
      throw new Error('commanderId and questId are required')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      const index = quests.findIndex((quest) => quest.id === safeQuestId)
      if (index < 0) {
        return null
      }

      const current = quests[index]
      if (!current) {
        return null
      }

      if (update.status === 'active') {
        throw new QuestUpdateError('use claim() to transition into active')
      }
      if (update.claimedByConversationId !== undefined) {
        throw new QuestUpdateError('claimedByConversationId is managed by claim()')
      }

      const nextQuest: CommanderQuest = cloneQuest(current)
      if (update.status !== undefined) {
        if (!isQuestStatus(update.status)) {
          throw new Error(`Invalid quest status: ${String(update.status)}`)
        }
        nextQuest.status = update.status

        if (update.status === 'done' || update.status === 'failed') {
          if (!nextQuest.completedAt) {
            nextQuest.completedAt = new Date().toISOString()
          }
        } else {
          delete nextQuest.completedAt
        }
        delete nextQuest.claimedByConversationId
      }
      if (update.source !== undefined) {
        if (!isQuestSource(update.source)) {
          throw new Error(`Invalid quest source: ${String(update.source)}`)
        }
        nextQuest.source = update.source
      }
      if (update.instruction !== undefined) {
        const instruction = asTrimmedString(update.instruction)
        if (!instruction) {
          throw new Error('instruction must be a non-empty string')
        }
        nextQuest.instruction = instruction
      }
      if (update.githubIssueUrl !== undefined) {
        const githubIssueUrl = asTrimmedString(update.githubIssueUrl)
        if (update.githubIssueUrl !== null && !githubIssueUrl) {
          throw new Error('githubIssueUrl must be a non-empty string or null')
        }
        if (githubIssueUrl) {
          nextQuest.githubIssueUrl = githubIssueUrl
        } else {
          delete nextQuest.githubIssueUrl
        }
      }
      if (update.note !== undefined) {
        const note = asTrimmedString(update.note)
        if (update.note !== null && !note) {
          throw new Error('note must be a non-empty string or null')
        }
        if (note) {
          nextQuest.note = note
        } else {
          delete nextQuest.note
        }
      }
      if (update.artifacts !== undefined) {
        if (update.artifacts === null) {
          nextQuest.artifacts = []
        } else {
          const artifacts = normalizeQuestArtifacts(update.artifacts)
          if (!artifacts) {
            throw new Error('artifacts is invalid')
          }
          nextQuest.artifacts = artifacts
        }
      }
      if (update.contract !== undefined) {
        const { contract } = normalizeContract(update.contract)
        if (!contract) {
          throw new Error('contract is invalid')
        }
        nextQuest.contract = contract
      }

      quests[index] = nextQuest
      await this.writeQuestsForCommander(safeCommanderId, quests)
      if (update.status === 'done' && this.eventBus) {
        this.eventBus.emit({
          event: 'completed',
          questId: nextQuest.id,
          commanderId: safeCommanderId,
          completedAt: nextQuest.completedAt ?? new Date().toISOString(),
        })
      }
      return cloneQuest(nextQuest)
    })
  }

  async appendNote(commanderId: string, questId: string, note: string): Promise<CommanderQuest | null> {
    const safeCommanderId = asTrimmedString(commanderId)
    const safeQuestId = asTrimmedString(questId)
    const safeNote = asTrimmedString(note)
    if (!safeCommanderId || !safeQuestId) {
      throw new Error('commanderId and questId are required')
    }
    if (!safeNote) {
      throw new Error('note must be a non-empty string')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      const index = quests.findIndex((quest) => quest.id === safeQuestId)
      if (index < 0) {
        return null
      }

      const current = quests[index]
      if (!current) {
        return null
      }

      const existingNote = asTrimmedString(current.note)
      const nextQuest: CommanderQuest = {
        ...current,
        note: existingNote ? `${existingNote}\n${safeNote}` : safeNote,
      }

      quests[index] = nextQuest
      await this.writeQuestsForCommander(safeCommanderId, quests)
      return cloneQuest(nextQuest)
    })
  }

  async get(commanderId: string, questId: string): Promise<CommanderQuest | null> {
    const safeQuestId = asTrimmedString(questId)
    if (!safeQuestId) {
      return null
    }

    const quests = await this.list(commanderId)
    return quests.find((quest) => quest.id === safeQuestId) ?? null
  }

  async delete(commanderId: string, questId: string): Promise<boolean> {
    const safeCommanderId = asTrimmedString(commanderId)
    const safeQuestId = asTrimmedString(questId)
    if (!safeCommanderId || !safeQuestId) {
      throw new Error('commanderId and questId are required')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      const nextQuests = quests.filter((quest) => quest.id !== safeQuestId)
      if (nextQuests.length === quests.length) {
        return false
      }

      await this.writeQuestsForCommander(safeCommanderId, nextQuests)
      return true
    })
  }

  async resetActiveToPending(commanderId: string): Promise<number> {
    const safeCommanderId = asTrimmedString(commanderId)
    if (!safeCommanderId) {
      throw new Error('commanderId is required')
    }

    return this.withMutationLock(async () => {
      const quests = await this.readQuestsForCommander(safeCommanderId)
      let changedCount = 0
      const nextQuests = quests.map((quest) => {
        if (quest.status !== 'active') {
          return quest
        }
        changedCount += 1
        return {
          ...quest,
          status: 'pending' as const,
          claimedByConversationId: undefined,
        }
      })

      if (changedCount > 0) {
        await this.writeQuestsForCommander(safeCommanderId, nextQuests)
      }
      return changedCount
    })
  }

  private resolveCommanderFilePath(commanderId: string): string {
    const safeCommanderId = asTrimmedString(commanderId)
    if (!safeCommanderId) {
      throw new Error('commanderId is required')
    }

    const resolved = path.resolve(this.dataDir, safeCommanderId, 'quests.json')
    const basePath = this.dataDir.endsWith(path.sep)
      ? this.dataDir
      : `${this.dataDir}${path.sep}`
    if (!resolved.startsWith(basePath)) {
      throw new Error(`Invalid commanderId path: ${commanderId}`)
    }
    return resolved
  }

  private async readQuestsForCommander(commanderId: string): Promise<CommanderQuest[]> {
    const filePath = this.resolveCommanderFilePath(commanderId)

    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        return []
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return []
    }

    const { quests, migrationsApplied } = parsePersistedQuests(parsed)

    // One-time, idempotent on-disk backfill of retired permissionMode
    // literals. Emit a structured warn per migrated row, then persist the
    // upgraded collection so subsequent reads are a no-op. See #1222.
    if (migrationsApplied.length > 0) {
      for (const migration of migrationsApplied) {
        console.warn(
          '[commanders/quest-store] migrated retired permissionMode',
          {
            questId: migration.id,
            commanderId: migration.commanderId,
            filePath,
            from: migration.aliasLiteral,
            to: 'default',
          },
        )
      }
      try {
        await this.writeQuestsForCommander(commanderId, quests)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          '[commanders/quest-store] failed to persist permissionMode migration',
          { commanderId, filePath, error: message },
        )
      }
    }

    return quests
  }

  private async writeQuestsForCommander(commanderId: string, quests: CommanderQuest[]): Promise<void> {
    const filePath = this.resolveCommanderFilePath(commanderId)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(
      filePath,
      JSON.stringify({ quests: sortQuests(quests) } satisfies PersistedCommanderQuests, null, 2),
      'utf8',
    )
  }

  private async claimLocked(
    commanderId: string,
    questId: string,
    conversationId: string,
    quests: CommanderQuest[],
  ): Promise<CommanderQuest | null> {
    const index = quests.findIndex((quest) => quest.id === questId)
    if (index < 0) {
      return null
    }

    const current = quests[index]
    if (!current) {
      return null
    }

    if (current.status === 'active') {
      if (current.claimedByConversationId === conversationId) {
        return cloneQuest(current)
      }
    }

    if (current.status !== 'pending') {
      throw new QuestAlreadyClaimedError({
        claimedBy: current.claimedByConversationId ?? null,
        status: current.status,
      })
    }

    const nextQuest: CommanderQuest = {
      ...current,
      status: 'active',
      claimedByConversationId: conversationId,
    }
    delete nextQuest.completedAt

    quests[index] = nextQuest
    await this.writeQuestsForCommander(commanderId, quests)
    return cloneQuest(nextQuest)
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
