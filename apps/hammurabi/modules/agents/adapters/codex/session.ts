import { normalizeCodexEvent } from '../../event-normalizers/codex.js'
import {
  codexApprovalAdapter,
  sendCodexApprovalReply,
  type CodexApprovalRawEvent,
} from './approval-adapter.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  SessionMessageQueue,
} from '../../message-queue.js'
import type { ActionPolicyGate } from '../../../policies/action-policy-gate.js'
import { handleProviderApproval } from '../../../policies/provider-approval-adapter.js'
import {
  createCodexProviderContext,
  ensureCodexProviderContext,
  readCodexNotificationCleanup,
  readCodexRuntime,
  readCodexRuntimeTeardownPromise,
  readCodexThreadId,
} from '../../providers/provider-session-context.js'
import {
  cloneActiveSkillInvocation,
  snapshotExitedStreamSession,
  toCompletedSession,
} from '../../session/state.js'
import { truncateLogText } from '../../session/helpers.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CodexApprovalDecision,
  CodexRuntimeFailure,
  CodexPendingApprovalRequest,
  CodexSessionCreateOptions,
  CodexSessionRuntimeHandle,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  StreamSessionAdapter,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'
import {
  buildCodexApprovalMissingIdSystemEvent,
  clearCodexPendingApprovalByItemId,
  getCodexApprovalRequestDetails,
  getCodexApprovalToolCall,
  getCodexCompletedItemId,
  isCodexApprovalLikeMethod,
  markCodexTurnHealthy,
  parseCodexSidecarError,
  parseCodexApprovalMethod,
} from './helpers.js'

const CODEX_TRANSPORT_RECOVERY_GRACE_MS = 250
const codexTransportRecoveryPromises = new WeakMap<StreamSession, Promise<void>>()

export interface CodexSessionDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  clearExitedSession(sessionName: string): void
  clearTurnWatchdog(session: StreamSession): void
  deleteLiveSession(sessionName: string): void
  deleteSessionEventHandlers(sessionName: string): void
  getActiveSession(sessionName: string): AnySession | undefined
  getAllSessions(): Iterable<AnySession>
  resetActiveTurnState(session: StreamSession): void
  notifyApprovalEnqueued?(session: StreamSession, request: CodexPendingApprovalRequest): void
  notifyApprovalResolved?(
    session: StreamSession,
    request: CodexPendingApprovalRequest,
    decision: CodexApprovalDecision,
    delivered: boolean,
  ): void
  runtimeFactory(
    sessionName: string,
    machine: MachineConfig | undefined,
    handleOwningSessionFailure: (failure: CodexRuntimeFailure) => void,
  ): CodexSessionRuntimeHandle
  schedulePersistedSessionsWrite(): void
  scheduleTurnWatchdog(session: StreamSession): void
  setCompletedSession(sessionName: string, session: CompletedSession): void
  setExitedSession(sessionName: string, session: ExitedStreamSessionState): void
  writeTranscriptMeta(session: StreamSession): void
  getActionPolicyGate?(): ActionPolicyGate | null
}

export type CodexSendAttemptResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string }

function codexFailureMessage(reason: string): string {
  return `Codex transport failure: ${reason}`
}

const ALWAYS_ON_CODEX_APPROVAL_POLICY = {
  granular: {
    sandbox_approval: true,
    mcp_elicitations: true,
    rules: true,
    request_permissions: true,
    skill_approval: true,
  },
} as const

function resolveCodexTransportPolicy(mode: ClaudePermissionMode): {
  sandbox: string
  approvalPolicy: string | typeof ALWAYS_ON_CODEX_APPROVAL_POLICY
} {
  // Hammurabi owns the canonical action-policy gate (#1186); codex's own
  // sandbox should not double-gate. workspace-write rejects writes to .git
  // metadata even inside the workspace, which breaks `git worktree add` for
  // dispatched workers and adds zero defense-in-depth (the gate already
  // routes provider-emitted approval events through the unified pipeline,
  // and internal default-allow policies fast-path safe internal actions).
  // Approval policy stays ALWAYS_ON granular so codex still emits the
  // request events Hammurabi's gate intercepts.
  return {
    sandbox: 'danger-full-access',
    approvalPolicy: ALWAYS_ON_CODEX_APPROVAL_POLICY,
  }
}

