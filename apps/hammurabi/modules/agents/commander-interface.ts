/**
 * Commander sessions interface — the implementation that backs the
 * CommanderSessionsInterface contract declared in `./types.ts`.
 *
 * Extracted from `createAgentsRouter()` inside `routes.ts` in #921 Phase P5
 * so commander lifecycle lives in a focused module instead of as an inline
 * 157-line object literal nested in a 2300-line router closure.
 *
 * The implementation depends on several router-local factories (session
 * creators, queue plumbing, runtime teardown) that cannot be module-imported
 * because they themselves close over router state. Those dependencies are
 * passed through `CommanderInterfaceContext` at construction time — the
 * router instantiates this interface once and the contract is explicit.
 *
 * Non-closure dependencies (codex turn watchdog helpers, default adaptive
 * thinking mode constant) are imported directly so the context interface
 * stays focused on what's actually router-local.
 */
import {
  clearCodexTurnWatchdog,
  markCodexTurnHealthy,
} from './adapters/codex/helpers.js'
import { DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE } from '../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../claude-effort.js'
import type { QueuedMessage, QueuedMessagePriority } from './message-queue.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CommanderSessionsInterface,
  MachineConfig,
  SessionCreator,
  SessionType,
  StreamJsonEvent,
  StreamSession,
} from './types.js'

/** Signature for the router's Codex app-server session creator. */
export type CodexSessionCreator = (
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string,
  options: {
    resumeSessionId?: string
    systemPrompt?: string
    sessionType?: SessionType
    creator?: SessionCreator
  },
) => Promise<StreamSession>

/** Signature for the router's Gemini ACP session creator. */
export type GeminiSessionCreator = (
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string,
  options: {
    resumeSessionId?: string
    systemPrompt?: string
    maxTurns?: number
    sessionType?: SessionType
    creator?: SessionCreator
  },
) => Promise<StreamSession>

/** Signature for the router's Claude stream session creator (synchronous). */
export type ClaudeSessionCreator = (
  sessionName: string,
  mode: ClaudePermissionMode,
  task: string,
  cwd: string | undefined,
  machine: MachineConfig | undefined,
  agentType: 'claude',
  options: {
    systemPrompt?: string
    effort?: ClaudeEffortLevel
    adaptiveThinking: typeof DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    resumeSessionId?: string
    maxTurns?: number
    sessionType?: SessionType
    creator?: SessionCreator
  },
) => StreamSession

export type SessionTeardown = (session: StreamSession, reason: string) => Promise<void>
export type RuntimeShutdown = (reason?: string) => Promise<void>

export type CreateQueuedMessage = (
  text: string,
  priority: QueuedMessagePriority,
) => QueuedMessage

export type EnqueueQueuedMessage = (
  session: StreamSession,
  message: QueuedMessage,
) => { ok: true } | { ok: false; error: string }

export type ScheduleQueueDrain = (
  session: StreamSession,
  options?: { force?: boolean },
) => void

/**
 * Signature matches the router's internal `sendImmediateTextToStreamSession`:
 * returns a discriminated-union success/failure result. The commander
 * interface only uses `result.ok`, so we do not model the full success payload
 * here — callers of `sendToSession` return a boolean.
 */
export type SendImmediateText = (
  session: StreamSession,
  text: string,
) => Promise<
  | { ok: true; queued: boolean; message: QueuedMessage }
  | { ok: false; error: string }
>

/**
 * Every router-local closure the CommanderSessionsInterface implementation
 * needs. Keeping the context explicit means any future change to
 * commander-lifecycle dependencies shows up in the type, not as a hidden
 * closure reference.
 */
export interface CommanderInterfaceContext {
  sessions: Map<string, AnySession>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  schedulePersistedSessionsWrite: () => void

  createCodexAppServerSession: CodexSessionCreator
  createGeminiAcpSession: GeminiSessionCreator
  createStreamSession: ClaudeSessionCreator

  createQueuedMessage: CreateQueuedMessage
  enqueueQueuedMessage: EnqueueQueuedMessage
  scheduleQueuedMessageDrain: ScheduleQueueDrain
  sendImmediateTextToStreamSession: SendImmediateText

  teardownCodexSessionRuntime: SessionTeardown
  teardownGeminiSessionRuntime: SessionTeardown
  shutdownCodexRuntimes: RuntimeShutdown
  shutdownGeminiRuntimes: RuntimeShutdown
}

/**
 * Subset of `CommanderSessionsInterface` covered by this factory. The
 * `dispatchWorkerForCommander` method is composed in by the router itself
 * (issue #1223) because it needs router-local state — the machine registry,
 * `maxSessions` budget, and direct access to the session-creator closures —
 * that is intentionally not part of `CommanderInterfaceContext`. Keeping it
 * out of this factory's return type means the router's compose step is the
 * single place that sees both halves.
 */
