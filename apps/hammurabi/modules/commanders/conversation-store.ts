import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentType } from '../agents/types.js'
import {
  createDefaultHeartbeatState,
  normalizeHeartbeatState,
  type CommanderHeartbeatState,
} from './heartbeat.js'
import {
  buildLegacyCommanderConversationId,
  parseCommanderChannelMeta,
  parseCommanderLastRoute,
  type CommanderChannelMeta,
  type CommanderConversationBackfill,
  type CommanderConversationSurface,
  type CommanderCurrentTask,
  type CommanderLastRoute,
} from './store.js'
import { resolveCommanderDataDir, resolveCommanderPaths } from './paths.js'

const CONVERSATION_STATUSES = new Set<Conversation['status']>([
  'active',
  'idle',
  'archived',
])

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Conversation {
  id: string
  commanderId: string
  surface: CommanderConversationSurface
  channelMeta?: CommanderChannelMeta
  lastRoute?: CommanderLastRoute
  agentType?: AgentType | null
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

export interface ConversationStoreOptions {
  logger?: Pick<Console, 'info' | 'warn'>
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
  return raw === 'discord' ||
    raw === 'telegram' ||
    raw === 'whatsapp' ||
    raw === 'ui' ||
    raw === 'cli' ||
    raw === 'api'
    ? raw
    : null
}

function parseStatus(raw: unknown): Conversation['status'] | null {
  return typeof raw === 'string' && CONVERSATION_STATUSES.has(raw as Conversation['status'])
    ? raw as Conversation['status']
    : null
}

function parseAgentType(raw: unknown): AgentType | null {
  return raw === 'claude' || raw === 'codex' || raw === 'gemini'
    ? raw
    : null
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    currentTask: conversation.currentTask ? { ...conversation.currentTask } : null,
    heartbeat: { ...conversation.heartbeat },
    channelMeta: conversation.channelMeta ? { ...conversation.channelMeta } : undefined,
    lastRoute: conversation.lastRoute ? { ...conversation.lastRoute } : undefined,
  }
}