function buildCodexTransportRecoveredEvent(reason: string): StreamJsonEvent {
  return {
    type: 'system',
    subtype: 'transport_recovered',
    text: `Codex transport recovered after disconnect: ${reason}`,
  }
}

function readCodexTurnId(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) {
    return undefined
  }
  const turn = (params as { turn?: unknown }).turn
  if (typeof turn !== 'object' || turn === null) {
    return undefined
  }
  const turnId = (turn as { id?: unknown }).id
  if (typeof turnId !== 'string') {
    return undefined
  }
  const normalized = turnId.trim()
  return normalized.length > 0 ? normalized : undefined
}

function setCodexActiveTurnId(session: StreamSession, turnId: string | undefined): void {
  session.activeTurnId = turnId
}

function clearCodexActiveTurnId(session: StreamSession): void {
  session.activeTurnId = undefined
}

function getCodexActiveTurnId(session: StreamSession): string | undefined {
  if (session.lastTurnCompleted) {
    return undefined
  }
  return session.activeTurnId
}

function buildCodexTurnInput(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }]
}

function classifyCodexDispatchError(
  method: 'turn/start' | 'turn/steer',
  error: unknown,
): { retryable: boolean; reason: string; clearActiveTurnId: boolean } {
  const detail = error instanceof Error ? error.message : String(error)
  const parsedError = parseCodexSidecarError(error)
  const reason = parsedError?.message ?? detail
  const normalizedReason = reason.toLowerCase()

  const isExpectedTurnMismatch = method === 'turn/steer' && (
    normalizedReason.includes('expectedturnid')
    || normalizedReason.includes('expected turn')
    || normalizedReason.includes('precondition')
    || normalizedReason.includes('does not match')
    || normalizedReason.includes('turn advanced')
    || normalizedReason.includes('turn mismatch')
  )
  if (isExpectedTurnMismatch) {
    return {
      retryable: true,
      reason,
      clearActiveTurnId: true,
    }
  }

  const isBusyTurnError = parsedError?.code === -32001 && (
    normalizedReason.includes('already in progress')
    || normalizedReason.includes('busy')
    || normalizedReason.includes('active turn')
    || normalizedReason.includes('same-turn steering')
    || normalizedReason.includes('steerable')
    || normalizedReason.includes('review')
    || normalizedReason.includes('compact')
  )
  if (isBusyTurnError) {
    return {
      retryable: true,
      reason,
      clearActiveTurnId: false,
    }
  }

  return {
    retryable: false,
    reason,
    clearActiveTurnId: false,
  }
}

export async function startCodexTurn(session: StreamSession, text: string): Promise<void> {
  const resumeThreadId = readCodexThreadId(session)
  if (!resumeThreadId) {
    throw new Error('Codex session is missing a thread id')
  }
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    throw new Error('Codex runtime is not initialized')
  }
  await runtime.ensureConnected()
  await runtime.sendRequest('turn/start', {
    threadId: resumeThreadId,
    input: buildCodexTurnInput(text),
  })
}

async function steerCodexTurn(session: StreamSession, turnId: string, text: string): Promise<void> {
  const resumeThreadId = readCodexThreadId(session)
  if (!resumeThreadId) {
    throw new Error('Codex session is missing a thread id')
  }
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    throw new Error('Codex runtime is not initialized')
  }
  await runtime.ensureConnected()
  await runtime.sendRequest('turn/steer', {
    threadId: resumeThreadId,
    expectedTurnId: turnId,
    input: buildCodexTurnInput(text),
  })
}

