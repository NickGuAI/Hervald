import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AuthUser } from '@gehirn/auth-providers'
import type { Router } from 'express'
import type { WebSocket } from 'ws'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import type { HammurabiEvent } from '../../src/types/hammurabi-events.js'
import type { ActionPolicyGate } from '../policies/action-policy-gate.js'
import type { QueuedMessage, QueuedMessageImage, SessionMessageQueue } from './message-queue.js'
import type {
  ClaudeAdaptiveThinkingMode,
} from '../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../claude-effort.js'
import type { QuestStore } from '../commanders/quest-store.js'
import type { GeminiTurnState } from './event-normalizers/gemini.js'

// Session execution now runs in a single approval-on mode.
export type ClaudePermissionMode = 'default'

export type AgentType = 'claude' | 'codex' | 'gemini'
export type SessionType = 'commander' | 'worker' | 'cron' | 'sentinel'
export type SessionTransportType = 'pty' | 'stream' | 'external'
export type SessionCreatorKind = 'human' | 'commander' | 'cron' | 'sentinel'

export interface SessionCreator {
  kind: SessionCreatorKind
  id?: string
}

export interface AgentSession {
  name: string
  label?: string
  created: string
  lastActivityAt?: string
  pid: number
  sessionType?: SessionType
  transportType?: SessionTransportType
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  cwd?: string
  host?: string
  creator?: SessionCreator
  spawnedBy?: string
  spawnedWorkers?: string[]
  workerSummary?: WorkerSummary
  processAlive?: boolean
  hadResult?: boolean
  resumedFrom?: string
  status?: 'active' | 'idle' | 'stale' | 'completed' | 'exited'
  resumeAvailable?: boolean
  queuedMessageCount?: number
}

export type WorldAgentStatus = 'active' | 'idle' | 'stale' | 'completed'
export type WorldAgentPhase = 'idle' | 'thinking' | 'tool_use' | 'blocked' | 'stale' | 'completed'
export type WorldAgentRole = 'commander' | 'worker'

export interface WorldAgent {
  id: string
  agentType: AgentType
  transportType: SessionTransportType
  status: WorldAgentStatus
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
  task: string
  phase: WorldAgentPhase
  lastToolUse: string | null
  lastUpdatedAt: string
  role: WorldAgentRole
}

export interface PtyHandle {
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pid: number
}

export interface PtySpawner {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: NodeJS.ProcessEnv
    },
  ): PtyHandle
}

export interface PtySession {
  kind: 'pty'
  name: string
  sessionType: SessionType
  creator: SessionCreator
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  cwd: string
  host?: string
  task?: string
  pty: PtyHandle
  buffer: string
  clients: Set<WebSocket>
  createdAt: string
  lastEventAt: string
}

export type StreamJsonEvent = HammurabiEvent

export type CodexApprovalMethod =
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval'
  | 'item/mcpToolCall/requestApproval'
  | 'item/rules/requestApproval'
  | 'item/skill/requestApproval'
export type CodexApprovalDecision = 'accept' | 'decline'

export interface CodexPendingApprovalRequest {
  requestId: number
  method: CodexApprovalMethod
  threadId: string
  itemId?: string
  turnId?: string
  cwd?: string
  reason?: string
  risk?: string
  permissions?: unknown
  requestedAt: string
}

export interface CodexProtocolMessage {
  method: string
  params: unknown
  requestId?: number
}

export interface CodexRuntimeTerminalFailure {
  reason: string
  exitCode?: number
  signal?: string
}

export type CodexRuntimeFailure =
  | { kind: 'transport_disconnect'; reason: string }
  | ({ kind: 'terminal' } & CodexRuntimeTerminalFailure)

export interface CodexSessionRuntimeHandle {
  process: ChildProcess | null
  ensureConnected(): Promise<void>
  sendRequest(method: string, params: unknown): Promise<unknown>
  sendResponse(id: number, result: unknown): void
  getTerminalFailure(): CodexRuntimeTerminalFailure | null
  waitForTerminalFailure(timeoutMs: number): Promise<CodexRuntimeTerminalFailure | null>
  addNotificationListener(threadId: string, cb: (message: CodexProtocolMessage) => void): () => void
  log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void
  teardown(options?: { threadId?: string; reason?: string; timeoutMs?: number }): Promise<void>
  teardownOnProcessExit(threadId?: string): void
}

