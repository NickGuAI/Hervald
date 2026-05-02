import type { Router } from 'express'
import cron from 'node-cron'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AgentSessionMonitorOptions } from '@gehirn/ai-services'
import { createAgentsRouter } from '../modules/agents/routes.js'
import { CommandRoomExecutor } from '../modules/command-room/executor.js'
import { CommandRoomRunStore } from '../modules/command-room/run-store.js'
import { createCommandRoomRouter } from '../modules/command-room/routes.js'
import { CommandRoomScheduler } from '../modules/command-room/scheduler.js'
import { CommandRoomTaskStore } from '../modules/command-room/task-store.js'
import { registerCommanderCron } from '../modules/commanders/cron.js'
import { createChannelReplyDispatchers } from '../modules/commanders/channel-dispatchers.js'
import { QuestStore } from '../modules/commanders/quest-store.js'
import {
  CommanderEmailConfigStore,
  CommanderEmailStateStore,
} from '../modules/commanders/email-config.js'
import { EmailPoller } from '../modules/commanders/email-poller.js'
import {
  resolveCommanderDataDir,
  resolveCommanderSessionStorePath,
} from '../modules/commanders/paths.js'
import { createCommandersRouter } from '../modules/commanders/routes.js'
import { CommanderSessionStore } from '../modules/commanders/store.js'
import { ConversationStore } from '../modules/commanders/conversation-store.js'
import { createApprovalsRouter } from '../modules/policies/approvals-routes.js'
import { ActionPolicyGate } from '../modules/policies/action-policy-gate.js'
import { ApprovalCoordinator } from '../modules/policies/pending-store.js'
import { createPoliciesRouter } from '../modules/policies/routes.js'
import { PolicyStore } from '../modules/policies/store.js'
import { createServicesRouter } from '../modules/services/routes.js'
import { createSentinelsRouter } from '../modules/sentinels/routes.js'
import { createSkillsRouter } from '../modules/skills/routes.js'
import { createTelemetryRouterWithHub } from '../modules/telemetry/routes.js'
import { createOtelRouter } from '../modules/telemetry/otel-receiver.js'
import { createWhatsAppBridgeRouter } from '../modules/whatsapp-bridge/routes.js'
import type { ApiKeyStoreLike } from './api-keys/store.js'
import type { OpenAITranscriptionKeyStoreLike } from './api-keys/transcription-store.js'
import { createRealtimeProxy } from './realtime/proxy.js'

export interface HammurabiModule {
  name: string
  label: string
  routePrefix: string
  router: Router
  handleUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  shutdown?: () => Promise<void> | void
}

interface ModuleRegistryOptions {
  apiKeyStore?: ApiKeyStoreLike
  transcriptionKeyStore?: OpenAITranscriptionKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  /** Max concurrent agent sessions (default 10). Set via HAMMURABI_MAX_AGENT_SESSIONS. */
  maxAgentSessions?: number
}

export interface ModuleRegistryResult {
  modules: HammurabiModule[]
  /** OTEL receiver router — mount at `/v1` (separate from module prefixes). */
  otelRouter: Router
}

const DEFAULT_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES = 30
const DEFAULT_COMMAND_ROOM_POLL_INTERVAL_MS = 5_000

