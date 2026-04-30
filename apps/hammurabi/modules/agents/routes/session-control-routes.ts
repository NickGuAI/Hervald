import type { RequestHandler, Router } from 'express'
import {
  clearCodexTurnWatchdog,
  codexRolloutUnavailableMessage,
  hasCodexRolloutFile,
  isMissingCodexRolloutError,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import type { QueuedMessage, QueuedMessageImage, QueuedMessagePriority } from '../message-queue.js'
import { parseCodexApprovalDecision, parseSessionName } from '../session/input.js'
import { snapshotDeletedResumableStreamSession } from '../session/state.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CodexApprovalDecision,
  CodexSessionCreateOptions,
  CompletedSession,
  ExitedStreamSessionState,
  GeminiSessionCreateOptions,
  MachineConfig,
  PersistedStreamSession,
  PersistedSessionsState,
  ResolvedResumableSessionSource,
  StreamJsonEvent,
  StreamSession,
  StreamSessionCreateOptions,
} from '../types.js'

interface SessionQueueSnapshot {
  items: QueuedMessage[]
  currentMessage: QueuedMessage | null
  maxSize: number
  totalCount: number
}

type QueueMutationResult =
  | { ok: true; position: number }
  | { ok: false; status: number; error: string }

type ImmediateSendResult =
  | { ok: true; queued: boolean; message: QueuedMessage }
  | { ok: false; error: string }

interface SessionControlRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  maxSessions: number
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  applyCodexApprovalDecision(
    session: StreamSession,
    requestId: number,
    decision: CodexApprovalDecision,
  ): { ok: true } | {
    ok: false
    code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
    reason: string
  }
  clearCodexResumeMetadata(sessionName: string): void
  createCodexAppServerSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options?: CodexSessionCreateOptions,
  ): Promise<StreamSession>
  createGeminiAcpSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options?: GeminiSessionCreateOptions,
  ): Promise<StreamSession>
  createStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: 'claude',
    options?: StreamSessionCreateOptions,
  ): StreamSession
  readMachineRegistry(): Promise<MachineConfig[]>
  readPersistedSessionsState(): Promise<PersistedSessionsState>
  resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } }
  retireLiveCodexSessionForResume(sessionName: string, session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  sendImmediateTextToStreamSession(session: StreamSession, text: string): Promise<ImmediateSendResult>
  queueTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
  ): Promise<{ ok: true; message: QueuedMessage; position: number } | { ok: false; status: number; error: string }>
  createQueuedMessage(
    text: string,
    priority: QueuedMessagePriority,
    images?: QueuedMessageImage[],
  ): QueuedMessage
  enqueueQueuedMessage(session: StreamSession, message: QueuedMessage): QueueMutationResult
  getQueueSnapshot(session: StreamSession): SessionQueueSnapshot
  isQueueBackpressureError(error: string): boolean
  reorderVisibleQueuedMessages(session: StreamSession, order: readonly string[]): boolean
  removeQueuedMessageById(session: StreamSession, messageId: string): QueuedMessage | undefined
  clearVisibleQueuedMessages(session: StreamSession): void
  broadcastQueueUpdate(session: StreamSession): void
  clearQueuedMessageRetry(session: StreamSession): void
  resetQueuedMessageRetryDelay(session: StreamSession): void
  scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void
  applyRestoredQueueState(
    session: StreamSession,
    source: PersistedStreamSession,
    options?: { includeCurrentMessage?: boolean },
  ): void
  resumeRestoredQueueDrain(session: StreamSession): void
  teardownCodexSessionRuntime(session: StreamSession, reason: string): Promise<void>
  teardownGeminiSessionRuntime(session: StreamSession, reason: string): Promise<void>
  initializeAutoRotationState(session: StreamSession): void
}

const ALLOWED_QUEUED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_QUEUED_IMAGE_B64_LEN = Math.ceil(20 * 1024 * 1024 / 3) * 4