export interface GeminiAcpRuntimeHandle {
  process: ChildProcess | null
  ensureConnected(): Promise<void>
  sendRequest(method: string, params: unknown): Promise<unknown>
  sendNotification(method: string, params: unknown): void
  sendResponse(id: number | string, result: unknown): void
  addNotificationListener(sessionId: string, cb: (message: GeminiProtocolMessage) => void): () => void
  teardown(options?: { reason?: string; timeoutMs?: number }): Promise<void>
  teardownOnProcessExit(): void
}

export interface GeminiProtocolMessage {
  method: string
  params: unknown
  requestId?: number | string
}

export type StreamDispatchMode = 'live' | 'queue'

export type StreamDispatchResult =
  | { ok: true; delivered: 'live' }
  | { ok: true; delivered: 'queued'; message: QueuedMessage; position: number }
  | { ok: false; retryable: boolean; reason: string }

export interface StreamSessionAdapter {
  dispatchSend(
    session: StreamSession,
    text: string,
    mode: StreamDispatchMode,
    images?: QueuedMessageImage[],
    options?: { userEventSubtype?: string },
  ): Promise<StreamDispatchResult>
}

export interface StreamSession {
  kind: 'stream'
  name: string
  sessionType: SessionType
  creator: SessionCreator
  conversationId?: string
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  mode: ClaudePermissionMode
  cwd: string
  host?: string
  /**
   * Canonical active-skill trust context for this session. Worker dispatch
   * inherits this object by default, can override it explicitly, or can clear
   * it with an explicit `null` payload. Approval policy reads this field
   * directly instead of inferring trust from session lineage or names.
   */
  currentSkillInvocation?: ActiveSkillInvocation
  spawnedBy?: string
  spawnedWorkers: string[]
  task?: string
  process: ChildProcess
  events: StreamJsonEvent[]
  clients: Set<WebSocket>
  createdAt: string
  lastEventAt: string
  systemPrompt?: string
  maxTurns?: number
  model?: string
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
  stdoutBuffer: string
  lastStderrSummary?: string
  stdinDraining: boolean
  lastTurnCompleted: boolean
  completedTurnAt?: string
  claudeSessionId?: string
  codexThreadId?: string
  activeTurnId?: string
  geminiSessionId?: string
  resumedFrom?: string
  finalResultEvent?: StreamJsonEvent
  conversationEntryCount: number
  autoRotatePending: boolean
  codexTurnWatchdogTimer?: NodeJS.Timeout
  codexTurnStaleAt?: string
  codexLastIncomingMethod?: string
  codexLastIncomingAt?: string
  codexUnclassifiedIncomingCount: number
  codexPendingApprovals: Map<number, CodexPendingApprovalRequest>
  messageQueue: SessionMessageQueue
  currentQueuedMessage?: QueuedMessage
  pendingDirectSendMessages: QueuedMessage[]
  queuedMessageRetryTimer?: NodeJS.Timeout
  queuedMessageRetryMessageId?: string
  queuedMessageRetryDelayMs: number
  queuedMessageDrainScheduled: boolean
  queuedMessageDrainPending: boolean
  queuedMessageDrainPendingForce: boolean
  codexNotificationCleanup?: () => void
  codexRuntime?: CodexSessionRuntimeHandle
  codexRuntimeTeardownPromise?: Promise<void>
  geminiNotificationCleanup?: () => void
  geminiRuntime?: GeminiAcpRuntimeHandle
  geminiRuntimeTeardownPromise?: Promise<void>
  geminiPendingSystemPrompt?: string
  geminiTurnState?: GeminiTurnState
  geminiToolCallSnapshots?: Map<string, Record<string, unknown>>
  adapter?: StreamSessionAdapter
  /** True when this session was spawned during restore with no new task.
   * Used to skip the persist-write on exit so the file is not overwritten
   * with an empty list just because the idle resume process exited. */
  restoredIdle: boolean
}