async function hydrateCodexApprovalRawEvent(
  session: StreamSession,
  pendingRequest: CodexPendingApprovalRequest,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'notifyApprovalResolved'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
  >,
): Promise<CodexApprovalRawEvent> {
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    throw new Error('Codex runtime is unavailable')
  }

  let toolCall = getCodexApprovalToolCall(undefined, pendingRequest)
  try {
    const threadReadResult = await runtime.sendRequest('thread/read', {
      threadId: pendingRequest.threadId ?? readCodexThreadId(session),
      includeTurns: true,
    })
    toolCall = getCodexApprovalToolCall(threadReadResult, pendingRequest)
  } catch (error) {
    runtime.log('warn', 'Failed to hydrate Codex approval request from thread/read', {
      sessionName: session.name,
      threadId: pendingRequest.threadId ?? readCodexThreadId(session),
      requestId: pendingRequest.requestId,
      itemId: pendingRequest.itemId,
      error: truncateLogText(error instanceof Error ? error.message : String(error)),
    })
  }

  if (!toolCall) {
    throw new Error('Unable to hydrate Codex approval request')
  }

  return {
    request: pendingRequest,
    toolName: toolCall.toolName,
    toolInput: toolCall.toolInput,
    replyDeps: deps,
  }
}

export function applyCodexApprovalDecision(
  session: StreamSession,
  requestId: number,
  decision: CodexApprovalDecision,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'notifyApprovalResolved'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
  >,
): { ok: true } | {
  ok: false
  code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
  reason: string
} {
  if (session.agentType !== 'codex') {
    return {
      ok: false,
      code: 'invalid_session',
      reason: 'Codex approvals are only available for Codex sessions',
    }
  }
  const runtime = readCodexRuntime(session)
  if (!runtime) {
    return { ok: false, code: 'unavailable', reason: 'Codex runtime is unavailable' }
  }

  const pendingRequest = session.codexPendingApprovals.get(requestId)
  if (!pendingRequest) {
    return {
      ok: false,
      code: 'not_found',
      reason: `Codex approval request "${requestId}" not found`,
    }
  }

  return sendCodexApprovalReply(session, pendingRequest, decision, deps)
}

export async function teardownCodexSessionRuntime(
  session: StreamSession,
  reason: string,
): Promise<void> {
  if (readCodexRuntimeTeardownPromise(session)) {
    await readCodexRuntimeTeardownPromise(session)
    return
  }

  const runtime = readCodexRuntime(session)
  if (!runtime) {
    clearCodexActiveTurnId(session)
    try {
      session.process.kill('SIGTERM')
    } catch {
      // Best-effort cleanup only.
    }
    return
  }

  readCodexNotificationCleanup(session)?.()
  ensureCodexProviderContext(session).notificationCleanup = undefined

  const teardownPromise = runtime.teardown({
    threadId: readCodexThreadId(session),
    reason,
  })
  ensureCodexProviderContext(session).runtimeTeardownPromise = teardownPromise
  try {
    await teardownPromise
  } finally {
    clearCodexActiveTurnId(session)
    const context = ensureCodexProviderContext(session)
    context.runtimeTeardownPromise = undefined
    context.notificationCleanup = undefined
    context.runtime = undefined
  }
}

export async function failCodexSession(
  sessionName: string,
  session: StreamSession,
  reason: string,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'clearTurnWatchdog'
    | 'deleteLiveSession'
    | 'deleteSessionEventHandlers'
    | 'getActiveSession'
    | 'setCompletedSession'
    | 'setExitedSession'
  >,
  exitCode = 1,
  signal?: string,
): Promise<void> {
  if (deps.getActiveSession(sessionName) !== session) {
    return
  }

  deps.clearTurnWatchdog(session)
  clearCodexActiveTurnId(session)
  markCodexTurnHealthy(session)

  const message = codexFailureMessage(reason)
  const systemEvent: StreamJsonEvent = {
    type: 'system',
    text: message,
  }
  deps.appendEvent(session, systemEvent)
  deps.broadcastEvent(session, systemEvent)

  const resultEvent: StreamJsonEvent = {
    type: 'result',
    subtype: 'failed',
    is_error: true,
    result: message,
  }
  deps.appendEvent(session, resultEvent)
  deps.broadcastEvent(session, resultEvent)

  const exitEvent: StreamJsonEvent = {
    type: 'exit',
    exitCode,
    signal,
    text: message,
  }
  deps.appendEvent(session, exitEvent)
  deps.broadcastEvent(session, exitEvent)

  deps.setCompletedSession(
    sessionName,
    toCompletedSession(
      sessionName,
      session.completedTurnAt ?? new Date().toISOString(),
      resultEvent,
      session.usage.costUsd,
      {
        sessionType: session.sessionType,
        creator: session.creator,
        spawnedBy: session.spawnedBy,
        createdAt: session.createdAt,
      },
    ),
  )
  deps.setExitedSession(sessionName, snapshotExitedStreamSession(session))

  await teardownCodexSessionRuntime(session, message)

  for (const client of session.clients) {
    client.close(1000, 'Session ended')
  }
  deps.deleteLiveSession(sessionName)
  deps.deleteSessionEventHandlers(sessionName)
}

