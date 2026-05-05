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
} from '../../migrations/provider-context.js'
import { writeJsonFileAtomically } from '../../migrations/write-json-file-atomically.js'

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
  agentType?: AgentType | null
  name: string
  status: 'active' | 'idle' | 'archived'
  currentTask: CommanderCurrentTask | null
  providerContext?: ProviderSessionContext
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  createdAt: string
  lastMessageAt: string
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
  const providerContext = parseProviderContext(raw)

  return {
    id,
    commanderId,
    surface,
    channelMeta: parseCommanderChannelMeta(raw.channelMeta),
    lastRoute: parseCommanderLastRoute(raw.lastRoute),
    agentType,
    ...(asOptionalString(raw.name) ? { name: asOptionalString(raw.name) } : {}),
    status,
    currentTask: parseCurrentTask(raw.currentTask),
    ...(providerContext ? { providerContext } : {}),
    lastHeartbeat,
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
  const name = normalizeConversationName(input.name)
  if (!name) {
    throw new Error('Conversation name must be 1-64 characters')
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
    name,
    status: input.status,
    currentTask: input.currentTask ? { ...input.currentTask } : null,
    ...(input.providerContext ? { providerContext: { ...input.providerContext } } : {}),
    lastHeartbeat: input.lastHeartbeat,
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
      const name = this.resolveConversationName(commanderId)
      this.assertConversationNameAvailable(commanderId, name)
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
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        name,
        createdAt: nowIso,
        lastMessageAt: nowIso,
      })
      this.items().set(created.id, cloneConversation(created))
      await this.writeConversation(created)
      return { conversation: cloneConversation(created), created: true }
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
    const normalized = normalizeConversation({
      ...parsed,
      id: canonicalId,
      name,
    })

    commanderNames.add(name)
    const heartbeatConfigPresent = Object.prototype.hasOwnProperty.call(raw, 'heartbeat')
    if (parsed.name && !heartbeatConfigPresent && canonicalId === parsed.id) {
      return normalized
    }

    if (!parsed.name) {
      this.logger.warn(
        `[commanders][conversations] Backfilled missing name for conversation "${normalized.id}" as "${normalized.name}"`,
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
