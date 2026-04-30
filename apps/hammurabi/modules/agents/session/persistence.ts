import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { resolveCommanderDataDir } from '../../commanders/paths.js'
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
  createClaudeSession: (
    entry: PersistedStreamSession,
    machine?: MachineConfig,
  ) => StreamSession | Promise<StreamSession>
  createCodexSession: (
    entry: PersistedStreamSession,
    machine?: MachineConfig,
  ) => Promise<StreamSession>
  createGeminiSession: (
    entry: PersistedStreamSession,
    machine?: MachineConfig,
  ) => Promise<StreamSession>
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
    claudeSessionId: session.claudeSessionId,
    codexThreadId: session.codexThreadId,
    geminiSessionId: session.geminiSessionId,
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

  const rawTranscriptId = session.claudeSessionId
    ?? session.codexThreadId
    ?? session.geminiSessionId
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
    if (session.sessionType === 'cron' && session.lastTurnCompleted && session.finalResultEvent) continue
    if (session.agentType === 'claude' && (!session.claudeSessionId || !session.lastTurnCompleted)) continue
    if (session.agentType === 'codex' && !session.codexThreadId) continue
    sessionsByName.set(session.name, buildPersistedEntryFromLiveStreamSession(session.name, session))
  }

  for (const [sessionName, exited] of deps.exitedStreamSessions) {
    if (exited.sessionType === 'cron') continue
    if (exited.agentType === 'claude' && !exited.claudeSessionId) continue
    if (exited.agentType === 'codex' && !exited.codexThreadId) continue
    sessionsByName.set(sessionName, buildPersistedEntryFromExitedSession(sessionName, exited))
  }

  const restoredSessions = [...sessionsByName.values()]
  restoredSessions.sort((left, right) => left.name.localeCompare(right.name))
  return { sessions: restoredSessions }
}

export async function writePersistedSessionsState(
  sessionStorePath: string,
  payload: PersistedSessionsState,
): Promise<void> {
  await mkdir(path.dirname(sessionStorePath), { recursive: true })
  await writeFile(sessionStorePath, JSON.stringify(payload, null, 2), 'utf8')
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

  return parsePersistedSessionsState(parsed)
}

export async function restorePersistedSessions(
  deps: PersistedRestoreDeps,
): Promise<void> {
  const persisted = await readPersistedSessionsState(deps.sessionStorePath)
  if (persisted.sessions.length === 0) return

  for (const rawEntry of persisted.sessions) {
    if (deps.sessions.has(rawEntry.name)) {
      continue
    }

    try {
      const { entry, events } = await resolveRestoredReplaySource(rawEntry)

      if (entry.sessionState === 'exited') {
        const hadResult = entry.hadResult ?? false
        if (
          (entry.agentType === 'claude' && !entry.claudeSessionId) ||
          (entry.agentType === 'codex' && !entry.codexThreadId) ||
          (entry.agentType === 'gemini' && !entry.geminiSessionId)
        ) {
          continue
        }

        deps.exitedStreamSessions.set(entry.name, {
          phase: 'exited',
          hadResult,
          sessionType: entry.sessionType ?? 'worker',
          creator: entry.creator ?? { kind: 'human' },
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
          claudeSessionId: entry.claudeSessionId,
          codexThreadId: entry.codexThreadId,
          activeTurnId: entry.activeTurnId,
          geminiSessionId: entry.geminiSessionId,
          effort: entry.agentType === 'claude'
            ? entry.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
            : undefined,
          adaptiveThinking: entry.agentType === 'claude'
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
              sessionType: entry.sessionType ?? 'worker',
              creator: entry.creator ?? { kind: 'human' },
              spawnedBy: entry.spawnedBy,
            })
          }
        }
        continue
      }

      if (deps.sessions.size >= deps.maxSessions) {
        break
      }

      let machine: MachineConfig | undefined
      if (entry.host) {
        const machines = await deps.machineRegistry.readMachineRegistry()
        machine = machines.find((candidate) => candidate.id === entry.host)
        if (!machine) {
          continue
        }
      }

      const session = entry.agentType === 'codex'
        ? await deps.createCodexSession(entry, machine)
        : entry.agentType === 'gemini'
          ? await deps.createGeminiSession(entry, machine)
          : await deps.createClaudeSession(entry, machine)

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
    } catch {
      // Ignore individual restore failures and continue restoring others.
    }
  }
}

export function clearCodexResumeMetadata(
  sessionName: string,
  sessions: Map<string, AnySession>,
  exitedStreamSessions: Map<string, ExitedStreamSessionState>,
  schedulePersistedSessionsWrite: () => void,
): void {
  const liveSession = sessions.get(sessionName)
  if (liveSession?.kind === 'stream' && liveSession.agentType === 'codex') {
    liveSession.codexThreadId = undefined
    liveSession.activeTurnId = undefined
    liveSession.codexTurnStaleAt = undefined
  }

  const exitedSession = exitedStreamSessions.get(sessionName)
  if (exitedSession?.agentType === 'codex') {
    exitedSession.codexThreadId = undefined
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
  session.codexNotificationCleanup?.()
  session.codexNotificationCleanup = undefined
  for (const client of session.clients) {
    client.close(1000, 'Session resumed')
  }
  exitedStreamSessions.set(sessionName, snapshotExitedStreamSession(session))
  sessions.delete(sessionName)
  sessionEventHandlers.delete(sessionName)
}
