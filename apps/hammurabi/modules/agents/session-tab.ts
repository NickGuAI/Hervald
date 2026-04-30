export type SessionTab = 'all' | 'commander' | 'worker' | 'other'
type SessionType = 'commander' | 'worker' | 'cron' | 'sentinel'

export const DEFAULT_SESSION_TAB: SessionTab = 'commander'

export const SESSION_TABS: SessionTab[] = [
  'all',
  'commander',
  'worker',
  'other',
]

function parseSessionType(value: unknown): SessionType | null {
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

function matchesSessionTabName(sessionType: unknown, tab: SessionTab): boolean {
  const resolvedType = parseSessionType(sessionType) ?? 'worker'
  if (tab === 'commander') return resolvedType === 'commander'
  if (tab === 'worker') return resolvedType === 'worker'
  if (tab === 'other') return resolvedType === 'cron' || resolvedType === 'sentinel'
  return true
}

export function filterSessionsByTab<T extends { name: string; sessionType?: SessionType }>(
  sessions: T[],
  tab: SessionTab,
): T[] {
  return sessions.filter((session) => matchesSessionTabName(session.sessionType, tab))
}
