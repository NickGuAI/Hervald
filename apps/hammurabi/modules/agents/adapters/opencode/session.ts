import {
  createOpenCodeTurnState,
  normalizeOpenCodePromptResponse,
  normalizeOpenCodeSessionUpdate,
} from '../../event-normalizers/opencode.js'
import {
  opencodeApprovalAdapter,
  type OpenCodeApprovalRawEvent,
} from './approval-adapter.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  SessionMessageQueue,
} from '../../message-queue.js'
import type { ActionPolicyGate } from '../../../policies/action-policy-gate.js'
import { handleProviderApproval } from '../../../policies/provider-approval-adapter.js'
import {
  createOpenCodeProviderContext,
  ensureOpenCodeProviderContext,
  readOpenCodeRuntime,
  readOpenCodeSessionId,
} from '../../providers/provider-session-context.js'
import {
  buildOpenCodePromptText,
  buildOpenCodeSystemPrompt,
  mapOpenCodeMode,
} from './helpers.js'
import { isRemoteMachine } from '../../machines.js'
import {
  asObject,
  cloneActiveSkillInvocation,
  snapshotExitedStreamSession,
  toCompletedSession,
  toExitBasedCompletedSession,
} from '../../session/state.js'
import { OpenCodeAcpRuntime } from '../../launchers/runtimes.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CompletedSession,
  ExitedStreamSessionState,
  OpenCodeAcpRuntimeHandle,
  OpenCodeSessionCreateOptions,
  MachineConfig,
  StreamSessionAdapter,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'

export interface OpenCodeSessionDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  clearExitedSession(sessionName: string): void
  deleteLiveSession(sessionName: string): void
  deleteSessionEventHandlers(sessionName: string): void
  getActiveSession(sessionName: string): AnySession | undefined
  resetActiveTurnState(session: StreamSession): void
  runtimeFactory?: (
    sessionName: string,
    machine?: MachineConfig,
    model?: string,
  ) => OpenCodeAcpRuntimeHandle
  schedulePersistedSessionsWrite(): void
  setCompletedSession(sessionName: string, session: CompletedSession): void
  setExitedSession(sessionName: string, session: ExitedStreamSessionState): void
  writeTranscriptMeta(session: StreamSession): void
  getActionPolicyGate?(): ActionPolicyGate | null
}

export async function finalizeOpenCodeTurnFailure(
  session: StreamSession,
  detail: string,
  deps: Pick<OpenCodeSessionDeps, 'appendEvent' | 'broadcastEvent'>,
): Promise<void> {
  const closeEvents = normalizeOpenCodePromptResponse(
    { stopReason: 'cancelled' },
    session.opencodeTurnState ?? createOpenCodeTurnState(),
  )
  for (const event of closeEvents.filter((candidate) => candidate.type !== 'result')) {
    deps.appendEvent(session, event)
    deps.broadcastEvent(session, event)
  }

  const systemEvent: StreamJsonEvent = {
    type: 'system',
    text: `OpenCode turn failed: ${detail}`,
  }
  deps.appendEvent(session, systemEvent)
  deps.broadcastEvent(session, systemEvent)

  const resultEvent: StreamJsonEvent = {
    type: 'result',
    subtype: 'failed',
    is_error: true,
    result: `OpenCode turn failed: ${detail}`,
  }
  deps.appendEvent(session, resultEvent)
  deps.broadcastEvent(session, resultEvent)
}