export interface ExternalSession {
  kind: 'external'
  name: string
  sessionType: SessionType
  creator: SessionCreator
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  machine: string
  cwd: string
  host?: string
  task?: string
  status: 'connected' | 'stale'
  lastHeartbeat: number
  events: StreamJsonEvent[]
  clients: Set<WebSocket>
  createdAt: string
  lastEventAt: string
  metadata?: Record<string, unknown>
}

export interface CompletedSession {
  name: string
  createdAt?: string
  completedAt: string
  subtype: string
  finalComment: string
  costUsd: number
  sessionType: SessionType
  creator: SessionCreator
  spawnedBy?: string
}

export type WorkerStatus = 'starting' | 'running' | 'down' | 'done'
export type WorkerPhase = 'starting' | 'running' | 'exited'

export interface WorkerState {
  name: string
  status: WorkerStatus
  phase: WorkerPhase
}

export interface WorkerSummary {
  total: number
  starting: number
  running: number
  down: number
  done: number
}

export interface ExitedStreamSessionState {
  phase: 'exited'
  hadResult: boolean
  sessionType: SessionType
  creator: SessionCreator
  conversationId?: string
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  mode: ClaudePermissionMode
  cwd: string
  host?: string
  currentSkillInvocation?: ActiveSkillInvocation
  spawnedBy?: string
  spawnedWorkers: string[]
  createdAt: string
  claudeSessionId?: string
  codexThreadId?: string
  activeTurnId?: string
  geminiSessionId?: string
  resumedFrom?: string
  conversationEntryCount: number
  events: StreamJsonEvent[]
  queuedMessages?: QueuedMessage[]
  currentQueuedMessage?: QueuedMessage
  pendingDirectSendMessages?: QueuedMessage[]
}

export interface StreamSessionCreateOptions {
  resumeSessionId?: string
  systemPrompt?: string
  maxTurns?: number
  model?: string
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  createdAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  resumedFrom?: string
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  currentSkillInvocation?: ActiveSkillInvocation
}

export interface CodexSessionCreateOptions {
  resumeSessionId?: string
  createdAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  systemPrompt?: string
  model?: string
  resumedFrom?: string
  machine?: MachineConfig
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  currentSkillInvocation?: ActiveSkillInvocation
}

export interface GeminiSessionCreateOptions {
  resumeSessionId?: string
  createdAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  systemPrompt?: string
  resumedFrom?: string
  machine?: MachineConfig
  maxTurns?: number
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  currentSkillInvocation?: ActiveSkillInvocation
}

export type AnySession = PtySession | StreamSession | ExternalSession

export interface AgentsRouterOptions {
  ptySpawner?: PtySpawner
  maxSessions?: number
  taskDelayMs?: number
  wsKeepAliveIntervalMs?: number
  autoRotateEntryThreshold?: number
  codexTurnWatchdogTimeoutMs?: number
  sessionStorePath?: string
  autoResumeSessions?: boolean
  machinesFilePath?: string
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  getActionPolicyGate?: () => ActionPolicyGate | null
  commanderSessionStorePath?: string
  questStore?: QuestStore
}

export interface AgentsRouterResult {
  router: Router
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  sessionsInterface: CommanderSessionsInterface
  approvalSessionsInterface: ApprovalSessionsInterface
}

export interface ActiveSkillInvocation {
  toolUseId?: string
  skillId: string
  /** Persisted display label so approval UI and policy traces do not derive it later. */
  displayName: string
  /** ISO timestamp when this skill context became active for the session. */
  startedAt: string
}

export interface ApprovalSessionContext {
  sessionName: string
  sessionType: SessionType
  creator: SessionCreator
  agentType: AgentType
  mode: ClaudePermissionMode
  cwd: string
  host?: string
  commanderScopeId?: string
  currentSkillInvocation?: ActiveSkillInvocation
}

export interface PendingCodexApprovalView {
  id: string
  sessionName: string
  commanderScopeId?: string
  requestId: number
  actionId: string
  actionLabel: string
  requestedAt: string
  reason?: string
  risk?: string
  threadId?: string
  itemId?: string
  turnId?: string
}

export interface CodexApprovalQueueEvent {
  type: 'enqueued' | 'resolved'
  approval: PendingCodexApprovalView
  decision?: 'approve' | 'reject'
  delivered?: boolean
}

