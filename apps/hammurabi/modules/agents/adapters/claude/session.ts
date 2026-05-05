import { spawn, type ChildProcess } from 'node:child_process'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  normalizeClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
} from '../../../claude-effort.js'
import { normalizeClaudeEvent } from '../../event-normalizers/claude.js'
import {
  buildLoginShellCommand,
  prepareMachineLaunchEnvironment,
  buildSshArgs,
  isRemoteMachine,
} from '../../machines.js'
import {
  cloneActiveSkillInvocation,
  snapshotExitedStreamSession,
  toCompletedSession,
  toExitBasedCompletedSession,
} from '../../session/state.js'
import {
  createClaudeProviderContext,
  ensureClaudeProviderContext,
} from '../../providers/provider-session-context.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  SessionMessageQueue,
  type QueuedMessageImage,
} from '../../message-queue.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  StreamSessionAdapter,
  StreamJsonEvent,
  StreamSession,
  StreamSessionCreateOptions,
} from '../../types.js'
import {
  buildClaudeApprovalSettingsJson,
  buildClaudeLocalLoginShellSpawn,
  buildClaudeShellInvocation,
  buildClaudeSpawnEnv,
  buildClaudeStreamArgs,
  resolveClaudeApprovalPort,
} from './helpers.js'

export interface ClaudeStreamSessionDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  clearExitedSession(sessionName: string): void
  deleteLiveSession(sessionName: string): void
  getActiveSession(sessionName: string): AnySession | undefined
  resetActiveTurnState(session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  setCompletedSession(sessionName: string, session: CompletedSession): void
  setExitedSession(sessionName: string, session: ExitedStreamSessionState): void
  spawnImpl?: typeof spawn
  internalToken?: string
  writeToStdin(session: StreamSession, data: string): boolean
  writeTranscriptMeta(session: StreamSession): void
}

function buildPromptContent(
  text: string,
  images?: QueuedMessageImage[],
): string | Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
> {
  if (!images?.length) {
    return text
  }

  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
}

function buildUserEvent(
  text: string,
  images?: QueuedMessageImage[],
  subtype?: string,
): StreamJsonEvent {
  return {
    type: 'user',
    ...(subtype ? { subtype } : {}),
    message: { role: 'user', content: buildPromptContent(text, images) },
  } as unknown as StreamJsonEvent
}

export function createClaudeSessionAdapter(
  deps: Pick<
    ClaudeStreamSessionDeps,
    'appendEvent' | 'broadcastEvent' | 'resetActiveTurnState' | 'writeToStdin'
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

      const userEvent = buildUserEvent(text, normalizedImages, options?.userEventSubtype)
      const sent = deps.writeToStdin(session, `${JSON.stringify(userEvent)}\n`)
      if (!sent) {
        if (session.stdinDraining) {
          return { ok: false, retryable: true, reason: 'Process stdin is busy' }
        }
        return { ok: false, retryable: false, reason: 'Stream session unavailable' }
      }

      deps.resetActiveTurnState(session)
      deps.appendEvent(session, userEvent)
      deps.broadcastEvent(session, userEvent)
      return { ok: true, delivered: 'live' }
    },
  }
}

