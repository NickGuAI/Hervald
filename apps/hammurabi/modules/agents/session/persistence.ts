import { appendFile, mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  migrateProviderContext,
  migratedProviderContextChanged,
  sanitizeProviderContextForPersistence,
} from '../../../migrations/provider-context.js'
import { resolveCommanderDataDir } from '../../commanders/paths.js'
import { writeJsonFileAtomically } from '../../../migrations/write-json-file-atomically.js'
import { resolveModuleDataDir } from '../../data-dir.js'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
} from '../../claude-adaptive-thinking.js'
import { DEFAULT_CLAUDE_EFFORT_LEVEL } from '../../claude-effort.js'
import type { MachineRegistryStore } from '../machines.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  SessionMessageQueue,
} from '../message-queue.js'
import { COMMANDER_PATH_SEGMENT_PATTERN, RESTORED_REPLAY_TURN_LIMIT } from '../constants.js'
import {
  applyRestoredReplayState,
  asObject,
  buildPersistedEntryFromExitedSession,
  buildPersistedEntryFromLiveStreamSession,
  countCompletedTurnEntries,
  mergePersistedSessionWithTranscriptMeta,
  parsePersistedSessionsState,
  snapshotExitedStreamSession,
  toCompletedSession,
} from './state.js'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PersistedSessionsState,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'
import {
  appendTranscriptEvent,
  readSessionMeta,
  readTranscriptTail,
  type TranscriptMeta,
  writeSessionMeta,
} from '../transcript-store.js'
import {
  ensureCodexProviderContext,
} from '../providers/provider-session-context.js'
import { getProvider } from '../providers/registry.js'

export interface PersistedSessionsWriteDeps {
  sessions: Map<string, AnySession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
}

export interface PersistedRestoreDeps {
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  maxSessions: number
  sessionStorePath?: string
  machineRegistry: MachineRegistryStore
  applyUsageEvent: (session: StreamSession, event: StreamJsonEvent) => void
  restoreProviderSession: (
    entry: PersistedStreamSession,
    machine?: MachineConfig,
  ) => StreamSession | Promise<StreamSession>
}

function defaultSessionStorePath(): string {
  return path.join(resolveModuleDataDir('agents'), 'stream-sessions.json')
}

export function sanitizeTranscriptFileKey(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function warnTranscriptStoreFailure(action: string, sessionName: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[agents] Failed to ${action} for "${sessionName}": ${message}`)
}

export function buildTranscriptMeta(session: StreamSession): TranscriptMeta {
  return {
    agentType: session.agentType,
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
    cwd: session.cwd,
    host: session.host,
    createdAt: session.createdAt,
    providerContext: sanitizeProviderContextForPersistence(session.providerContext, {
      effort: session.effort,
      adaptiveThinking: session.adaptiveThinking,
    }),
    spawnedBy: session.spawnedBy,
  }
}

export function writeTranscriptMetaForSession(session: StreamSession): void {
  void writeSessionMeta(session.name, buildTranscriptMeta(session)).catch((error) => {
    warnTranscriptStoreFailure('write transcript meta', session.name, error)
  })
}

export function appendGenericTranscriptEvent(session: StreamSession, event: StreamJsonEvent): void {
  void appendTranscriptEvent(session.name, event).catch((error) => {
    warnTranscriptStoreFailure('append transcript event', session.name, error)
  })
  writeTranscriptMetaForSession(session)
}

export function appendCommanderTranscriptEvent(
  session: StreamSession,
  event: StreamJsonEvent,
  queues: Map<string, Promise<void>>,
  extractClaudeSessionId: (event: StreamJsonEvent) => string | undefined,
): void {
  if (session.sessionType !== 'commander' || session.creator.kind !== 'commander') {
    return
  }

  const commanderId = session.creator.id?.trim()
  if (!commanderId || !COMMANDER_PATH_SEGMENT_PATTERN.test(commanderId)) {
    return
  }

  const rawTranscriptId = getProvider(session.agentType)?.transcriptId(session, event)
    ?? extractClaudeSessionId(event)
    ?? session.name
  const transcriptId = sanitizeTranscriptFileKey(rawTranscriptId)
  if (!transcriptId) {
    return
  }

  let line: string
  try {
    line = `${JSON.stringify(event)}\n`
  } catch {
    return
  }

  const transcriptPath = path.resolve(
    resolveCommanderDataDir(),
    commanderId,
    'sessions',
    `${transcriptId}.jsonl`,
  )

  const previous = queues.get(transcriptPath) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(transcriptPath), { recursive: true })
      await appendFile(transcriptPath, line, 'utf8')
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[agents] Failed to append commander transcript "${transcriptPath}": ${message}`)
    })

  queues.set(transcriptPath, next)
  void next.finally(() => {
    if (queues.get(transcriptPath) === next) {
      queues.delete(transcriptPath)
    }
  })
}

