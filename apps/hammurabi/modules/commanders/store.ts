import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
  type ClaudeEffortLevel,
} from '../claude-effort.js'
import { parseProviderId } from '../agents/providers/registry.js'
import type { ProviderSessionContext } from '../agents/providers/provider-session-context.js'
import type { AgentType } from '../agents/types.js'
import {
  createDefaultHeartbeatConfig,
  normalizeHeartbeatConfig,
  type CommanderHeartbeatConfig,
} from './heartbeat.js'
import { resolveCommanderSessionStorePath } from './paths.js'
import {
  createDefaultCommanderRuntimeConfig,
  DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS,
  DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS,
  type CommanderRuntimeConfig,
} from './runtime-config.shared.js'
import type { OrgCommanderRoleKey } from '../org/types.js'
import { writeJsonFileAtomically } from '../../migrations/write-json-file-atomically.js'
import {
  migrateProviderContext,
  migratedProviderContextChanged,
  parseCanonicalProviderContext,
} from '../../migrations/provider-context.js'

const COMMANDER_STATES = new Set<CommanderSession['state']>([
  'idle',
  'running',
  'paused',
  'stopped',
])

export const DEFAULT_COMMANDER_MAX_TURNS = DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS
export const MAX_COMMANDER_MAX_TURNS = DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS
export type CommanderContextMode = 'thin' | 'fat'
export const DEFAULT_COMMANDER_CONTEXT_MODE: CommanderContextMode = 'fat'

export interface CommanderTaskSource {
  owner: string
  repo: string
  label?: string
  project?: string
}

export interface CommanderCurrentTask {
  issueNumber: number
  issueUrl: string
  startedAt: string
}

export interface HeartbeatContextConfig {
  fatPinInterval?: number
}

export interface CommanderRemoteOrigin {
  machineId: string
  label: string
  syncToken: string
}

export interface CommanderChannelMeta {
  provider: 'whatsapp' | 'telegram' | 'discord'
  chatType: 'direct' | 'group' | 'channel' | 'forum-topic'
  accountId: string
  peerId: string
  parentPeerId?: string
  groupId?: string
  threadId?: string
  sessionKey: string
  displayName: string
  subject?: string
  space?: string
}

export interface CommanderLastRoute {
  channel: string
  to: string
  accountId: string
  threadId?: string
}

export interface CommanderSession {
  id: string
  host: string
  avatarSeed?: string
  persona?: string
  state: 'idle' | 'running' | 'paused' | 'stopped'
  created: string
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  providerContext?: ProviderSessionContext
  cwd?: string
  heartbeat: CommanderHeartbeatConfig
  maxTurns: number
  contextMode: CommanderContextMode
  contextConfig?: HeartbeatContextConfig
  taskSource: CommanderTaskSource | null
  operatorId?: string
  roleKey?: OrgCommanderRoleKey
  templateId?: string | null
  replicatedFromCommanderId?: string | null
  archived?: boolean
  archivedAt?: string
  remoteOrigin?: CommanderRemoteOrigin
}

export type CommanderConversationSurface =
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'ui'
  | 'cli'
  | 'api'

interface ParsedCommanderSessions {
  sessions: CommanderSession[]
  commanderHeartbeatMissingIds: Set<string>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOwnProperty(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function latestIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed) {
      continue
    }
    if (!latest || trimmed > latest) {
      latest = trimmed
    }
  }
  return latest
}

function isNonDefaultHeartbeat(heartbeat: CommanderHeartbeatConfig): boolean {
  const defaults = createDefaultHeartbeatConfig()
  return heartbeat.intervalMs !== defaults.intervalMs ||
    heartbeat.messageTemplate.trim() !== defaults.messageTemplate.trim() ||
    heartbeat.intervalOverridden === true
}

function parseTaskSource(raw: unknown): CommanderTaskSource | null {
  if (!isObject(raw)) {
    return null
  }

  const owner = typeof raw.owner === 'string' ? raw.owner.trim() : ''
  const repo = typeof raw.repo === 'string' ? raw.repo.trim() : ''
  if (!owner || !repo) {
    return null
  }

  const label = typeof raw.label === 'string' && raw.label.trim().length > 0
    ? raw.label.trim()
    : undefined
  const project = typeof raw.project === 'string' && raw.project.trim().length > 0
    ? raw.project.trim()
    : undefined

  return { owner, repo, label, project }
}