function parseQueuedImages(value: unknown): QueuedMessageImage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((image): image is QueuedMessageImage => {
    return image !== null
      && typeof image === 'object'
      && typeof image.mediaType === 'string'
      && ALLOWED_QUEUED_IMAGE_TYPES.has(image.mediaType)
      && typeof image.data === 'string'
      && image.data.length <= MAX_QUEUED_IMAGE_B64_LEN
  }).slice(0, 5)
}

export function registerSessionControlRoutes(deps: SessionControlRouteDeps): void {
  const {
    router,
    requireReadAccess,
    requireWriteAccess,
    maxSessions,
    sessions,
    completedSessions,
    exitedStreamSessions,
    sessionEventHandlers,
  } = deps

  router.post('/sessions/:name/send', requireWriteAccess, async (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (text.length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string' })
      return
    }

    const result = await deps.sendImmediateTextToStreamSession(session, text)
    if (!result.ok) {
      const isQueueBackpressure = deps.isQueueBackpressureError(result.error)
      res.status(isQueueBackpressure ? 409 : 503).json({
        sent: false,
        error: isQueueBackpressure ? result.error : 'Stream session unavailable',
      })
      return
    }

    if (result.queued) {
      res.status(202).json({ sent: false, queued: true })
      return
    }

    res.json({ sent: true })
  })

  router.post('/sessions/:name/message', requireWriteAccess, async (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const images = parseQueuedImages(req.body?.images)
    if (!text.length && images.length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string or images must be provided' })
      return
    }

    if (req.query.queue === 'true') {
      const queued = await deps.queueTextToStreamSession(session, text, images)
      if (!queued.ok) {
        res.status(queued.status).json({ error: queued.error })
        return
      }
      deps.scheduleQueuedMessageDrain(session)
      res.status(202).json({ queued: true, id: queued.message.id, position: queued.position })
      return
    }

    if (!text.length) {
      res.status(400).json({ error: 'text must be a non-empty string' })
      return
    }

    const result = await deps.sendImmediateTextToStreamSession(session, text)
    if (!result.ok) {
      const isQueueBackpressure = deps.isQueueBackpressureError(result.error)
      res.status(isQueueBackpressure ? 409 : 503).json({
        sent: false,
        error: isQueueBackpressure ? result.error : 'Stream session unavailable',
      })
      return
    }

    res.status(result.queued ? 202 : 200).json({
      sent: !result.queued,
      queued: result.queued,
      id: result.message.id,
    })
  })

  router.get('/sessions/:name/queue', requireReadAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    res.json(deps.getQueueSnapshot(session))
  })

  router.put('/sessions/:name/queue/reorder', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    const order = Array.isArray(req.body?.order)
      ? req.body.order.filter((entry: unknown): entry is string => typeof entry === 'string')
      : []
    if (!deps.reorderVisibleQueuedMessages(session, order)) {
      res.status(400).json({ error: 'order must contain every queued message id exactly once' })
      return
    }

    deps.broadcastQueueUpdate(session)
    deps.schedulePersistedSessionsWrite()
    res.json({ reordered: true })
  })

  router.delete('/sessions/:name/queue/:id', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    const messageId = typeof req.params.id === 'string' ? req.params.id.trim() : ''
    if (!messageId) {
      res.status(400).json({ error: 'Invalid queued message id' })
      return
    }

    const removed = deps.removeQueuedMessageById(session, messageId)
    if (!removed) {
      res.status(404).json({ error: 'Queued message not found' })
      return
    }

    if (session.queuedMessageRetryMessageId === removed.id) {
      deps.clearQueuedMessageRetry(session)
      deps.resetQueuedMessageRetryDelay(session)
      const queueSnapshot = deps.getQueueSnapshot(session)
      if (
        session.lastTurnCompleted &&
        !session.currentQueuedMessage &&
        ((queueSnapshot.currentMessage ?? null) !== null || (queueSnapshot.totalCount ?? 0) > 0)
      ) {
        deps.scheduleQueuedMessageDrain(session)
      }
    }

    deps.broadcastQueueUpdate(session)
    deps.schedulePersistedSessionsWrite()
    res.json({ removed: true, id: removed.id })
  })

  router.delete('/sessions/:name/queue', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    deps.clearVisibleQueuedMessages(session)
    deps.broadcastQueueUpdate(session)
    deps.schedulePersistedSessionsWrite()
    res.json({ cleared: true })
  })

  router.post('/sessions/:name/codex-approvals/:requestId', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const rawRequestIdParam = req.params.requestId
    const rawRequestId = Array.isArray(rawRequestIdParam) ? rawRequestIdParam[0] ?? '' : rawRequestIdParam ?? ''
    if (!/^\d+$/.test(rawRequestId)) {
      res.status(400).json({ error: 'Invalid Codex approval request id' })
      return
    }
    const requestId = Number.parseInt(rawRequestId, 10)
    if (!Number.isInteger(requestId) || requestId < 0) {
      res.status(400).json({ error: 'Invalid Codex approval request id' })
      return
    }

    const decision = parseCodexApprovalDecision(req.body?.decision)
    if (!decision) {
      res.status(400).json({ error: 'decision must be "accept" or "decline"' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'stream') {
      res.status(404).json({ error: `Stream session "${sessionName}" not found` })
      return
    }

    const decisionResult = deps.applyCodexApprovalDecision(session, requestId, decision)
    if (!decisionResult.ok) {
      if (decisionResult.code === 'not_found') {
        res.status(404).json({ error: decisionResult.reason })
        return
      }
      if (decisionResult.code === 'invalid_session') {
        res.status(409).json({ error: decisionResult.reason })
        return
      }
      res.status(503).json({ error: decisionResult.reason })
      return
    }

    res.json({ sent: true, requestId, decision })
  })

  router.post('/sessions/:name/pre-kill-debrief', requireWriteAccess, async (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session) {
      res.status(404).json({ error: `Session "${sessionName}" not found` })
      return
    }

    if (session.kind === 'pty') {
      res.json({ debriefed: false, reason: 'pty-session' })
      return
    }

    if (session.kind !== 'stream') {
      res.json({ debriefed: false, reason: 'unsupported-session-type' })
      return
    }

    res.json({ debriefStarted: false, reason: 'not-supported-yet' })
  })

  router.get('/sessions/:name/debrief-status', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    res.json({ status: 'none' })
  })

  router.delete('/sessions/:name', requireWriteAccess, async (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session) {
      const hadExited = exitedStreamSessions.delete(sessionName)
      const hadCompleted = completedSessions.delete(sessionName)
      if (hadExited || hadCompleted) {
        deps.schedulePersistedSessionsWrite()
        res.json({ killed: true })
        return
      }
      res.status(404).json({ error: `Session "${sessionName}" not found` })
      return
    }

    for (const client of session.clients) {
      client.close(1000, 'Session killed')
    }

    if (session.kind === 'pty') {
      session.pty.kill()
    } else if (session.kind === 'stream') {
      if (session.agentType === 'codex') {
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
        await deps.teardownCodexSessionRuntime(session, `Session "${sessionName}" deleted`)
      } else if (session.agentType === 'gemini') {
        await deps.teardownGeminiSessionRuntime(session, `Session "${sessionName}" deleted`)
      } else {
        session.process.kill('SIGTERM')
      }
    }

    const exitedSnapshot = session.kind === 'stream'
      ? snapshotDeletedResumableStreamSession(session)
      : null

    sessions.delete(sessionName)
    if (exitedSnapshot) {
      exitedStreamSessions.set(sessionName, exitedSnapshot)
    } else {
      exitedStreamSessions.delete(sessionName)
    }
    completedSessions.delete(sessionName)
    sessionEventHandlers.delete(sessionName)
    deps.schedulePersistedSessionsWrite()

    res.json({ killed: true })
  })

  router.post('/sessions/:name/resume', requireWriteAccess, async (req, res) => {
    const originalName = parseSessionName(req.params.name)
    if (!originalName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    let persistedState: PersistedSessionsState
    try {
      persistedState = await deps.readPersistedSessionsState()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load persisted sessions'
      res.status(500).json({ error: message })
      return
    }

    const resolved = deps.resolveResumableSessionSource(originalName, persistedState)
    if (!resolved.source) {
      res.status(resolved.error?.status ?? 404).json({
        error: resolved.error?.message ?? `Session "${originalName}" is not resumable`,
      })
      return
    }
    const { source, liveSession } = resolved.source

    if (sessions.size >= maxSessions && !liveSession) {
      res.status(429).json({ error: `Session limit reached (${maxSessions})` })
      return
    }

    let machine: MachineConfig | undefined
    if (source.host) {
      try {
        const machines = await deps.readMachineRegistry()
        machine = machines.find((entry) => entry.id === source.host)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read machines registry'
        res.status(500).json({ error: message })
        return
      }
      if (!machine) {
        res.status(400).json({ error: `Unknown host machine "${source.host}"` })
        return
      }
    }

    if (
      !liveSession &&
      source.agentType === 'codex' &&
      source.codexThreadId &&
      !source.host &&
      !(await hasCodexRolloutFile(source.codexThreadId, source.createdAt))
    ) {
      deps.clearCodexResumeMetadata(originalName)
      res.status(409).json({
        error: codexRolloutUnavailableMessage(originalName),
      })
      return
    }

    try {
      const resumedSession = source.agentType === 'codex'
        ? await deps.createCodexAppServerSession(originalName, source.mode, '', source.cwd, {
          resumeSessionId: source.codexThreadId,
          resumedFrom: source.resumedFrom,
          sessionType: source.sessionType,
          creator: source.creator,
          currentSkillInvocation: source.currentSkillInvocation,
          spawnedBy: source.spawnedBy,
          spawnedWorkers: source.spawnedWorkers,
          machine,
        })
        : source.agentType === 'gemini'
          ? await deps.createGeminiAcpSession(originalName, source.mode, '', source.cwd, {
            resumeSessionId: source.geminiSessionId,
            resumedFrom: source.resumedFrom,
            sessionType: source.sessionType,
            creator: source.creator,
            currentSkillInvocation: source.currentSkillInvocation,
            spawnedBy: source.spawnedBy,
            spawnedWorkers: source.spawnedWorkers,
            machine,
          })
          : deps.createStreamSession(
            originalName,
            source.mode,
            '',
            source.cwd,
            machine,
            'claude',
            {
              effort: source.effort,
              adaptiveThinking: source.adaptiveThinking,
              resumeSessionId: source.claudeSessionId,
              resumedFrom: source.resumedFrom,
              sessionType: source.sessionType,
              creator: source.creator,
              currentSkillInvocation: source.currentSkillInvocation,
              spawnedBy: source.spawnedBy,
              spawnedWorkers: source.spawnedWorkers,
            },
          )
      deps.applyRestoredQueueState(resumedSession, source, {
        includeCurrentMessage: !source.hadResult,
      })
      if (liveSession) {
        deps.retireLiveCodexSessionForResume(originalName, liveSession)
      }
      completedSessions.delete(originalName)
      sessions.set(originalName, resumedSession)
      deps.resumeRestoredQueueDrain(resumedSession)
      deps.initializeAutoRotationState(resumedSession)
      deps.schedulePersistedSessionsWrite()
      res.status(201).json({
        name: originalName,
        sessionType: resumedSession.sessionType,
        creator: resumedSession.creator,
        transportType: 'stream',
        resumedFrom: originalName,
      })
    } catch (error) {
      if (isMissingCodexRolloutError(error)) {
        deps.clearCodexResumeMetadata(originalName)
        res.status(409).json({
          error: codexRolloutUnavailableMessage(originalName),
        })
        return
      }
      const message = error instanceof Error ? error.message : 'Failed to resume session'
      res.status(500).json({ error: message })
    }
  })
}