export async function startOpenCodeTurn(
  session: StreamSession,
  text: string,
  deps: Pick<OpenCodeSessionDeps, 'appendEvent' | 'broadcastEvent' | 'getActiveSession'>,
): Promise<void> {
  const resumeSessionId = readOpenCodeSessionId(session)
  if (!resumeSessionId) {
    throw new Error('OpenCode session is missing a session id')
  }
  const runtime = readOpenCodeRuntime(session)
  if (!runtime) {
    throw new Error('OpenCode runtime is not initialized')
  }

  const promptText = buildOpenCodePromptText(session, text)
  session.opencodeTurnState = createOpenCodeTurnState()

  const messageStartEvent: StreamJsonEvent = {
    type: 'message_start',
    message: {
      id: `opencode-${Date.now()}`,
      role: 'assistant',
    },
    source: {
      provider: 'opencode',
      backend: 'acp',
    },
  }
  deps.appendEvent(session, messageStartEvent)
  deps.broadcastEvent(session, messageStartEvent)

  try {
    const result = await runtime.sendRequest('session/prompt', {
      sessionId: resumeSessionId,
      prompt: [{ type: 'text', text: promptText }],
    })
    const finalEvents = normalizeOpenCodePromptResponse(result, session.opencodeTurnState)
    for (const event of finalEvents) {
      deps.appendEvent(session, event)
      deps.broadcastEvent(session, event)
    }
  } catch (error) {
    if (deps.getActiveSession(session.name) !== session) {
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    await finalizeOpenCodeTurnFailure(session, detail, deps)
    throw error
  }
}

function buildOpenCodeUserEvent(
  text: string,
  subtype?: string,
): StreamJsonEvent {
  return {
    type: 'user',
    ...(subtype ? { subtype } : {}),
    message: { role: 'user', content: text },
  } as unknown as StreamJsonEvent
}

function trackOpenCodeToolCallSnapshot(session: StreamSession, update: Record<string, unknown> | null): void {
  if (!update) {
    return
  }
  const sessionUpdate = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : ''
  if (sessionUpdate !== 'tool_call' && sessionUpdate !== 'tool_call_update') {
    return
  }

  const toolCallId = typeof update.toolCallId === 'string' && update.toolCallId.trim().length > 0
    ? update.toolCallId.trim()
    : undefined
  if (!toolCallId) {
    return
  }

  if (!session.opencodeToolCallSnapshots) {
    session.opencodeToolCallSnapshots = new Map()
  }

  const previous = session.opencodeToolCallSnapshots.get(toolCallId) ?? {}
  session.opencodeToolCallSnapshots.set(toolCallId, {
    ...previous,
    ...update,
  })
}

function buildOpenCodeApprovalRawEvent(
  session: StreamSession,
  requestId: number | string | undefined,
  params: Record<string, unknown> | null,
  deps: Pick<OpenCodeSessionDeps, 'appendEvent' | 'broadcastEvent' | 'schedulePersistedSessionsWrite'>,
): OpenCodeApprovalRawEvent | null {
  if (requestId === undefined || !params) {
    return null
  }

  const toolCall = asObject(params.toolCall)
  if (!toolCall || !Array.isArray(params.options)) {
    return null
  }

  const toolCallId = typeof toolCall.toolCallId === 'string' && toolCall.toolCallId.trim().length > 0
    ? toolCall.toolCallId.trim()
    : undefined
  const toolSnapshot = toolCallId ? session.opencodeToolCallSnapshots?.get(toolCallId) : undefined

  return {
    requestId,
    method: 'requestPermission',
    params,
    toolCall,
    toolSnapshot,
    replyDeps: deps,
  }
}

export function createOpenCodeSessionAdapter(
  deps: Pick<
    OpenCodeSessionDeps,
    | 'appendEvent'
    | 'broadcastEvent'
    | 'getActiveSession'
    | 'resetActiveTurnState'
    | 'schedulePersistedSessionsWrite'
  >,
): StreamSessionAdapter {
  return {
    async dispatchSend(session, text, mode, images, options) {
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
        const imageEventText = text
          ? 'Image attachments are not supported in OpenCode sessions. Sending text only.'
          : 'Image attachments are not supported in OpenCode sessions.'
        const imageEvent: StreamJsonEvent = {
          type: 'system',
          text: imageEventText,
        }
        deps.appendEvent(session, imageEvent)
        deps.broadcastEvent(session, imageEvent)
        if (!text) {
          return { ok: false, retryable: false, reason: imageEventText }
        }
      }

      deps.resetActiveTurnState(session)
      const userEvent = buildOpenCodeUserEvent(text, options?.userEventSubtype)
      deps.appendEvent(session, userEvent)
      deps.broadcastEvent(session, userEvent)

      try {
        await startOpenCodeTurn(session, text, deps)
      } catch (error) {
        if (deps.getActiveSession(session.name) !== session) {
          return { ok: false, retryable: false, reason: 'Session unavailable' }
        }
        const detail = error instanceof Error ? error.message : String(error)
        console.warn(`[agents] OpenCode input delivery failed for ${session.name}: ${detail}`)
        deps.schedulePersistedSessionsWrite()
        return { ok: false, retryable: false, reason: detail }
      }

      return { ok: true, delivered: 'live' }
    },
  }
}