export interface ApprovalSessionsInterface {
  getSessionContext(name: string): ApprovalSessionContext | null
  findSessionContextByClaudeSessionId(sessionId: string): ApprovalSessionContext | null
  getLiveSession(name: string): StreamSession | null
  findLiveSessionByClaudeSessionId(sessionId: string): StreamSession | null
  listPendingCodexApprovals(): PendingCodexApprovalView[]
  resolvePendingCodexApproval(
    approvalId: string,
    decision: CodexApprovalDecision,
  ): {
    ok: true
  } | {
    ok: false
    code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
    reason: string
  }
  subscribeToCodexApprovalQueue(listener: (event: CodexApprovalQueueEvent) => void): () => void
}

/**
 * Result returned by `CommanderSessionsInterface.dispatchWorkerForCommander`.
 * The interface yields `{ status, body }` instead of writing to a Response so
 * the commanders router can forward the result without coupling auth + URL
 * resolution (its job) to session-spawn details (the agents router's job).
 */
export interface DispatchWorkerForCommanderResult {
  status: number
  body: Record<string, unknown>
}

export interface CommanderSessionsInterface {
  createCommanderSession(params: {
    name: string
    commanderId?: string
    conversationId?: string
    systemPrompt: string
    agentType: 'claude' | 'codex' | 'gemini'
    effort?: ClaudeEffortLevel
    cwd?: string
    resumeSessionId?: string
    resumeCodexThreadId?: string
    resumeGeminiSessionId?: string
    maxTurns?: number
  }): Promise<StreamSession>
  /**
   * Dispatch a worker session attributed to a commander whose identity has
   * already been verified by the caller (typically the URL-baked
   * `/api/commanders/:id/workers` route). The spawned session persists with
   * `creator: { kind: "commander", id }` and `sessionType: "worker"` so the
   * Hervald TEAM panel — and every other consumer that filters by
   * commander ownership — sees it correctly. See issue #1223.
   */
  dispatchWorkerForCommander(input: {
    commanderId: string
    rawBody: unknown
  }): Promise<DispatchWorkerForCommanderResult>
  sendToSession(
    name: string,
    text: string,
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    },
  ): Promise<boolean>
  deleteSession(name: string): void
  getSession(name: string): StreamSession | undefined
  subscribeToEvents(name: string, handler: (event: StreamJsonEvent) => void): () => void
  shutdown?(): Promise<void>
}

export interface MachineConfig {
  id: string
  label: string
  host: string | null
  tailscaleHostname?: string
  user?: string
  port?: number
  cwd?: string
  envFile?: string
}

export type MachineToolKey = 'claude' | 'codex' | 'gemini' | 'git' | 'node'

export interface MachineToolStatus {
  ok: boolean
  version: string | null
  raw: string
}

export interface MachineHealthReport {
  machineId: string
  mode: 'local' | 'ssh'
  ssh: {
    ok: boolean
    destination?: string
  }
  tools: Record<MachineToolKey, MachineToolStatus>
}

export interface PersistedStreamSession {
  name: string
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  mode: ClaudePermissionMode
  cwd: string
  host?: string
  currentSkillInvocation?: ActiveSkillInvocation
  createdAt: string
  claudeSessionId?: string
  codexThreadId?: string
  activeTurnId?: string
  geminiSessionId?: string
  conversationEntryCount?: number
  events?: StreamJsonEvent[]
  spawnedBy?: string
  spawnedWorkers?: string[]
  resumedFrom?: string
  sessionState?: 'active' | 'exited'
  hadResult?: boolean
  queuedMessages?: QueuedMessage[]
  currentQueuedMessage?: QueuedMessage
  pendingDirectSendMessages?: QueuedMessage[]
}

export interface PersistedSessionsState {
  sessions: PersistedStreamSession[]
}

export interface ResolvedResumableSessionSource {
  source: PersistedStreamSession
  liveSession?: StreamSession
}

export interface CapturedCommandResult {
  stdout: string
  stderr: string
  code: number
  signal: string | null
  timedOut: boolean
}

export interface CompletedSessionMetadata {
  sessionType?: SessionType
  creator?: SessionCreator
  spawnedBy?: string
  createdAt?: string
}