function parseConversation(raw: unknown): Conversation | null {
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
  const heartbeat = normalizeHeartbeatState(raw.heartbeat, lastHeartbeat)

  return {
    id,
    commanderId,
    surface,
    channelMeta: parseCommanderChannelMeta(raw.channelMeta),
    lastRoute: parseCommanderLastRoute(raw.lastRoute),
    agentType: parseAgentType(raw.agentType),
    status,
    currentTask: parseCurrentTask(raw.currentTask),
    claudeSessionId: asOptionalString(raw.claudeSessionId),
    codexThreadId: asOptionalString(raw.codexThreadId),
    geminiSessionId: asOptionalString(raw.geminiSessionId),
    lastHeartbeat: heartbeat.lastSentAt ?? lastHeartbeat,
    heartbeat,
    heartbeatTickCount,
    completedTasks,
    totalCostUsd,
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
  if (!CONVERSATION_STATUSES.has(input.status)) {
    throw new Error(`Invalid conversation status "${input.status}"`)
  }

  return {
    id: input.id,
    commanderId: input.commanderId,
    surface: input.surface,
    ...(input.channelMeta ? { channelMeta: { ...input.channelMeta } } : {}),
    ...(input.lastRoute ? { lastRoute: { ...input.lastRoute } } : {}),
    agentType: input.agentType ?? null,
    status: input.status,
    currentTask: input.currentTask ? { ...input.currentTask } : null,
    ...(input.claudeSessionId ? { claudeSessionId: input.claudeSessionId.trim() } : {}),
    ...(input.codexThreadId ? { codexThreadId: input.codexThreadId.trim() } : {}),
    ...(input.geminiSessionId ? { geminiSessionId: input.geminiSessionId.trim() } : {}),
    lastHeartbeat: input.lastHeartbeat,
    heartbeat: normalizeHeartbeatState(input.heartbeat, input.lastHeartbeat),
    heartbeatTickCount: Math.max(0, Math.floor(input.heartbeatTickCount)),
    completedTasks: Math.max(0, Math.floor(input.completedTasks)),
    totalCostUsd: Math.max(0, input.totalCostUsd),
    createdAt: input.createdAt,
    lastMessageAt: input.lastMessageAt,
  }
}

function toConversationFilePath(dataDir: string, commanderId: string, conversationId: string): string {
  const commanderRoot = resolveCommanderPaths(commanderId, dataDir).commanderRoot
  return path.join(commanderRoot, 'conversations', `${conversationId}.json`)
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

  async get(conversationId: string): Promise<Conversation | null> {
    await this.ensureLoaded()
    const found = this.items().get(conversationId)
    return found ? cloneConversation(found) : null
  }

  async create(input: Omit<Conversation, 'id'> & { id?: string }): Promise<Conversation> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const id = input.id?.trim() || randomUUID()
      if (this.items().has(id)) {
        throw new Error(`Conversation "${id}" already exists`)
      }

      const normalized = normalizeConversation({
        ...input,
        id,
      })
      this.items().set(id, cloneConversation(normalized))
      await this.writeConversation(normalized)
      return cloneConversation(normalized)
    })
  }

  async upsertBackfilledConversation(backfill: CommanderConversationBackfill): Promise<Conversation> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const existing = this.items().get(backfill.id)
      if (existing) {
        return cloneConversation(existing)
      }

      const normalized = normalizeConversation({
        ...backfill,
        agentType: null,
      })
      this.items().set(normalized.id, cloneConversation(normalized))
      await this.writeConversation(normalized)
      this.logger.info(
        `[commanders][backfill] Persisted conversation "${normalized.id}" for commander "${normalized.commanderId}"`,
      )
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
      this.items().set(conversationId, cloneConversation(next))
      await this.writeConversation(next)
      return cloneConversation(next)
    })
  }

  async findOrCreateConversationBySessionKey(
    commanderId: string,
    sessionKey: string,
    defaults: {
      surface: Conversation['surface']
      channelMeta: CommanderChannelMeta
      lastRoute: CommanderLastRoute
    },
  ): Promise<{ conversation: Conversation; created: boolean }> {
    return this.withMutationLock(async () => {
      await this.ensureLoaded()
      const normalizedSessionKey = sessionKey.trim()
      if (!normalizedSessionKey) {
        throw new Error('sessionKey must be a non-empty string')
      }

      for (const existing of this.items().values()) {
        if (
          existing.commanderId === commanderId &&
          existing.channelMeta?.sessionKey === normalizedSessionKey
        ) {
          const updated: Conversation = normalizeConversation({
            ...cloneConversation(existing),
            channelMeta: {
              ...defaults.channelMeta,
              sessionKey: normalizedSessionKey,
            },
            lastRoute: { ...defaults.lastRoute },
            lastMessageAt: new Date().toISOString(),
          })
          this.items().set(updated.id, cloneConversation(updated))
          await this.writeConversation(updated)
          return { conversation: cloneConversation(updated), created: false }
        }
      }

      const nowIso = new Date().toISOString()
      const conversationId = randomUUID()
      const created = normalizeConversation({
        id: conversationId,
        commanderId,
        surface: defaults.surface,
        channelMeta: {
          ...defaults.channelMeta,
          sessionKey: normalizedSessionKey,
        },
        lastRoute: { ...defaults.lastRoute },
        status: 'idle',
        currentTask: null,
        lastHeartbeat: null,
        heartbeat: createDefaultHeartbeatState(),
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: nowIso,
        lastMessageAt: nowIso,
      })
      this.items().set(created.id, cloneConversation(created))
      await this.writeConversation(created)
      return { conversation: cloneConversation(created), created: true }
    })
  }

  async ensureLegacyConversation(input: {
    commanderId: string
    surface?: Conversation['surface']
    createdAt: string
    heartbeat?: CommanderHeartbeatState
    currentTask?: CommanderCurrentTask | null
  }): Promise<Conversation> {
    const id = buildLegacyCommanderConversationId(input.commanderId)
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
      heartbeat: input.heartbeat ?? createDefaultHeartbeatState(),
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
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

    const conversations: Conversation[] = []
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
          const raw = await readFile(path.join(conversationsDir, file.name), 'utf8')
          const parsed = parseConversation(JSON.parse(raw) as unknown)
          if (parsed) {
            conversations.push(parsed)
          }
        } catch {
          // Skip malformed conversation files; the API should remain readable.
        }
      }
    }

    return conversations
  }

  private async writeConversation(conversation: Conversation): Promise<void> {
    const filePath = toConversationFilePath(this.dataDir, conversation.commanderId, conversation.id)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(normalizeConversation(conversation), null, 2), 'utf8')
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