export async function resolveRestoredReplaySource(
  entry: PersistedStreamSession,
): Promise<{ entry: PersistedStreamSession; events: StreamJsonEvent[] }> {
  let resolvedEntry = entry
  try {
    resolvedEntry = mergePersistedSessionWithTranscriptMeta(entry, await readSessionMeta(entry.name))
  } catch (error) {
    warnTranscriptStoreFailure('read transcript meta', entry.name, error)
  }

  try {
    const transcriptEvents = await readTranscriptTail(entry.name, RESTORED_REPLAY_TURN_LIMIT)
    if (transcriptEvents.length > 0) {
      return {
        entry: resolvedEntry,
        events: transcriptEvents.filter((event): event is StreamJsonEvent => !!asObject(event)),
      }
    }
  } catch (error) {
    warnTranscriptStoreFailure('read transcript tail', entry.name, error)
  }

  return {
    entry: resolvedEntry,
    events: resolvedEntry.events ? [...resolvedEntry.events] : [],
  }
}

export function serializePersistedSessionsState(
  deps: PersistedSessionsWriteDeps,
): PersistedSessionsState {
  const sessionsByName = new Map<string, PersistedStreamSession>()
  for (const session of deps.sessions.values()) {
    if (session.kind !== 'stream') continue
    if (
      (session.sessionType === 'cron' || session.sessionType === 'automation') &&
      session.lastTurnCompleted &&
      session.finalResultEvent
    ) continue
    if (!getProvider(session.agentType)?.snapshotForPersist(session)) continue
    sessionsByName.set(session.name, buildPersistedEntryFromLiveStreamSession(session.name, session))
  }

  for (const [sessionName, exited] of deps.exitedStreamSessions) {
    if (exited.sessionType === 'cron' || exited.sessionType === 'automation') continue
    const persistedExited = buildPersistedEntryFromExitedSession(sessionName, exited)
    if (!getProvider(exited.agentType)?.hasResumeIdentifier(persistedExited)) {
      continue
    }
    sessionsByName.set(sessionName, persistedExited)
  }

  const restoredSessions = [...sessionsByName.values()]
  restoredSessions.sort((left, right) => left.name.localeCompare(right.name))
  return { sessions: restoredSessions }
}

export async function writePersistedSessionsState(
  sessionStorePath: string,
  payload: PersistedSessionsState,
  options: { backup?: boolean } = {},
): Promise<void> {
  await writeJsonFileAtomically(sessionStorePath, payload, { backup: options.backup })
}