export async function createOpenCodeAcpSession(
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  options: OpenCodeSessionCreateOptions = {},
  deps: OpenCodeSessionDeps,
): Promise<StreamSession> {
  deps.clearExitedSession(sessionName)

  const runtimeFactory = deps.runtimeFactory
    ?? ((name: string, machine?: MachineConfig, model?: string) => new OpenCodeAcpRuntime(name, machine, model))
  const runtime = runtimeFactory(sessionName, options.machine, options.model)
  const initializedAt = new Date().toISOString()
  const sessionCwd = cwd || process.env.HOME || '/tmp'

  try {
    await runtime.ensureConnected()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const reason = `OpenCode runtime failed to start: ${detail}`
    await runtime.teardown({ reason })
    throw new Error(reason)
  }

  const loadOrCreateResult = options.resumeSessionId
    ? await runtime.sendRequest('session/load', {
      sessionId: options.resumeSessionId,
      cwd: sessionCwd,
      mcpServers: [],
    }) as { sessionId?: string }
    : await runtime.sendRequest('session/new', {
      cwd: sessionCwd,
      mcpServers: [],
    }) as { sessionId?: string }

  const resumeSessionId = typeof loadOrCreateResult?.sessionId === 'string' && loadOrCreateResult.sessionId.trim().length > 0
    ? loadOrCreateResult.sessionId.trim()
    : options.resumeSessionId

  if (!resumeSessionId) {
    await runtime.teardown({ reason: 'OpenCode ACP session bootstrap failed' })
    throw new Error('OpenCode ACP did not return a session id')
  }

  const opencodeMode = mapOpenCodeMode(mode)
  if (opencodeMode !== 'default') {
    await runtime.sendRequest('session/set_mode', {
      sessionId: resumeSessionId,
      modeId: opencodeMode,
    })
  }

  if (!runtime.process) {
    throw new Error('OpenCode ACP runtime process is not initialized')
  }

  const session: StreamSession = {
    kind: 'stream',
    name: sessionName,
    sessionType: options.sessionType ?? 'worker',
    creator: options.creator ?? { kind: 'human' },
    conversationId: options.conversationId,
    agentType: 'opencode',
    mode,
    cwd: sessionCwd,
    host: isRemoteMachine(options.machine) ? options.machine.id : undefined,
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
    maxTurns: options.maxTurns,
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
    providerContext: createOpenCodeProviderContext({
      sessionId: resumeSessionId,
      runtime,
    }),
    adapter: createOpenCodeSessionAdapter(deps),
    resumedFrom: options.resumedFrom,
    opencodePendingSystemPrompt: buildOpenCodeSystemPrompt(options.systemPrompt, options.maxTurns),
    opencodeTurnState: createOpenCodeTurnState(),
    opencodeToolCallSnapshots: new Map(),
    restoredIdle: Boolean(options.resumeSessionId) && task.length === 0,
  }

  deps.writeTranscriptMeta(session)

  ensureOpenCodeProviderContext(session).notificationCleanup = runtime.addNotificationListener(
    resumeSessionId,
    ({ method, params, requestId }) => {
    if (requestId !== undefined) {
      const permissionRequest = buildOpenCodeApprovalRawEvent(session, requestId, asObject(params), deps)
      if (!permissionRequest) {
        return
      }

      const actionPolicyGate = deps.getActionPolicyGate?.()
      if (!actionPolicyGate) {
        const unavailableEvent: StreamJsonEvent = {
          type: 'system',
          text: 'Hammurabi approval gate is unavailable. OpenCode request denied.',
        }
        deps.appendEvent(session, unavailableEvent)
        deps.broadcastEvent(session, unavailableEvent)
        deps.schedulePersistedSessionsWrite()
        readOpenCodeRuntime(session)?.sendResponse(requestId, {
          outcome: {
            outcome: 'cancelled',
          },
        })
        return
      }

      void handleProviderApproval(opencodeApprovalAdapter, permissionRequest, session, { actionPolicyGate }).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error)
        const failureEvent: StreamJsonEvent = {
          type: 'system',
          text: `OpenCode approval handling failed: ${detail}`,
        }
        deps.appendEvent(session, failureEvent)
        deps.broadcastEvent(session, failureEvent)
        deps.schedulePersistedSessionsWrite()
        readOpenCodeRuntime(session)?.sendResponse(requestId, {
          outcome: {
            outcome: 'cancelled',
          },
        })
      })
      return
    }

    if (method !== 'session/update') {
      return
    }
    const payload = asObject(params)
    trackOpenCodeToolCallSnapshot(session, asObject(payload?.update))
    const normalized = normalizeOpenCodeSessionUpdate(
      payload?.update,
      session.opencodeTurnState ?? createOpenCodeTurnState(),
    )
    if (!normalized) {
      return
    }
    const events = Array.isArray(normalized) ? normalized : [normalized]
    for (const event of events) {
      deps.appendEvent(session, event)
      deps.broadcastEvent(session, event)
    }
    },
  )

  if (typeof session.process.stdin?.on === 'function') {
    session.process.stdin.on('error', () => {
      // Session cleanup is handled by runtime exit/error listeners.
    })
  }

  // Defer the synthetic-vs-real completion decision until BOTH the child
  // process has exited AND its stdout has finished draining. The OpenCode
  // ACP runtime parses prompt responses out of the same stdout pipe, and
  // a pending `runtime.sendRequest('session/prompt', ...)` rejection (or
  // resolution) propagates through microtasks. If we finalized completion
  // synchronously inside the 'exit' handler, the rejection chain that
  // appends a real `result` event would land too late and leave one-shot
  // sessions reporting the synthetic exit-only payload. Mirroring the
  // Claude session contract via two-flag tracking + a `'close'` backstop
  // keeps the completion source-of-truth aligned with the latest event
  // we received before the process fully tore down. See issue #1217 P1
  // review on PR #1244.
  type ExitCompletionEvent = StreamJsonEvent & {
    exitCode?: number
    signal?: string | number
    text?: string
  }
  let processExited = false
  let stdoutEnded = false
  let completionFinalized = false
  let finalizationContext:
    | { kind: 'exit'; exitEvent: ExitCompletionEvent }
    | { kind: 'error'; errorEvent: ExitCompletionEvent }
    | null = null

  function finalizeCompletionIfReady(): void {
    if (completionFinalized) return
    if (!processExited || !stdoutEnded) return
    if (!finalizationContext) return
    completionFinalized = true

    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    if (session.finalResultEvent) {
      deps.setCompletedSession(
        sessionName,
        toCompletedSession(
          sessionName,
          session.completedTurnAt ?? new Date().toISOString(),
          session.finalResultEvent,
          session.usage.costUsd,
          {
            sessionType: session.sessionType,
            creator: session.creator,
            spawnedBy: session.spawnedBy,
            createdAt: session.createdAt,
          },
        ),
      )
    } else if (
      session.sessionType === 'cron' ||
      session.sessionType === 'sentinel' ||
      session.sessionType === 'automation'
    ) {
      // One-shot OpenCode sessions share the same completion contract as Claude:
      // exit without `result` must still produce a completed-with-error entry
      // so the executor's GET poll resolves to `completed: true`. See issue #1217.
      const fallbackEvent =
        finalizationContext.kind === 'exit'
          ? finalizationContext.exitEvent
          : finalizationContext.errorEvent
      deps.setCompletedSession(
        sessionName,
        toExitBasedCompletedSession(sessionName, fallbackEvent, session.usage.costUsd, {
          sessionType: session.sessionType,
          creator: session.creator,
          spawnedBy: session.spawnedBy,
          createdAt: session.createdAt,
        }),
      )
    }

    deps.setExitedSession(sessionName, snapshotExitedStreamSession(session))
    deps.deleteLiveSession(sessionName)
    deps.deleteSessionEventHandlers(sessionName)
    deps.schedulePersistedSessionsWrite()
    runtime.teardownOnProcessExit()
  }

  // The ACP runtime owns parsing of stdout chunks, so there is no trailing
  // buffer to drain here — we just observe 'end' as the signal that all
  // request/response lines have been delivered to the runtime's parser.
  session.process.stdout?.on('end', () => {
    stdoutEnded = true
    finalizeCompletionIfReady()
  })

  const cpEmitter = session.process as unknown as NodeJS.EventEmitter
  cpEmitter.on('exit', (code: number | null, signal: string | null) => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    const exitCode = code ?? -1
    const signalText = signal ?? undefined
    const baseText = signalText
      ? `Process exited (signal: ${signalText})`
      : `Process exited with code ${exitCode}`
    const exitEvent: ExitCompletionEvent = {
      type: 'exit',
      exitCode,
      signal: signalText,
      text: baseText,
    }
    deps.appendEvent(session, exitEvent)
    deps.broadcastEvent(session, exitEvent)

    for (const client of session.clients) {
      client.close(1000, 'Session ended')
    }

    finalizationContext = { kind: 'exit', exitEvent }
    processExited = true
    finalizeCompletionIfReady()
  })

  // 'close' is guaranteed to fire AFTER 'exit' (or 'error' on spawn failure)
  // and after the stdio streams have closed. Using it as a backstop keeps
  // finalization unblocked even when stdout never emits its own 'end' event.
  cpEmitter.on('close', () => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }
    if (!stdoutEnded) {
      stdoutEnded = true
    }
    finalizeCompletionIfReady()
  })

  cpEmitter.on('error', (error: Error) => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    const errorEvent: ExitCompletionEvent = {
      type: 'system',
      text: `Process error: ${error.message}`,
    }
    deps.appendEvent(session, errorEvent)
    deps.broadcastEvent(session, errorEvent)

    for (const client of session.clients) {
      client.close(1000, 'Session ended')
    }

    if (!finalizationContext) {
      finalizationContext = { kind: 'error', errorEvent }
    }
    processExited = true
    // Errors imply the process is in trouble (often spawn failure with no
    // stdio to drain). Don't wait for stdout 'end' or 'close' — those may
    // be delayed or skipped on some platforms — and finalize now so we
    // don't leak a zombie live session.
    if (!stdoutEnded) {
      stdoutEnded = true
    }
    finalizeCompletionIfReady()
  })

  if (task.length > 0) {
    try {
      const userEvent: StreamJsonEvent = {
        type: 'user',
        message: { role: 'user', content: task },
      } as unknown as StreamJsonEvent
      deps.appendEvent(session, userEvent)
      deps.broadcastEvent(session, userEvent)
      await startOpenCodeTurn(session, task, deps)
    } catch (error) {
      await runtime.teardown({
        reason: `Initial OpenCode prompt failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      throw error
    }
  }

  return session
}