async function recoverCodexTransport(
  sessionName: string,
  session: StreamSession,
  reason: string,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'clearTurnWatchdog'
    | 'deleteLiveSession'
    | 'deleteSessionEventHandlers'
    | 'getActiveSession'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
    | 'setCompletedSession'
    | 'setExitedSession'
  >,
): Promise<void> {
  const existingRecovery = codexTransportRecoveryPromises.get(session)
  if (existingRecovery) {
    return existingRecovery
  }

  const recovery = (async () => {
    if (deps.getActiveSession(sessionName) !== session || readCodexRuntimeTeardownPromise(session)) {
      return
    }

    const runtime = readCodexRuntime(session)
    const threadId = readCodexThreadId(session)
    if (!runtime || !threadId) {
      await failCodexSession(sessionName, session, reason, deps)
      deps.schedulePersistedSessionsWrite()
      return
    }

    const terminalFailure = await runtime.waitForTerminalFailure(CODEX_TRANSPORT_RECOVERY_GRACE_MS)
    if (deps.getActiveSession(sessionName) !== session || readCodexRuntimeTeardownPromise(session)) {
      return
    }
    if (terminalFailure) {
      await failCodexSession(
        sessionName,
        session,
        terminalFailure.reason,
        deps,
        terminalFailure.exitCode,
        terminalFailure.signal,
      )
      deps.schedulePersistedSessionsWrite()
      return
    }

    const { sandbox, approvalPolicy } = resolveCodexTransportPolicy(session.mode)

    try {
      await runtime.ensureConnected()
      await runtime.sendRequest('thread/resume', {
        threadId,
        sandbox,
        approvalPolicy,
      })
    } catch (error) {
      if (deps.getActiveSession(sessionName) !== session || readCodexRuntimeTeardownPromise(session)) {
        return
      }

      const latestTerminalFailure = runtime.getTerminalFailure()
      const detail = latestTerminalFailure?.reason ?? (error instanceof Error ? error.message : String(error))
      await failCodexSession(
        sessionName,
        session,
        detail,
        deps,
        latestTerminalFailure?.exitCode,
        latestTerminalFailure?.signal,
      )
      deps.schedulePersistedSessionsWrite()
      return
    }

    if (deps.getActiveSession(sessionName) !== session || readCodexRuntimeTeardownPromise(session)) {
      return
    }

    markCodexTurnHealthy(session)
    deps.clearTurnWatchdog(session)
    if (!session.lastTurnCompleted) {
      deps.scheduleTurnWatchdog(session)
    }

    const recoveredEvent = buildCodexTransportRecoveredEvent(reason)
    deps.appendEvent(session, recoveredEvent)
    deps.broadcastEvent(session, recoveredEvent)
    deps.schedulePersistedSessionsWrite()
  })().finally(() => {
    if (codexTransportRecoveryPromises.get(session) === recovery) {
      codexTransportRecoveryPromises.delete(session)
    }
  })

  codexTransportRecoveryPromises.set(session, recovery)
  return recovery
}

