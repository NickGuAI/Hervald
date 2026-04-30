import type { AuthUser } from '@gehirn/auth-providers'
import type { Request, RequestHandler, Response as ExpressResponse, Router } from 'express'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import type { CommanderSessionsInterface } from '../../agents/routes.js'
import type {
  CommandRoomRunStore,
} from '../../command-room/run-store.js'
import type {
  CommandRoomTaskStore,
  CronTask as CommandRoomCronTask,
  CreateCronTaskInput,
  CommandRoomTaskType,
} from '../../command-room/task-store.js'
import type {
  CommanderEmailConfigStore,
  CommanderEmailStateStore,
} from '../email-config.js'
import type { EmailPoller, CommanderEmailClient } from '../email-poller.js'
import type {
  CommanderHeartbeatManager,
} from '../heartbeat.js'
import type { HeartbeatLog } from '../heartbeat-log.js'
import type { CommanderSubagentLifecycleEvent, CommanderManager } from '../manager.js'
import type { QuestStore } from '../quest-store.js'
import type { ResolvedWorkspace } from '../../workspace/types.js'
import type {
  CommanderChannelMeta,
  CommanderCurrentTask,
  CommanderLastRoute,
  CommanderSession,
  CommanderSessionStore,
  CommanderTaskSource,
} from '../store.js'
import type { GhTasks } from '../tools/gh-tasks.js'
import type { CommanderRuntimeConfig } from '../runtime-config.shared.js'

export interface CommanderChannelReplyDispatchInput {
  commanderId: string
  message: string
  channelMeta: CommanderChannelMeta
  lastRoute: CommanderLastRoute
}

export type CommanderChannelReplyDispatcher = (
  input: CommanderChannelReplyDispatchInput,
) => Promise<void> | void

export interface CommandersRouterOptions {
  sessionStore?: CommanderSessionStore
  sessionStorePath?: string
  runtimeConfig?: CommanderRuntimeConfig
  runtimeConfigPath?: string
  questStore?: QuestStore
  questStoreDataDir?: string
  emailConfigStore?: CommanderEmailConfigStore
  emailStateStore?: CommanderEmailStateStore
  emailClient?: CommanderEmailClient
  emailPoller?: Pick<EmailPoller, 'sendReply'>
  ghTasksFactory?: (repo: string) => Pick<GhTasks, 'readTask'>
  heartbeatLog?: HeartbeatLog
  fetchImpl?: typeof fetch
  sessionsInterface?: CommanderSessionsInterface
  commandRoomTaskStore?: CommandRoomTaskStore
  commandRoomRunStore?: CommandRoomRunStore
  commandRoomScheduler?: CommanderCronScheduler
  commandRoomSchedulerInitialized?: Promise<void>
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  memoryBasePath?: string
  heartbeatBasePath?: string
  contextPressureInputTokenThreshold?: number
  now?: () => Date
  githubToken?: string
  agentsSessionStorePath?: string
  remoteSyncSharedSecret?: string
  channelReplyDispatchers?: Partial<Record<CommanderChannelMeta['provider'], CommanderChannelReplyDispatcher>>
}

export interface CommandersRouterResult {
  router: Router
  dispose: () => void
}

export interface GitHubIssueResponse {
  number: number
  title: string
  body?: string | null
  html_url: string
  state: string
  labels?: Array<{ name?: string }>
  pull_request?: unknown
}

export interface GitHubIssueUrlParts {
  owner: string
  repo: string
  issueNumber: number
  normalizedUrl: string
}

export type StreamEvent = Record<string, unknown>

export interface ContextPressureBridge {
  onContextPressure(handler: () => Promise<void> | void): void
  trigger(): Promise<void>
}

export interface CommanderSubAgentEntry {
  sessionId: string
  dispatchedAt: string
  state: 'running' | 'completed' | 'failed'
  result?: string
}

export interface CommanderTerminalState {
  kind: 'max_turns'
  subtype?: string
  terminalReason?: string
  message: string
  errors: string[]
}

export interface CommanderRuntime {
  manager: CommanderManager
  contextPressureBridge: ContextPressureBridge
  lastTaskState: string
  heartbeatCount: number
  lastKnownInputTokens: number
  forceNextFatHeartbeat: boolean
  pendingCollect: string[]
  pendingInternalUserMessages: Map<string, number>
  collectTimer: ReturnType<typeof setTimeout> | null
  subAgents: Map<string, CommanderSubAgentEntry>
  terminalState: CommanderTerminalState | null
  unsubscribeEvents?: () => void
}

export interface CommanderSessionStats {
  questCount: number
  scheduleCount: number
}

export type CommanderSessionResponseBase = Omit<CommanderSession, 'remoteOrigin'> & {
  name: string
  remoteOrigin?: {
    machineId: string
    label: string
  }
}

export type CommanderUiPublic = {
  borderColor?: string
  accentColor?: string
  speakingTone?: string
} | null

