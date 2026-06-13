import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AgentType } from '../agents/types.js'
import { parseProviderId } from '../agents/providers/registry.js'
import {
  type ProviderSessionContext,
} from '../agents/providers/provider-session-context.js'
import {
  normalizeHeartbeatConfig,
} from './heartbeat.js'
import {
  normalizeVoiceConfig,
  type VoiceConfigOverride,
} from './voice-config.js'
import {
  conversationNamesEqual,
  generateConversationName,
  normalizeConversationName,
} from './conversation-names.js'
import {
  buildDefaultCommanderConversationId,
  parseCommanderChannelMeta,
  parseCommanderLastRoute,
  type CommanderChannelMeta,
  type CommanderConversationSurface,
  type CommanderCurrentTask,
  type CommanderLastRoute,
} from './store.js'
import { resolveCommanderDataDir, resolveCommanderPaths } from './paths.js'
import {
  migrateProviderContext,
  migratedProviderContextChanged,
  parseCanonicalProviderContext,
} from '../agents/providers/provider-context-migration.js'
import { writeJsonFileAtomically } from '../json-file.js'

const CONVERSATION_STATUSES = new Set<Conversation['status']>([
  'active',
  'idle',
  'archived',
])
const CHAT_SURFACES = new Set<Conversation['surface']>([
  'api',
  'cli',
  'ui',
])
const CREATION_SOURCES = new Set<ConversationCreationSource>([
  'ui',
  'cli',
  'api',
  'channel',
  'system-default',
  'unknown',
])
const CREATED_BY_KINDS = new Set<ConversationCreatedByKind>([
  'human',
  'api-key',
  'system',
  'channel',
  'unknown',
])
const CHANNEL_REPLY_DELIVERY_STATUSES = new Set<ChannelReplyDelivery['status']>([
  'pending',
  'delivered',
  'failed',
])
const DEFAULT_CHAT_STATUSES = new Set<Conversation['status']>([
  'active',
  'idle',
])

function activeChatStatusPriority(status: Conversation['status']): number {
  return status === 'active' ? 0 : status === 'idle' ? 1 : 2
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Conversation {
  id: string
  commanderId: string
  surface: CommanderConversationSurface
  channelMeta?: CommanderChannelMeta
  lastRoute?: CommanderLastRoute
  channelReplyDelivery?: ChannelReplyDelivery
  voiceConfig?: VoiceConfigOverride
  agentType?: AgentType | null
  model?: string | null
  name: string
  status: 'active' | 'idle' | 'archived'
  currentTask: CommanderCurrentTask | null
  providerContext?: ProviderSessionContext
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  creationSource: ConversationCreationSource
  createdByKind: ConversationCreatedByKind
  createdById?: string
  createdBySessionName?: string
  createdByConversationId?: string
  requestId?: string
  createdAt: string
  lastMessageAt: string
}

export type ConversationCreationSource =
  | 'ui'
  | 'cli'
  | 'api'
  | 'channel'
  | 'system-default'
  | 'unknown'

export type ConversationCreatedByKind =
  | 'human'
  | 'api-key'
  | 'system'
  | 'channel'
  | 'unknown'

export interface ChannelReplyDelivery {
  id: string
  status: 'pending' | 'delivered' | 'failed'
  message: string
  provider: CommanderChannelMeta['provider']
  sessionKey: string
  lastRoute: CommanderLastRoute
  attemptCount: number
  attemptedAt: string
  updatedAt: string
  deliveredAt?: string
  failedAt?: string
  error?: string
}

export interface ConversationStoreOptions {
  logger?: Pick<Console, 'info' | 'warn'>
}

type ParsedConversation = Omit<Conversation, 'name'> & {
  name?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string'
    ? (value.trim() || null)
    : null
}

function asOptionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    return undefined
  }
  return value.trim() || null
}