export function createClaudeStreamSession(
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  machine: MachineConfig | undefined,
  options: StreamSessionCreateOptions = {},
  deps: ClaudeStreamSessionDeps,
): StreamSession {
  deps.clearExitedSession(sessionName)

  const initializedAt = new Date().toISOString()
  const effort = normalizeClaudeEffortLevel(options.effort, DEFAULT_CLAUDE_EFFORT_LEVEL)
  const adaptiveThinking = normalizeClaudeAdaptiveThinkingMode(
    options.adaptiveThinking,
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const remote = isRemoteMachine(machine)
  const settingsJson = buildClaudeApprovalSettingsJson()
  const args = buildClaudeStreamArgs(
    mode,
    options.resumeSessionId,
    options.systemPrompt,
    options.maxTurns,
    effort,
    settingsJson,
    options.model,
  )

  const localSpawnCwd = process.env.HOME || '/tmp'
  const requestedCwd = cwd ?? machine?.cwd
  const sessionCwd = requestedCwd ?? localSpawnCwd
  const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
  const remoteClaude = buildClaudeShellInvocation(args, adaptiveThinking)
  const remoteStreamCmd = buildLoginShellCommand(
    remoteClaude,
    requestedCwd,
    remote ? preparedLaunch.sourcedEnvFile : undefined,
  )
  const localShellSpawn = buildClaudeLocalLoginShellSpawn(
    args,
    adaptiveThinking,
    requestedCwd,
    preparedLaunch.sourcedEnvFile,
    process.env.SHELL,
  )
  // Remote Claude needs the EC2 approval daemon reachable on the remote machine
  // for every PreToolUse hook call. SSH does not propagate spawn env by default,
  // so we (a) reverse-tunnel the daemon back via `-R 127.0.0.1:<port>:127.0.0.1:<port>`
  // and (b) propagate the internal token via `-o SendEnv=HAMMURABI_INTERNAL_TOKEN`.
  // Token may be undefined when the local server has not minted one — we still
  // open the tunnel so the hook can reach the daemon (auth fails with a clear
  // 401, not a `fetch failed`). See the upstream session-launch issue.
  const remoteApprovalBridge = remote
    ? {
        port: resolveClaudeApprovalPort(process.env),
        internalToken: deps.internalToken,
      }
    : undefined
  const spawnCommand = remote ? 'ssh' : localShellSpawn.command
  const spawnArgs = remote
    ? buildSshArgs(
      machine,
      remoteStreamCmd,
      false,
      remoteApprovalBridge,
      preparedLaunch.sshSendEnvKeys,
    )
    : localShellSpawn.args
  const spawnCwd = remote ? localSpawnCwd : sessionCwd
  const spawnImpl = deps.spawnImpl ?? spawn
  const spawnEnv = buildClaudeSpawnEnv(preparedLaunch.env, adaptiveThinking, {
    internalToken: deps.internalToken,
  })
  spawnEnv.HAMMURABI_SESSION_NAME = sessionName

  const childProcess: ChildProcess = spawnImpl(spawnCommand, spawnArgs, {
    cwd: spawnCwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: StreamSession = {
    kind: 'stream',
    name: sessionName,
    sessionType: options.sessionType ?? 'worker',
    creator: options.creator ?? { kind: 'human' },
    conversationId: options.conversationId,
    agentType: 'claude',
    effort,
    adaptiveThinking,
    mode,
    cwd: sessionCwd,
    host: remote ? machine.id : undefined,
    currentSkillInvocation: cloneActiveSkillInvocation(options.currentSkillInvocation),
    spawnedBy: options.spawnedBy,
    spawnedWorkers: options.spawnedWorkers ? [...options.spawnedWorkers] : [],
    task: task.length > 0 ? task : undefined,
    process: childProcess,
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
    providerContext: createClaudeProviderContext({
      sessionId: options.resumeSessionId,
      effort,
      adaptiveThinking,
    }),
    activeTurnId: undefined,
    adapter: createClaudeSessionAdapter(deps),
    resumedFrom: options.resumedFrom,
    restoredIdle: Boolean(options.resumeSessionId) && task.length === 0,
  }

  deps.writeTranscriptMeta(session)

  if (typeof childProcess.stdin?.on === 'function') {
    childProcess.stdin.on('error', () => {
      // Session cleanup is handled by the process exit/error listeners.
    })
  }

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    session.stdoutBuffer += chunk.toString()
    const lines = session.stdoutBuffer.split('\n')
    session.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as StreamJsonEvent
        const normalized = normalizeClaudeEvent(event) as StreamJsonEvent | StreamJsonEvent[] | null
        if (!normalized) {
          continue
        }
        const events = Array.isArray(normalized) ? normalized : [normalized]
        for (const normalizedEvent of events) {
          deps.appendEvent(session, normalizedEvent)
          deps.broadcastEvent(session, normalizedEvent)
        }
      } catch {
        // Skip unparseable lines from the CLI.
      }
    }
  })

  // Drain any remaining buffered NDJSON when stdout closes. NDJSON lines
  // should end in '\n', but if the CLI exits without flushing a trailing
  // newline the last event (e.g. a `result`) stays in `stdoutBuffer` and
  // the 'data' handler never parses it. Without this drain, the 'exit'
  // listener runs with `finalResultEvent` unset — so one-shot session
  // types fall into the synthetic-completion fallback even though a real
  // `result` was emitted. See issue #1217 / PR #462 fix #4.
  function drainTrailingStdoutBuffer(): void {
    const remaining = session.stdoutBuffer.trim()
    session.stdoutBuffer = ''
    if (!remaining) {
      return
    }
    try {
      const event = JSON.parse(remaining) as StreamJsonEvent
      const normalized = normalizeClaudeEvent(event) as StreamJsonEvent | StreamJsonEvent[] | null
      if (!normalized) {
        return
      }
      const events = Array.isArray(normalized) ? normalized : [normalized]
      for (const normalizedEvent of events) {
        deps.appendEvent(session, normalizedEvent)
        deps.broadcastEvent(session, normalizedEvent)
      }
    } catch {
      // Ignore unparseable trailing data — same policy as the 'data' handler.
    }
  }

  // One-shot completion is deferred until BOTH the child process has exited
  // AND its stdout has finished draining. In Node, `'exit'` may fire while
  // stdout is still open, so a final `result` line that lacks a trailing
  // `\n` is still sitting in `stdoutBuffer` when the exit handler runs. If
  // we finalized completion right there, sentinel/cron sessions would land
  // in `completedSessions` with the synthetic exit-only payload and the
  // real `result` (parsed later by the stdout `'end'` drain) would never
  // update polling clients. Tracking the two halves separately and only
  // committing once both have settled closes that race. See issue #1217
  // P1 review on PR #1244.
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
      // One-shot session types (`cron`, `sentinel`, `automation`) must always land in
      // `completedSessions` so the executor's GET poll resolves to
      // `completed: true` rather than the `exitedStreamSessions` 'exited'
      // branch (which the polling client maps to 'running' via completedFlag
      // === false). Keeps the 30-status-check fallback from firing on fast
      // exits without `result` (e.g. 429, auth, crash). See issue #1217 / PR #462.
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

    if (finalizationContext.kind === 'error') {
      deps.schedulePersistedSessionsWrite()
    } else {
      const isIdleRestoreExit =
        session.restoredIdle &&
        session.lastTurnCompleted &&
        ensureClaudeProviderContext(session).sessionId !== undefined
      if (!isIdleRestoreExit) {
        deps.schedulePersistedSessionsWrite()
      }
    }
  }

  childProcess.stdout?.on('end', () => {
    drainTrailingStdoutBuffer()
    stdoutEnded = true
    finalizeCompletionIfReady()
  })

  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (!text) return
    const lines = text
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined
    if (lastLine) {
      session.lastStderrSummary = lastLine.length > 300
        ? `${lastLine.slice(0, 297)}...`
        : lastLine
    }
    const stderrEvent: StreamJsonEvent = {
      type: 'system',
      text: `stderr: ${text}`,
    }
    deps.appendEvent(session, stderrEvent)
    deps.broadcastEvent(session, stderrEvent)
  })

  const cpEmitter = childProcess as unknown as NodeJS.EventEmitter
  cpEmitter.on('exit', (code: number | null, signal: string | null) => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }

    if (!session.lastTurnCompleted) {
      ensureClaudeProviderContext(session).sessionId = undefined
    }

    const exitCode = code ?? -1
    const stderrSummary = session.lastStderrSummary
    const signalText = signal ?? undefined
    const baseText = signalText
      ? `Process exited (signal: ${signalText})`
      : `Process exited with code ${exitCode}`
    const exitEvent: ExitCompletionEvent = {
      type: 'exit',
      exitCode,
      signal: signalText,
      stderr: stderrSummary,
      text: stderrSummary ? `${baseText}; stderr: ${stderrSummary}` : baseText,
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
  // and after the stdio streams have closed. We use it as a backstop so the
  // synthetic-vs-real completion decision still runs even if stdout never
  // emits its own 'end' event (rare but possible when the stream is
  // destroyed without an EOF). Calling drainTrailingStdoutBuffer() here is
  // idempotent — if the stdout 'end' handler already drained, the buffer
  // is empty and this is a no-op.
  cpEmitter.on('close', () => {
    if (deps.getActiveSession(sessionName) !== session) {
      return
    }
    if (!stdoutEnded) {
      drainTrailingStdoutBuffer()
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
    // be delayed or skipped on some platforms — and instead finalize now
    // so we don't leak a zombie live session. Drain the trailing buffer
    // first in case a real `result` snuck in before the failure: the
    // race-fix payoff is preserving real results, not deferring forever.
    if (!stdoutEnded) {
      drainTrailingStdoutBuffer()
      stdoutEnded = true
    }
    finalizeCompletionIfReady()
  })

  if (task.length > 0) {
    const userMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: task } })
    deps.writeToStdin(session, userMsg + '\n')
  }

  return session
}