function parseEnabledFlag(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function resolveCommandRoomMonitorOptions(
  env: NodeJS.ProcessEnv = process.env,
): AgentSessionMonitorOptions {
  const pollIntervalMs =
    parsePositiveInteger(env.HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS)
    ?? DEFAULT_COMMAND_ROOM_POLL_INTERVAL_MS
  const staleSessionTtlMinutes =
    parsePositiveInteger(env.HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES)
    ?? DEFAULT_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES

  return {
    pollIntervalMs,
    maxPollAttempts: Math.max(1, Math.ceil((staleSessionTtlMinutes * 60_000) / pollIntervalMs)),
  }
}

export function createModules(options: ModuleRegistryOptions = {}): ModuleRegistryResult {
  const internalToken = randomBytes(32).toString('hex')
  const commandRoomMonitorOptions = resolveCommandRoomMonitorOptions()

  const commanderDataDir = resolveCommanderDataDir()
  const policyStore = new PolicyStore()
  const approvalCoordinator = new ApprovalCoordinator()
  let actionPolicyGate: ActionPolicyGate | null = null

  const agents = createAgentsRouter({
    apiKeyStore: options.apiKeyStore,
    getActionPolicyGate: () => actionPolicyGate,
    maxSessions: options.maxAgentSessions,
    internalToken,
    questStore: new QuestStore(commanderDataDir),
  })
  actionPolicyGate = new ActionPolicyGate({
    policyStore,
    approvalCoordinator,
    getApprovalSessionsInterface: () => agents.approvalSessionsInterface,
  })

  const commanderSessionStorePath = resolveCommanderSessionStorePath(commanderDataDir)
  // Build ConversationStore BEFORE CommanderSessionStore so the legacy-runtime
  // backfill in CommanderSessionStore.ensureLoaded() can persist synthetic
  // Conversation rows derived from pre-#1216 CommanderSession shapes. Without
  // the persistBackfilledConversation callback wired here, store.ts:670-678
  // logs a warning and silent-drops the migration — operators upgrading from
  // pre-#1216 lose historical heartbeat / currentTask / cost / channel data.
  // See PR #1279 codex review.
  const commanderConversationStore = new ConversationStore(commanderDataDir)
  const commanderSessionStore = new CommanderSessionStore(commanderSessionStorePath, {
    persistBackfilledConversation: async (conversation) => {
      await commanderConversationStore.upsertBackfilledConversation(conversation)
    },
  })
  const emailConfigStore = new CommanderEmailConfigStore(commanderDataDir)
  const emailStateStore = new CommanderEmailStateStore(commanderDataDir)
  const emailPoller = new EmailPoller({
    sessionStore: commanderSessionStore,
    configStore: emailConfigStore,
    stateStore: emailStateStore,
    sessionsInterface: agents.sessionsInterface,
  })

  const commandRoomTaskStore = new CommandRoomTaskStore({
    commanderDataDir,
  })
  const commandRoomRunStore = new CommandRoomRunStore({
    commanderDataDir,
    taskStore: commandRoomTaskStore,
  })
  const commandRoomExecutor = new CommandRoomExecutor({
    taskStore: commandRoomTaskStore,
    runStore: commandRoomRunStore,
    internalToken,
  })
  const commandRoomScheduler = new CommandRoomScheduler({
    taskStore: commandRoomTaskStore,
    executor: commandRoomExecutor,
  })
  const commandRoomSchedulerInitialized = commandRoomScheduler.initialize()
  void commandRoomSchedulerInitialized.catch((error) => {
    console.error('[command-room] Failed to initialize shared scheduler:', error)
  })

  const commanders = createCommandersRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    sessionsInterface: agents.sessionsInterface,
    sessionStore: commanderSessionStore,
    sessionStorePath: commanderSessionStorePath,
    // Share the same ConversationStore instance the sessionStore writes
    // backfills into, so router-side reads observe the migrated rows.
    conversationStore: commanderConversationStore,
    questStoreDataDir: commanderDataDir,
    heartbeatBasePath: commanderDataDir,
    memoryBasePath: commanderDataDir,
    commandRoomTaskStore,
    commandRoomRunStore,
    commandRoomScheduler,
    commandRoomSchedulerInitialized,
    channelReplyDispatchers: createChannelReplyDispatchers(),
    emailConfigStore,
    emailStateStore,
    emailPoller,
  })

  registerCommanderCron(cron, {
    basePath: commanderDataDir,
    commanderSessionStorePath,
    enableEmailPoll: parseEnabledFlag(process.env.COMMANDER_EMAIL_POLL_ENABLED),
    emailPoller,
  })

  const commandRoom = createCommandRoomRouter({
    apiKeyStore: options.apiKeyStore,
    taskStore: commandRoomTaskStore,
    runStore: commandRoomRunStore,
    executor: commandRoomExecutor,
    scheduler: commandRoomScheduler,
    schedulerInitialized: commandRoomSchedulerInitialized,
    internalToken,
    monitorOptions: commandRoomMonitorOptions,
  })

  const sentinels = createSentinelsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    commanderStore: commanderSessionStore,
    internalToken,
  })
  void sentinels.ready.catch((error) => {
    console.error('[sentinel] Failed to initialize shared scheduler:', error)
  })

  const services = createServicesRouter({
    apiKeyStore: options.apiKeyStore,
  })

  const policies = createPoliciesRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
    policyStore,
    approvalCoordinator,
    approvalSessionsInterface: agents.approvalSessionsInterface,
    actionPolicyGate,
  })

  const approvals = createApprovalsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
    approvalCoordinator,
    approvalSessionsInterface: agents.approvalSessionsInterface,
  })

  // Telemetry — returns both the legacy router and the shared hub
  const telemetry = createTelemetryRouterWithHub({
    apiKeyStore: options.apiKeyStore,
  })

  // OTEL receiver shares the same TelemetryHub instance
  const otelRouter = createOtelRouter({
    hub: telemetry.hub,
    apiKeyStore: options.apiKeyStore,
  })

  const realtime = createRealtimeProxy({
    apiKeyStore: options.apiKeyStore,
    transcriptionKeyStore: options.transcriptionKeyStore,
  })

  const whatsappBridge = createWhatsAppBridgeRouter({
    apiKeyStore: options.apiKeyStore,
    internalApiKey: internalToken,
  })

  const modules: HammurabiModule[] = [
    {
      name: 'agents',
      label: 'Agents Monitor',
      routePrefix: '/api/agents',
      router: agents.router,
      handleUpgrade: agents.handleUpgrade,
      shutdown: agents.sessionsInterface.shutdown,
    },
    {
      name: 'policies',
      label: 'Action Policies',
      routePrefix: '/api',
      router: policies.router,
    },
    {
      name: 'approvals',
      label: 'Approvals',
      routePrefix: '/api/approvals',
      router: approvals.router,
      handleUpgrade: approvals.handleUpgrade,
    },
    {
      name: 'commanders',
      label: 'Commanders',
      routePrefix: '/api/commanders',
      router: commanders.router,
    },
    {
      name: 'conversations',
      label: 'Conversations',
      routePrefix: '/api/conversations',
      router: commanders.conversationRouter,
    },
    {
      name: 'command-room',
      label: 'Command Room',
      routePrefix: '/api/command-room',
      router: commandRoom.router,
    },
    {
      name: 'sentinels',
      label: 'Sentinels',
      routePrefix: '/api/sentinels',
      router: sentinels.router,
    },
    {
      name: 'telemetry',
      label: 'Telemetry Hub',
      routePrefix: '/api/telemetry',
      router: telemetry.router,
    },
    {
      name: 'services',
      label: 'Services Manager',
      routePrefix: '/api/services',
      router: services.router,
      handleUpgrade: services.handleUpgrade,
    },
    {
      name: 'realtime',
      label: 'Realtime',
      routePrefix: '/api/realtime',
      router: realtime.router,
      handleUpgrade: realtime.handleUpgrade,
    },
    {
      name: 'skills',
      label: 'Skills & Cron',
      routePrefix: '/api/skills',
      router: createSkillsRouter({
        apiKeyStore: options.apiKeyStore,
        auth0Domain: options.auth0Domain,
        auth0Audience: options.auth0Audience,
        auth0ClientId: options.auth0ClientId,
      }),
    },
    {
      name: 'whatsapp-bridge',
      label: 'WhatsApp Bridge',
      routePrefix: '/api/whatsapp',
      router: whatsappBridge.router,
    },
  ]

  return { modules, otelRouter }
}