export async function readPersistedSessionsState(
  sessionStorePath?: string,
): Promise<PersistedSessionsState> {
  const resolvedPath = sessionStorePath
    ? path.resolve(sessionStorePath)
    : defaultSessionStorePath()
  let raw: string
  try {
    raw = await readFile(resolvedPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessions: [] }
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { sessions: [] }
  }

  const payload = asObject(parsed)
  if (!Array.isArray(payload?.sessions)) {
    return parsePersistedSessionsState(parsed)
  }

  let migratedCount = 0
  let migratedSessions: unknown[] | null = null
  for (const [index, entry] of payload.sessions.entries()) {
    if (!asObject(entry)) {
      if (migratedSessions) {
        migratedSessions.push(entry)
      }
      continue
    }

    const { cleaned } = migrateProviderContext(entry)
    const changed = migratedProviderContextChanged(entry, cleaned)
    if (!changed) {
      if (migratedSessions) {
        migratedSessions.push(entry)
      }
      continue
    }

    if (!migratedSessions) {
      migratedSessions = payload.sessions.slice(0, index)
    }
    migratedSessions.push(cleaned)
    migratedCount += 1
  }

  if (migratedCount === 0 || !migratedSessions) {
    return parsePersistedSessionsState(parsed)
  }

  const migratedPayload = {
    ...payload,
    sessions: migratedSessions,
  }

  if (migratedCount > 0) {
    await writeJsonFileAtomically(resolvedPath, migratedPayload, { backup: true })
    console.warn(
      `[agents][migration] Migrated providerContext in ${migratedCount} stream session record(s)`,
    )
  }

  return parsePersistedSessionsState(migratedPayload)
}

export async function restorePersistedSessions(
  deps: PersistedRestoreDeps,
): Promise<void> {
  const persisted = await readPersistedSessionsState(deps.sessionStorePath)
  if (persisted.sessions.length === 0) return

  const machines = await deps.machineRegistry.readMachineRegistry()
  let remainingLiveSlots = Math.max(0, deps.maxSessions - deps.sessions.size)

  await Promise.allSettled(persisted.sessions.map(async (rawEntry) => {
    if (deps.sessions.has(rawEntry.name)) {
      return
    }

    try {
      const { entry, events } = await resolveRestoredReplaySource(rawEntry)

      if (entry.sessionState === 'exited') {
        if (!entry.sessionType || !entry.creator) {
          return
        }
        const hadResult = entry.hadResult ?? false
        if (!getProvider(entry.agentType)?.hasResumeIdentifier(entry)) {
          return
        }

        const provider = getProvider(entry.agentType)
        const supportsEffort = provider?.uiCapabilities.supportsEffort ?? false
        const supportsAdaptiveThinking = provider?.uiCapabilities.supportsAdaptiveThinking ?? false
        deps.exitedStreamSessions.set(entry.name, {
          phase: 'exited',
          hadResult,
          sessionType: entry.sessionType,
          creator: entry.creator,
          agentType: entry.agentType,
          mode: entry.mode,
          cwd: entry.cwd,
          host: entry.host,
          currentSkillInvocation: entry.currentSkillInvocation
            ? { ...entry.currentSkillInvocation }
            : undefined,
          spawnedBy: entry.spawnedBy,
          spawnedWorkers: entry.spawnedWorkers ? [...entry.spawnedWorkers] : [],
          createdAt: entry.createdAt,
          providerContext: entry.providerContext,
          activeTurnId: entry.activeTurnId,
          effort: supportsEffort
            ? entry.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
            : undefined,
          adaptiveThinking: supportsAdaptiveThinking
            ? entry.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
            : undefined,
          resumedFrom: entry.resumedFrom,
          conversationEntryCount: entry.conversationEntryCount ?? countCompletedTurnEntries(events),
          events: [...events],
          queuedMessages: entry.queuedMessages ? [...entry.queuedMessages] : [],
          currentQueuedMessage: entry.currentQueuedMessage,
          pendingDirectSendMessages: entry.pendingDirectSendMessages ? [...entry.pendingDirectSendMessages] : [],
        })

        if (hadResult) {
          const resultEvent = [...events].reverse().find((evt) => evt.type === 'result')
          if (resultEvent) {
            const totalCost = typeof resultEvent.total_cost_usd === 'number'
              ? resultEvent.total_cost_usd
              : (typeof resultEvent.cost_usd === 'number' ? resultEvent.cost_usd : 0)
            deps.completedSessions.set(
              entry.name,
              toCompletedSession(
                entry.name,
                entry.createdAt,
                resultEvent,
                totalCost,
                {
                  sessionType: entry.sessionType,
                  creator: entry.creator,
                  spawnedBy: entry.spawnedBy,
                  createdAt: entry.createdAt,
                },
              ),
            )
          } else {
            deps.completedSessions.set(entry.name, {
              name: entry.name,
              createdAt: entry.createdAt,
              completedAt: entry.createdAt,
              subtype: 'success',
              finalComment: '',
              costUsd: 0,
              sessionType: entry.sessionType,
              creator: entry.creator,
              spawnedBy: entry.spawnedBy,
            })
          }
        }
        return
      }

      if (!entry.sessionType || !entry.creator) {
        return
      }

      let machine: MachineConfig | undefined
      if (entry.host) {
        machine = machines.find((candidate) => candidate.id === entry.host)
        if (!machine) {
          return
        }
      }

      if (remainingLiveSlots <= 0) {
        return
      }
      remainingLiveSlots -= 1

      try {
        const session = await deps.restoreProviderSession(entry, machine)

        applyRestoredReplayState(session, events, deps.applyUsageEvent, entry.conversationEntryCount)
        session.messageQueue = new SessionMessageQueue(
          DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
          entry.queuedMessages ?? [],
        )
        session.currentQueuedMessage = entry.currentQueuedMessage
        session.pendingDirectSendMessages = entry.pendingDirectSendMessages
          ? [...entry.pendingDirectSendMessages]
          : []
        session.activeTurnId = entry.activeTurnId
        if (entry.agentType === 'codex' && entry.activeTurnId) {
          session.lastTurnCompleted = false
          session.completedTurnAt = undefined
          session.finalResultEvent = undefined
        }
        deps.sessions.set(entry.name, session)
      } catch (error) {
        remainingLiveSlots += 1
        throw error
      }
    } catch (error) {
      console.warn(
        `[agents][restore] Failed to restore persisted session "${rawEntry.name}"`,
        error,
      )
    }
  }))
}

