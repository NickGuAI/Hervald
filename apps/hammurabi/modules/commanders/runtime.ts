import {
  resolveCommanderDataDir,
  resolveCommanderSessionStorePath,
} from './paths.js'
import { QuestStore } from './quest-store.js'
import { createCommandersRouter } from './routes.js'
import { CommanderSessionStore } from './store.js'
import { ConversationStore } from './conversation-store.js'
import {
  buildCommanderSessionSeed,
  type CommanderSessionSeedParams,
} from './memory/module.js'
import { createCommanderTranscriptAppender } from './transcripts.js'
import type {
  ModuleRouteRegistration,
  ModuleRuntimeContext,
} from '../../server/module-runtime.js'

export function createCommandersFoundation(context: ModuleRuntimeContext): null {
  const { capabilities } = context
  const commanderDataDir = resolveCommanderDataDir()
  const questStore = new QuestStore({
    dataDir: commanderDataDir,
    eventBus: capabilities.consume('automations.quest-event-bus', 'commanders'),
  })
  const commanderSessionStorePath = resolveCommanderSessionStorePath(commanderDataDir)
  const commanderConversationStore = new ConversationStore(commanderDataDir)
  const commanderSessionStore = new CommanderSessionStore(commanderSessionStorePath)

  capabilities.provide('commanders.data-dir', 'commanders', commanderDataDir)
  capabilities.provide('commanders.quest-store', 'commanders', questStore)
  capabilities.provide('commanders.store', 'commanders', commanderSessionStore)
  capabilities.provide('commanders.conversations', 'commanders', commanderConversationStore)
  capabilities.provide(
    'commanders.session-seed-builder',
    'commanders',
    (params: Omit<CommanderSessionSeedParams, 'memoryBasePath'>) =>
      buildCommanderSessionSeed({ ...params, memoryBasePath: commanderDataDir }),
  )
  capabilities.provide('commanders.transcripts', 'commanders', createCommanderTranscriptAppender(commanderDataDir))

  return null
}

export function createCommandersRuntime(context: ModuleRuntimeContext): ModuleRouteRegistration {
  const { capabilities, internalToken, options } = context
  const commanderDataDir = capabilities.consume('commanders.data-dir', 'commanders')
  const commanderSessionStorePath = resolveCommanderSessionStorePath(commanderDataDir)

  const commanders = createCommandersRouter({
    apiKeyStore: options.apiKeyStore,
    providerSecretsStore: capabilities.consume('provider-secrets-store', 'commanders'),
    auth0Domain: options.auth0Domain,
    auth0Audience: options.auth0Audience,
    auth0ClientId: options.auth0ClientId,
    sessionsInterface: capabilities.consume('agents.sessions-interface', 'commanders'),
    conversationSessionWebSocket: capabilities.consume('agents.session-websocket', 'commanders'),
    sessionStore: capabilities.consume('commanders.store', 'commanders'),
    sessionStorePath: commanderSessionStorePath,
    conversationStore: capabilities.consume('commanders.conversations', 'commanders'),
    channelBindingStore: capabilities.consume('channels.bindings', 'commanders'),
    actionPolicyGate: capabilities.consume('policies.action-gate', 'commanders'),
    getWorkspaceResolver: () => capabilities.consume('workspace.resolver', 'commanders'),
    questStore: capabilities.consume('commanders.quest-store', 'commanders'),
    heartbeatBasePath: commanderDataDir,
    memoryBasePath: commanderDataDir,
    automationStore: capabilities.consume('automations.store', 'commanders'),
    automationScheduler: capabilities.consume('automations.scheduler', 'commanders'),
    automationSchedulerInitialized: capabilities.consume('automations.scheduler-initialized', 'commanders'),
    internalToken,
  })

  capabilities.provide('commanders.runtime', 'commanders', commanders)

  return {
    name: 'commanders',
    routeIds: ['commanders.api', 'commanders.quests-api'],
    router: commanders.router,
    shutdown: commanders.dispose,
  }
}
