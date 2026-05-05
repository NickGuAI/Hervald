import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { type Request, type Response as ExpressResponse } from 'express'
import { combinedAuth } from '../../../server/middleware/combined-auth.js'
import type { CommanderSessionsInterface } from '../../agents/routes.js'
import { AutomationStore } from '../../automations/store.js'
import { resolveModuleDataDir } from '../../data-dir.js'
import {
  resolveWorkspaceRoot,
  toWorkspaceError,
  WorkspaceError,
} from '../../workspace/index.js'
import {
  buildFatHeartbeatMessage as appendHeartbeatChecklist,
  chooseHeartbeatMode,
  resolveFatPinInterval,
} from '../choose-heartbeat-mode.js'
import {
  profileForApiResponse,
  readCommanderUiProfile,
  resolveCommanderAvatarPath,
} from '../commander-profile.js'
import {
  migrateLegacyCommanderConfig,
} from '../config-migration.js'
import {
  CommanderEmailConfigStore,
  CommanderEmailStateStore,
} from '../email-config.js'
import { EmailPoller } from '../email-poller.js'
import {
  CommanderHeartbeatManager,
  createDefaultHeartbeatConfig,
  type CommanderHeartbeatConfig,
} from '../heartbeat.js'
import { HeartbeatLog, type HeartbeatLogAppendInput } from '../heartbeat-log.js'
import { CommanderManager, type CommanderSubagentLifecycleEvent } from '../manager.js'
import { ConversationStore, type Conversation } from '../conversation-store.js'
import {
  resolveCommanderDataDir,
} from '../paths.js'
import { QuestStore, type CommanderQuest } from '../quest-store.js'
import { resolveGitHubToken } from '../github-http.js'
import {
  parseBearerToken,
  parseContextPressureInputTokenThreshold,
  parseMessage,
  parseSessionId,
} from '../route-parsers.js'
import {
  buildDefaultCommanderConversationId,
  CommanderSessionStore,
  type CommanderChannelMeta,
  type CommanderCurrentTask,
  type CommanderLastRoute,
  type CommanderSession,
  type CommanderTaskSource,
} from '../store.js'
import { GhTasks } from '../tools/gh-tasks.js'
import {
  defaultCommanderRuntimeConfigPath,
  loadCommanderRuntimeConfig,
} from '../runtime-config.js'
import {
  BASE_SYSTEM_PROMPT,
  resolveCommanderWorkflow,
  resolveEffectiveBasePrompt,
} from '../workflow-resolution.js'
import type {
  CommanderChannelReplyDispatchInput,
  CommanderRoutesContext,
  CommanderRuntime,
  CommanderConversationRuntimeView,
  CommanderSessionResponse,
  CommanderSessionStats,
  CommanderSubAgentEntry,
  CommandersRouterOptions,
  ContextPressureBridge,
  StreamEvent,
} from './types.js'

const STARTUP_PROMPT = 'Commander runtime started. Acknowledge readiness and await instructions.'
const COMMANDER_SESSION_NAME_PREFIX = 'commander-'
const COLLECT_MODE_DEBOUNCE_MS = 1_000

export { BASE_SYSTEM_PROMPT, STARTUP_PROMPT }

export function toCommanderSessionName(commanderId: string): string {
  return `${COMMANDER_SESSION_NAME_PREFIX}${commanderId}`
}

export function buildConversationSessionName(
  conversation: Pick<Conversation, 'commanderId' | 'id'>,
): string {
  return `${toCommanderSessionName(conversation.commanderId)}-conversation-${conversation.id}`
}

function defaultAgentsSessionStorePath(): string {
  return path.join(resolveModuleDataDir('agents'), 'stream-sessions.json')
}

function normalizeQueuedInternalUserMessage(message: string): string | null {
  const normalized = message.trim()
  return normalized.length > 0 ? normalized : null
}

function isMissingOperatorsStoreError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('operators.json')
    && (
      error.message.includes('ENOENT')
      || error.message.includes('Founder operator')
    )
}

export function queueInternalUserMessage(
  runtime: CommanderRuntime | undefined,
  message: string,
): void {
  const normalized = normalizeQueuedInternalUserMessage(message)
  if (!runtime || !normalized) {
    return
  }
  runtime.pendingInternalUserMessages.set(
    normalized,
    (runtime.pendingInternalUserMessages.get(normalized) ?? 0) + 1,
  )
}

export function consumeInternalUserMessage(
  runtime: CommanderRuntime | undefined,
  message: string,
): boolean {
  const normalized = normalizeQueuedInternalUserMessage(message)
  if (!runtime || !normalized) {
    return false
  }

  const count = runtime.pendingInternalUserMessages.get(normalized) ?? 0
  if (count <= 0) {
    return false
  }

  if (count === 1) {
    runtime.pendingInternalUserMessages.delete(normalized)
  } else {
    runtime.pendingInternalUserMessages.set(normalized, count - 1)
  }
  return true
}

export async function sendQueuedInternalUserMessage(
  runtime: CommanderRuntime | undefined,
  sessionsInterface: CommanderSessionsInterface,
  sessionName: string,
  message: string,
  options: {
    queue?: boolean
    priority?: 'high' | 'normal' | 'low'
  },
): Promise<boolean> {
  const sent = await sessionsInterface.sendToSession(sessionName, message, options)
  if (sent) {
    queueInternalUserMessage(runtime, message)
  }
  return sent
}