export async function shutdownCodexRuntimes(
  deps: Pick<CodexSessionDeps, 'clearTurnWatchdog' | 'getAllSessions'>,
  reason = 'Hammurabi shutdown',
): Promise<void> {
  const codexSessions = [...deps.getAllSessions()].filter((session): session is StreamSession =>
    session.kind === 'stream' && session.agentType === 'codex'
  )

  await Promise.allSettled(codexSessions.map(async (session) => {
    deps.clearTurnWatchdog(session)
    clearCodexActiveTurnId(session)
    markCodexTurnHealthy(session)
    for (const client of session.clients) {
      client.close(1001, 'Server shutting down')
    }
    await teardownCodexSessionRuntime(session, reason)
  }))
}

export async function sendTextToCodexSession(
  session: StreamSession,
  text: string,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'getActiveSession'
    | 'resetActiveTurnState'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
    | 'clearTurnWatchdog'
    | 'deleteLiveSession'
    | 'deleteSessionEventHandlers'
    | 'setCompletedSession'
    | 'setExitedSession'
  >,
): Promise<CodexSendAttemptResult> {
  const pendingRecovery = codexTransportRecoveryPromises.get(session)
  if (pendingRecovery) {
    await pendingRecovery
    if (deps.getActiveSession(session.name) !== session) {
      return { ok: false, retryable: false, reason: 'Session unavailable' }
    }
  }

  const activeTurnId = getCodexActiveTurnId(session)
  const dispatchMethod = activeTurnId ? 'turn/steer' : 'turn/start'
  deps.resetActiveTurnState(session)
  try {
    if (activeTurnId) {
      await steerCodexTurn(session, activeTurnId, text)
    } else {
      await startCodexTurn(session, text)
    }
  } catch (error) {
    if (deps.getActiveSession(session.name) !== session) {
      return { ok: false, retryable: false, reason: 'Session unavailable' }
    }

    const runtime = readCodexRuntime(session)
    const classifiedError = classifyCodexDispatchError(dispatchMethod, error)
    if (classifiedError.retryable) {
      if (classifiedError.clearActiveTurnId) {
        clearCodexActiveTurnId(session)
      }
      runtime?.log('info', 'Codex live dispatch deferred after retryable transport response', {
        sessionName: session.name,
        threadId: readCodexThreadId(session),
        method: dispatchMethod,
        activeTurnId: activeTurnId ?? null,
        reason: classifiedError.reason,
        clearedActiveTurnId: classifiedError.clearActiveTurnId,
      })
      return { ok: false, retryable: true, reason: classifiedError.reason }
    }
    const detail = classifiedError.reason
    console.warn(`[agents] Codex input delivery failed for ${session.name}: ${detail}`)
    await failCodexSession(session.name, session, detail, deps)
    deps.schedulePersistedSessionsWrite()
    return { ok: false, retryable: false, reason: detail }
  }

  deps.scheduleTurnWatchdog(session)
  const userEvent: StreamJsonEvent = {
    type: 'user',
    message: { role: 'user', content: text },
  } as unknown as StreamJsonEvent
  deps.appendEvent(session, userEvent)
  deps.broadcastEvent(session, userEvent)
  return { ok: true }
}

export function createCodexSessionAdapter(
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'getActiveSession'
    | 'resetActiveTurnState'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
    | 'clearTurnWatchdog'
    | 'deleteLiveSession'
    | 'deleteSessionEventHandlers'
    | 'setCompletedSession'
    | 'setExitedSession'
  >,
): StreamSessionAdapter {
  return {
    async dispatchSend(session, text, mode, images) {
      const normalizedImages = images && images.length > 0 ? [...images] : undefined

      if (mode === 'queue') {
        const backlogCount = session.pendingDirectSendMessages.length + session.messageQueue.size
        if (backlogCount >= session.messageQueue.maxSize) {
          return { ok: false, retryable: false, reason: `Queue is full (max ${session.messageQueue.maxSize} messages)` }
        }
        const { message, position } = session.messageQueue.enqueue({
          text,
          images: normalizedImages,
          priority: 'normal',
        })
        return { ok: true, delivered: 'queued', message, position }
      }

      if (normalizedImages?.length) {
        if (!text) {
          const imageEventText = 'Image-only messages are not supported in Codex sessions. Please include text with your image.'
          const imageEvent: StreamJsonEvent = {
            type: 'system',
            text: imageEventText,
          }
          deps.appendEvent(session, imageEvent)
          deps.broadcastEvent(session, imageEvent)
          return { ok: false, retryable: false, reason: imageEventText }
        }
        console.warn(`[agents] Codex session ${session.name}: ignoring ${normalizedImages.length} image(s) — not yet supported`)
      }

      const result = await sendTextToCodexSession(session, text, deps)
      if (!result.ok) {
        return result
      }
      return { ok: true, delivered: 'live' }
    },
  }
}

