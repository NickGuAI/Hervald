import type { RequestHandler, Router } from 'express'
import { parseSessionName } from '../session/input.js'
import {
  buildPersistedEntryFromExitedSession,
  canResumeLiveStreamSession,
  getCommanderLabels,
  getWorldAgentStatus,
  summarizeWorkerStates,
  toCompletedSession,
} from '../session/state.js'
import {
  extractSessionMessagePeek,
  type SessionMessagePeekRoleFilter,
} from '../session/message-peek.js'
import type {
  AgentSession,
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  StreamSession,
  WorkerState,
} from '../types.js'

interface SessionQueryRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  commanderSessionStorePath?: string
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  isExitedSessionResumeAvailable(entry: ReturnType<typeof buildPersistedEntryFromExitedSession>): Promise<boolean>
  parseSessionName: typeof parseSessionName
  pruneStaleCronSessions?(): number
  pruneStaleCommandRoomSessions?(): number
  pruneStaleNonHumanSessions?(): Promise<number>
  getWorkerStates(sourceSessionName: string): WorkerState[]
}

function countVisibleQueuedMessages(session: StreamSession | ExitedStreamSessionState): number {
  const queuedMessages = 'messageQueue' in session
    ? session.messageQueue.list()
    : (session.queuedMessages ?? [])
  return queuedMessages.length + (session.pendingDirectSendMessages?.length ?? 0)
}

function parseLastQueryParam(rawValue: unknown): number | null {
  if (rawValue === undefined) {
    return 5
  }
  if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
    return null
  }

  const value = Number.parseInt(rawValue, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null
  }

  return Math.min(value, 100)
}

function parseRoleQueryParam(rawValue: unknown): SessionMessagePeekRoleFilter | null {
  if (rawValue === undefined) {
    return 'all'
  }
  if (rawValue === 'assistant' || rawValue === 'user' || rawValue === 'all') {
    return rawValue
  }
  return null
}