function parsePersistedCommanderSessionNames(value: unknown): Set<string> {
  const parsed = new Set<string>()
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    return parsed
  }

  for (const entry of (value as { sessions: unknown[] }).sessions) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const name = (entry as { name?: unknown }).name
    const sessionType = (entry as { sessionType?: unknown }).sessionType
    const creator = (entry as { creator?: unknown }).creator
    const creatorKind = typeof creator === 'object' && creator !== null
      ? (creator as { kind?: unknown }).kind
      : undefined
    if (
      typeof name !== 'string' ||
      sessionType !== 'commander' ||
      creatorKind !== 'commander'
    ) {
      continue
    }
    parsed.add(name)
  }

  return parsed
}

async function readPersistedCommanderSessionNames(
  sessionStorePath: string,
): Promise<{ names: Set<string>; parseFailed: boolean }> {
  let raw: string
  try {
    raw = await readFile(sessionStorePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { names: new Set<string>(), parseFailed: false }
    }
    throw error
  }

  try {
    return {
      names: parsePersistedCommanderSessionNames(JSON.parse(raw) as unknown),
      parseFailed: false,
    }
  } catch {
    return { names: new Set<string>(), parseFailed: true }
  }
}

export function resolveEffectiveHeartbeat(
  commander: Pick<CommanderSession, 'heartbeat'>,
): CommanderHeartbeatConfig {
  return { ...commander.heartbeat }
}

export function isContextPressureSubtypeEvent(event: StreamEvent): boolean {
  const type = typeof event.type === 'string' ? event.type : ''
  const subtype = typeof event.subtype === 'string' ? event.subtype : ''
  return type === 'context_pressure' || subtype === 'context_pressure'
}

function isUsageBearingContextPressureEvent(event: StreamEvent): boolean {
  const type = typeof event.type === 'string' ? event.type : ''
  return type === 'message_delta' || type === 'result'
}

export function isInputTokenContextPressureEvent(
  event: StreamEvent,
  sessionInputTokens: number,
  threshold: number,
): boolean {
  if (!isUsageBearingContextPressureEvent(event)) {
    return false
  }

  return Number.isFinite(sessionInputTokens) && sessionInputTokens >= threshold
}

export function toSessionRepo(session: CommanderSession | null | undefined): string | null {
  if (!session?.taskSource) return null
  const owner = session.taskSource.owner?.trim()
  const repo = session.taskSource.repo?.trim()
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

export function listSubAgentEntries(runtime: CommanderRuntime | undefined): CommanderSubAgentEntry[] {
  if (!runtime) {
    return []
  }
  return [...runtime.subAgents.values()]
    .sort((left, right) => left.dispatchedAt.localeCompare(right.dispatchedAt))
}

function consumeCompletedSubAgentEntries(runtime: CommanderRuntime): CommanderSubAgentEntry[] {
  const completed: CommanderSubAgentEntry[] = []
  for (const [sessionId, entry] of runtime.subAgents.entries()) {
    if (entry.state !== 'completed') {
      continue
    }
    completed.push(entry)
    runtime.subAgents.delete(sessionId)
  }
  completed.sort((left, right) => left.dispatchedAt.localeCompare(right.dispatchedAt))
  return completed
}

function formatSubAgentResultsSection(completedEntries: CommanderSubAgentEntry[]): string | null {
  if (completedEntries.length === 0) {
    return null
  }

  return [
    '[SUB-AGENT RESULTS]',
    ...completedEntries.map((entry, index) => {
      const summary = entry.result?.trim() || 'No sub-agent summary provided.'
      return `${index + 1}. ${entry.sessionId}: ${summary}`
    }),
  ].join('\n')
}

type HeartbeatLogTaskSnapshot = {
  questCount: number
  claimedQuestId?: string
  claimedQuestInstruction?: string
}

function defaultCommanderRuntimeView(): CommanderConversationRuntimeView {
  return {
    heartbeat: createDefaultHeartbeatConfig(),
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    currentTask: null,
    completedTasks: 0,
    totalCostUsd: 0,
  }
}

async function resolveDefaultConversationForCommander(
  commanderId: string,
  conversationStore: ConversationStore,
): Promise<Conversation | null> {
  return conversationStore.get(buildDefaultCommanderConversationId(commanderId))
}

function latestIsoTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (!value) {
      continue
    }
    if (!latest || value > latest) {
      latest = value
    }
  }
  return latest
}

function getConversationActivityTimestamp(conversation: Conversation): string {
  return latestIsoTimestamp([
    conversation.lastMessageAt,
    conversation.createdAt,
  ]) ?? conversation.createdAt
}

function getConversationHeartbeatTimestamp(conversation: Conversation): string | null {
  return latestIsoTimestamp([
    conversation.lastHeartbeat,
  ])
}

function conversationStatusPriority(status: Conversation['status']): number {
  switch (status) {
    case 'active':
      return 0
    case 'idle':
      return 1
    case 'archived':
      return 2
  }
}

function compareConversationPriority(left: Conversation, right: Conversation): number {
  const statusDelta = conversationStatusPriority(left.status) - conversationStatusPriority(right.status)
  if (statusDelta !== 0) {
    return statusDelta
  }
  return getConversationActivityTimestamp(right).localeCompare(getConversationActivityTimestamp(left))
}

function selectPrimaryConversationForCommander(
  conversations: readonly Conversation[],
): Conversation | null {
  return [...conversations].sort(compareConversationPriority)[0] ?? null
}