async function createCodexSessionFromThread(
  sessionName: string,
  mode: ClaudePermissionMode,
  sessionCwd: string,
  threadId: string,
  runtime: CodexSessionRuntimeHandle,
  task: string,
  deps: Pick<
    CodexSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'clearExitedSession'
    | 'getActiveSession'
    | 'getActionPolicyGate'
    | 'notifyApprovalEnqueued'
    | 'notifyApprovalResolved'
    | 'resetActiveTurnState'
    | 'schedulePersistedSessionsWrite'
    | 'scheduleTurnWatchdog'
    | 'writeTranscriptMeta'
    | 'clearTurnWatchdog'
    | 'deleteLiveSession'
    | 'deleteSessionEventHandlers'
    | 'setCompletedSession'
    | 'setExitedSession'
  >,
  options: CodexSessionCreateOptions = {},
): Promise<StreamSession> {
  deps.clearExitedSession(sessionName)

  const initializedAt = new Date().toISOString()
  if (!runtime.process) {
    throw new Error('Codex runtime process is not initialized')
  }
  let notificationCleanup = () => {}

  const session: StreamSession = {
    kind: 'stream',
    name: sessionName,
    sessionType: options.sessionType ?? 'worker',
    creator: options.creator ?? { kind: 'human' },
    conversationId: options.conversationId,
    agentType: 'codex',
    mode,
    cwd: sessionCwd,
    host: options.machine?.host ? options.machine.id : undefined,
    currentSkillInvocation: cloneActiveSkillInvocation(options.currentSkillInvocation),
    spawnedBy: options.spawnedBy,
    spawnedWorkers: options.spawnedWorkers ? [...options.spawnedWorkers] : [],
    task: task.length > 0 ? task : undefined,
    process: runtime.process,
    events: [],
    clients: new Set(),
    createdAt: options.createdAt ?? initializedAt,
    lastEventAt: initializedAt,
    systemPrompt: options.systemPrompt,
    model: options.model,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: true,
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexPendingApprovals: new Map(),
    codexUnclassifiedIncomingCount: 0,
    messageQueue: new SessionMessageQueue(DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT),
    queuedMessageRetryDelayMs: 250,
    pendingDirectSendMessages: [],
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    providerContext: createCodexProviderContext({
      threadId,
      runtime,
    }),
    activeTurnId: undefined,
    adapter: createCodexSessionAdapter(deps),
    resumedFrom: options.resumedFrom,
    restoredIdle: false,
  }

  deps.writeTranscriptMeta(session)

  notificationCleanup = runtime.addNotificationListener(threadId, ({ method, params, requestId }) => {
    session.codexLastIncomingMethod = method
    session.codexLastIncomingAt = new Date().toISOString()

    if (method === 'turn/started') {
      const nextActiveTurnId = readCodexTurnId(params)
      if (session.activeTurnId !== nextActiveTurnId) {
        setCodexActiveTurnId(session, nextActiveTurnId)
        deps.schedulePersistedSessionsWrite()
      }
    } else if (method === 'turn/completed') {
      if (session.activeTurnId !== undefined) {
        clearCodexActiveTurnId(session)
        deps.schedulePersistedSessionsWrite()
      }
    }

    const approvalMethod = parseCodexApprovalMethod(method)
    if (!approvalMethod && isCodexApprovalLikeMethod(method)) {
      session.codexUnclassifiedIncomingCount += 1
      runtime.log('warn', 'Codex approval request used unhandled method; declining to keep sidecar unblocked', {
        sessionName: session.name,
        threadId,
        method,
        requestId: typeof requestId === 'number' ? requestId : null,
        unclassifiedIncomingCount: session.codexUnclassifiedIncomingCount,
      })

      const unhandledEvent: StreamJsonEvent = {
        type: 'system',
        text: `Codex requested approval via an unhandled method "${method}". Hammurabi automatically declined it so the turn can continue.`,
      }
      deps.appendEvent(session, unhandledEvent)
      deps.broadcastEvent(session, unhandledEvent)
      deps.schedulePersistedSessionsWrite()

      if (typeof requestId === 'number') {
        try {
          runtime.sendResponse(requestId, { decision: 'decline' })
        } catch (error) {
          runtime.log('error', 'Failed to send decline response for unhandled Codex approval method', {
            sessionName: session.name,
            threadId,
            method,
            requestId,
            error: truncateLogText(error instanceof Error ? error.message : String(error)),
          })
        }
      }

      if (!session.lastTurnCompleted) {
        deps.scheduleTurnWatchdog(session)
      }
      return
    }

    if (approvalMethod) {
      const approvalDetails = getCodexApprovalRequestDetails(params)
      if (typeof requestId !== 'number') {
        runtime.log('warn', 'Codex approval request missing JSON-RPC id', {
          sessionName: session.name,
          threadId,
          method,
          ...approvalDetails,
        })
        const missingIdEvent = buildCodexApprovalMissingIdSystemEvent(approvalMethod, params)
        deps.appendEvent(session, missingIdEvent)
        deps.broadcastEvent(session, missingIdEvent)
        deps.schedulePersistedSessionsWrite()
        return
      }

      const pendingRequest: CodexPendingApprovalRequest = {
        requestId,
        method: approvalMethod,
        threadId: approvalDetails.threadId ?? threadId,
        itemId: approvalDetails.itemId,
        turnId: approvalDetails.turnId,
        cwd: approvalDetails.cwd,
        reason: approvalDetails.reason,
        risk: approvalDetails.risk,
        permissions: approvalDetails.permissions,
        requestedAt: new Date().toISOString(),
      }

      deps.clearTurnWatchdog(session)
      markCodexTurnHealthy(session)

      const actionPolicyGate = deps.getActionPolicyGate?.()
      if (!actionPolicyGate) {
        runtime.log('warn', 'Action policy gate unavailable for Codex approval request', {
          sessionName: session.name,
          threadId,
          requestId,
          method,
          ...approvalDetails,
        })
        const unavailableEvent: StreamJsonEvent = {
          type: 'system',
          text: 'Hammurabi approval gate is unavailable. Codex request denied.',
        }
        deps.appendEvent(session, unavailableEvent)
        deps.broadcastEvent(session, unavailableEvent)
        deps.schedulePersistedSessionsWrite()
        const delivery = sendCodexApprovalReply(session, pendingRequest, 'decline', deps, {
          notifyNativeQueue: false,
          removeTrackedRequest: false,
        })
        if (!delivery.ok) {
          runtime.log('error', 'Codex approval deny fallback failed', {
            sessionName: session.name,
            threadId,
            requestId,
            method,
            code: delivery.code,
            reason: delivery.reason,
          })
        }
        return
      }

      void hydrateCodexApprovalRawEvent(session, pendingRequest, deps).then(async (rawEvent) => {
        await handleProviderApproval(codexApprovalAdapter, rawEvent, session, { actionPolicyGate })
      }).catch((error) => {
        runtime.log('warn', 'Unified action-policy enforcement failed for Codex approval request', {
          sessionName: session.name,
          threadId,
          requestId,
          method,
          error: truncateLogText(error instanceof Error ? error.message : String(error)),
        })
        const delivery = sendCodexApprovalReply(session, pendingRequest, 'decline', deps, {
          notifyNativeQueue: false,
          removeTrackedRequest: false,
        })
        if (!delivery.ok) {
          runtime.log('error', 'Codex approval deny fallback failed', {
            sessionName: session.name,
            threadId,
            requestId,
            method,
            code: delivery.code,
            reason: delivery.reason,
          })
        }
      })
      return
    }

    if (!session.lastTurnCompleted) {
      deps.scheduleTurnWatchdog(session)
    }

    if (method === 'item/completed') {
      clearCodexPendingApprovalByItemId(session, getCodexCompletedItemId(params))
    }

    const normalized = normalizeCodexEvent(method, params)
    if (!normalized) {
      return
    }
    const events = Array.isArray(normalized) ? normalized : [normalized]
    for (const event of events) {
      deps.appendEvent(session, event)
      deps.broadcastEvent(session, event)
    }
  })
  ensureCodexProviderContext(session).notificationCleanup = notificationCleanup

  if (task.length > 0) {
    deps.resetActiveTurnState(session)
    try {
      await startCodexTurn(session, task)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      try {
        await teardownCodexSessionRuntime(session, `Initial Codex turn setup failed: ${detail}`)
      } catch (teardownError) {
        runtime.log('warn', 'Codex runtime teardown failed after initial turn setup error', {
          sessionName: session.name,
          threadId,
          originalError: truncateLogText(detail),
          teardownError: truncateLogText(
            teardownError instanceof Error ? teardownError.message : String(teardownError),
          ),
        })
      }
      throw error
    }

    deps.scheduleTurnWatchdog(session)
    const userEvent: StreamJsonEvent = {
      type: 'user',
      message: { role: 'user', content: task },
    } as unknown as StreamJsonEvent
    deps.appendEvent(session, userEvent)
    deps.broadcastEvent(session, userEvent)
  }

  return session
}