function buildHistoricalDefaultCommanderConversationId(commanderId: string): string {
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

function parseCurrentTask(raw: unknown): CommanderCurrentTask | null {
  if (raw === null || raw === undefined || !isObject(raw)) {
    return null
  }

  const issueNumber = raw.issueNumber
  const issueUrl = typeof raw.issueUrl === 'string' ? raw.issueUrl.trim() : ''
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt.trim() : ''
  if (
    typeof issueNumber !== 'number' ||
    !Number.isInteger(issueNumber) ||
    issueNumber < 1 ||
    issueUrl.length === 0 ||
    startedAt.length === 0
  ) {
    return null
  }

  return { issueNumber, issueUrl, startedAt }
}

function parseSurface(raw: unknown): Conversation['surface'] | null {
  if (typeof raw !== 'string') {
    return null
  }
  const normalized = raw.trim()
  return /^[a-z][a-z0-9_-]{1,63}$/i.test(normalized)
    ? normalized as Conversation['surface']
    : null
}

function parseStatus(raw: unknown): Conversation['status'] | null {
  return typeof raw === 'string' && CONVERSATION_STATUSES.has(raw as Conversation['status'])
    ? raw as Conversation['status']
    : null
}

function parseCreationSource(raw: unknown): ConversationCreationSource | null {
  return typeof raw === 'string' && CREATION_SOURCES.has(raw as ConversationCreationSource)
    ? raw as ConversationCreationSource
    : null
}

function parseCreatedByKind(raw: unknown): ConversationCreatedByKind | null {
  return typeof raw === 'string' && CREATED_BY_KINDS.has(raw as ConversationCreatedByKind)
    ? raw as ConversationCreatedByKind
    : null
}

function parseChannelReplyProvider(raw: unknown): CommanderChannelMeta['provider'] | null {
  if (typeof raw !== 'string') {
    return null
  }
  const normalized = raw.trim().toLowerCase()
  return /^[a-z][a-z0-9_-]{1,63}$/i.test(normalized)
    ? normalized as CommanderChannelMeta['provider']
    : null
}

function parseChannelReplyDelivery(raw: unknown): ChannelReplyDelivery | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const id = asOptionalString(raw.id)
  const status = typeof raw.status === 'string' && CHANNEL_REPLY_DELIVERY_STATUSES.has(raw.status as ChannelReplyDelivery['status'])
    ? raw.status as ChannelReplyDelivery['status']
    : null
  const message = asOptionalString(raw.message)
  const provider = parseChannelReplyProvider(raw.provider)
  const sessionKey = asOptionalString(raw.sessionKey)
  const lastRoute = parseCommanderLastRoute(raw.lastRoute)
  const attemptedAt = asOptionalString(raw.attemptedAt)
  const updatedAt = asOptionalString(raw.updatedAt)
  if (!id || !status || !message || !provider || !sessionKey || !lastRoute || !attemptedAt || !updatedAt) {
    return undefined
  }

  const attemptCount = typeof raw.attemptCount === 'number' && Number.isFinite(raw.attemptCount)
    ? Math.max(1, Math.floor(raw.attemptCount))
    : 1

  return {
    id,
    status,
    message,
    provider,
    sessionKey,
    lastRoute,
    attemptCount,
    attemptedAt,
    updatedAt,
    ...(asOptionalString(raw.deliveredAt) ? { deliveredAt: asOptionalString(raw.deliveredAt) } : {}),
    ...(asOptionalString(raw.failedAt) ? { failedAt: asOptionalString(raw.failedAt) } : {}),
    ...(asOptionalString(raw.error) ? { error: asOptionalString(raw.error) } : {}),
  }
}

function parseProviderContext(
  raw: Record<string, unknown>,
): ProviderSessionContext | undefined {
  return parseCanonicalProviderContext(raw.providerContext) ?? undefined
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    currentTask: conversation.currentTask ? { ...conversation.currentTask } : null,
    channelMeta: conversation.channelMeta ? { ...conversation.channelMeta } : undefined,
    lastRoute: conversation.lastRoute ? { ...conversation.lastRoute } : undefined,
    channelReplyDelivery: conversation.channelReplyDelivery
      ? {
        ...conversation.channelReplyDelivery,
        lastRoute: { ...conversation.channelReplyDelivery.lastRoute },
      }
      : undefined,
    voiceConfig: conversation.voiceConfig
      ? {
        ...(conversation.voiceConfig.tts ? { tts: { ...conversation.voiceConfig.tts } } : {}),
        ...(conversation.voiceConfig.stt ? { stt: { ...conversation.voiceConfig.stt } } : {}),
      }
      : undefined,
  }
}

