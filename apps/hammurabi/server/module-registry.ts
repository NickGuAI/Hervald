import type { Router } from 'express'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AgentSessionMonitorOptions } from '@gehirn/ai-services'
import { createAgentsRouter } from '../modules/agents/routes.js'
import { createAutomationsRouter } from '../modules/automations/routes.js'
import { AutomationExecutor } from '../modules/automations/executor.js'
import { AutomationScheduler } from '../modules/automations/scheduler.js'
import { AutomationStore } from '../modules/automations/store.js'
import { AutomationQuestEventBus } from '../modules/automations/quest-event-bus.js'
import { createProviderRegistryRouter } from '../modules/agents/providers/http-router.js'
import { registerCommanderCron } from '../modules/commanders/cron.js'
import { createChannelReplyDispatchers } from '../modules/commanders/channel-dispatchers.js'
import {
  COMMANDER_EMAIL_POLL_CRON,
  COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
} from '../modules/commanders/cron.js'
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
import { createCommanderChannelsRouter } from '../modules/channels/route.js'
import { createCommandersRouter } from '../modules/commanders/routes.js'
import { CommanderSessionStore } from '../modules/commanders/store.js'
import { ConversationStore } from '../modules/commanders/conversation-store.js'
import { createOrgRouter } from '../modules/org/route.js'
import { createOperatorsRouter } from '../modules/operators/routes.js'
import { maintainCommanderTranscriptIndex } from '../modules/commanders/transcript-index.js'
import { createApprovalsRouter } from '../modules/policies/approvals-routes.js'
import { ActionPolicyGate } from '../modules/policies/action-policy-gate.js'
import { ApprovalCoordinator } from '../modules/policies/pending-store.js'
import { createPoliciesRouter } from '../modules/policies/routes.js'
import { PolicyStore } from '../modules/policies/store.js'
import { createServicesRouter } from '../modules/services/routes.js'
import { createSettingsRouter } from '../modules/settings/routes.js'
import type { AppSettingsStore } from '../modules/settings/store.js'
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
  appSettingsStore?: AppSettingsStore
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
  const questEventBus = new AutomationQuestEventBus()
  const questStore = new QuestStore({
    dataDir: commanderDataDir,
    eventBus: questEventBus,
  })

  const agents = createAgentsRouter({
    apiKeyStore: options.apiKeyStore,
    getActionPolicyGate: () => actionPolicyGate,
    maxSessions: options.maxAgentSessions,
    internalToken,
    questStore,
  })
  actionPolicyGate = new ActionPolicyGate({
    policyStore,
    approvalCoordinator,
    getApprovalSessionsInterface: () => agents.approvalSessionsInterface,
  })

  const commanderSessionStorePath = resolveCommanderSessionStorePath(commanderDataDir)
  const commanderConversationStore = new ConversationStore(commanderDataDir)
  const commanderSessionStore = new CommanderSessionStore(commanderSessionStorePath)
  const emailConfigStore = new CommanderEmailConfigStore(commanderDataDir)
  const emailStateStore = new CommanderEmailStateStore(commanderDataDir)
  const emailPoller = new EmailPoller({
    sessionStore: commanderSessionStore,
    configStore: emailConfigStore,
    stateStore: emailStateStore,
    sessionsInterface: agents.sessionsInterface,
  })

  const automationStore = new AutomationStore({
    commanderDataDir,
  })
  const automationExecutor = new AutomationExecutor({
    store: automationStore,
    internalToken,
  })
  const automationScheduler = new AutomationScheduler({
    store: automationStore,
    executor: automationExecutor,
    commanderStore: commanderSessionStore,
    questEventBus,
  })
  const automationSchedulerInitialized = automationScheduler.initialize()
  void automationSchedulerInitialized.catch((error) => {
    console.error('[automations] Failed to initialize shared scheduler:', error)
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
    questStore,
    heartbeatBasePath: commanderDataDir,
    memoryBasePath: commanderDataDir,
    automationStore,
    automationScheduler,
    automationSchedulerInitialized,
    channelReplyDispatchers: createChannelReplyDispatchers(),
    emailConfigStore,
    emailStateStore,
    emailPoller,
  })
  const channels = createCommanderChannelsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
    sessionStore: commanderSessionStore,
  })

  if (parseEnabledFlag(process.env.COMMANDER_EMAIL_POLL_ENABLED)) {
    let emailPollInFlight: Promise<void> | null = null
    automationScheduler.registerInternalSchedule(
      'commander-email-poll',
      process.env.COMMANDER_EMAIL_POLL_CRON?.trim() || COMMANDER_EMAIL_POLL_CRON,
      () => {
        if (emailPollInFlight) {
          return
        }
        emailPollInFlight = emailPoller.pollAll()
          .catch((error) => {
            console.error('[commanders] Failed commander email poll:', error)
          })
          .finally(() => {
            emailPollInFlight = null
          })
      },
    )
  }

  automationScheduler.registerInternalSchedule(
    'commander-transcript-maintenance',
    process.env.COMMANDER_TRANSCRIPT_MAINTENANCE_CRON?.trim() || COMMANDER_TRANSCRIPT_MAINTENANCE_CRON,
    async () => {
      const commanderIds = (await commanderSessionStore.list()).map((session) => session.id)
      for (const commanderId of commanderIds) {
        await maintainCommanderTranscriptIndex(commanderId, { basePath: commanderDataDir }).catch((error) => {
          console.error(`[commanders] Failed transcript maintenance for ${commanderId}:`, error)
        })
      }
    },
  )

  const automations = createAutomationsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    store: automationStore,
    executor: automationExecutor,
    scheduler: automationScheduler,
    schedulerInitialized: automationSchedulerInitialized,
    commanderStore: commanderSessionStore,
    internalToken,
    monitorOptions: commandRoomMonitorOptions,
  })
  const operators = createOperatorsRouter({
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
  })
  const org = createOrgRouter({
    sessionStore: commanderSessionStore,
    automationStore,
    conversationStore: commanderConversationStore,
    questStore,
    commanderDataDir,
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
  })

  const services = createServicesRouter({
    apiKeyStore: options.apiKeyStore,
  })
  const settings = createSettingsRouter({
    store: options.appSettingsStore,
    apiKeyStore: options.apiKeyStore,
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    internalToken,
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

  // Telemetry router + shared hub
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
      name: 'providers',
      label: 'Provider Registry',
      routePrefix: '/api',
      router: createProviderRegistryRouter({
        apiKeyStore: options.apiKeyStore,
        auth0Domain: options.auth0Domain,
        auth0Audience: options.auth0Audience,
        auth0ClientId: options.auth0ClientId,
        internalToken,
      }),
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
      name: 'channels',
      label: 'Channels',
      routePrefix: '/api/commanders',
      router: channels,
    },
    {
      name: 'conversations',
      label: 'Conversations',
      routePrefix: '/api/conversations',
      router: commanders.conversationRouter,
    },
    {
      name: 'operators',
      label: 'Operators',
      routePrefix: '/api/operators',
      router: operators,
    },
    {
      name: 'org',
      label: 'Org Chart',
      routePrefix: '/api/org',
      router: org,
    },
    {
      name: 'settings',
      label: 'App Settings',
      routePrefix: '/api/settings',
      router: settings,
    },
    {
      name: 'automations',
      label: 'Automations',
      routePrefix: '/api/automations',
      router: automations.router,
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
