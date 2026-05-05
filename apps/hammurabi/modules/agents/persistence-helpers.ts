/**
 * Persistence + restore + prune helpers for the agents router.
 *
 * Extracted from `createAgentsRouter()` in `routes.ts` in issue/921 Phase
 * P6b. Combines four related functions that together manage the on-disk
 * session state: serialize/write on session-lifecycle changes, read on
 * server boot, restore previously-persisted sessions on startup, and
 * periodically prune command-room sessions that have completed.
 *
 * Why these four belong together: they all read/write the same
 * `sessionStorePath`, all operate on the same three session maps
 * (`sessions`, `completedSessions`, `exitedStreamSessions`), and both
 * `pruneStaleCommandRoomSessions` and the write path share the
 * `schedulePersistedSessionsWrite` serialization. Keeping them in one
 * module means the write-serialization invariant (a single `Promise<void>`
 * chain that serializes concurrent persist requests) can live here as
 * module-local state rather than leak out as a `persistSessionStateQueue`
 * ref through the context.
 */
import { readFile } from 'node:fs/promises'
import {
  COMMAND_ROOM_COMPLETED_SESSION_TTL_MS,
} from './constants.js'
import { buildDefaultCommanderConversationId } from '../commanders/store.js'
import {
  buildPersistedEntryFromExitedSession,
  getWorldAgentStatus,
} from './session/state.js'
import {
  readPersistedSessionsState as readPersistedSessionsStateFromStore,
  restorePersistedSessions as restorePersistedSessionsFromStore,
  serializePersistedSessionsState as serializePersistedSessionsStateForStore,
  writePersistedSessionsState as writePersistedSessionsStateToStore,
} from './session/persistence.js'
import {
  clearCodexTurnWatchdog,
  markCodexTurnHealthy,
} from './adapters/codex/helpers.js'
import type { MachineRegistryStore } from './machines.js'
import { getProvider } from './providers/registry.js'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PersistedSessionsState,
  StreamJsonEvent,
  StreamSession,
  PersistedStreamSession,
  SessionCreator,
  SessionType,
} from './types.js'

/**
 * Signature for the router's stream-usage event applier. Called when
 * restoring persisted sessions so the UI can rebuild its usage totals.
 */
export type ApplyStreamUsageEvent = (
  session: StreamSession,
  event: StreamJsonEvent,
) => void

export type ProviderSessionRestorer = (
  entry: PersistedStreamSession,
  machine: MachineConfig | undefined,
) => Promise<StreamSession>

export type ProviderSessionTeardown = (
  session: StreamSession,
  reason: string,
) => Promise<void>

export interface PersistenceHelpersContext {
  sessionStorePath: string
  maxSessions: number
  machineRegistry: MachineRegistryStore
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  applyStreamUsageEvent: ApplyStreamUsageEvent
  restoreProviderSession: ProviderSessionRestorer
  teardownProviderSession: ProviderSessionTeardown
  isExitedSessionResumeAvailable(
    entry: ReturnType<typeof buildPersistedEntryFromExitedSession>,
  ): Promise<boolean>
  isLiveSessionResumeAvailable(session: StreamSession): Promise<boolean>
}

export interface SessionPrunerConfig {
  enabled: boolean
  staleSessionTtlMs: number
  exitedSessionTtlMs: number
}

export type SessionPruneLifecycle = 'stale' | 'exited' | 'completed'

export interface SessionPruneCandidate {
  name: string
  sessionType: SessionType
  creator: SessionCreator
  lifecycle: SessionPruneLifecycle
  ageMs: number
  reason: 'cron-completed-ttl' | 'stale-non-human-ttl' | 'exited-non-human-ttl'
}

export interface PersistenceHelpers {
  schedulePersistedSessionsWrite: () => void
  flushPersistedSessionsWrite: () => Promise<void>
  readPersistedSessionsState: () => Promise<PersistedSessionsState>
  restorePersistedSessions: () => Promise<void>
  getStaleCronSessionCandidates: (nowMs?: number) => SessionPruneCandidate[]
  pruneStaleCronSessions: (nowMs?: number) => number
  pruneStaleCommandRoomSessions: (nowMs?: number) => number
  getStaleNonHumanSessionCandidates: (config: SessionPrunerConfig, nowMs?: number) => Promise<SessionPruneCandidate[]>
  pruneStaleNonHumanSessions: (config: SessionPrunerConfig, nowMs?: number) => Promise<number>
}