export type CommanderSessionResponse = CommanderSessionResponseBase &
  CommanderSessionStats & {
    ui?: CommanderUiPublic
    avatarUrl?: string | null
  }

export interface CommanderCronTaskResponse {
  id: string
  commanderId: string
  schedule: string
  instruction: string
  taskType: CommandRoomTaskType
  enabled: boolean
  lastRun: string | null
  nextRun: string | null
  agentType: 'claude' | 'codex' | 'gemini'
  sessionType?: 'stream' | 'pty'
  permissionMode?: string
  workDir?: string
  machine?: string
}

export interface CommanderCronStores {
  taskStore: CommandRoomTaskStore
  runStore: CommandRoomRunStore
}

export interface CommanderCronScheduler {
  createTask(input: CreateCronTaskInput): Promise<CommandRoomCronTask>
  updateTask(
    taskId: string,
    update: {
      schedule?: string
      instruction?: string
      enabled?: boolean
    },
  ): Promise<CommandRoomCronTask | null>
  deleteTask(taskId: string): Promise<boolean>
  getNextRun?(taskId: string): Date | null
}

export interface CommanderCronTaskRecord {
  task: CommandRoomCronTask
  stores: CommanderCronStores
}

export type RemoteSyncAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export interface CommanderRoutesContext {
  now: () => Date
  commanderDataDir: string
  commanderBasePath: string
  contextPressureInputTokenThreshold: number
  fetchImpl: typeof fetch
  githubToken: string | null
  runtimeConfig: CommanderRuntimeConfig
  sessionStore: CommanderSessionStore
  questStore: QuestStore
  emailConfigStore: CommanderEmailConfigStore
  emailStateStore: CommanderEmailStateStore
  emailReplyService: Pick<EmailPoller, 'sendReply'> | null
  ghTasksFactory: (repo: string) => Pick<GhTasks, 'readTask'>
  heartbeatLog: HeartbeatLog
  sessionsInterface?: CommanderSessionsInterface
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  /**
   * Auth gate for `POST /:id/workers` (commander-attributed worker dispatch).
   * Requires both `agents:write` (creates an agent session) and
   * `commanders:write` (acts on behalf of a commander). See issue #1223.
   */
  requireWorkerDispatchAccess: RequestHandler
  heartbeatManager: CommanderHeartbeatManager
  runtimes: Map<string, CommanderRuntime>
  activeCommanderSessions: Map<string, { sessionName: string; startedAt: string }>
  heartbeatFiredAtByCommander: Map<string, string>
  avatarUpload: { single(fieldname: string): RequestHandler }
  commandRoomScheduler?: CommanderCronScheduler
  commandRoomSchedulerInitialized: Promise<void>
  sendWorkspaceError: (res: ExpressResponse, error: unknown) => void
  resolveCommanderWorkspace: (rawCommanderId: unknown) => Promise<ResolvedWorkspace>
  getCommanderSessionStats: (commanderId: string) => Promise<CommanderSessionStats>
  listCommanderCronRunStores: (commanderId: string) => CommandRoomRunStore[]
  listCommanderCronTaskStores: (commanderId: string) => CommandRoomTaskStore[]
  listCommanderCronTasksWithStores: (commanderId: string) => Promise<CommanderCronTaskRecord[]>
  findCommanderCronTaskWithStores: (
    commanderId: string,
    taskId: string,
  ) => Promise<CommanderCronTaskRecord | null>
  buildCommanderCronTask: (
    task: CommandRoomCronTask,
    fallbackCommanderId: string,
  ) => Promise<CommanderCronTaskResponse>
  onSubagentLifecycleEvent: (
    commanderId: string,
    event: CommanderSubagentLifecycleEvent,
  ) => void
  authorizeRemoteSync: (req: Request, session: CommanderSession) => RemoteSyncAuthResult
  dispatchCommanderMessage: (input: {
    commanderId: string
    message: string
    mode: 'collect' | 'followup'
    session?: CommanderSession
    runtime?: CommanderRuntime
  }) => Promise<{ ok: true } | { ok: false; status: number; error: string }>
  dispatchCommanderChannelReply: (input: {
    commanderId: string
    message: string
  }) => Promise<
    | {
      ok: true
      provider: CommanderChannelMeta['provider']
      sessionKey: string
      lastRoute: CommanderLastRoute
    }
    | { ok: false; status: number; error: string }
  >
  attachCommanderPublicUi: (
    commanderId: string,
    payload: CommanderSessionResponse & {
      contextConfig: { fatPinInterval: number }
      runtime: {
        heartbeatCount: number
        terminalState: CommanderRuntime['terminalState']
      }
    },
  ) => Promise<
    CommanderSessionResponse & {
      contextConfig: { fatPinInterval: number }
      runtime: {
        heartbeatCount: number
        terminalState: CommanderRuntime['terminalState']
      }
    }
  >
  migrateCommanderConfigSource: (commanderId: string) => Promise<void>
  migrateLegacyCommanderConfig: () => Promise<void>
  reconcileCommanderSessions: () => Promise<void>
}