export type BaseCommanderSessionsInterface = Omit<
  CommanderSessionsInterface,
  'dispatchWorkerForCommander'
>

/**
 * Construct the commander-session interface backed by the given router
 * context. Behavior is identical to the pre-#921-P5 inline object literal
 * that lived in `routes.ts`; this is pure refactor.
 */
export function createCommanderSessionsInterface(
  ctx: CommanderInterfaceContext,
): BaseCommanderSessionsInterface {
  const {
    sessions,
    sessionEventHandlers,
    schedulePersistedSessionsWrite,
    createCodexAppServerSession,
    createGeminiAcpSession,
    createStreamSession,
    createQueuedMessage,
    enqueueQueuedMessage,
    scheduleQueuedMessageDrain,
    sendImmediateTextToStreamSession,
    teardownCodexSessionRuntime,
    teardownGeminiSessionRuntime,
    shutdownCodexRuntimes,
    shutdownGeminiRuntimes,
  } = ctx

  return {
    async createCommanderSession({
      name,
      commanderId,
      systemPrompt,
      agentType,
      effort,
      cwd,
      resumeSessionId,
      resumeCodexThreadId,
      resumeGeminiSessionId,
      maxTurns,
    }) {
      const creator = {
        kind: 'commander' as const,
        id: commanderId?.trim() || name,
      }
      let session: StreamSession
      if (agentType === 'codex') {
        const sessionCwd = cwd ?? process.env.HOME ?? '/tmp'
        if (resumeCodexThreadId) {
          try {
            session = await createCodexAppServerSession(
              name,
              'default',
              '',
              sessionCwd,
              {
                resumeSessionId: resumeCodexThreadId,
                sessionType: 'commander',
                creator,
              },
            )
          } catch {
            session = await createCodexAppServerSession(
              name,
              'default',
              '',
              sessionCwd,
              {
                systemPrompt,
                sessionType: 'commander',
                creator,
              },
            )
          }
        } else {
          session = await createCodexAppServerSession(
            name,
            'default',
            '',
            sessionCwd,
            {
              systemPrompt,
              sessionType: 'commander',
              creator,
            },
          )
        }
      } else if (agentType === 'gemini') {
        const sessionCwd = cwd ?? process.env.HOME ?? '/tmp'
        session = await createGeminiAcpSession(
          name,
          'default',
          '',
          sessionCwd,
          {
            resumeSessionId: resumeGeminiSessionId,
            systemPrompt,
            maxTurns,
            sessionType: 'commander',
            creator,
          },
        )
      } else {
        session = createStreamSession(
          name,
          'default',
          '',
          cwd,
          undefined,
          'claude',
          {
            systemPrompt,
            effort,
            adaptiveThinking: DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
            resumeSessionId,
            maxTurns,
            sessionType: 'commander',
            creator,
          },
        )
      }
      sessions.set(name, session)
      schedulePersistedSessionsWrite()
      return session
    },

    async sendToSession(name, text, options) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return false
      }
      if (options?.queue) {
        const message = createQueuedMessage(text, options.priority ?? 'normal')
        const queued = enqueueQueuedMessage(session, message)
        if (!queued.ok) {
          return false
        }
        scheduleQueuedMessageDrain(session)
        return true
      }

      const result = await sendImmediateTextToStreamSession(session, text)
      return result.ok
    },

    deleteSession(name) {
      const session = sessions.get(name)
      if (!session) {
        return
      }

      for (const client of session.clients) {
        client.close(1000, 'Commander stopped')
      }

      if (session.kind === 'stream') {
        if (session.agentType === 'codex') {
          clearCodexTurnWatchdog(session)
          markCodexTurnHealthy(session)
          void teardownCodexSessionRuntime(session, `Commander stopped session "${name}"`)
        } else if (session.agentType === 'gemini') {
          void teardownGeminiSessionRuntime(session, `Commander stopped session "${name}"`)
        } else {
          session.process.kill('SIGTERM')
        }
      } else if (session.kind === 'pty') {
        session.pty.kill()
      }
      // External sessions have no local process.

      sessions.delete(name)
      sessionEventHandlers.delete(name)
      schedulePersistedSessionsWrite()
    },

    getSession(name) {
      const session = sessions.get(name)
      return session?.kind === 'stream' ? session : undefined
    },

    subscribeToEvents(name, handler) {
      let handlers = sessionEventHandlers.get(name)
      if (!handlers) {
        handlers = new Set()
        sessionEventHandlers.set(name, handlers)
      }
      handlers.add(handler)
      return () => {
        const currentHandlers = sessionEventHandlers.get(name)
        if (!currentHandlers) {
          return
        }
        currentHandlers.delete(handler)
        if (currentHandlers.size === 0) {
          sessionEventHandlers.delete(name)
        }
      }
    },

    async shutdown() {
      await Promise.all([
        shutdownCodexRuntimes(),
        shutdownGeminiRuntimes(),
      ])
    },
  }
}