function parseConversation(raw: unknown): ParsedConversation | null {
  if (!isObject(raw)) {
    return null
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const commanderId = typeof raw.commanderId === 'string' ? raw.commanderId.trim() : ''
  const surface = parseSurface(raw.surface)
  const status = parseStatus(raw.status)
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt.trim() : ''
  const lastMessageAt = typeof raw.lastMessageAt === 'string' ? raw.lastMessageAt.trim() : ''
  if (!id || !commanderId || !surface || !status || !createdAt || !lastMessageAt) {
    return null
  }

  const lastHeartbeat = asNullableString(raw.lastHeartbeat)
  const heartbeatTickCount = typeof raw.heartbeatTickCount === 'number' && Number.isFinite(raw.heartbeatTickCount)
    ? Math.max(0, Math.floor(raw.heartbeatTickCount))
    : 0
  const completedTasks = typeof raw.completedTasks === 'number' && Number.isFinite(raw.completedTasks)
    ? Math.max(0, Math.floor(raw.completedTasks))
    : 0
  const totalCostUsd = typeof raw.totalCostUsd === 'number' && Number.isFinite(raw.totalCostUsd)
    ? Math.max(0, raw.totalCostUsd)
    : 0
  if (Object.prototype.hasOwnProperty.call(raw, 'heartbeat')) {
    normalizeHeartbeatConfig(raw.heartbeat)
  }
  const agentType = parseProviderId(raw.agentType)
  const model = asOptionalNullableString(raw.model)
  const providerContext = parseProviderContext(raw)
  const creationSource = parseCreationSource(raw.creationSource) ?? 'unknown'
  const createdByKind = parseCreatedByKind(raw.createdByKind) ?? 'unknown'

  return {
    id,
    commanderId,
    surface,
    channelMeta: parseCommanderChannelMeta(raw.channelMeta),
    lastRoute: parseCommanderLastRoute(raw.lastRoute),
    channelReplyDelivery: parseChannelReplyDelivery(raw.channelReplyDelivery),
    voiceConfig: normalizeVoiceConfig(raw.voiceConfig),
    agentType,
    ...(model !== undefined ? { model } : {}),
    ...(asOptionalString(raw.name) ? { name: asOptionalString(raw.name) } : {}),
    status,
    currentTask: parseCurrentTask(raw.currentTask),
    ...(providerContext ? { providerContext } : {}),
    lastHeartbeat,
    heartbeatTickCount,
    completedTasks,
    totalCostUsd,
    creationSource,
    createdByKind,
    ...(asOptionalString(raw.createdById) ? { createdById: asOptionalString(raw.createdById) } : {}),
    ...(asOptionalString(raw.createdBySessionName) ? { createdBySessionName: asOptionalString(raw.createdBySessionName) } : {}),
    ...(asOptionalString(raw.createdByConversationId) ? { createdByConversationId: asOptionalString(raw.createdByConversationId) } : {}),
    ...(asOptionalString(raw.requestId) ? { requestId: asOptionalString(raw.requestId) } : {}),
    createdAt,
    lastMessageAt,
  }
}

function isSafeUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

function normalizeConversation(
  input: Conversation,
): Conversation {
  if (!isSafeUuid(input.id)) {
    throw new Error(`Invalid conversation id "${input.id}"`)
  }
  if (input.commanderId.trim().length === 0) {
    throw new Error(`Invalid commander id "${input.commanderId}"`)
  }
  const name = normalizeConversationName(input.name)
  if (!name) {
    throw new Error('Conversation name must be 1-64 characters')
  }
  if (!CONVERSATION_STATUSES.has(input.status)) {
    throw new Error(`Invalid conversation status "${input.status}"`)
  }
  if (!CREATION_SOURCES.has(input.creationSource)) {
    throw new Error(`Invalid conversation creationSource "${input.creationSource}"`)
  }
  if (!CREATED_BY_KINDS.has(input.createdByKind)) {
    throw new Error(`Invalid conversation createdByKind "${input.createdByKind}"`)
  }
  const model = asOptionalNullableString(input.model)
  const createdById = asOptionalString(input.createdById)
  const createdBySessionName = asOptionalString(input.createdBySessionName)
  const createdByConversationId = asOptionalString(input.createdByConversationId)
  const requestId = asOptionalString(input.requestId)

  return {
    id: input.id,
    commanderId: input.commanderId,
    surface: input.surface,
    ...(input.channelMeta ? { channelMeta: { ...input.channelMeta } } : {}),
    ...(input.lastRoute ? { lastRoute: { ...input.lastRoute } } : {}),
    ...(input.channelReplyDelivery
      ? {
        channelReplyDelivery: {
          ...input.channelReplyDelivery,
          lastRoute: { ...input.channelReplyDelivery.lastRoute },
        },
      }
      : {}),
    ...(input.voiceConfig ? { voiceConfig: normalizeVoiceConfig(input.voiceConfig) } : {}),
    agentType: input.agentType ?? null,
    ...(model !== undefined ? { model } : {}),
    name,
    status: input.status,
    currentTask: input.currentTask ? { ...input.currentTask } : null,
    ...(input.providerContext ? { providerContext: { ...input.providerContext } } : {}),
    lastHeartbeat: input.lastHeartbeat,
    heartbeatTickCount: Math.max(0, Math.floor(input.heartbeatTickCount)),
    completedTasks: Math.max(0, Math.floor(input.completedTasks)),
    totalCostUsd: Math.max(0, input.totalCostUsd),
    creationSource: input.creationSource,
    createdByKind: input.createdByKind,
    ...(createdById ? { createdById } : {}),
    ...(createdBySessionName ? { createdBySessionName } : {}),
    ...(createdByConversationId ? { createdByConversationId } : {}),
    ...(requestId ? { requestId } : {}),
    createdAt: input.createdAt,
    lastMessageAt: input.lastMessageAt,
  }
}

function toConversationFilePath(dataDir: string, commanderId: string, conversationId: string): string {
  const commanderRoot = resolveCommanderPaths(commanderId, dataDir).commanderRoot
  return path.join(commanderRoot, 'conversations', `${conversationId}.json`)
}

function inferPersistedCreationProvenance(
  raw: Record<string, unknown>,
  parsed: ParsedConversation,
  canonicalId: string,
): Pick<Conversation,
  | 'creationSource'
  | 'createdByKind'
  | 'createdById'
  | 'createdBySessionName'
  | 'createdByConversationId'
  | 'requestId'
> {
  const parsedCreationSource = parseCreationSource(raw.creationSource)
  const parsedCreatedByKind = parseCreatedByKind(raw.createdByKind)
  let creationSource: ConversationCreationSource = parsedCreationSource ?? 'unknown'
  let createdByKind: ConversationCreatedByKind = parsedCreatedByKind ?? 'unknown'

  if (!parsedCreationSource || !parsedCreatedByKind) {
    if (canonicalId === buildDefaultCommanderConversationId(parsed.commanderId)) {
      creationSource = 'system-default'
      createdByKind = 'system'
    } else if (parsed.channelMeta) {
      creationSource = 'channel'
      createdByKind = 'channel'
    } else {
      creationSource = 'unknown'
      createdByKind = 'unknown'
    }
  }

  return {
    creationSource,
    createdByKind,
    ...(asOptionalString(raw.createdById) ? { createdById: asOptionalString(raw.createdById) } : {}),
    ...(asOptionalString(raw.createdBySessionName) ? { createdBySessionName: asOptionalString(raw.createdBySessionName) } : {}),
    ...(asOptionalString(raw.createdByConversationId) ? { createdByConversationId: asOptionalString(raw.createdByConversationId) } : {}),
    ...(asOptionalString(raw.requestId) ? { requestId: asOptionalString(raw.requestId) } : {}),
  }
}

export class ConversationStore {
  private readonly dataDir: string
  private readonly logger: Pick<Console, 'info' | 'warn'>
  private conversationsById: Map<string, Conversation> | null = null
  private loadPromise: Promise<void> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    dataDir: string = resolveCommanderDataDir(),
    options: ConversationStoreOptions = {},
  ) {
    this.dataDir = path.resolve(dataDir)
    this.logger = options.logger ?? console
  }

  async listAll(): Promise<Conversation[]> {
    await this.ensureLoaded()
    return [...this.items().values()]
      .map((conversation) => cloneConversation(conversation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async listByCommander(commanderId: string): Promise<Conversation[]> {
    await this.ensureLoaded()
    return [...this.items().values()]
      .filter((conversation) => conversation.commanderId === commanderId)
      .map((conversation) => cloneConversation(conversation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async getActiveChatForCommander(commanderId: string): Promise<Conversation | null> {
    await this.ensureLoaded()
    const defaultConversationId = buildDefaultCommanderConversationId(commanderId)
    const [active] = [...this.items().values()]
      .filter((conversation) => (
        conversation.commanderId === commanderId
        && conversation.id !== defaultConversationId
        && DEFAULT_CHAT_STATUSES.has(conversation.status)
        && CHAT_SURFACES.has(conversation.surface)
      ))
      .sort((left, right) => {
        // Status priority (issue #1362 corrected contract): active before idle.
        // Within a single status bucket, prefer the most recently created chat
        // so a brand-new chat the user just clicked Create on always wins.
        const statusDelta = activeChatStatusPriority(left.status) - activeChatStatusPriority(right.status)
        if (statusDelta !== 0) {
          return statusDelta
        }

        const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
        if (Number.isFinite(createdDelta) && createdDelta !== 0) {
          return createdDelta
        }

        return left.id.localeCompare(right.id)
      })

    return active ? cloneConversation(active) : null
  }

  async get(conversationId: string): Promise<Conversation | null> {
    await this.ensureLoaded()
    const found = this.items().get(conversationId)
    return found ? cloneConversation(found) : null
  }

  async create(
    input: Omit<Conversation, 'id' | 'name'> & { id?: string; name?: string },
  ): Promise<Conversation> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const id = input.id?.trim() || randomUUID()
      if (this.items().has(id)) {
        throw new Error(`Conversation "${id}" already exists`)
      }

      const name = this.resolveConversationName(input.commanderId, input.name)
      this.assertConversationNameAvailable(input.commanderId, name)

      const normalized = normalizeConversation({
        ...input,
        id,
        name,
      })
      this.items().set(id, cloneConversation(normalized))
      await this.writeConversation(normalized)
      return cloneConversation(normalized)
    })
  }

  async update(
    conversationId: string,
    mutate: (current: Conversation) => Conversation,
  ): Promise<Conversation | null> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const existing = this.items().get(conversationId)
      if (!existing) {
        return null
      }

      const next = normalizeConversation(mutate(cloneConversation(existing)))
      this.assertConversationNameAvailable(next.commanderId, next.name, conversationId)
      this.items().set(conversationId, cloneConversation(next))
      await this.writeConversation(next)
      return cloneConversation(next)
    })
  }

  async delete(conversationId: string): Promise<Conversation | null> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const existing = this.items().get(conversationId)
      if (!existing) {
        return null
      }

      this.items().delete(conversationId)
      await this.deleteConversationFile(existing)
      return cloneConversation(existing)
    })
  }

  async ensureDefaultConversation(input: {
    commanderId: string
    surface?: Conversation['surface']
    createdAt: string
    currentTask?: CommanderCurrentTask | null
  }): Promise<Conversation> {
    const id = buildDefaultCommanderConversationId(input.commanderId)
    const existing = await this.get(id)
    if (existing) {
      return existing
    }

    return this.create({
      id,
      commanderId: input.commanderId,
      surface: input.surface ?? 'ui',
      status: 'idle',
      currentTask: input.currentTask ?? null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'system-default',
      createdByKind: 'system',
      createdAt: input.createdAt,
      lastMessageAt: input.createdAt,
    })
  }

  private items(): Map<string, Conversation> {
    if (!this.conversationsById) {
      throw new Error('ConversationStore not loaded')
    }
    return this.conversationsById
  }

  private async ensureLoaded(): Promise<void> {
    if (this.conversationsById) {
      return
    }
    if (this.loadPromise) {
      await this.loadPromise
      return
    }

    this.loadPromise = (async () => {
      const loaded = await this.readAllFromDisk()
      if (!this.conversationsById) {
        this.conversationsById = new Map(
          loaded.map((conversation) => [conversation.id, cloneConversation(conversation)]),
        )
      }
    })()

    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async readAllFromDisk(): Promise<Conversation[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(this.dataDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }

    const conversationsById = new Map<string, Conversation>()
    let migratedCount = 0
    const namesByCommander = new Map<string, Set<string>>()
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const conversationsDir = path.join(this.dataDir, entry.name, 'conversations')
      let files: import('node:fs').Dirent[]
      try {
        files = await readdir(conversationsDir, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue
        }
        throw error
      }

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) {
          continue
        }

        try {
          const filePath = path.join(conversationsDir, file.name)
          const raw = await readFile(filePath, 'utf8')
          const parsedJson = JSON.parse(raw) as unknown
          if (!isObject(parsedJson)) {
            continue
          }

          const { cleaned } = migrateProviderContext(parsedJson)
          const migrationChanged = migratedProviderContextChanged(parsedJson, cleaned)
          if (migrationChanged) {
            await writeJsonFileAtomically(filePath, cleaned, { backup: true })
            migratedCount += 1
          }

          const parsed = parseConversation(cleaned)
          if (parsed) {
            const normalized = await this.normalizePersistedConversation(
              filePath,
              cleaned,
              parsed,
              namesByCommander,
            )
            conversationsById.set(normalized.id, normalized)
          }
        } catch {
          // Skip malformed conversation files; the API should remain readable.
        }
      }
    }

    if (migratedCount > 0) {
      this.logger.warn(
        `[commanders][migration] Migrated providerContext in ${migratedCount} conversation record(s)`,
      )
    }

    return [...conversationsById.values()]
  }

  private async writeConversation(conversation: Conversation): Promise<void> {
    const filePath = toConversationFilePath(this.dataDir, conversation.commanderId, conversation.id)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeJsonFileAtomically(filePath, normalizeConversation(conversation))
  }

  private async deleteConversationFile(conversation: Conversation): Promise<void> {
    const filePath = toConversationFilePath(this.dataDir, conversation.commanderId, conversation.id)
    await rm(filePath, { force: true })
  }

  private resolveConversationName(commanderId: string, requestedName?: string): string {
    const parsed = normalizeConversationName(requestedName)
    if (parsed) {
      return parsed
    }

    return generateConversationName(this.listConversationNames(commanderId))
  }

  private listConversationNames(commanderId: string, excludeConversationId?: string): string[] {
    return [...this.items().values()]
      .filter((conversation) => (
        conversation.commanderId === commanderId
        && conversation.id !== excludeConversationId
      ))
      .map((conversation) => conversation.name)
  }

  private assertConversationNameAvailable(
    commanderId: string,
    name: string,
    excludeConversationId?: string,
  ): void {
    const collision = [...this.items().values()].find((conversation) => (
      conversation.commanderId === commanderId
      && conversation.id !== excludeConversationId
      && conversationNamesEqual(conversation.name, name)
    ))
    if (!collision) {
      return
    }

    throw new Error(
      `Conversation name "${name}" already exists for commander "${commanderId}"`,
    )
  }

  private async normalizePersistedConversation(
    filePath: string,
    raw: Record<string, unknown>,
    parsed: ParsedConversation,
    namesByCommander: Map<string, Set<string>>,
  ): Promise<Conversation> {
    const commanderNames = namesByCommander.get(parsed.commanderId) ?? new Set<string>()
    namesByCommander.set(parsed.commanderId, commanderNames)

    const canonicalId = parsed.id === buildHistoricalDefaultCommanderConversationId(parsed.commanderId)
      ? buildDefaultCommanderConversationId(parsed.commanderId)
      : parsed.id
    const name = normalizeConversationName(parsed.name)
      ?? generateConversationName(commanderNames)
    const provenance = inferPersistedCreationProvenance(raw, parsed, canonicalId)
    const normalized = normalizeConversation({
      ...parsed,
      id: canonicalId,
      name,
      ...provenance,
    })

    commanderNames.add(name)
    const heartbeatConfigPresent = Object.prototype.hasOwnProperty.call(raw, 'heartbeat')
    const provenancePresent =
      parseCreationSource(raw.creationSource) !== null &&
      parseCreatedByKind(raw.createdByKind) !== null
    if (parsed.name && provenancePresent && !heartbeatConfigPresent && canonicalId === parsed.id) {
      return normalized
    }

    if (!parsed.name) {
      this.logger.warn(
        `[commanders][conversations] Backfilled missing name for conversation "${normalized.id}" as "${normalized.name}"`,
      )
    }
    if (!provenancePresent) {
      this.logger.warn(
        `[commanders][conversations] Backfilled creation provenance for conversation "${normalized.id}" as "${normalized.creationSource}/${normalized.createdByKind}"`,
      )
    }
    await this.rewriteConversation(filePath, normalized)
    return normalized
  }

  private async rewriteConversation(filePath: string, conversation: Conversation): Promise<void> {
    const nextPath = toConversationFilePath(this.dataDir, conversation.commanderId, conversation.id)
    await mkdir(path.dirname(nextPath), { recursive: true })
    await writeJsonFileAtomically(nextPath, normalizeConversation(conversation), { backup: true })
    if (path.resolve(filePath) !== path.resolve(nextPath)) {
      await rm(filePath, { force: true })
    }
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
