import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
  type ClaudeEffortLevel,
} from '../claude-effort.js'
import {
  createDefaultHeartbeatState,
  normalizeHeartbeatState,
  type CommanderHeartbeatState,
} from './heartbeat.js'
import type { ConversationStore } from './conversation-store.js'
import { resolveCommanderSessionStorePath } from './paths.js'
import {
  createDefaultCommanderRuntimeConfig,
  DEFAULT_COMMANDER_RUNTIME_DEFAULT_MAX_TURNS,
  DEFAULT_COMMANDER_RUNTIME_LIMIT_MAX_TURNS,
  type CommanderRuntimeConfig,
} from './runtime-config.shared.js'

const COMMANDER_STATES = new Set<CommanderSession['state']>([
  'idle',
  'running',
  'paused',
  'stopped',
])

const LEGACY_RUNTIME_KEYS = [
  'pid',
  'currentTask',
  'lastHeartbeat',
  'heartbeat',
  'heartbeatTickCount',
  'claudeSessionId',
  'codexThreadId',
  'geminiSessionId',
  'channelMeta',
  'lastRoute',
  'completedTasks',
  'totalCostUsd',
]

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
  agentType?: 'claude' | 'codex' | 'gemini'
  effort?: ClaudeEffortLevel
  cwd?: string
  maxTurns: number
  contextMode: CommanderContextMode
  contextConfig?: HeartbeatContextConfig
  taskSource: CommanderTaskSource | null
  remoteOrigin?: CommanderRemoteOrigin
}

export type CommanderConversationSurface =
  | 'discord'
  | 'telegram'
  | 'whatsapp'
  | 'ui'
  | 'cli'
  | 'api'

export interface CommanderConversationBackfill {
  id: string
  commanderId: string
  surface: CommanderConversationSurface
  channelMeta?: CommanderChannelMeta
  lastRoute?: CommanderLastRoute
  status: 'active' | 'idle' | 'archived'
  currentTask: CommanderCurrentTask | null
  claudeSessionId?: string
  codexThreadId?: string
  geminiSessionId?: string
  lastHeartbeat: string | null
  heartbeat: CommanderHeartbeatState
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  createdAt: string
  lastMessageAt: string
}

