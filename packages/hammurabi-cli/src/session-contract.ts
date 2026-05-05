const COMMANDER_SESSION_NAME_PREFIX = 'commander-'

export type SessionType = 'commander' | 'worker' | 'automation'
export type SessionCreatorKind = 'human' | 'commander' | 'automation'

export interface SessionCreator {
  kind: SessionCreatorKind
  id?: string
}

export interface CommanderOwnedSessionLike {
  creator?: SessionCreator | null
}

export type ConversationSurface = 'discord' | 'telegram' | 'whatsapp' | 'ui' | 'cli' | 'api'
export type ConversationStatus = 'active' | 'idle' | 'archived'

export interface ProviderContext {
  providerId: string
  sessionId?: string
  threadId?: string
  effort?: string
  adaptiveThinking?: string
}

export interface Conversation {
  id: string
  commanderId: string
  isDefaultConversation?: boolean
  surface: ConversationSurface
  channelMeta?: Record<string, unknown>
  lastRoute?: Record<string, unknown>
  name: string
  status: ConversationStatus
  currentTask: Record<string, unknown> | null
  providerContext?: ProviderContext
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  createdAt: string
  lastMessageAt: string
}

export interface WorkerLifecycleSessionLike {
  status?: string | null
  processAlive?: boolean | null
  completed?: boolean | null
}

export type WorkerLifecycle = 'running' | 'stale' | 'exited' | 'completed'

export function normalizeSessionType(value: unknown): SessionType | null {
  if (value === 'commander' || value === 'worker' || value === 'automation') {
    return value
  }
  if (value === 'cron' || value === 'sentinel') {
    return 'automation'
  }
  return null
}

export function normalizeSessionCreator(value: unknown): SessionCreator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rawKind = 'kind' in value ? value.kind : undefined
  if (rawKind !== 'human' && rawKind !== 'commander' && rawKind !== 'automation' && rawKind !== 'cron' && rawKind !== 'sentinel') {
    return null
  }

  const rawId = 'id' in value ? value.id : undefined
  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined
  const kind: SessionCreatorKind = rawKind === 'cron' || rawKind === 'sentinel'
    ? 'automation'
    : rawKind
  return { kind, ...(id ? { id } : {}) }
}

export function buildCommanderSessionName(commanderId: string): string {
  return `${COMMANDER_SESSION_NAME_PREFIX}${commanderId.trim()}`
}

export function isOwnedByCommander(
  session: CommanderOwnedSessionLike,
  commanderId: string,
): boolean {
  return (
    session.creator?.kind === 'commander'
    && session.creator.id?.trim() === commanderId.trim()
  )
}

export function workerLifecycle(session: WorkerLifecycleSessionLike): WorkerLifecycle {
  const status = (session.status ?? '').trim().toLowerCase()

  if (status === 'exited' || session.processAlive === false) {
    return 'exited'
  }
  if (session.completed || status === 'completed') {
    return 'completed'
  }
  if (status === 'stale') {
    return 'stale'
  }
  return 'running'
}
