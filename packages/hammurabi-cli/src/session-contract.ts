const COMMANDER_SESSION_NAME_PREFIX = 'commander-'

export type SessionType = 'commander' | 'worker' | 'cron' | 'sentinel'
export type SessionCreatorKind = 'human' | 'commander' | 'cron' | 'sentinel'

export interface SessionCreator {
  kind: SessionCreatorKind
  id?: string
}

export interface CommanderOwnedSessionLike {
  creator?: SessionCreator | null
}

export interface WorkerLifecycleSessionLike {
  status?: string | null
  processAlive?: boolean | null
  completed?: boolean | null
}

export type WorkerLifecycle = 'running' | 'stale' | 'exited' | 'completed'

export function normalizeSessionType(value: unknown): SessionType | null {
  if (
    value === 'commander' ||
    value === 'worker' ||
    value === 'cron' ||
    value === 'sentinel'
  ) {
    return value
  }
  return null
}

export function normalizeSessionCreator(value: unknown): SessionCreator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const rawKind = 'kind' in value ? value.kind : undefined
  if (
    rawKind !== 'human' &&
    rawKind !== 'commander' &&
    rawKind !== 'cron' &&
    rawKind !== 'sentinel'
  ) {
    return null
  }

  const rawId = 'id' in value ? value.id : undefined
  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined
  return { kind: rawKind, ...(id ? { id } : {}) }
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