/**
 * Build the 4 persistence helpers backed by the given context. Keeps the
 * `Promise<void>` write-serialization chain as module-local state so the
 * single-writer invariant is owned here, not in routes.ts.
 */
export function createPersistenceHelpers(
  ctx: PersistenceHelpersContext,
): PersistenceHelpers {
  const {
    sessionStorePath,
    maxSessions,
    machineRegistry,
    sessions,
    completedSessions,
    exitedStreamSessions,
    applyStreamUsageEvent,
    restoreProviderSession,
    teardownProviderSession,
    isExitedSessionResumeAvailable,
    isLiveSessionResumeAvailable,
  } = ctx

  // Single-writer queue: each write is chained off the previous one so
  // concurrent callers never interleave writes to the same file. A `.catch`
  // swallow before `.then` prevents a rejected previous write from
  // poisoning every subsequent call.
  let persistSessionStateQueue: Promise<void> = Promise.resolve()

  function isBenignPersistedSessionWriteError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
  }

  function schedulePersistedSessionsWrite(): void {
    persistSessionStateQueue = persistSessionStateQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await writePersistedSessionsStateToStore(
            sessionStorePath,
            serializePersistedSessionsStateForStore({ sessions, exitedStreamSessions }),
          )
        } catch (error) {
          // Test teardown and process shutdown can remove ephemeral data dirs
          // before this queued write drains. Treat that as a benign stop case.
          if (isBenignPersistedSessionWriteError(error)) {
            return
          }
          throw error
        }
      })
  }

  async function flushPersistedSessionsWrite(): Promise<void> {
    await persistSessionStateQueue.catch(() => undefined)
  }

  async function readPersistedSessionsState(): Promise<PersistedSessionsState> {
    return readPersistedSessionsStateFromStore(sessionStorePath)
  }

  async function restorePersistedSessions(): Promise<void> {
    const persisted = await readPersistedSessionsStateFromStore(sessionStorePath)
    const migrationSourceEntries = await readStoredSessionMigrationEntries(sessionStorePath)
    const migratedSessions = persisted.sessions.map((entry) =>
      migratePersistedSessionEntry(entry, migrationSourceEntries.get(entry.name)),
    )
    const migratedState = { sessions: migratedSessions }
    const changed = JSON.stringify(migratedState) !== JSON.stringify(persisted)
    if (changed) {
      await writePersistedSessionsStateToStore(sessionStorePath, migratedState, { backup: true })
    }

    await restorePersistedSessionsFromStore({
      sessions,
      completedSessions,
      exitedStreamSessions,
      maxSessions,
      sessionStorePath,
      machineRegistry,
      applyUsageEvent: applyStreamUsageEvent,
      restoreProviderSession,
    })
  }

  function getStaleCronSessionCandidates(nowMs: number = Date.now()): SessionPruneCandidate[] {
    const candidates: SessionPruneCandidate[] = []

    for (const [sessionName, session] of sessions) {
      if (session.kind !== 'stream') continue
      if (session.sessionType !== 'cron' && session.sessionType !== 'automation') continue
      if (!session.lastTurnCompleted || !session.finalResultEvent) continue

      const completedAtMs = Date.parse(session.completedTurnAt ?? session.createdAt)
      if (!Number.isFinite(completedAtMs)) continue
      const ageMs = nowMs - completedAtMs
      if (ageMs <= COMMAND_ROOM_COMPLETED_SESSION_TTL_MS) continue

      candidates.push({
        name: sessionName,
        sessionType: session.sessionType,
        creator: session.creator,
        lifecycle: 'completed',
        ageMs,
        reason: 'cron-completed-ttl',
      })
    }

    return candidates
  }

  function pruneStaleCronSessions(nowMs: number = Date.now()): number {
    const candidates = getStaleCronSessionCandidates(nowMs)
    if (candidates.length === 0) {
      return 0
    }

    for (const candidate of candidates) {
      const session = sessions.get(candidate.name)
      if (
        !session ||
        session.kind !== 'stream' ||
        (session.sessionType !== 'cron' && session.sessionType !== 'automation')
      ) {
        continue
      }

      for (const client of session.clients) {
        client.close(1000, 'Session ended')
      }
      if (getProvider(session.agentType)?.id === 'codex') {
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
      }
      void teardownProviderSession(session, 'Pruning stale automation session')
      sessions.delete(candidate.name)
    }

    schedulePersistedSessionsWrite()
    return candidates.length
  }

  function resolveExitedSessionAgeStartAt(sessionName: string, session: ExitedStreamSessionState): number | null {
    const completedAt = completedSessions.get(sessionName)?.completedAt
    if (completedAt) {
      const completedAtMs = Date.parse(completedAt)
      if (Number.isFinite(completedAtMs)) {
        return completedAtMs
      }
    }

    const latestEvent = [...session.events]
      .reverse()
      .find((event) => typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp)))
    if (latestEvent && typeof latestEvent.timestamp === 'string') {
      return Date.parse(latestEvent.timestamp)
    }

    const createdAtMs = Date.parse(session.createdAt)
    return Number.isFinite(createdAtMs) ? createdAtMs : null
  }

  async function getStaleNonHumanSessionCandidates(
    config: SessionPrunerConfig,
    nowMs: number = Date.now(),
  ): Promise<SessionPruneCandidate[]> {
    if (!config.enabled) {
      return []
    }

    const candidates: SessionPruneCandidate[] = []

    for (const [sessionName, session] of sessions) {
      if (session.kind !== 'stream') continue
      if (session.creator.kind === 'human') continue
      if (session.clients.size > 0) continue
      if (await isLiveSessionResumeAvailable(session)) continue

      const lifecycle = getWorldAgentStatus(session, nowMs)
      if (lifecycle === 'stale') {
        const staleAtMs = Date.parse(session.lastEventAt ?? session.createdAt)
        if (!Number.isFinite(staleAtMs)) continue
        const ageMs = nowMs - staleAtMs
        if (ageMs <= config.staleSessionTtlMs) continue

        candidates.push({
          name: sessionName,
          sessionType: session.sessionType,
          creator: session.creator,
          lifecycle: 'stale',
          ageMs,
          reason: 'stale-non-human-ttl',
        })
        continue
      }

      if (lifecycle === 'completed') {
        const completedAtMs = Date.parse(session.completedTurnAt ?? session.createdAt)
        if (!Number.isFinite(completedAtMs)) continue
        const ageMs = nowMs - completedAtMs
        if (ageMs <= config.exitedSessionTtlMs) continue

        candidates.push({
          name: sessionName,
          sessionType: session.sessionType,
          creator: session.creator,
          lifecycle: 'exited',
          ageMs,
          reason: 'exited-non-human-ttl',
        })
      }
    }

    for (const [sessionName, session] of exitedStreamSessions) {
      if (session.creator.kind === 'human') continue
      const persistedEntry = buildPersistedEntryFromExitedSession(sessionName, session)
      if (await isExitedSessionResumeAvailable(persistedEntry)) continue

      const exitedAtMs = resolveExitedSessionAgeStartAt(sessionName, session)
      if (exitedAtMs === null || !Number.isFinite(exitedAtMs)) continue
      const ageMs = nowMs - exitedAtMs
      if (ageMs <= config.exitedSessionTtlMs) continue

      candidates.push({
        name: sessionName,
        sessionType: session.sessionType,
        creator: session.creator,
        lifecycle: 'exited',
        ageMs,
        reason: 'exited-non-human-ttl',
      })
    }

    return candidates
  }

  async function pruneStaleNonHumanSessions(
    config: SessionPrunerConfig,
    nowMs: number = Date.now(),
  ): Promise<number> {
    const candidates = await getStaleNonHumanSessionCandidates(config, nowMs)
    if (candidates.length === 0) {
      return 0
    }

    for (const candidate of candidates) {
      const liveSession = sessions.get(candidate.name)
      if (liveSession?.kind === 'stream') {
        for (const client of liveSession.clients) {
          client.close(1000, 'Session pruned')
        }
        if (getProvider(liveSession.agentType)?.id === 'codex') {
          clearCodexTurnWatchdog(liveSession)
          markCodexTurnHealthy(liveSession)
        }
        await teardownProviderSession(liveSession, 'Pruning stale non-human session')
        sessions.delete(candidate.name)
        continue
      }

      if (exitedStreamSessions.has(candidate.name)) {
        exitedStreamSessions.delete(candidate.name)
        completedSessions.delete(candidate.name)
      }
    }

    schedulePersistedSessionsWrite()
    return candidates.length
  }

  return {
    schedulePersistedSessionsWrite,
    flushPersistedSessionsWrite,
    readPersistedSessionsState,
    restorePersistedSessions,
    getStaleCronSessionCandidates,
    pruneStaleCronSessions,
    pruneStaleCommandRoomSessions: pruneStaleCronSessions,
    getStaleNonHumanSessionCandidates,
    pruneStaleNonHumanSessions,
  }
}

function asMigrationRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function inferPersistedSessionSource(
  sessionName: string,
  rawEntry?: Record<string, unknown>,
): { creator: SessionCreator; sessionType: SessionType; spawnedBy?: string } {
  const parentSession = parseOptionalTrimmedString(rawEntry?.parentSession)
    ?? parseOptionalTrimmedString(rawEntry?.spawnedBy)
  if (sessionName.startsWith('command-room-')) {
    return {
      creator: { kind: 'cron', id: '<unknown-cron-task>' },
      sessionType: 'cron',
    }
  }
  if (sessionName.startsWith('automation-')) {
    return {
      creator: { kind: 'automation', id: '<unknown-automation>' },
      sessionType: 'automation',
    }
  }
  if (sessionName.startsWith('sentinel-')) {
    return {
      creator: { kind: 'sentinel', id: '<unknown-sentinel>' },
      sessionType: 'sentinel',
    }
  }
  if (sessionName.startsWith('worker-') || parentSession) {
    return {
      creator: {
        kind: 'commander',
        id: parentSession ? commanderIdFromSessionName(parentSession) ?? 'unknown' : 'unknown',
      },
      sessionType: 'worker',
      ...(parentSession ? { spawnedBy: parentSession } : {}),
    }
  }
  if (sessionName.startsWith('commander-')) {
    return {
      creator: {
        kind: 'commander',
        id: commanderIdFromSessionName(sessionName) ?? sessionName,
      },
      sessionType: 'commander',
    }
  }

  return {
    creator: { kind: 'human', id: '<unknown-user>' },
    sessionType: 'worker',
  }
}