function parseBooleanQueryParam(rawValue: unknown, fallback: boolean): boolean | null {
  if (rawValue === undefined) {
    return fallback
  }
  if (typeof rawValue !== 'string') {
    return null
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return null
}

export function registerSessionQueryRoutes(deps: SessionQueryRouteDeps): void {
  const { router, requireReadAccess } = deps
  const pruneCronSessions = deps.pruneStaleCronSessions ?? deps.pruneStaleCommandRoomSessions ?? (() => 0)
  const pruneNonHumanSessions = deps.pruneStaleNonHumanSessions ?? (async () => 0)

  async function pruneSessions(): Promise<void> {
    pruneCronSessions()
    await pruneNonHumanSessions()
  }

  router.get('/sessions/:name/workers', requireReadAccess, (req, res) => {
    const sessionName = deps.parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const sourceSession = deps.sessions.get(sessionName)
    if (!sourceSession || sourceSession.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    res.json(deps.getWorkerStates(sessionName))
  })

  router.get('/sessions/:name/messages', requireReadAccess, async (req, res) => {
    await pruneSessions()

    const name = deps.parseSessionName(req.params.name)
    if (!name) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const last = parseLastQueryParam(req.query.last)
    if (last === null) {
      res.status(400).json({ error: 'Invalid last query parameter' })
      return
    }

    const role = parseRoleQueryParam(req.query.role)
    if (role === null) {
      res.status(400).json({ error: 'Invalid role query parameter' })
      return
    }

    const includeToolUse = parseBooleanQueryParam(req.query.includeToolUse, true)
    if (includeToolUse === null) {
      res.status(400).json({ error: 'Invalid includeToolUse query parameter' })
      return
    }

    const activeSession = deps.sessions.get(name)
    if (activeSession) {
      const events = activeSession.kind === 'pty' ? [] : activeSession.events
      const fallbackTimestamp = activeSession.lastEventAt ?? activeSession.createdAt
      const messages = extractSessionMessagePeek(events, {
        last,
        role,
        includeToolUse,
        fallbackTimestamp,
      })

      res.json({
        session: name,
        total: events.length,
        returned: messages.length,
        messages,
      })
      return
    }

    const exitedSession = deps.exitedStreamSessions.get(name)
    if (exitedSession) {
      const messages = extractSessionMessagePeek(exitedSession.events, {
        last,
        role,
        includeToolUse,
        fallbackTimestamp: exitedSession.createdAt,
      })

      res.json({
        session: name,
        total: exitedSession.events.length,
        returned: messages.length,
        messages,
      })
      return
    }

    res.status(404).json({ error: 'Session not found' })
  })

  router.get('/sessions/:name', requireReadAccess, async (req, res) => {
    await pruneSessions()

    const name = deps.parseSessionName(req.params.name)
    if (!name) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const active = deps.sessions.get(name)
    if (active) {
      if (
        active.kind === 'stream' &&
        active.sessionType !== 'commander' &&
        active.creator.kind !== 'human' &&
        active.lastTurnCompleted &&
        active.finalResultEvent
      ) {
        const completed = toCompletedSession(
          name,
          active.completedTurnAt ?? new Date().toISOString(),
          active.finalResultEvent,
          active.usage.costUsd,
          {
            sessionType: active.sessionType,
            creator: active.creator,
            spawnedBy: active.spawnedBy,
            createdAt: active.createdAt,
          },
        )
        deps.completedSessions.set(name, completed)
        res.json({
          name,
          completed: true,
          status: completed.subtype,
          sessionType: completed.sessionType,
          creator: completed.creator,
          created: active.createdAt,
          lastActivityAt: active.lastEventAt ?? completed.completedAt,
          spawnedBy: completed.spawnedBy,
          result: {
            status: completed.subtype,
            finalComment: completed.finalComment,
            costUsd: completed.costUsd,
            completedAt: completed.completedAt,
          },
        })
        return
      }

      const pid = active.kind === 'pty'
        ? active.pty.pid
        : (active.kind === 'stream' ? (active.process.pid ?? 0) : 0)
      const workerStates = active.kind === 'stream' ? deps.getWorkerStates(name) : []
      res.json({
        name,
        completed: false,
        status: active.kind === 'external' ? active.status : 'running',
        created: active.createdAt,
        lastActivityAt: active.lastEventAt,
        pid,
        sessionType: active.sessionType,
        creator: active.creator,
        transportType: active.kind === 'external' ? 'external' : (active.kind === 'pty' ? 'pty' : 'stream'),
        agentType: active.agentType,
        effort: active.effort,
        adaptiveThinking: active.adaptiveThinking,
        cwd: active.cwd,
        host: active.host ?? (active.kind === 'external' ? active.machine : undefined),
        spawnedBy: active.kind === 'stream' ? active.spawnedBy : undefined,
        spawnedWorkers: active.kind === 'stream' ? [...active.spawnedWorkers] : undefined,
        workerSummary: active.kind === 'stream' ? summarizeWorkerStates(workerStates) : undefined,
        queuedMessageCount: active.kind === 'stream' ? countVisibleQueuedMessages(active) : undefined,
        ...(active.kind === 'external' ? { machine: active.machine, metadata: active.metadata } : {}),
      })
      return
    }

    const completed = deps.completedSessions.get(name)
    if (completed) {
      res.json({
        name,
        completed: true,
        status: completed.subtype,
        sessionType: completed.sessionType,
        creator: completed.creator,
        created: completed.createdAt ?? completed.completedAt,
        lastActivityAt: completed.completedAt,
        spawnedBy: completed.spawnedBy,
        result: {
          status: completed.subtype,
          finalComment: completed.finalComment,
          costUsd: completed.costUsd,
          completedAt: completed.completedAt,
        },
      })
      return
    }

    const exited = deps.exitedStreamSessions.get(name)
    if (exited) {
      res.json({
        name,
        completed: false,
        status: 'exited',
        created: exited.createdAt,
        lastActivityAt: exited.createdAt,
        pid: 0,
        sessionType: exited.sessionType,
        creator: exited.creator,
        transportType: 'stream',
        agentType: exited.agentType,
        effort: exited.effort,
        adaptiveThinking: exited.adaptiveThinking,
        cwd: exited.cwd,
        host: exited.host,
        spawnedBy: exited.spawnedBy,
        spawnedWorkers: [...exited.spawnedWorkers],
        processAlive: false,
        hadResult: exited.hadResult,
        resumedFrom: exited.resumedFrom,
        queuedMessageCount: countVisibleQueuedMessages(exited),
      })
      return
    }

    res.status(404).json({ error: 'Session not found' })
  })

  router.get('/sessions', requireReadAccess, async (_req, res) => {
    await pruneSessions()

    const result: AgentSession[] = []
    const nowMs = Date.now()
    const commanderLabels = await getCommanderLabels(deps.commanderSessionStorePath)
    for (const [name, session] of deps.sessions) {
      if (
        session.kind === 'stream' &&
        (session.sessionType === 'cron' || session.sessionType === 'automation') &&
        session.lastTurnCompleted &&
        session.finalResultEvent
      ) {
        continue
      }

      const pid = session.kind === 'pty'
        ? session.pty.pid
        : (session.kind === 'stream' ? (session.process.pid ?? 0) : 0)
      const workerStates = session.kind === 'stream' ? deps.getWorkerStates(name) : []

      let label: string | undefined
      if (session.sessionType === 'commander' && session.creator.kind === 'commander' && session.creator.id) {
        label = commanderLabels[session.creator.id]
      }

      result.push({
        name,
        label,
        created: session.createdAt,
        pid,
        sessionType: session.sessionType,
        creator: session.creator,
        transportType: session.kind === 'external' ? 'external' : (session.kind === 'pty' ? 'pty' : 'stream'),
        agentType: session.agentType,
        effort: session.effort,
        adaptiveThinking: session.adaptiveThinking,
        cwd: session.cwd,
        host: session.host ?? (session.kind === 'external' ? session.machine : undefined),
        spawnedBy: session.kind === 'stream' ? session.spawnedBy : undefined,
        spawnedWorkers: session.kind === 'stream' ? [...session.spawnedWorkers] : undefined,
        workerSummary: session.kind === 'stream' ? summarizeWorkerStates(workerStates) : undefined,
        processAlive: true,
        hadResult: session.kind === 'stream' ? Boolean(session.finalResultEvent) : undefined,
        resumedFrom: session.kind === 'stream' ? session.resumedFrom : undefined,
        queuedMessageCount: session.kind === 'stream' ? countVisibleQueuedMessages(session) : undefined,
        status: getWorldAgentStatus(session, nowMs),
        resumeAvailable: session.kind === 'stream' ? canResumeLiveStreamSession(session) : false,
      })
    }

    for (const [name, exited] of deps.exitedStreamSessions) {
      if (deps.sessions.has(name) || exited.sessionType === 'cron' || exited.sessionType === 'automation') {
        continue
      }

      const persistedEntry = buildPersistedEntryFromExitedSession(name, exited)
      const resumeAvailable = await deps.isExitedSessionResumeAvailable(persistedEntry)
      result.push({
        name,
        created: exited.createdAt,
        pid: 0,
        sessionType: exited.sessionType,
        creator: exited.creator,
        transportType: 'stream',
        agentType: exited.agentType,
        effort: exited.effort,
        adaptiveThinking: exited.adaptiveThinking,
        cwd: exited.cwd,
        host: exited.host,
        spawnedBy: exited.spawnedBy,
        spawnedWorkers: [...exited.spawnedWorkers],
        processAlive: false,
        hadResult: exited.hadResult,
        resumedFrom: exited.resumedFrom,
        queuedMessageCount: countVisibleQueuedMessages(exited),
        status: 'exited',
        resumeAvailable,
      })
    }

    res.json(result)
  })
}