function parseHeartbeatContextConfig(raw: unknown): HeartbeatContextConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined
  }

  if (!isObject(raw)) {
    return undefined
  }

  const fatPinInterval = raw.fatPinInterval
  if (
    fatPinInterval === undefined ||
    (
      typeof fatPinInterval === 'number' &&
      Number.isInteger(fatPinInterval) &&
      fatPinInterval > 0
    )
  ) {
    return fatPinInterval === undefined
      ? {}
      : { fatPinInterval }
  }

  return undefined
}

function parseRemoteOrigin(raw: unknown): CommanderRemoteOrigin | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const machineId = typeof raw.machineId === 'string' ? raw.machineId.trim() : ''
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const syncToken = typeof raw.syncToken === 'string' ? raw.syncToken.trim() : ''
  if (!machineId || !label || !syncToken) {
    return undefined
  }

  return {
    machineId,
    label,
    syncToken,
  }
}

function parseOptionalNonEmptyString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined
}

function parseOptionalCommanderRoleKey(raw: unknown): OrgCommanderRoleKey | undefined {
  return raw === 'engineering'
    || raw === 'research'
    || raw === 'ops'
    || raw === 'content'
    || raw === 'validator'
    || raw === 'ea'
    ? raw
    : undefined
}

function parseChannelProvider(raw: unknown): CommanderChannelMeta['provider'] | null {
  return raw === 'whatsapp' || raw === 'telegram' || raw === 'discord'
    ? raw
    : null
}

function parseChannelChatType(raw: unknown): CommanderChannelMeta['chatType'] | null {
  return raw === 'direct' || raw === 'group' || raw === 'channel' || raw === 'forum-topic'
    ? raw
    : null
}

export function parseCommanderChannelMeta(raw: unknown): CommanderChannelMeta | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const provider = parseChannelProvider(raw.provider)
  const chatType = parseChannelChatType(raw.chatType)
  const accountId = parseOptionalNonEmptyString(raw.accountId)
  const peerId = parseOptionalNonEmptyString(raw.peerId)
  const sessionKey = parseOptionalNonEmptyString(raw.sessionKey)
  const displayName = parseOptionalNonEmptyString(raw.displayName)
  if (!provider || !chatType || !accountId || !peerId || !sessionKey || !displayName) {
    return undefined
  }

  return {
    provider,
    chatType,
    accountId,
    peerId,
    parentPeerId: parseOptionalNonEmptyString(raw.parentPeerId),
    groupId: parseOptionalNonEmptyString(raw.groupId),
    threadId: parseOptionalNonEmptyString(raw.threadId),
    sessionKey,
    displayName,
    subject: parseOptionalNonEmptyString(raw.subject),
    space: parseOptionalNonEmptyString(raw.space),
  }
}

export function parseCommanderLastRoute(raw: unknown): CommanderLastRoute | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const channel = parseOptionalNonEmptyString(raw.channel)
  const to = parseOptionalNonEmptyString(raw.to)
  const accountId = parseOptionalNonEmptyString(raw.accountId)
  if (!channel || !to || !accountId) {
    return undefined
  }

  return {
    channel,
    to,
    accountId,
    threadId: parseOptionalNonEmptyString(raw.threadId),
  }
}

function parseCommanderMaxTurns(raw: unknown, runtimeConfig: CommanderRuntimeConfig): number {
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1
  ) {
    return runtimeConfig.defaults.maxTurns
  }

  return Math.min(raw, runtimeConfig.limits.maxTurns)
}

function parseCommanderContextMode(raw: unknown): CommanderContextMode {
  return raw === 'thin'
    ? 'thin'
    : DEFAULT_COMMANDER_CONTEXT_MODE
}

function buildCommanderConversationHashId(seed: string): string {
  const hash = createHash('sha256')
    .update(seed)
    .digest('hex')

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-')
}