interface ParsedCommanderSessions {
  sessions: CommanderSession[]
  backfills: CommanderConversationBackfill[]
  legacyShapeDetected: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function parseCurrentTask(raw: unknown): CommanderCurrentTask | null {
  if (raw === null || raw === undefined) {
    return null
  }

  if (!isObject(raw)) {
    return null
  }

  const issueNumber = raw.issueNumber
  const issueUrl = raw.issueUrl
  const startedAt = raw.startedAt
  if (
    typeof issueNumber !== 'number' ||
    !Number.isInteger(issueNumber) ||
    issueNumber < 1 ||
    typeof issueUrl !== 'string' ||
    issueUrl.trim().length === 0 ||
    typeof startedAt !== 'string' ||
    startedAt.trim().length === 0
  ) {
    return null
  }

  return {
    issueNumber,
    issueUrl: issueUrl.trim(),
    startedAt: startedAt.trim(),
  }
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

function parseAgentType(raw: unknown): 'claude' | 'codex' | 'gemini' {
  if (raw === 'codex' || raw === 'gemini') {
    return raw
  }
  return 'claude'
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

function hasLegacyRuntimeShape(raw: Record<string, unknown>): boolean {
  return LEGACY_RUNTIME_KEYS.some((key) => raw[key] !== undefined && raw[key] !== null)
}

function normalizeLegacyConversationStatus(
  rawState: CommanderSession['state'],
): CommanderConversationBackfill['status'] {
  return rawState === 'running'
    ? 'active'
    : 'idle'
}

function surfaceFromChannelMeta(
  channelMeta: CommanderChannelMeta | undefined,
): CommanderConversationSurface {
  switch (channelMeta?.provider) {
    case 'discord':
      return 'discord'
    case 'telegram':
      return 'telegram'
    case 'whatsapp':
      return 'whatsapp'
    default:
      return 'ui'
  }
}

export function buildLegacyCommanderConversationId(commanderId: string): string {
  const hash = createHash('sha256')
    .update(`legacy-conversation:${commanderId}`)
    .digest('hex')

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-')
}

function buildLegacyBackfill(
  raw: Record<string, unknown>,
  session: CommanderSession,
  runtimeConfig: CommanderRuntimeConfig,
): CommanderConversationBackfill {
  const channelMeta = parseCommanderChannelMeta(raw.channelMeta)
  const lastRoute = parseCommanderLastRoute(raw.lastRoute)
  const currentTask = parseCurrentTask(raw.currentTask)
  const lastHeartbeat = typeof raw.lastHeartbeat === 'string'
    ? raw.lastHeartbeat.trim() || null
    : null
  const heartbeatTickCount = typeof raw.heartbeatTickCount === 'number' && Number.isFinite(raw.heartbeatTickCount)
    ? Math.max(0, Math.floor(raw.heartbeatTickCount))
    : 0
  const heartbeat = normalizeHeartbeatState(raw.heartbeat, lastHeartbeat)
  const completedTasks = typeof raw.completedTasks === 'number' && Number.isFinite(raw.completedTasks)
    ? Math.max(0, Math.floor(raw.completedTasks))
    : 0
  const totalCostUsd = typeof raw.totalCostUsd === 'number' && Number.isFinite(raw.totalCostUsd)
    ? Math.max(0, raw.totalCostUsd)
    : 0

  return {
    id: buildLegacyCommanderConversationId(session.id),
    commanderId: session.id,
    surface: surfaceFromChannelMeta(channelMeta),
    ...(channelMeta ? { channelMeta } : {}),
    ...(lastRoute ? { lastRoute } : {}),
    status: normalizeLegacyConversationStatus(session.state),
    currentTask,
    claudeSessionId: parseOptionalNonEmptyString(raw.claudeSessionId),
    codexThreadId: parseOptionalNonEmptyString(raw.codexThreadId),
    geminiSessionId: parseOptionalNonEmptyString(raw.geminiSessionId),
    lastHeartbeat: heartbeat.lastSentAt ?? lastHeartbeat,
    heartbeat,
    heartbeatTickCount,
    completedTasks,
    totalCostUsd,
    createdAt: session.created,
    lastMessageAt: heartbeat.lastSentAt ?? session.created,
  }
}

function parseCommanderSession(
  raw: unknown,
  runtimeConfig: CommanderRuntimeConfig,
): { session: CommanderSession | null; backfill?: CommanderConversationBackfill; legacyShapeDetected: boolean } {
  if (!isObject(raw)) {
    return { session: null, legacyShapeDetected: false }
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
  const agentType = parseAgentType(raw.agentType)
  const effort = normalizeClaudeEffortLevel(raw.effort, DEFAULT_CLAUDE_EFFORT_LEVEL)
  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim().length > 0
    ? raw.cwd.trim()
    : undefined
  const taskSource = raw.taskSource != null ? parseTaskSource(raw.taskSource) : null
  const contextConfig = parseHeartbeatContextConfig(raw.contextConfig)
  const maxTurns = parseCommanderMaxTurns(raw.maxTurns, runtimeConfig)
  const contextMode = parseCommanderContextMode(raw.contextMode)
  const remoteOrigin = parseRemoteOrigin(raw.remoteOrigin)
  const state = raw.state

  if (
    !id ||
    !host ||
    !created ||
    !COMMANDER_STATES.has(state as CommanderSession['state'])
  ) {
    return { session: null, legacyShapeDetected: false }
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
    cwd,
    maxTurns,
    contextMode,
    contextConfig,
    taskSource,
    ...(remoteOrigin ? { remoteOrigin } : {}),
  }

  const legacyShapeDetected = hasLegacyRuntimeShape(raw)
  return {
    session,
    backfill: legacyShapeDetected
      ? buildLegacyBackfill(raw, session, runtimeConfig)
      : undefined,
    legacyShapeDetected,
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
  const backfills: CommanderConversationBackfill[] = []
  let legacyShapeDetected = false

  for (const entry of candidates) {
    const parsed = parseCommanderSession(entry, runtimeConfig)
    if (!parsed.session) {
      continue
    }
    sessions.push(parsed.session)
    if (parsed.backfill) {
      backfills.push(parsed.backfill)
    }
    legacyShapeDetected = legacyShapeDetected || parsed.legacyShapeDetected
  }

  return { sessions, backfills, legacyShapeDetected }
}

function cloneSession(session: CommanderSession): CommanderSession {
  return {
    ...session,
    contextConfig: session.contextConfig ? { ...session.contextConfig } : undefined,
    taskSource: session.taskSource ? { ...session.taskSource } : null,
    ...(session.remoteOrigin ? { remoteOrigin: { ...session.remoteOrigin } } : {}),
  }
}

function serializeSession(session: CommanderSession): CommanderSession {
  return cloneSession(session)
}

export function defaultCommanderSessionStorePath(): string {
  return resolveCommanderSessionStorePath()
}

export interface CommanderSessionStoreOptions {
  runtimeConfig?: CommanderRuntimeConfig
  persistBackfilledConversation?: (conversation: CommanderConversationBackfill) => Promise<void>
  logger?: Pick<Console, 'info' | 'warn'>
}

export class CommanderSessionStore {
  private readonly filePath: string
  private readonly runtimeConfig: CommanderRuntimeConfig
  private readonly persistBackfilledConversation?: (conversation: CommanderConversationBackfill) => Promise<void>
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
    this.persistBackfilledConversation = options.persistBackfilledConversation
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

  // Deprecated compatibility shim. Channel binding moved to ConversationStore.
  async findOrCreateBySessionKey(): Promise<never> {
    throw new Error('CommanderSessionStore.findOrCreateBySessionKey moved to ConversationStore')
  }

  // Deprecated compatibility shim. Heartbeat state moved to Conversation persistence.
  async updateLastHeartbeat(
    input: {
      conversationId: string
      timestamp: string
    },
    conversationStore: Pick<ConversationStore, 'update'>,
  ): Promise<boolean> {
    const updated = await conversationStore.update(input.conversationId, (current) => ({
      ...current,
      lastHeartbeat: input.timestamp,
      heartbeat: {
        ...current.heartbeat,
        lastSentAt: input.timestamp,
      },
      heartbeatTickCount: current.heartbeatTickCount + 1,
    }))
    return updated !== null
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

      let backfillPersisted = false
      if (persisted.backfills.length > 0 && this.persistBackfilledConversation) {
        for (const backfill of persisted.backfills) {
          await this.persistBackfilledConversation(backfill)
          this.logger.info(
            `[commanders][backfill] Lifted runtime fields from commander "${backfill.commanderId}" into conversation "${backfill.id}"`,
          )
        }
        backfillPersisted = true
      } else if (persisted.backfills.length > 0) {
        this.logger.warn(
          `[commanders][backfill] Detected ${persisted.backfills.length} legacy commander runtime records but no conversation backfill handler is configured`,
        )
      }

      if (persisted.legacyShapeDetected && (persisted.backfills.length === 0 || backfillPersisted)) {
        await this.writeToDisk()
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
        return { sessions: [], backfills: [], legacyShapeDetected: false }
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawFile) as unknown
    } catch {
      return { sessions: [], backfills: [], legacyShapeDetected: false }
    }

    return parsePersistedCommanderSessions(parsed, this.runtimeConfig)
  }

  private async writeToDisk(): Promise<void> {
    const sessions = [...this.sessions().values()]
      .map((session) => serializeSession(session))
      .sort((left, right) => left.created.localeCompare(right.created))

    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(
      this.filePath,
      JSON.stringify({ sessions }, null, 2),
      'utf8',
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