function selectMostRecentActiveConversationForCommander(
  conversations: readonly Conversation[],
): Conversation | null {
  const active = conversations
    .filter((conversation) => conversation.status === 'active')
    .sort((left, right) =>
      getConversationActivityTimestamp(right).localeCompare(getConversationActivityTimestamp(left)),
    )
  return active[0] ?? null
}

async function resolveHeartbeatConversationForCommander(
  commanderId: string,
  conversationStore: ConversationStore,
  conversationId?: string,
): Promise<Conversation | null> {
  if (conversationId) {
    const conversation = await conversationStore.get(conversationId)
    return conversation?.commanderId === commanderId
      ? conversation
      : null
  }

  const conversations = await conversationStore.listByCommander(commanderId)
  return selectMostRecentActiveConversationForCommander(conversations)
}

async function resolveCommanderRuntimeViewForCommander(
  commanderId: string,
  conversationStore: ConversationStore,
): Promise<CommanderConversationRuntimeView> {
  const conversations = await conversationStore.listByCommander(commanderId)
  if (conversations.length === 0) {
    return defaultCommanderRuntimeView()
  }

  const primary = selectPrimaryConversationForCommander(conversations)

  if (!primary) {
    return defaultCommanderRuntimeView()
  }

  const totalCostUsd = conversations.reduce((sum, conversation) => sum + conversation.totalCostUsd, 0)
  const completedTasks = conversations.reduce((sum, conversation) => sum + conversation.completedTasks, 0)
  const heartbeatTickCount = conversations.reduce((sum, conversation) => sum + conversation.heartbeatTickCount, 0)
  const lastHeartbeat = latestIsoTimestamp(
    conversations.map((conversation) => getConversationHeartbeatTimestamp(conversation)),
  )

  return {
    heartbeat: createDefaultHeartbeatConfig(),
    lastHeartbeat,
    heartbeatTickCount,
    currentTask: primary.currentTask ? { ...primary.currentTask } : null,
    completedTasks,
    totalCostUsd,
    channelMeta: primary.channelMeta ? { ...primary.channelMeta } : undefined,
    lastRoute: primary.lastRoute ? { ...primary.lastRoute } : undefined,
    providerContext: primary.providerContext ? { ...primary.providerContext } : undefined,
  }
}

async function resolveLatestChannelConversationForCommander(
  commanderId: string,
  conversationStore: ConversationStore,
): Promise<Conversation | null> {
  const conversations = await conversationStore.listByCommander(commanderId)
  const channelConversations = conversations
    .filter((conversation) => conversation.channelMeta && conversation.lastRoute)
    .sort((left, right) => {
      const byLastMessage = right.lastMessageAt.localeCompare(left.lastMessageAt)
      if (byLastMessage !== 0) {
        return byLastMessage
      }
      return right.createdAt.localeCompare(left.createdAt)
    })

  return channelConversations[0] ?? null
}

async function ensureDefaultConversationForCommander(
  session: CommanderSession,
  conversationStore: ConversationStore,
  options: {
    surface?: Conversation['surface']
    currentTask?: CommanderCurrentTask | null
  } = {},
): Promise<Conversation> {
  return conversationStore.ensureDefaultConversation({
    commanderId: session.id,
    surface: options.surface,
    createdAt: session.created,
    currentTask: options.currentTask,
  })
}

async function buildHeartbeatLogTaskSnapshot(
  commanderId: string,
  runtimeView: CommanderConversationRuntimeView,
  questStore: QuestStore,
): Promise<HeartbeatLogTaskSnapshot> {
  try {
    const quests = await questStore.list(commanderId)
    const openQuests = quests.filter((quest) => quest.status === 'pending' || quest.status === 'active')
    const activeQuest = openQuests.find((quest) => quest.status === 'active')

    if (activeQuest) {
      return {
        questCount: openQuests.length,
        claimedQuestId: activeQuest.id,
        claimedQuestInstruction: activeQuest.instruction,
      }
    }

    return { questCount: openQuests.length }
  } catch (error) {
    console.error(
      `[commanders] Failed to resolve heartbeat quest snapshot for "${commanderId}":`,
      error,
    )

    const claimedTask = runtimeView.currentTask
    if (!claimedTask) {
      return { questCount: 0 }
    }

    return {
      questCount: 1,
      claimedQuestId: String(claimedTask.issueNumber),
      claimedQuestInstruction: `Issue #${claimedTask.issueNumber}`,
    }
  }
}

export function resolveCommanderAgentType(
  session: Pick<CommanderSession, 'agentType'>,
): NonNullable<CommanderSession['agentType']> {
  return session.agentType ?? 'claude'
}