function commanderIdFromSessionName(sessionName: string | null | undefined): string | null {
  const normalized = sessionName?.trim() ?? ''
  if (!normalized.startsWith('commander-')) {
    return null
  }

  const commanderId = normalized.slice('commander-'.length).trim()
  return commanderId.length > 0 ? commanderId : null
}

function migratePersistedSessionEntry(
  entry: PersistedStreamSession,
  rawEntry?: Record<string, unknown>,
): PersistedStreamSession {
  const inferred = inferPersistedSessionSource(entry.name, rawEntry)
  const next: PersistedStreamSession = { ...entry }
  const changedFields: string[] = []

  if (!next.sessionType) {
    next.sessionType = inferred.sessionType
    changedFields.push('sessionType')
  }

  if (!next.creator) {
    next.creator = inferred.creator
    changedFields.push('creator')
  }

  if (!next.spawnedBy && inferred.spawnedBy) {
    next.spawnedBy = inferred.spawnedBy
    changedFields.push('spawnedBy')
  }

  if (
    !next.conversationId &&
    next.sessionType === 'commander' &&
    next.creator?.kind === 'commander' &&
    typeof next.creator.id === 'string' &&
    next.creator.id.trim().length > 0
  ) {
    next.conversationId = buildDefaultCommanderConversationId(next.creator.id.trim())
    changedFields.push('conversationId')
  }

  if (changedFields.length > 0) {
    console.info(
      `[agents][migration] Backfilled persisted session "${entry.name}": ${changedFields.join(', ')}`,
    )
  }

  return next
}

async function readStoredSessionMigrationEntries(
  sessionStorePath: string,
): Promise<Map<string, Record<string, unknown>>> {
  let raw: string
  try {
    raw = await readFile(sessionStorePath, 'utf8')
  } catch {
    return new Map()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return new Map()
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { sessions?: unknown[] }).sessions)) {
    return new Map()
  }

  const entriesByName = new Map<string, Record<string, unknown>>()
  for (const rawEntry of (parsed as { sessions: unknown[] }).sessions) {
    const entry = asMigrationRecord(rawEntry)
    if (!entry) {
      continue
    }

    const name = parseOptionalTrimmedString(entry.name)
    if (!name) {
      continue
    }

    entriesByName.set(name, entry)
  }

  return entriesByName
}