export async function createCodexAppServerSession(
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  options: CodexSessionCreateOptions = {},
  deps: CodexSessionDeps,
): Promise<StreamSession> {
  const runtime = deps.runtimeFactory(
    sessionName,
    options.machine,
    (failure) => {
      const candidate = deps.getActiveSession(sessionName)
      if (!candidate || candidate.kind !== 'stream' || candidate.agentType !== 'codex') {
        return
      }
      if (readCodexRuntime(candidate) !== runtime) {
        return
      }
      if (readCodexRuntimeTeardownPromise(candidate)) {
        return
      }
      if (failure.kind === 'transport_disconnect') {
        void recoverCodexTransport(sessionName, candidate, failure.reason, deps)
        return
      }
      if (codexTransportRecoveryPromises.has(candidate)) {
        return
      }
      void failCodexSession(sessionName, candidate, failure.reason, deps, failure.exitCode, failure.signal)
    },
  )

  const sessionCwd = cwd || process.env.HOME || '/tmp'
  const { sandbox, approvalPolicy } = resolveCodexTransportPolicy(mode)

  const hasSystemPrompt = typeof options.systemPrompt === 'string' && options.systemPrompt.length > 0
  const initialTask = hasSystemPrompt ? '' : task

  const threadStartParams: {
    cwd: string
    sandbox: string
    approvalPolicy: string | typeof ALWAYS_ON_CODEX_APPROVAL_POLICY
    developerInstructions?: string
    model?: string
  } = {
    cwd: sessionCwd,
    sandbox,
    approvalPolicy,
  }
  if (hasSystemPrompt) {
    threadStartParams.developerInstructions = options.systemPrompt
  }
  if (typeof options.model === 'string' && options.model.trim().length > 0) {
    threadStartParams.model = options.model.trim()
  }

  let threadId: string
  try {
    await runtime.ensureConnected()
    if (options.resumeSessionId) {
      threadId = options.resumeSessionId
      await runtime.sendRequest('thread/resume', {
        threadId,
        sandbox,
        approvalPolicy,
      })
    } else {
      const threadResult = await runtime.sendRequest('thread/start', threadStartParams) as { thread: { id: string } }
      threadId = threadResult.thread.id
    }
  } catch (error) {
    await runtime.teardown({ reason: 'Codex runtime bootstrap failed' })
    throw error
  }

  return createCodexSessionFromThread(
    sessionName,
    mode,
    sessionCwd,
    threadId,
    runtime,
    initialTask,
    deps,
    options,
  )
}