export function buildDefaultCommanderConversationId(commanderId: string): string {
  return buildCommanderConversationHashId(`default-conversation:${commanderId}`)
}

function parseCommanderSession(
  raw: unknown,
  runtimeConfig: CommanderRuntimeConfig,
): {
  session: CommanderSession | null
  heartbeatMissing?: boolean
} {
  if (!isObject(raw)) {
    return { session: null }
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const host = typeof raw.host === 'string' ? raw.host.trim() : ''
  const avatarSeed = typeof raw.avatarSeed === 'string' && raw.avatarSeed.trim().length > 0
    ? raw.avatarSeed.trim()
    : undefined
  const persona = typeof raw.persona === 'string' && raw.persona.trim().length > 0
    ? raw.persona.trim()
    : undefined
  const created = typeof raw.created === 'string' ? raw.created.trim() : ''
  const agentType = parseProviderId(raw.agentType) ?? 'claude'
  const effort = normalizeClaudeEffortLevel(raw.effort, DEFAULT_CLAUDE_EFFORT_LEVEL)
  const providerContext = parseCanonicalProviderContext(raw.providerContext, { effort }) ?? undefined
  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim().length > 0
    ? raw.cwd.trim()
    : undefined
  const taskSource = raw.taskSource != null ? parseTaskSource(raw.taskSource) : null
  const contextConfig = parseHeartbeatContextConfig(raw.contextConfig)
  const maxTurns = parseCommanderMaxTurns(raw.maxTurns, runtimeConfig)
  const contextMode = parseCommanderContextMode(raw.contextMode)
  const heartbeat = normalizeHeartbeatConfig(raw.heartbeat)
  const heartbeatMissing = !hasOwnProperty(raw, 'heartbeat')
  const operatorId = parseOptionalNonEmptyString(raw.operatorId)
  const roleKey = parseOptionalCommanderRoleKey(raw.roleKey)
  const templateId = raw.templateId === null ? null : parseOptionalNonEmptyString(raw.templateId)
  const replicatedFromCommanderId = raw.replicatedFromCommanderId === null
    ? null
    : parseOptionalNonEmptyString(raw.replicatedFromCommanderId)
  const archived = raw.archived === true
  const archivedAt = archived ? parseOptionalNonEmptyString(raw.archivedAt) : undefined
  const remoteOrigin = parseRemoteOrigin(raw.remoteOrigin)
  const state = raw.state

  if (
    !id ||
    !host ||
    !created ||
    !COMMANDER_STATES.has(state as CommanderSession['state'])
  ) {
    return { session: null }
  }

  const session: CommanderSession = {
    id,
    host,
    avatarSeed,
    persona,
    state: state as CommanderSession['state'],
    created,
    agentType,
    effort,
    ...(providerContext ? { providerContext } : {}),
    cwd,
    heartbeat,
    maxTurns,
    contextMode,
    contextConfig,
    taskSource,
    ...(operatorId ? { operatorId } : {}),
    ...(roleKey ? { roleKey } : {}),
    ...(templateId !== undefined ? { templateId } : {}),
    ...(replicatedFromCommanderId !== undefined ? { replicatedFromCommanderId } : {}),
    ...(archived ? { archived: true } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    ...(remoteOrigin ? { remoteOrigin } : {}),
  }

  return {
    session,
    heartbeatMissing,
  }
}

function parsePersistedCommanderSessions(
  raw: unknown,
  runtimeConfig: CommanderRuntimeConfig,
): ParsedCommanderSessions {
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : (isObject(raw) && Array.isArray(raw.sessions) ? raw.sessions : [])

  const sessions: CommanderSession[] = []
  const commanderHeartbeatMissingIds = new Set<string>()

  for (const entry of candidates) {
    const parsed = parseCommanderSession(entry, runtimeConfig)
    if (!parsed.session) {
      continue
    }
    sessions.push(parsed.session)
    if (parsed.heartbeatMissing) {
      commanderHeartbeatMissingIds.add(parsed.session.id)
    }
  }

  return { sessions, commanderHeartbeatMissingIds }
}

function cloneSession(session: CommanderSession): CommanderSession {
  return {
    ...session,
    ...(session.providerContext ? { providerContext: { ...session.providerContext } } : {}),
    heartbeat: normalizeHeartbeatConfig(session.heartbeat),
    contextConfig: session.contextConfig ? { ...session.contextConfig } : undefined,
    taskSource: session.taskSource ? { ...session.taskSource } : null,
    ...(session.remoteOrigin ? { remoteOrigin: { ...session.remoteOrigin } } : {}),
  }
}

type SerializedCommanderSession = Record<string, unknown> & { created: string }

function serializeSession(session: CommanderSession): SerializedCommanderSession {
  const raw = cloneSession(session) as unknown as Record<string, unknown>
  const cleaned = migrateProviderContext(raw).cleaned
  return {
    ...cleaned,
    created: typeof cleaned.created === 'string' ? cleaned.created : session.created,
  }
}

export function defaultCommanderSessionStorePath(): string {
  return resolveCommanderSessionStorePath()
}

export interface CommanderSessionStoreOptions {
  runtimeConfig?: CommanderRuntimeConfig
  logger?: Pick<Console, 'info' | 'warn'>
}

export class CommanderSessionStore {
  private readonly filePath: string
  private readonly runtimeConfig: CommanderRuntimeConfig
  private readonly logger: Pick<Console, 'info' | 'warn'>
  private sessionsById: Map<string, CommanderSession> | null = null
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    filePath: string = defaultCommanderSessionStorePath(),
    options: CommanderSessionStoreOptions = {},
  ) {
    this.filePath = path.resolve(filePath)
    this.runtimeConfig = options.runtimeConfig ?? createDefaultCommanderRuntimeConfig()
    this.logger = options.logger ?? console
  }

  async list(): Promise<CommanderSession[]> {
    await this.ensureLoaded()
    return [...this.sessions().values()]
      .map((session) => cloneSession(session))
      .sort((left, right) => left.created.localeCompare(right.created))
  }

  async get(id: string): Promise<CommanderSession | null> {
    await this.ensureLoaded()
    const found = this.sessions().get(id)
    return found ? cloneSession(found) : null
  }

  async create(session: CommanderSession): Promise<CommanderSession> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const sessions = this.sessions()
      if (sessions.has(session.id)) {
        throw new Error(`Commander session "${session.id}" already exists`)
      }

      sessions.set(session.id, cloneSession(session))
      await this.writeToDisk()
      return cloneSession(session)
    })
  }

  async update(
    id: string,
    mutate: (current: CommanderSession) => CommanderSession,
  ): Promise<CommanderSession | null> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const sessions = this.sessions()
      const existing = sessions.get(id)
      if (!existing) {
        return null
      }

      const next = mutate(cloneSession(existing))
      sessions.set(id, cloneSession(next))
      await this.writeToDisk()
      return cloneSession(next)
    })
  }

  async delete(id: string): Promise<boolean> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const sessions = this.sessions()
      if (!sessions.has(id)) {
        return false
      }
      sessions.delete(id)
      await this.writeToDisk()
      return true
    })
  }

  private sessions(): Map<string, CommanderSession> {
    if (!this.sessionsById) {
      throw new Error('CommanderSessionStore not loaded')
    }
    return this.sessionsById
  }

  private async ensureLoaded(): Promise<void> {
    if (this.sessionsById) {
      return
    }
    if (this.loadPromise) {
      await this.loadPromise
      return
    }

    this.loadPromise = (async () => {
      const persisted = await this.readFromDisk()
      if (!this.sessionsById) {
        this.sessionsById = new Map(
          persisted.sessions.map((session) => [session.id, cloneSession(session)]),
        )
      }

      let heartbeatMigrationPersisted = false
      if (persisted.commanderHeartbeatMissingIds.size > 0) {
        for (const commanderId of persisted.commanderHeartbeatMissingIds) {
          const session = this.sessions().get(commanderId)
          if (!session) {
            continue
          }
          session.heartbeat = await this.resolveMigratedCommanderHeartbeat(commanderId)
        }
        heartbeatMigrationPersisted = true
      }

      if (heartbeatMigrationPersisted) {
        await this.writeToDisk({ backup: true })
      }
    })()

    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async readFromDisk(): Promise<ParsedCommanderSessions> {
    let rawFile: string
    try {
      rawFile = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          sessions: [],
          commanderHeartbeatMissingIds: new Set<string>(),
        }
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawFile) as unknown
    } catch {
      return {
        sessions: [],
        commanderHeartbeatMissingIds: new Set<string>(),
      }
    }

    const parsedPayload = isObject(parsed) ? parsed : null
    const sessions = Array.isArray(parsed)
      ? parsed
      : (parsedPayload && Array.isArray(parsedPayload.sessions) ? parsedPayload.sessions : null)
    if (!sessions) {
      return parsePersistedCommanderSessions(parsed, this.runtimeConfig)
    }

    let migratedCount = 0
    const migratedSessions = sessions.map((entry) => {
      if (!isObject(entry)) {
        return entry
      }
      const { cleaned } = migrateProviderContext(entry)
      if (migratedProviderContextChanged(entry, cleaned)) {
        migratedCount += 1
      }
      return cleaned
    })

    const migratedPayload = Array.isArray(parsed)
      ? migratedSessions
      : { ...parsedPayload, sessions: migratedSessions }
    if (migratedCount > 0) {
      await writeJsonFileAtomically(this.filePath, migratedPayload, { backup: true })
      this.logger.warn(
        `[commanders][migration] Migrated providerContext in ${migratedCount} commander session record(s)`,
      )
    }

    return parsePersistedCommanderSessions(migratedPayload, this.runtimeConfig)
  }

  private async resolveMigratedCommanderHeartbeat(commanderId: string): Promise<CommanderHeartbeatConfig> {
    const candidates = await this.readHistoricalConversationHeartbeatCandidates(commanderId)
    const selected = candidates
      .filter((candidate) => isNonDefaultHeartbeat(candidate.heartbeat))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0]
    return selected ? { ...selected.heartbeat } : createDefaultHeartbeatConfig()
  }

  private async readHistoricalConversationHeartbeatCandidates(
    commanderId: string,
  ): Promise<Array<{ heartbeat: CommanderHeartbeatConfig; timestamp: string }>> {
    const conversationsDir = path.join(path.dirname(this.filePath), commanderId, 'conversations')
    let files: import('node:fs').Dirent[]
    try {
      files = await readdir(conversationsDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }

    const candidates: Array<{ heartbeat: CommanderHeartbeatConfig; timestamp: string }> = []
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) {
        continue
      }

      try {
        const raw = JSON.parse(await readFile(path.join(conversationsDir, file.name), 'utf8')) as unknown
        if (!isObject(raw) || raw.commanderId !== commanderId || !hasOwnProperty(raw, 'heartbeat')) {
          continue
        }
        const lastHeartbeat = typeof raw.lastHeartbeat === 'string' && raw.lastHeartbeat.trim().length > 0
          ? raw.lastHeartbeat.trim()
          : null
        const heartbeat = normalizeHeartbeatConfig(raw.heartbeat)
        const historicalHeartbeatLastSentAt = isObject(raw.heartbeat) && typeof raw.heartbeat.lastSentAt === 'string'
          ? raw.heartbeat.lastSentAt.trim() || null
          : null
        const timestamp = latestIsoTimestamp([
          typeof raw.lastMessageAt === 'string' ? raw.lastMessageAt : null,
          historicalHeartbeatLastSentAt,
          lastHeartbeat,
          typeof raw.createdAt === 'string' ? raw.createdAt : null,
        ]) ?? ''
        candidates.push({ heartbeat, timestamp })
      } catch {
        // Ignore malformed historical conversation files; session loading must remain tolerant.
      }
    }
    return candidates
  }

  private async writeToDisk(options: { backup?: boolean } = {}): Promise<void> {
    const sessions = [...this.sessions().values()]
      .map((session) => serializeSession(session))
      .sort((left, right) => left.created.localeCompare(right.created))

    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeJsonFileAtomically(
      this.filePath,
      { sessions },
      { backup: options.backup },
    )
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

export function isCommanderSessionRunning(
  session: Pick<CommanderSession, 'state'> | null | undefined,
): boolean {
  return session?.state === 'running'
}