export async function toCommanderSessionResponse(
  session: CommanderSession,
  conversationStore: ConversationStore,
  runtime?: CommanderRuntime | undefined,
  stats: CommanderSessionStats = { questCount: 0, scheduleCount: 0 },
): Promise<CommanderSessionResponse & {
  contextConfig: { fatPinInterval: number }
  runtime: {
    heartbeatCount: number
    terminalState: CommanderRuntime['terminalState']
  }
}> {
  const normalizedAgentType = resolveCommanderAgentType(session)
  const runtimeView = await resolveCommanderRuntimeViewForCommander(session.id, conversationStore)
  const base = session.remoteOrigin
    ? {
        ...session,
        ...runtimeView,
        heartbeat: { ...session.heartbeat },
        name: session.host,
        agentType: normalizedAgentType,
        remoteOrigin: {
          machineId: session.remoteOrigin.machineId,
          label: session.remoteOrigin.label,
        },
      }
    : {
        ...session,
        ...runtimeView,
        heartbeat: { ...session.heartbeat },
        name: session.host,
        agentType: normalizedAgentType,
      }

  return {
    ...base,
    name: session.host,
    questCount: stats.questCount,
    scheduleCount: stats.scheduleCount,
    contextConfig: {
      fatPinInterval: resolveFatPinInterval(session.contextConfig?.fatPinInterval),
    },
    runtime: {
      heartbeatCount: runtime?.heartbeatCount ?? runtimeView.heartbeatTickCount ?? 0,
      terminalState: runtime?.terminalState ?? null,
    },
  }
}

export function createContextPressureBridge(): ContextPressureBridge {
  const handlers = new Set<() => Promise<void> | void>()
  return {
    onContextPressure(handler: () => Promise<void> | void): void {
      handlers.add(handler)
    },
    async trigger(): Promise<void> {
      for (const handler of handlers) {
        await handler()
      }
    },
  }
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    if (allowed.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'))
    }
  },
})

export function buildQuestInstructionFromGitHubIssue(issue: { title: string; body: string }): string {
  const title = issue.title.trim()
  const body = issue.body.trim()
  if (title && body) {
    return `${title}\n\n${body}`
  }
  return title || body || 'Review and execute the linked GitHub issue.'
}

export function summarizeQuestInstruction(instruction: string): string {
  const firstLine = instruction
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return firstLine ?? instruction
}

function formatPendingQuestsSummary(pendingQuests: CommanderQuest[]): string | null {
  if (pendingQuests.length === 0) {
    return null
  }

  return [
    '[QUEST BOARD] Top pending quests:',
    ...pendingQuests.slice(0, 3).map((quest, index) => `${index + 1}. ${summarizeQuestInstruction(quest.instruction)}`),
  ].join('\n')
}

function normalizeEventErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((entry) => parseMessage(entry))
    .filter((entry): entry is string => entry !== null)
}

export function resolveCommanderTerminalState(
  event: StreamEvent,
): CommanderRuntime['terminalState'] {
  if (event.type !== 'result') {
    return null
  }

  const subtype = parseMessage(event.subtype) ?? undefined
  const terminalReason = parseMessage(event.terminal_reason ?? event.terminalReason) ?? undefined
  const message = parseMessage(event.result ?? event.text)
    ?? 'Commander session ended.'
  const errors = normalizeEventErrors(event.errors)
  const reachedMaxTurns = (
    subtype === 'error_max_turns'
    || terminalReason === 'max_turns'
    || /maximum number of turns/i.test(message)
    || errors.some((entry) => /maximum number of turns/i.test(entry))
  )

  if (!reachedMaxTurns) {
    return null
  }

  return {
    kind: 'max_turns',
    subtype,
    terminalReason,
    message,
    errors,
  }
}