export function clearCodexResumeMetadata(
  sessionName: string,
  sessions: Map<string, AnySession>,
  exitedStreamSessions: Map<string, ExitedStreamSessionState>,
  schedulePersistedSessionsWrite: () => void,
): void {
  const liveSession = sessions.get(sessionName)
  if (liveSession?.kind === 'stream' && liveSession.agentType === 'codex') {
    ensureCodexProviderContext(liveSession).threadId = undefined
    liveSession.activeTurnId = undefined
    liveSession.codexTurnStaleAt = undefined
  }

  const exitedSession = exitedStreamSessions.get(sessionName)
  if (exitedSession?.agentType === 'codex') {
    ensureCodexProviderContext(exitedSession).threadId = undefined
    exitedSession.activeTurnId = undefined
  }

  schedulePersistedSessionsWrite()
}

export function retireLiveCodexSessionForResume(
  sessionName: string,
  session: StreamSession,
  exitedStreamSessions: Map<string, ExitedStreamSessionState>,
  sessions: Map<string, AnySession>,
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>,
  clearCodexTurnWatchdog: (session: StreamSession) => void,
  markCodexTurnHealthy: (session: StreamSession) => void,
): void {
  clearCodexTurnWatchdog(session)
  markCodexTurnHealthy(session)
  ensureCodexProviderContext(session).notificationCleanup?.()
  ensureCodexProviderContext(session).notificationCleanup = undefined
  for (const client of session.clients) {
    client.close(1000, 'Session resumed')
  }
  exitedStreamSessions.set(sessionName, snapshotExitedStreamSession(session))
  sessions.delete(sessionName)
  sessionEventHandlers.delete(sessionName)
}
