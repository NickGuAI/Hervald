import type { RequestHandler, Router } from 'express'
import {
  clearCodexTurnWatchdog,
  codexRolloutUnavailableMessage,
  hasCodexRolloutFile,
  isMissingCodexRolloutError,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import type { QueuedMessage, QueuedMessageImage, QueuedMessagePriority } from '../message-queue.js'
import { parseMessageImagesForRequest } from '../message-images.js'
import type { ProviderCreateOptions } from '../providers/provider-adapter.js'
import { getProvider } from '../providers/registry.js'
import { ProviderAuthRequiredError } from '../provider-auth.js'
import { parseSessionName } from '../session/input.js'
import { snapshotDeletedResumableStreamSession } from '../session/state.js'
import {
  applyWorkspaceContextToText,
  hasWorkspaceContextPayload,
  readWorkspaceContextPayload,
} from '../../workspace/context.js'
import type { WorkspaceResolverCapability } from '../../workspace/capability.js'
import { toWorkspaceError } from '../../workspace/resolver.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PersistedStreamSession,
  PersistedSessionsState,
  ResolvedResumableSessionSource,
  StreamJsonEvent,
  StreamSession,
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
  clearCodexResumeMetadata(sessionName: string): void
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: StreamSession['agentType'],
    options?: Omit<ProviderCreateOptions, 'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'>,
  ): Promise<StreamSession>
  readMachineRegistry(): Promise<MachineConfig[]>
  readPersistedSessionsState(): Promise<PersistedSessionsState>
  resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } }
  retireLiveSessionForResume(sessionName: string, session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  sendImmediateTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
  ): Promise<ImmediateSendResult>
  queueTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
  ): Promise<{ ok: true; message: QueuedMessage; position: number } | { ok: false; status: number; error: string }>
  createQueuedMessage(
    text: string,
    priority: QueuedMessagePriority,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
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
  getWorkspaceResolver?: () => WorkspaceResolverCapability | undefined
  applyRestoredQueueState(
    session: StreamSession,
    source: PersistedStreamSession,
    options?: { includeCurrentMessage?: boolean },
  ): void
  resumeRestoredQueueDrain(session: StreamSession): void
  teardownProviderSession(session: StreamSession, reason: string): Promise<void>
  initializeAutoRotationState(session: StreamSession): void
}

function readClientSendId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
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
    const clientSendId = readClientSendId(req.body?.clientSendId)
    const workspaceContext = readWorkspaceContextPayload(req.body?.workspaceContext)
    if (text.length === 0 && !hasWorkspaceContextPayload(workspaceContext)) {
      res.status(400).json({ error: 'text must be a non-empty string' })
      return
    }
    let messageText: string
    try {
      messageText = await applyWorkspaceContextToText({
        text,
        resolver: workspaceContext?.targetId ? deps.getWorkspaceResolver?.() : undefined,
        context: workspaceContext,
      })
    } catch (error) {
      const workspaceError = toWorkspaceError(error)
      res.status(workspaceError.statusCode).json({ error: workspaceError.message })
      return
    }
    if (messageText.length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string' })
      return
    }

    const result = await deps.sendImmediateTextToStreamSession(session, messageText, undefined, text, clientSendId)
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
    const clientSendId = readClientSendId(req.body?.clientSendId)
    const parsedImages = parseMessageImagesForRequest(req.body?.images)
    if (!parsedImages.ok) {
      res.status(parsedImages.status).json({ error: parsedImages.error })
      return
    }
    const images = parsedImages.images
    const workspaceContext = readWorkspaceContextPayload(req.body?.workspaceContext)
    if (!text.length && images.length === 0 && !hasWorkspaceContextPayload(workspaceContext)) {
      res.status(400).json({ error: 'text must be a non-empty string or images must be provided' })
      return
    }
    let messageText: string
    try {
      messageText = await applyWorkspaceContextToText({
        text,
        resolver: workspaceContext?.targetId ? deps.getWorkspaceResolver?.() : undefined,
        context: workspaceContext,
      })
    } catch (error) {
      const workspaceError = toWorkspaceError(error)
      res.status(workspaceError.statusCode).json({ error: workspaceError.message })
      return
    }
    if (!messageText.length && images.length === 0) {
      res.status(400).json({ error: 'text must be a non-empty string or images must be provided' })
      return
    }

    if (req.query.queue === 'true') {
      const queued = await deps.queueTextToStreamSession(session, messageText, images, text, clientSendId)
      if (!queued.ok) {
        res.status(queued.status).json({ error: queued.error })
        return
      }
      deps.scheduleQueuedMessageDrain(session)
      res.status(202).json({ queued: true, id: queued.message.id, position: queued.position })
      return
    }

    const result = await deps.sendImmediateTextToStreamSession(session, messageText, images, text, clientSendId)
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
      if (getProvider(session.agentType)?.id === 'codex') {
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
      }
      await deps.teardownProviderSession(session, `Session "${sessionName}" deleted`)
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

    const sourceProvider = getProvider(source.agentType)
    const sourceResumeId = sourceProvider?.getResumeId(source)
    if (
      !liveSession &&
      sourceProvider?.id === 'codex' &&
      sourceResumeId &&
      !source.host &&
      !(await hasCodexRolloutFile(sourceResumeId, source.createdAt))
    ) {
      deps.clearCodexResumeMetadata(originalName)
      res.status(409).json({
        error: codexRolloutUnavailableMessage(originalName),
      })
      return
    }

    try {
      const resumedSession = await deps.createProviderStreamSession(
        originalName,
        source.mode,
        '',
        source.cwd,
        machine,
        source.agentType,
        {
          effort: source.effort,
          adaptiveThinking: source.adaptiveThinking,
          maxThinkingTokens: source.maxThinkingTokens,
          resumeSessionId: sourceResumeId,
          resumedFrom: source.resumedFrom,
          sessionType: source.sessionType,
          creator: source.creator,
          conversationId: source.conversationId,
          currentSkillInvocation: source.currentSkillInvocation,
          spawnedBy: source.spawnedBy,
          spawnedWorkers: source.spawnedWorkers,
        },
      )
      deps.applyRestoredQueueState(resumedSession, source, {
        includeCurrentMessage: !source.hadResult,
      })
      if (liveSession) {
        deps.retireLiveSessionForResume(originalName, liveSession)
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
      if (error instanceof ProviderAuthRequiredError) {
        res.status(424).json({
          code: 'AUTH_REQUIRED',
          provider: error.provider,
          scopeId: error.snapshot.scopeId,
          host: error.snapshot.host,
          reauthUrl: error.snapshot.reauthUrl,
          error: error.message,
        })
        return
      }
      const message = error instanceof Error ? error.message : 'Failed to resume session'
      res.status(500).json({ error: message })
    }
  })
}