export function buildCommandersContext(
  options: CommandersRouterOptions = {},
): CommanderRoutesContext {
  const commanderDataDir = options.sessionStorePath
    ? path.dirname(path.resolve(options.sessionStorePath))
    : resolveCommanderDataDir()
  const commanderBasePath = options.memoryBasePath ?? commanderDataDir
  const now = options.now ?? (() => new Date())
  const contextPressureInputTokenThreshold = parseContextPressureInputTokenThreshold(
    options.contextPressureInputTokenThreshold,
  )
  const fetchImpl = options.fetchImpl ?? fetch
  const githubToken = resolveGitHubToken(options.githubToken)
  const runtimeConfigPath = options.runtimeConfigPath
    ?? defaultCommanderRuntimeConfigPath()
  const runtimeConfig = options.runtimeConfig ?? loadCommanderRuntimeConfig({
    filePath: runtimeConfigPath,
  })
  const conversationStore = options.conversationStore
    ?? new ConversationStore(commanderDataDir)
  const sessionStore = options.sessionStore
    ?? new CommanderSessionStore(options.sessionStorePath, { runtimeConfig })
  const emailStoresDataDir = parseMessage(options.memoryBasePath)
    ?? parseMessage(options.heartbeatBasePath)
    ?? commanderDataDir
  const questStore = options.questStore ?? (
    options.questStoreDataDir
      ? new QuestStore(options.questStoreDataDir)
      : options.sessionStorePath
        ? new QuestStore(path.dirname(path.resolve(options.sessionStorePath)))
        : new QuestStore()
  )
  const automationStore = options.automationStore ?? new AutomationStore({
    commanderDataDir,
  })
  const emailConfigStore = options.emailConfigStore ?? new CommanderEmailConfigStore(emailStoresDataDir)
  const emailStateStore = options.emailStateStore ?? new CommanderEmailStateStore(emailStoresDataDir)
  const ghTasksFactory = options.ghTasksFactory ?? ((repo: string) => new GhTasks({ repo }))
  const automationScheduler = options.automationScheduler
  const automationSchedulerInitialized = automationScheduler
    ? (options.automationSchedulerInitialized ?? Promise.resolve())
    : Promise.resolve()
  const sendWorkspaceError = (res: ExpressResponse, error: unknown): void => {
    const workspaceError = toWorkspaceError(error)
    res.status(workspaceError.statusCode).json({ error: workspaceError.message })
  }

  async function resolveCommanderWorkspace(rawCommanderId: unknown) {
    const commanderId = parseSessionId(rawCommanderId)
    if (!commanderId) {
      throw new WorkspaceError(400, 'Invalid commander id')
    }

    const session = await sessionStore.get(commanderId)
    if (!session) {
      throw new WorkspaceError(404, `Commander "${commanderId}" not found`)
    }

    return resolveWorkspaceRoot({
      rootPath: session.cwd,
      source: {
        kind: 'commander',
        id: session.id,
        label: session.host,
        host: session.remoteOrigin?.machineId,
        readOnly: true,
        repo: session.taskSource
          ? {
              owner: session.taskSource.owner,
              repo: session.taskSource.repo,
            }
          : undefined,
      },
    })
  }

  const getCommanderSessionStats = async (commanderId: string): Promise<CommanderSessionStats> => {
    await automationSchedulerInitialized
    const [quests, automations] = await Promise.all([
      questStore.list(commanderId),
      automationStore.list({ parentCommanderId: commanderId }).catch((error) => {
        if (isMissingOperatorsStoreError(error)) {
          return []
        }
        throw error
      }),
    ])
    const scheduleCount = automations.filter((automation) => automation.trigger === 'schedule').length

    return {
      questCount: quests.length,
      scheduleCount,
    }
  }

  const heartbeatDataDir = parseMessage(options.heartbeatBasePath) ?? parseMessage(commanderBasePath)
  const heartbeatLog = options.heartbeatLog ?? new HeartbeatLog(
    heartbeatDataDir ? { dataDir: heartbeatDataDir } : undefined,
  )
  const sessionsInterface = options.sessionsInterface
  const channelReplyDispatchers = options.channelReplyDispatchers ?? {}
  const agentsSessionStorePath = path.resolve(
    options.agentsSessionStorePath ?? defaultAgentsSessionStorePath(),
  )
  const runtimes = new Map<string, CommanderRuntime>()
  const activeCommanderSessions = new Map<string, { sessionName: string; startedAt: string }>()
  const heartbeatFiredAtByConversation = new Map<string, string>()
  const emailReplyService = options.emailPoller ?? (
    sessionsInterface
      ? new EmailPoller({
          sessionStore,
          configStore: emailConfigStore,
          stateStore: emailStateStore,
          sessionsInterface,
          ...(options.emailClient ? { emailClient: options.emailClient } : {}),
          now,
        })
      : null
  )

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  const requireWorkerDispatchAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write', 'commanders:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  const onSubagentLifecycleEvent = (
    commanderId: string,
    event: CommanderSubagentLifecycleEvent,
  ): void => {
    const runtime = runtimes.get(commanderId)
    if (!runtime) {
      return
    }

    const existing = runtime.subAgents.get(event.sessionId)
    runtime.subAgents.set(event.sessionId, {
      sessionId: event.sessionId,
      dispatchedAt: existing?.dispatchedAt ?? event.dispatchedAt,
      state: event.state,
      result: event.result?.trim() || existing?.result,
    })

  }

  let commanderConfigMigrationPromise: Promise<void> | null = null

  const migrateCommanderConfigSource = async (_commanderId: string): Promise<void> => {
    await migrateAllCommanderConfigSources()
  }

  const migrateAllCommanderConfigSources = async (): Promise<void> => {
    commanderConfigMigrationPromise ??= migrateLegacyCommanderConfig(sessionStore, {
      commanderBasePath,
    }).then(() => undefined)

    await commanderConfigMigrationPromise
  }

  const scheduleCollectSend = (commanderId: string, runtime: CommanderRuntime): void => {
    if (runtime.collectTimer) {
      clearTimeout(runtime.collectTimer)
    }

    runtime.collectTimer = setTimeout(() => {
      void (async () => {
        runtime.collectTimer = null
        const merged = runtime.pendingCollect.splice(0).join('\n\n').trim()
        if (!merged || !sessionsInterface) {
          return
        }

        if (runtimes.get(commanderId) !== runtime) {
          return
        }

        const sessionName = activeCommanderSessions.get(commanderId)?.sessionName
          ?? toCommanderSessionName(commanderId)
        const sent = await sessionsInterface.sendToSession(sessionName, merged, {
          queue: true,
          priority: 'normal',
        })
        if (!sent) {
          if (
            runtimes.get(commanderId) === runtime
            && sessionsInterface.getSession(sessionName)
          ) {
            runtime.pendingCollect.unshift(merged)
            scheduleCollectSend(commanderId, runtime)
            console.warn(`[commanders] Collect mode send failed for "${commanderId}" (retry scheduled).`)
            return
          }
          console.warn(`[commanders] Collect mode send failed for "${commanderId}" (session unavailable).`)
        }
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[commanders] Collect mode send failed for "${commanderId}": ${message}`)
      })
    }, COLLECT_MODE_DEBOUNCE_MS)
  }

  const remoteSyncSharedSecret = parseMessage(
    options.remoteSyncSharedSecret ?? process.env.COMMANDER_REMOTE_SYNC_SHARED_SECRET,
  )

  const authorizeRemoteSync = (
    req: Request,
    session: CommanderSession,
  ): { ok: true } | { ok: false; status: number; error: string } => {
    const bearerToken = parseBearerToken(req)
    if (!bearerToken) {
      return {
        ok: false,
        status: 401,
        error: 'Bearer token is required',
      }
    }

    if (remoteSyncSharedSecret && bearerToken === remoteSyncSharedSecret) {
      return { ok: true }
    }

    if (session.remoteOrigin?.syncToken && bearerToken === session.remoteOrigin.syncToken) {
      return { ok: true }
    }

    return {
      ok: false,
      status: 403,
      error: 'Invalid sync token',
    }
  }

  const heartbeatManager = new CommanderHeartbeatManager({
    now,
    sendHeartbeat: async ({ commanderId, conversationId, renderedMessage, timestamp }) => {
      const appendHeartbeatLog = async (
        input: HeartbeatLogAppendInput,
        label: string,
      ): Promise<void> => {
        try {
          await heartbeatLog.append(commanderId, input)
        } catch (appendError) {
          console.error(
            `[commanders] Failed to append heartbeat log (${label}) for "${commanderId}":`,
            appendError,
          )
        }
      }

      heartbeatFiredAtByConversation.set(conversationId, timestamp)
      const session = await sessionStore.get(commanderId)
      if (!session) return false  // commander deleted — valid stop
      const conversation = await conversationStore.get(conversationId)
      if (!conversation || conversation.commanderId !== commanderId) {
        heartbeatFiredAtByConversation.delete(conversationId)
        return false
      }
      const runtimeView = await resolveCommanderRuntimeViewForCommander(commanderId, conversationStore)
      const taskSnapshot = await buildHeartbeatLogTaskSnapshot(commanderId, runtimeView, questStore)
      if (session.state !== 'running') {
        if (session.state === 'idle') {
          // Idle commanders can be resumed without recreating the loop.
          await appendHeartbeatLog(
            {
              firedAt: timestamp,
              ...taskSnapshot,
              outcome: 'skipped',
              errorMessage: 'Commander idle — heartbeat skipped, loop alive',
            },
            'commander-idle',
          )
          heartbeatFiredAtByConversation.delete(conversationId)
          return true
        }

        await appendHeartbeatLog(
          {
            firedAt: timestamp,
            ...taskSnapshot,
            outcome: 'error',
            errorMessage: 'Commander session was not running when heartbeat fired',
          },
          'commander-not-running',
        )
        heartbeatFiredAtByConversation.delete(conversationId)
        return false
      }

      if (!sessionsInterface) {
        await appendHeartbeatLog(
          {
            firedAt: timestamp,
            ...taskSnapshot,
            outcome: 'error',
            errorMessage: 'sessionsInterface not configured',
          },
          'no-sessions-interface',
        )
        heartbeatFiredAtByConversation.delete(conversationId)
        return false
      }

      const sessionName = buildConversationSessionName({
        commanderId,
        id: conversationId,
      })
      const activeAgentSession = sessionsInterface.getSession(sessionName)
      const runtime = runtimes.get(commanderId)
      const heartbeatModeRuntime = {
        heartbeatCount: conversation.heartbeatTickCount,
        forceNextFatHeartbeat: runtime?.forceNextFatHeartbeat ?? false,
      }
      let heartbeatMessage: string

      const buildFatHeartbeatMessage = async (
        commanderBody: string,
        completedSubAgentEntries: CommanderSubAgentEntry[],
      ): Promise<string> => {
        const pendingQuests = await questStore.listPending(commanderId, 3)
        const pendingQuestsSummary = formatPendingQuestsSummary(pendingQuests)
        const subAgentResultsSection = formatSubAgentResultsSection(completedSubAgentEntries)
        return [commanderBody.trim(), pendingQuestsSummary, renderedMessage.trim(), subAgentResultsSection]
          .filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
          .join('\n\n')
      }

      if (runtime) {
        const heartbeatMode = chooseHeartbeatMode(heartbeatModeRuntime, session, activeAgentSession)

        if (heartbeatMode === 'fat') {
          const workflow = await resolveCommanderWorkflow(
            commanderId,
            session.cwd,
            commanderBasePath,
          )
          const commanderBody = resolveEffectiveBasePrompt(workflow.workflow)
          const completedSubAgentEntries = consumeCompletedSubAgentEntries(runtime)
          heartbeatMessage = await buildFatHeartbeatMessage(
            commanderBody,
            completedSubAgentEntries,
          )
          const enriched = await appendHeartbeatChecklist(
            heartbeatMessage,
            commanderId,
            commanderBasePath,
          )
          if (enriched) heartbeatMessage = enriched
        } else {
          heartbeatMessage = renderedMessage
        }

        runtime.heartbeatCount += 1
        runtime.forceNextFatHeartbeat = false
        runtime.lastTaskState = heartbeatMessage
      } else {
        const heartbeatMode = chooseHeartbeatMode(
          heartbeatModeRuntime,
          session,
          activeAgentSession,
        )

        if (heartbeatMode === 'fat') {
          const workflow = await resolveCommanderWorkflow(
            commanderId,
            session.cwd,
            commanderBasePath,
          )
          const commanderBody = resolveEffectiveBasePrompt(workflow.workflow)
          heartbeatMessage = await buildFatHeartbeatMessage(commanderBody, [])
          const enriched = await appendHeartbeatChecklist(
            heartbeatMessage,
            commanderId,
            commanderBasePath,
          )
          if (enriched) heartbeatMessage = enriched
        } else {
          heartbeatMessage = renderedMessage
        }
      }

      const sent = await sendQueuedInternalUserMessage(runtime, sessionsInterface, sessionName, heartbeatMessage, {
        queue: true,
        priority: 'low',
      })
      if (!sent) {
        if (sessionsInterface.getSession(sessionName)) {
          await appendHeartbeatLog(
            {
              firedAt: timestamp,
              ...taskSnapshot,
              outcome: 'error',
              errorMessage: 'stream session queue is full',
            },
            'queue-backpressure',
          )
          return 'retryable'
        }
        await appendHeartbeatLog(
          {
            firedAt: timestamp,
            ...taskSnapshot,
            outcome: 'error',
            errorMessage: 'stream session unavailable',
          },
          'session-unavailable',
        )
        heartbeatFiredAtByConversation.delete(conversationId)
        return false
      }

      const outcome = taskSnapshot.questCount > 0 ? 'ok' : 'no-quests'
      await appendHeartbeatLog(
        {
          firedAt: timestamp,
          ...taskSnapshot,
          outcome,
        },
        'heartbeat-success',
      )
      return true
    },
    onHeartbeatSent: async ({ conversationId, timestamp }) => {
      await conversationStore.update(conversationId, (current) => ({
        ...current,
        lastHeartbeat: timestamp,
        heartbeatTickCount: current.heartbeatTickCount + 1,
      }))
      heartbeatFiredAtByConversation.delete(conversationId)
    },
    onHeartbeatError: ({ commanderId, conversationId, error }) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      void (async () => {
        try {
          const runtimeView = await resolveCommanderRuntimeViewForCommander(commanderId, conversationStore)
          const taskSnapshot = await buildHeartbeatLogTaskSnapshot(commanderId, runtimeView, questStore)
          await heartbeatLog.append(commanderId, {
            firedAt: heartbeatFiredAtByConversation.get(conversationId) ?? now().toISOString(),
            ...taskSnapshot,
            outcome: 'error',
            errorMessage,
          })
        } catch (appendError) {
          console.error(
            `[commanders] Failed to append heartbeat error log for "${commanderId}":`,
            appendError,
          )
        } finally {
          heartbeatFiredAtByConversation.delete(conversationId)
        }
      })().catch((appendError) => {
        console.error(
          `[commanders] Failed to append heartbeat error log for "${commanderId}":`,
          appendError,
        )
        heartbeatFiredAtByConversation.delete(conversationId)
      })
    },
  })

  async function reconcileCommanderSessions(): Promise<void> {
    if (!sessionsInterface) {
      return
    }

    const persistedCommanderSessions = await readPersistedCommanderSessionNames(agentsSessionStorePath)
    const allCommanders = await sessionStore.list()
    const runningCommanders = allCommanders.filter((session) => session.state === 'running')
    for (const commander of runningCommanders) {
      const defaultConversation = await ensureDefaultConversationForCommander(
        commander,
        conversationStore,
        { surface: 'ui' },
      )
      const conversations = await conversationStore.listByCommander(commander.id)
      const defaultSessionName = buildConversationSessionName(defaultConversation)
      let hasLiveConversation = false
      activeCommanderSessions.delete(commander.id)
      for (const conversation of conversations) {
        const sessionName = buildConversationSessionName(conversation)
        const liveSession = persistedCommanderSessions.parseFailed
          ? sessionsInterface.getSession(sessionName)
          : persistedCommanderSessions.names.has(sessionName)
            ? sessionsInterface.getSession(sessionName)
            : undefined
        if (!liveSession) {
          continue
        }

        hasLiveConversation = true
        const activeConversation = conversation.status === 'active'
          ? conversation
          : await conversationStore.update(conversation.id, (current) => ({
              ...current,
              status: 'active',
            })) ?? conversation
        if (activeConversation.id === buildDefaultCommanderConversationId(commander.id)) {
          activeCommanderSessions.set(commander.id, {
            sessionName,
            startedAt: liveSession.createdAt ?? commander.created,
          })
        }
        heartbeatManager.start(
          activeConversation.id,
          commander.id,
          resolveEffectiveHeartbeat(commander),
        )
      }

      if (!hasLiveConversation) {
        const liveDefaultSession = persistedCommanderSessions.parseFailed
          ? sessionsInterface.getSession(defaultSessionName)
          : persistedCommanderSessions.names.has(defaultSessionName)
            ? sessionsInterface.getSession(defaultSessionName)
            : undefined
        if (liveDefaultSession) {
          hasLiveConversation = true
          const activeDefaultConversation = defaultConversation.status === 'active'
            ? defaultConversation
            : await conversationStore.update(defaultConversation.id, (current) => ({
                ...current,
                status: 'active',
              })) ?? defaultConversation
          activeCommanderSessions.set(commander.id, {
            sessionName: defaultSessionName,
            startedAt: liveDefaultSession.createdAt ?? commander.created,
          })
          heartbeatManager.start(
            activeDefaultConversation.id,
            commander.id,
            resolveEffectiveHeartbeat(commander),
          )
        }
      }

      if (!hasLiveConversation) {
        await sessionStore.update(commander.id, (current) => ({
          ...current,
          state: 'idle',
        }))
      }
    }
  }

  const dispatchCommanderMessage = async (input: {
    commanderId: string
    message: string
    mode: 'collect' | 'followup'
    session?: CommanderSession
    runtime?: CommanderRuntime
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
    const session = input.session ?? await sessionStore.get(input.commanderId)
    if (!session) {
      return { ok: false, status: 404, error: `Commander "${input.commanderId}" not found` }
    }

    const runtime = input.runtime ?? runtimes.get(input.commanderId)
    if (!runtime || session.state !== 'running') {
      return { ok: false, status: 409, error: `Commander "${input.commanderId}" is not running` }
    }

    runtime.lastTaskState = input.message

    if (!sessionsInterface) {
      return { ok: false, status: 500, error: 'sessionsInterface not configured' }
    }

    const sessionName = activeCommanderSessions.get(input.commanderId)?.sessionName
      ?? toCommanderSessionName(input.commanderId)
    if (input.mode === 'followup') {
      const sent = await sessionsInterface.sendToSession(sessionName, input.message)
      if (!sent) {
        return {
          ok: false,
          status: 409,
          error: `Commander "${input.commanderId}" stream session unavailable`,
        }
      }
    } else {
      runtime.pendingCollect.push(input.message)
      scheduleCollectSend(input.commanderId, runtime)
    }
    return { ok: true }
  }

  const dispatchCommanderChannelReply = async (input: {
    commanderId: string
    message: string
  }): Promise<
    | {
      ok: true
      provider: CommanderChannelMeta['provider']
      sessionKey: string
      lastRoute: CommanderLastRoute
    }
    | { ok: false; status: number; error: string }
  > => {
    const session = await sessionStore.get(input.commanderId)
    if (!session) {
      return { ok: false, status: 404, error: `Commander "${input.commanderId}" not found` }
    }

    const channelConversation = await resolveLatestChannelConversationForCommander(
      input.commanderId,
      conversationStore,
    )
    if (!channelConversation?.channelMeta || !channelConversation.lastRoute) {
      return {
        ok: false,
        status: 409,
        error: `Commander "${input.commanderId}" has no external channel route`,
      }
    }

    const provider = channelConversation.channelMeta.provider
    const dispatcher = channelReplyDispatchers[provider]
    if (!dispatcher) {
      return {
        ok: false,
        status: 501,
        error: `No outbound dispatcher configured for provider "${provider}"`,
      }
    }

    const normalizedLastRoute: CommanderLastRoute = {
      ...channelConversation.lastRoute,
      channel: provider,
    }

    try {
      await dispatcher({
        commanderId: input.commanderId,
        message: input.message,
        channelMeta: {
          ...channelConversation.channelMeta,
        },
        lastRoute: normalizedLastRoute,
      } satisfies CommanderChannelReplyDispatchInput)
    } catch (error) {
      const details = error instanceof Error ? parseMessage(error.message) : null
      return {
        ok: false,
        status: 502,
        error: details ?? `Failed to dispatch outbound ${provider} reply`,
      }
    }

    return {
      ok: true,
      provider,
      sessionKey: channelConversation.channelMeta.sessionKey,
      lastRoute: normalizedLastRoute,
    }
  }

  const attachCommanderPublicUi = async (
    commanderId: string,
    payload: CommanderSessionResponse & {
      contextConfig: { fatPinInterval: number }
      runtime: {
        heartbeatCount: number
        terminalState: CommanderRuntime['terminalState']
      }
    },
  ): Promise<
    CommanderSessionResponse & {
      contextConfig: { fatPinInterval: number }
      runtime: {
        heartbeatCount: number
        terminalState: CommanderRuntime['terminalState']
      }
    }
  > => {
    const profile = await readCommanderUiProfile(commanderId, commanderBasePath)
    const avatarPath = await resolveCommanderAvatarPath(commanderId, commanderBasePath, profile)
    return {
      ...payload,
      ui: profileForApiResponse(profile),
      avatarUrl: avatarPath ? `/api/commanders/${encodeURIComponent(commanderId)}/avatar` : null,
    }
  }

  return {
    now,
    commanderDataDir,
    commanderBasePath,
    contextPressureInputTokenThreshold,
    fetchImpl,
    githubToken,
    runtimeConfig,
    sessionStore,
    conversationStore,
    questStore,
    emailConfigStore,
    emailStateStore,
    emailReplyService,
    ghTasksFactory,
    heartbeatLog,
    sessionsInterface,
    requireReadAccess,
    requireWriteAccess,
    requireWorkerDispatchAccess,
    heartbeatManager,
    runtimes,
    activeCommanderSessions,
    heartbeatFiredAtByConversation,
    avatarUpload,
    automationStore,
    automationScheduler,
    automationSchedulerInitialized,
    sendWorkspaceError,
    resolveCommanderWorkspace,
    getCommanderSessionStats,
    onSubagentLifecycleEvent,
    authorizeRemoteSync,
    dispatchCommanderMessage,
    dispatchCommanderChannelReply,
    attachCommanderPublicUi,
    resolveDefaultConversation: (commanderId: string) =>
      resolveDefaultConversationForCommander(commanderId, conversationStore),
    resolveHeartbeatConversation: (
      commanderId: string,
      conversationId?: string,
    ) => resolveHeartbeatConversationForCommander(commanderId, conversationStore, conversationId),
    resolveCommanderRuntimeView: (commanderId: string) =>
      resolveCommanderRuntimeViewForCommander(commanderId, conversationStore),
    ensureDefaultConversation: (
      session: CommanderSession,
      options,
    ) => ensureDefaultConversationForCommander(session, conversationStore, options),
    migrateCommanderConfigSource,
    migrateLegacyCommanderConfig: migrateAllCommanderConfigSources,
    reconcileCommanderSessions,
  }
}
