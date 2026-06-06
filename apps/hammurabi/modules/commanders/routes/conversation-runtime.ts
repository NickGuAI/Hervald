import { isDeepStrictEqual } from 'node:util'
import {
  buildCommanderSessionSeedFromResolvedWorkflow,
} from '../memory/module.js'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { ClaudeMaxThinkingTokens } from '../../claude-max-thinking-tokens.js'
import type { AgentType, StreamJsonEvent, StreamSession } from '../../agents/types.js'
import type { QueuedMessageImage } from '../../agents/message-queue.js'
import { mapStreamEventsToMessages } from '../../agents/messages/history.js'
import type { MsgItem } from '../../agents/messages/model.js'
import { readTranscriptTailPage } from '../../agents/transcript-store.js'
import { STARTUP_PROMPT } from './context.js'
import type { CommanderSession } from '../store.js'
import { resolveCommanderWorkflow } from '../workflow-resolution.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderRoutesContext } from './types.js'
import { sanitizeProviderContextForPersistence } from '../../agents/providers/provider-context-migration.js'
import { asClaudeProviderContext } from '../../agents/providers/provider-session-context.js'
import { getProvider } from '../../agents/providers/registry.js'
import { resolveProviderDefaults } from '../../agents/providers/provider-adapter.js'
import { appendClaudeReasoningPolicy } from '../../agents/adapters/claude/reasoning-policy.js'

export function buildConversationSessionName(conversation: Conversation): string {
  return `commander-${conversation.commanderId}-conversation-${conversation.id}`
}

export function getLiveConversationSession(
  context: CommanderRoutesContext,
  conversation: Conversation,
) {
  return context.sessionsInterface?.getSession(buildConversationSessionName(conversation))
}

const DEFAULT_CONVERSATION_MESSAGES_LIMIT = 10
const MAX_CONVERSATION_MESSAGES_LIMIT = 50
const DEFAULT_TRANSCRIPT_TAIL_EVENT_LIMIT = 500
const MAX_TRANSCRIPT_TAIL_EVENT_LIMIT = 5_000
const MAX_TRANSCRIPT_TAIL_READ_ATTEMPTS = 5
const DEEP_THINKING_RESEARCH_ROLES = ['context-research', 'risk-research'] as const
const DEEP_THINKING_THINKING_ROLES = ['inversion-thinking', 'synthesis-thinking', 'operational-thinking'] as const
const DEFAULT_DEEP_THINKING_WORKER_WAIT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_DEEP_THINKING_WORKER_POLL_MS = 1000
const DEFAULT_DEEP_THINKING_OPERATION_SCHEDULE_DELAY_MS = 0
/**
 * Worker findings are capped before being injected into follow-up worker and
 * synthesis prompts. The character budget is documented here because token
 * counts are provider-specific; 24k chars is roughly 6k English tokens.
 */
const DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS = 24_000

let deepThinkingDispatchSequence = 0
let deepThinkingWorkerWaitTimeoutMs = DEFAULT_DEEP_THINKING_WORKER_WAIT_TIMEOUT_MS
let deepThinkingWorkerPollMs = DEFAULT_DEEP_THINKING_WORKER_POLL_MS
let deepThinkingOperationScheduleDelayMs = DEFAULT_DEEP_THINKING_OPERATION_SCHEDULE_DELAY_MS

interface DeepThinkingOperationRegistration {
  controller: AbortController
  context: CommanderRoutesContext
  conversation: Conversation
  sessionName: string
  operationId: string
  cancellationRecorded: boolean
}

const deepThinkingOperations = new Map<string, DeepThinkingOperationRegistration>()

export function configureDeepThinkingRoutingForTest(options: {
  workerWaitTimeoutMs?: number
  workerPollMs?: number
  operationScheduleDelayMs?: number
}): void {
  deepThinkingWorkerWaitTimeoutMs = options.workerWaitTimeoutMs ?? DEFAULT_DEEP_THINKING_WORKER_WAIT_TIMEOUT_MS
  deepThinkingWorkerPollMs = options.workerPollMs ?? DEFAULT_DEEP_THINKING_WORKER_POLL_MS
  deepThinkingOperationScheduleDelayMs = options.operationScheduleDelayMs ?? DEFAULT_DEEP_THINKING_OPERATION_SCHEDULE_DELAY_MS
}

export function resetDeepThinkingRoutingStateForTest(): void {
  for (const operation of deepThinkingOperations.values()) {
    operation.controller.abort(new Error('deep-thinking routing state reset'))
  }
  deepThinkingOperations.clear()
  deepThinkingDispatchSequence = 0
  configureDeepThinkingRoutingForTest({})
}

function stripDeepThinkingTriggers(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/\bthink\s+(?:harder|deeper|deeply|longer|more\s+(?:carefully|thoroughly|rigorously))\b/gi, ' ')
    .replace(/\b(?:deep|deeper|extended|multi[-\s]?round|multiple[-\s]+rounds?)\s+(?:thinking|reasoning|analysis)\b/gi, ' ')
    .replace(/\b(?:reason|analy[sz]e)\s+(?:deeper|deeply|harder|more\s+(?:carefully|thoroughly|rigorously))\b/gi, ' ')
    .replace(/\btake\s+(?:a\s+)?(?:deep|harder|more\s+careful)\s+(?:think|look)\b/gi, ' ')
    .replace(/深入思考|深度思考|多轮思考|认真思考|仔细思考/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasSubstantiveDeepThinkingSubject(message: string): boolean {
  const withoutTrigger = stripDeepThinkingTriggers(message)
  const latinWordCount = withoutTrigger.match(/[a-z0-9][a-z0-9'-]*/gi)?.length ?? 0
  const cjkCount = withoutTrigger.match(/[\u3400-\u9fff]/g)?.length ?? 0
  return latinWordCount >= 4 || cjkCount >= 8 || withoutTrigger.length >= 24
}

function hasExplicitDeepThinkingTrigger(message: string): boolean {
  const normalized = message
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!normalized) {
    return false
  }

  return [
    /\bthink\s+(?:harder|deeper|deeply|longer|more\s+(?:carefully|thoroughly|rigorously))\b/,
    /\b(?:deep|deeper|extended|multi[-\s]?round|multiple[-\s]+rounds?)\s+(?:thinking|reasoning|analysis)\b/,
    /\b(?:reason|analy[sz]e)\s+(?:deeper|deeply|harder|more\s+(?:carefully|thoroughly|rigorously))\b/,
    /\btake\s+(?:a\s+)?(?:deep|harder|more\s+careful)\s+(?:think|look)\b/,
    /深入思考|深度思考|多轮思考|认真思考|仔细思考/,
  ].some((pattern) => pattern.test(normalized))
}

export function isSubstantiveDeepThinkingRequest(message: string): boolean {
  return hasExplicitDeepThinkingTrigger(message) && hasSubstantiveDeepThinkingSubject(message)
}

export interface ConversationMessagesPageOptions {
  limit?: number
  before?: number | null
}

export interface ConversationMessagesPage {
  conversationId: string
  sessionName: string
  source: 'live' | 'transcript' | 'empty'
  limit: number
  before: string | null
  nextBefore: string | null
  hasMore: boolean
  totalMessages: number
  messages: MsgItem[]
}

function normalizeConversationMessagesLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_CONVERSATION_MESSAGES_LIMIT
  }
  return Math.max(1, Math.min(MAX_CONVERSATION_MESSAGES_LIMIT, Math.floor(limit)))
}

function normalizeConversationMessagesCursor(before: number | null | undefined): number {
  if (before === null || before === undefined || !Number.isFinite(before)) {
    return 0
  }
  return Math.max(0, Math.floor(before))
}

function sliceMessagesFromNewest(input: {
  messages: MsgItem[]
  limit: number
  skipNewest: number
  hasMoreBeforeWindow: boolean
}): Pick<ConversationMessagesPage, 'before' | 'nextBefore' | 'hasMore' | 'totalMessages' | 'messages'> {
  const endExclusive = Math.max(0, input.messages.length - input.skipNewest)
  const startInclusive = Math.max(0, endExclusive - input.limit)
  const messages = input.messages.slice(startInclusive, endExclusive)
  const hasMore = input.hasMoreBeforeWindow || startInclusive > 0
  const nextBefore = hasMore
    ? String(input.skipNewest + messages.length)
    : null

  return {
    before: input.skipNewest > 0 ? String(input.skipNewest) : null,
    nextBefore,
    hasMore,
    totalMessages: input.hasMoreBeforeWindow
      ? Math.max(input.skipNewest + messages.length, input.messages.length)
      : input.messages.length,
    messages,
  }
}

async function readTranscriptMessagesWindow(
  sessionName: string,
  targetMessages: number,
): Promise<{ messages: MsgItem[]; hasMoreBeforeWindow: boolean }> {
  let maxTurns = Math.max(targetMessages, DEFAULT_CONVERSATION_MESSAGES_LIMIT)
  let maxEvents = Math.max(DEFAULT_TRANSCRIPT_TAIL_EVENT_LIMIT, targetMessages * 25)
  let lastMessages: MsgItem[] = []
  let lastHasMore = false

  for (let attempt = 0; attempt < MAX_TRANSCRIPT_TAIL_READ_ATTEMPTS; attempt += 1) {
    const page = await readTranscriptTailPage(sessionName, {
      maxTurns,
      maxEvents,
    })
    const messages = mapStreamEventsToMessages(page.events as readonly StreamJsonEvent[])
    lastMessages = messages
    lastHasMore = page.hasMore

    if (messages.length >= targetMessages || !page.hasMore || maxEvents >= MAX_TRANSCRIPT_TAIL_EVENT_LIMIT) {
      break
    }

    maxTurns *= 2
    maxEvents = Math.min(maxEvents * 2, MAX_TRANSCRIPT_TAIL_EVENT_LIMIT)
  }

  return {
    messages: lastMessages,
    hasMoreBeforeWindow: lastHasMore,
  }
}

export async function getConversationMessagesPage(
  context: CommanderRoutesContext,
  conversation: Conversation,
  options: ConversationMessagesPageOptions = {},
): Promise<ConversationMessagesPage> {
  const sessionName = buildConversationSessionName(conversation)
  const limit = normalizeConversationMessagesLimit(options.limit)
  const skipNewest = normalizeConversationMessagesCursor(options.before)
  const liveEvents = getLiveConversationSession(context, conversation)?.events ?? []

  if (liveEvents.length > 0) {
    const liveMessages = mapStreamEventsToMessages(liveEvents as readonly StreamJsonEvent[])
    if (skipNewest < liveMessages.length) {
      const livePage = sliceMessagesFromNewest({
        messages: liveMessages,
        limit,
        skipNewest,
        hasMoreBeforeWindow: false,
      })
      return {
        conversationId: conversation.id,
        sessionName,
        source: 'live',
        limit,
        ...livePage,
      }
    }
  }

  const targetMessages = skipNewest + limit
  const transcriptWindow = await readTranscriptMessagesWindow(sessionName, targetMessages)
  const transcriptPage = sliceMessagesFromNewest({
    messages: transcriptWindow.messages,
    limit,
    skipNewest,
    hasMoreBeforeWindow: transcriptWindow.hasMoreBeforeWindow,
  })
  const source: ConversationMessagesPage['source'] = transcriptWindow.messages.length === 0
    ? 'empty'
    : 'transcript'

  return {
    conversationId: conversation.id,
    sessionName,
    source,
    limit,
    ...transcriptPage,
  }
}

export interface ConversationSpawnOptions {
  agentType?: AgentType
  model?: string | null
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
}

interface PreparedConversationSession {
  commander: CommanderSession
  sessionName: string
  createSessionInput: {
    name: string
    commanderId: string
    conversationId: string
    systemPrompt: string
    agentType: AgentType
    model?: string
    effort?: ClaudeEffortLevel
    adaptiveThinking?: ClaudeAdaptiveThinkingMode
    maxThinkingTokens?: ClaudeMaxThinkingTokens
    cwd?: string
    host?: string
    resumeProviderContext?: Conversation['providerContext']
    maxTurns?: number
  }
}

export class ConversationProviderSwapConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationProviderSwapConflictError'
  }
}

export class ConversationProviderSwapUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationProviderSwapUnavailableError'
  }
}

async function prepareConversationSession(
  context: CommanderRoutesContext,
  commanderId: string,
  conversation: Conversation,
  spawnOptions?: ConversationSpawnOptions,
): Promise<PreparedConversationSession> {
  const commander = await context.sessionStore.get(commanderId)
  if (!commander) {
    throw new Error(`Commander "${commanderId}" not found`)
  }
  if (!context.sessionsInterface) {
    throw new Error('sessionsInterface not configured')
  }

  const commanderAgentType = commander.agentType ?? 'claude'
  const agentType = spawnOptions?.agentType ?? conversation.agentType ?? commanderAgentType
  const provider = getProvider(agentType)
  const providerDefaults = provider ? resolveProviderDefaults(provider) : undefined
  const conversationClaudeContext = conversation.agentType === agentType
    ? asClaudeProviderContext(conversation.providerContext)
    : null
  const commanderClaudeContext = commander.agentType === agentType
    ? asClaudeProviderContext(commander.providerContext)
    : null
  const hasSpawnModel = spawnOptions
    ? Object.prototype.hasOwnProperty.call(spawnOptions, 'model')
    : false
  const conversationModel = conversation.agentType === agentType
    ? (conversation.model ?? undefined)
    : undefined
  const model = hasSpawnModel
    ? (spawnOptions?.model ?? undefined)
    : conversationModel ?? (agentType === commanderAgentType
      ? (commander.model ?? undefined)
      : undefined)
  const effort = provider?.uiCapabilities.supportsEffort
    ? spawnOptions?.effort
      ?? conversationClaudeContext?.effort
      ?? commander.effort
      ?? commanderClaudeContext?.effort
      ?? providerDefaults?.effort
    : undefined
  const adaptiveThinking = provider?.uiCapabilities.supportsAdaptiveThinking
    ? spawnOptions?.adaptiveThinking
      ?? conversationClaudeContext?.adaptiveThinking
      ?? commander.adaptiveThinking
      ?? commanderClaudeContext?.adaptiveThinking
      ?? providerDefaults?.adaptiveThinking
    : undefined
  const maxThinkingTokens = provider?.uiCapabilities.supportsMaxThinkingTokens
    ? spawnOptions?.maxThinkingTokens
      ?? conversationClaudeContext?.maxThinkingTokens
      ?? commander.maxThinkingTokens
      ?? commanderClaudeContext?.maxThinkingTokens
      ?? providerDefaults?.maxThinkingTokens
    : undefined
  const cwd = commander.cwd ?? undefined
  const host = commander.host ?? undefined
  const workflow = await resolveCommanderWorkflow(
    commanderId,
    cwd,
    context.commanderBasePath,
  )
  const built = await buildCommanderSessionSeedFromResolvedWorkflow(
      {
        commanderId,
        cwd,
        currentTask: conversation.currentTask,
        taskSource: commander.taskSource,
      maxTurns: commander.maxTurns,
      memoryBasePath: context.commanderBasePath,
    },
    workflow,
  )
  const systemPrompt = agentType === 'claude'
    ? appendClaudeReasoningPolicy(built.systemPrompt)
    : built.systemPrompt

  return {
    commander,
    sessionName: buildConversationSessionName(conversation),
    createSessionInput: {
      name: buildConversationSessionName(conversation),
      commanderId,
      conversationId: conversation.id,
      systemPrompt,
      agentType,
      model,
      effort,
      adaptiveThinking,
      maxThinkingTokens,
      cwd,
      host,
      resumeProviderContext: conversation.providerContext,
      maxTurns: built.maxTurns,
    },
  }
}

function applyLiveSessionState(
  current: Conversation,
  liveSession: StreamSession | null,
  nextAgentType: AgentType,
  nextStatus: Conversation['status'],
): Conversation {
  return {
    ...current,
    agentType: nextAgentType,
    model: liveSession?.model,
    providerContext: sanitizeConversationProviderContext(liveSession) ?? current.providerContext,
    status: nextStatus,
    lastHeartbeat: nextStatus === 'active' ? null : current.lastHeartbeat,
    heartbeatTickCount: nextStatus === 'active' ? 0 : current.heartbeatTickCount,
    lastMessageAt: new Date().toISOString(),
  }
}

function sanitizeConversationProviderContext(
  session: StreamSession | null | undefined,
): Conversation['providerContext'] | undefined {
  if (!session) {
    return undefined
  }

  return sanitizeProviderContextForPersistence(session.providerContext, {
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
    maxThinkingTokens: session.maxThinkingTokens,
  }) ?? undefined
}

function isCompatibleLiveConversationSession(
  liveSession: StreamSession | undefined,
  createSessionInput: PreparedConversationSession['createSessionInput'],
): liveSession is StreamSession {
  if (!liveSession) {
    return false
  }

  const expectedCwd = createSessionInput.cwd ?? process.env.HOME ?? '/tmp'
  return liveSession.agentType === createSessionInput.agentType
    && liveSession.model === createSessionInput.model
    && liveSession.cwd === expectedCwd
    && isDeepStrictEqual(
      sanitizeConversationProviderContext(liveSession) ?? null,
      createSessionInput.resumeProviderContext ?? null,
    )
}

function refreshLiveConversationSessionPrompt(
  liveSession: StreamSession,
  createSessionInput: PreparedConversationSession['createSessionInput'],
): void {
  liveSession.systemPrompt = createSessionInput.systemPrompt
  liveSession.maxTurns = createSessionInput.maxTurns
}

export async function updateCommanderDerivedState(
  context: CommanderRoutesContext,
  commanderId: string,
): Promise<void> {
  const commander = await context.sessionStore.get(commanderId)
  if (!commander) {
    return
  }

  const conversations = await context.conversationStore.listByCommander(commanderId)
  const hasLiveSession = conversations.some((conversation) => {
    if (conversation.status !== 'active') {
      return false
    }
    return Boolean(getLiveConversationSession(context, conversation))
  })

  await context.sessionStore.update(commanderId, (current) => {
    // `stopped` is the explicit operator-set terminal state. Conversation-level
    // mutations (pause/archive/message delivery) must not silently revive a
    // stopped commander to running/idle — only POST /api/commanders/:id/start
    // can transition out of stopped. See codex-review P2 on PR #1279
    // (comment 3174988519).
    if (current.state === 'stopped') {
      return current
    }
    return {
      ...current,
      state: hasLiveSession ? 'running' : 'idle',
    }
  })
}

export async function startConversationSession(
  context: CommanderRoutesContext,
  commanderId: string,
  conversation: Conversation,
  initialMessage?: string | null,
  spawnOptions?: ConversationSpawnOptions,
  sendOptions?: { queue?: boolean; priority?: 'high' | 'normal' | 'low' },
  dispatchChannelReplies = false,
  channelReplySkipCompletedTurns = 0,
): Promise<{ conversation: Conversation; sent: boolean }> {
  const prepared = await prepareConversationSession(
    context,
    commanderId,
    conversation,
    spawnOptions,
  )
  const sessionsInterface = context.sessionsInterface
  if (!sessionsInterface) {
    throw new Error('sessionsInterface not configured')
  }
  const { sessionName, createSessionInput } = prepared
  const existingSession = sessionsInterface.getSession(sessionName)
  const reusingLiveSession = isCompatibleLiveConversationSession(existingSession, createSessionInput)
  if (reusingLiveSession) {
    refreshLiveConversationSessionPrompt(existingSession, createSessionInput)
  } else {
    removeChannelReplyForwarder(context, sessionName)
    sessionsInterface.deleteSession(sessionName)
  }

  let liveSession: StreamSession
  if (reusingLiveSession) {
    liveSession = existingSession
  } else {
    liveSession = await sessionsInterface.createCommanderSession(createSessionInput)
  }

  const updated = await context.conversationStore.update(conversation.id, (current) => ({
    ...applyLiveSessionState(current, liveSession, createSessionInput.agentType, 'active'),
  }))
  await updateCommanderDerivedState(context, commanderId)
  const heartbeatConversation = updated ?? conversation
  context.heartbeatManager.start(
    heartbeatConversation.id,
    commanderId,
    prepared.commander.heartbeat,
  )
  if (dispatchChannelReplies) {
    ensureChannelReplyForwarder(context, heartbeatConversation, {
      skipCompletedTurns: channelReplySkipCompletedTurns,
    })
  }

  const messageToSend = initialMessage ?? (reusingLiveSession ? null : STARTUP_PROMPT)
  const sent = messageToSend
    ? await sessionsInterface.sendToSession(sessionName, messageToSend, sendOptions)
    : true
  if (!sent) {
    context.heartbeatManager.stop(heartbeatConversation.id)
    removeChannelReplyForwarder(context, sessionName)
    sessionsInterface.deleteSession(sessionName)
    await context.conversationStore.update(conversation.id, (current) => ({
      ...current,
      status: 'idle',
    }))
    await updateCommanderDerivedState(context, commanderId)
    return {
      conversation: updated ?? conversation,
      sent: false,
    }
  }

  return {
    conversation: updated ?? conversation,
    sent: true,
  }
}

export async function swapConversationProvider(
  context: CommanderRoutesContext,
  conversation: Conversation,
  agentType: AgentType,
  spawnOptions?: Omit<ConversationSpawnOptions, 'agentType'>,
): Promise<Conversation> {
  const modelProvided = spawnOptions
    ? Object.prototype.hasOwnProperty.call(spawnOptions, 'model')
    : false
  if (
    conversation.agentType === agentType
    && !modelProvided
    && !getLiveConversationSession(context, conversation)
  ) {
    return conversation
  }

  const liveSession = getLiveConversationSession(context, conversation)
  if (!liveSession) {
    const updated = await context.conversationStore.update(conversation.id, (current) => ({
      ...current,
      agentType,
      ...(modelProvided ? { model: spawnOptions?.model ?? null } : {}),
      lastMessageAt: new Date().toISOString(),
    }))
    return updated ?? conversation
  }

  const sessionsInterface = context.sessionsInterface
  if (!sessionsInterface?.replaceCommanderSession) {
    throw new ConversationProviderSwapUnavailableError(
      'sessionsInterface does not support provider swapping',
    )
  }

  if (!liveSession.lastTurnCompleted) {
    throw new ConversationProviderSwapConflictError(
      `Conversation "${conversation.id}" is mid-turn and cannot swap providers yet`,
    )
  }
  if (liveSession.currentQueuedMessage || liveSession.pendingDirectSendMessages.length > 0) {
    throw new ConversationProviderSwapConflictError(
      `Conversation "${conversation.id}" has queued work and cannot swap providers yet`,
    )
  }

  const prepared = await prepareConversationSession(
    context,
    conversation.commanderId,
    conversation,
    {
      ...spawnOptions,
      agentType,
    },
  )
  const replacement = await sessionsInterface.replaceCommanderSession(
    prepared.createSessionInput,
  )

  const updated = await context.conversationStore.update(conversation.id, (current) => ({
    ...applyLiveSessionState(current, replacement, agentType, 'active'),
  }))
  await updateCommanderDerivedState(context, conversation.commanderId)
  return updated ?? conversation
}

export interface DeliverConversationMessageOptions {
  queue?: boolean
  priority?: 'high' | 'normal' | 'low'
  dispatchChannelReplies?: boolean
  /**
   * When `true`, an `idle` conversation is auto-started before delivering the
   * message instead of returning 409. This is the explicit opt-in for channel
   * webhook surfaces (whatsapp/telegram/discord) where the inbound message
   * itself is the implicit start signal — UI surfaces must keep the default
   * `false` so explicit Start clicks remain the only resume path.
   * See codex-review P1 on PR #1279 (comment 3174904129).
   */
  autoStartIdle?: boolean
  /**
   * Spawn options applied when `autoStartIdle` triggers `startConversationSession`.
   * Ignored when the conversation is already active.
   */
  startSpawnOptions?: ConversationSpawnOptions
  abortSignal?: AbortSignal
}

export interface ConversationMessagePayload {
  message: string
  displayMessage?: string
  images?: QueuedMessageImage[]
}

interface DeepThinkingWorkerLaunch {
  stage: 'research' | 'thinking'
  role: typeof DEEP_THINKING_RESEARCH_ROLES[number] | typeof DEEP_THINKING_THINKING_ROLES[number]
  sessionName: string
}

interface DeepThinkingWorkerOutput extends DeepThinkingWorkerLaunch {
  status: 'completed' | 'timeout' | 'unavailable'
  output: string
}

function nextDeepThinkingWorkerName(
  conversation: Conversation,
  role: DeepThinkingWorkerLaunch['role'],
  now: Date,
): string {
  deepThinkingDispatchSequence = (deepThinkingDispatchSequence + 1) % Number.MAX_SAFE_INTEGER
  return [
    'deepthink',
    conversation.id.slice(0, 8),
    now.getTime().toString(36),
    String(deepThinkingDispatchSequence),
    role,
  ].join('-')
}

function buildDeepThinkingWorkerTask(input: {
  stage: DeepThinkingWorkerLaunch['stage']
  role: DeepThinkingWorkerLaunch['role']
  conversation: Conversation
  originalMessage: string
  researchOutputs?: readonly DeepThinkingWorkerOutput[]
}): string {
  const roleInstruction = (() => {
    switch (input.role) {
      case 'context-research':
        return 'Research pass: gather the most relevant facts, source/code context, constraints, prior decisions, and missing information for the request. Return concise findings and cite concrete evidence when available.'
      case 'risk-research':
        return 'Research pass: look for contradictory evidence, fragile assumptions, prior failures, and risks that would make a direct answer shallow or wrong. Return concise findings and caveats.'
      case 'inversion-thinking':
        return 'Thinking pass: reason by inversion. Identify how the answer could fail, what advice should be rejected, and what assumptions need qualification.'
      case 'synthesis-thinking':
        return 'Thinking pass: reason from first principles and synthesize the strongest answer direction from the research outputs.'
      case 'operational-thinking':
        return 'Thinking pass: convert the research into concrete actions, tradeoffs, and decision criteria.'
    }
  })()
  const researchSection = input.researchOutputs && input.researchOutputs.length > 0
    ? [
        '',
        'Research worker outputs to use:',
        formatDeepThinkingWorkerOutputs(input.researchOutputs, DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS),
      ].join('\n')
    : ''

  return [
    'You are a bounded deep-thinking worker launched by Hammurabi for a commander conversation.',
    roleInstruction,
    '',
    `Commander conversation: ${input.conversation.id}`,
    '',
    'Original user request:',
    input.originalMessage,
    researchSection,
    '',
    'Return your findings in a compact form for the main commander conversation to synthesize. Do not continue beyond this single pass.',
  ].join('\n')
}

function buildDeepThinkingSynthesisMessage(input: {
  originalMessage: string
  researchOutputs: readonly DeepThinkingWorkerOutput[]
  thinkingOutputs: readonly DeepThinkingWorkerOutput[]
}): string {
  return [
    'Deep-thinking routing guardrail engaged.',
    'The user explicitly requested substantive deep thinking, so Hammurabi completed bounded research and thinking worker passes before this synthesis turn.',
    '',
    'Original user request:',
    input.originalMessage,
    '',
    'Research worker outputs:',
    formatDeepThinkingWorkerOutputs(input.researchOutputs, DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS),
    '',
    'Thinking worker outputs:',
    formatDeepThinkingWorkerOutputs(input.thinkingOutputs, DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS),
    '',
    'Synthesize the final answer from the worker outputs above. Do not fake iterative rounds with labels unless the substance is grounded in the worker findings.',
  ].join('\n')
}

function truncateDeepThinkingPromptInput(value: string, remainingBudget: number): { text: string; truncated: boolean } {
  if (value.length <= remainingBudget) {
    return { text: value, truncated: false }
  }
  const marker = `\n[truncated: exceeded deep-thinking prompt budget of ${DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS} characters]`
  if (remainingBudget <= marker.length) {
    return { text: marker.slice(0, Math.max(0, remainingBudget)), truncated: true }
  }
  return {
    text: `${value.slice(0, remainingBudget - marker.length)}${marker}`,
    truncated: true,
  }
}

function formatDeepThinkingWorkerOutputs(
  outputs: readonly DeepThinkingWorkerOutput[],
  maxChars = DEEP_THINKING_WORKER_OUTPUT_PROMPT_BUDGET_CHARS,
): string {
  if (outputs.length === 0) {
    return '- none'
  }
  const sections: string[] = []
  let usedChars = 0
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]
    const section = [
      `- ${output.stage}/${output.role} (${output.sessionName}, ${output.status}):`,
      output.output,
    ].join('\n')
    const separatorLength = sections.length > 0 ? 1 : 0
    const remaining = maxChars - usedChars - separatorLength
    if (remaining <= 0) {
      sections.push(`[truncated: omitted ${outputs.length - index} worker output(s) after deep-thinking prompt budget of ${maxChars} characters]`)
      break
    }
    const truncated = truncateDeepThinkingPromptInput(section, remaining)
    sections.push(truncated.text)
    usedChars += separatorLength + truncated.text.length
    if (truncated.truncated) {
      const omitted = outputs.length - index - 1
      if (omitted > 0) {
        sections.push(`[truncated: omitted ${omitted} worker output(s) after deep-thinking prompt budget of ${maxChars} characters]`)
      }
      break
    }
  }
  return sections.join('\n')
}

function extractDeepThinkingFinalText(event: StreamJsonEvent | undefined): string | null {
  if (!event) {
    return null
  }
  if ('ev' in event && event.ev && typeof event.ev === 'object') {
    const result = (event.ev as { result?: unknown; error?: unknown }).result
    if (typeof result === 'string' && result.trim()) {
      return result.trim()
    }
    const error = (event.ev as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) {
      return error.trim()
    }
  }
  const result = (event as { result?: unknown }).result
  if (typeof result === 'string' && result.trim()) {
    return result.trim()
  }
  const text = (event as { text?: unknown }).text
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

function extractDeepThinkingAssistantText(events: readonly StreamJsonEvent[]): string | null {
  const messages = mapStreamEventsToMessages(events)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.kind !== 'agent') {
      continue
    }
    const text = message.text.trim()
    if (text) {
      return text
    }
  }
  return null
}

function extractDeepThinkingWorkerOutput(session: StreamSession): string {
  return (
    extractDeepThinkingFinalText(session.finalResultEvent) ??
    extractDeepThinkingAssistantText(session.events) ??
    'completed without captured text output'
  )
}

class DeepThinkingRoutingAbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepThinkingRoutingAbortError'
  }
}

class DeepThinkingRoutingTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeepThinkingRoutingTimeoutError'
  }
}

type DeepThinkingRoutingStatus = 'skipped' | 'started' | 'completed' | 'cancelled' | 'timed_out' | 'failed'

function deepThinkingOperationId(conversationId: string): string {
  deepThinkingDispatchSequence = (deepThinkingDispatchSequence + 1) % Number.MAX_SAFE_INTEGER
  return [
    'deepthink-route',
    conversationId.slice(0, 8),
    Date.now().toString(36),
    String(deepThinkingDispatchSequence),
  ].join('-')
}

function throwIfDeepThinkingAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }
  const reason = signal.reason instanceof Error
    ? signal.reason.message
    : typeof signal.reason === 'string'
      ? signal.reason
      : 'deep-thinking routing was cancelled'
  throw new DeepThinkingRoutingAbortError(reason)
}

function sleepDeepThinkingPoll(ms: number, signal: AbortSignal): Promise<void> {
  throwIfDeepThinkingAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DeepThinkingRoutingAbortError('deep-thinking routing was cancelled'))
    }, { once: true })
  })
}

async function waitForDeepThinkingWorker(
  context: CommanderRoutesContext,
  worker: DeepThinkingWorkerLaunch,
  input: {
    signal: AbortSignal
    sessionName: string
  },
): Promise<DeepThinkingWorkerOutput> {
  const deadline = Date.now() + deepThinkingWorkerWaitTimeoutMs
  while (Date.now() <= deadline) {
    throwIfDeepThinkingAborted(input.signal)
    if (!context.sessionsInterface?.getSession(input.sessionName)) {
      throw new DeepThinkingRoutingAbortError('conversation session stopped')
    }
    const session = context.sessionsInterface?.getSession(worker.sessionName)
    if (!session) {
      return {
        ...worker,
        status: 'unavailable',
        output: 'worker session was not available for output collection',
      }
    }
    if (session.lastTurnCompleted) {
      return {
        ...worker,
        status: 'completed',
        output: extractDeepThinkingWorkerOutput(session),
      }
    }
    await sleepDeepThinkingPoll(deepThinkingWorkerPollMs, input.signal)
  }

  throw new DeepThinkingRoutingTimeoutError('worker did not finish before the bounded deep-thinking wait window')
}

async function launchDeepThinkingWorkers(input: {
  context: CommanderRoutesContext
  conversation: Conversation
  commander: CommanderSession
  liveSession: StreamSession
  originalMessage: string
  stage: DeepThinkingWorkerLaunch['stage']
  roles: readonly DeepThinkingWorkerLaunch['role'][]
  researchOutputs?: readonly DeepThinkingWorkerOutput[]
  signal: AbortSignal
  launchedWorkers: DeepThinkingWorkerLaunch[]
}): Promise<
  | {
    ok: true
    workers: DeepThinkingWorkerLaunch[]
  }
  | {
    ok: false
    status: number
    error: string
  }
> {
  const sessionsInterface = input.context.sessionsInterface
  if (!sessionsInterface) {
    return { ok: false, status: 500, error: 'sessionsInterface not configured' }
  }

  const workers: DeepThinkingWorkerLaunch[] = []
  for (const role of input.roles) {
    throwIfDeepThinkingAborted(input.signal)
    const sessionName = nextDeepThinkingWorkerName(input.conversation, role, input.context.now())
    const result = await sessionsInterface.dispatchWorkerForCommander({
      commanderId: input.conversation.commanderId,
      abortSignal: input.signal,
      rawBody: {
        name: sessionName,
        sessionType: 'worker',
        agentType: input.liveSession.agentType,
        ...(input.liveSession.model !== undefined ? { model: input.liveSession.model } : {}),
        ...(input.commander.cwd !== undefined ? { cwd: input.commander.cwd } : {}),
        ...(input.commander.host !== undefined ? { host: input.commander.host } : {}),
        ...(input.liveSession.effort !== undefined ? { effort: input.liveSession.effort } : {}),
        ...(input.liveSession.adaptiveThinking !== undefined ? { adaptiveThinking: input.liveSession.adaptiveThinking } : {}),
        ...(input.liveSession.maxThinkingTokens !== undefined ? { maxThinkingTokens: input.liveSession.maxThinkingTokens } : {}),
        task: buildDeepThinkingWorkerTask({
          stage: input.stage,
          role,
          conversation: input.conversation,
          originalMessage: input.originalMessage,
          researchOutputs: input.researchOutputs,
        }),
      },
    })
    if (result.status < 200 || result.status >= 300) {
      const detail = typeof result.body.error === 'string'
        ? result.body.error
        : 'worker dispatch failed'
      return {
        ok: false,
        status: result.status,
        error: `Deep-thinking worker dispatch failed: ${detail}`,
      }
    }
    const returnedSessionName = typeof result.body.sessionName === 'string'
      ? result.body.sessionName
      : sessionName
    const worker = { stage: input.stage, role, sessionName: returnedSessionName }
    workers.push(worker)
    input.launchedWorkers.push(worker)
  }

  return { ok: true, workers }
}

function recordDeepThinkingRoutingDecision(input: {
  context: CommanderRoutesContext
  sessionName: string
  conversation: Conversation
  operationId: string
  status: DeepThinkingRoutingStatus
  message: string
  workerCount?: number
  detail?: string
}): void {
  const event: StreamJsonEvent = {
    type: 'system',
    subtype: 'deep_thinking_routing',
    status: input.status,
    operationId: input.operationId,
    conversationId: input.conversation.id,
    commanderId: input.conversation.commanderId,
    text: input.message,
    ...(input.workerCount !== undefined ? { workerCount: input.workerCount } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    timestamp: input.context.now().toISOString(),
  } as StreamJsonEvent
  input.context.sessionsInterface?.recordSessionEvent?.(input.sessionName, event)
  console.info('[deep-thinking-routing]', {
    status: input.status,
    conversationId: input.conversation.id,
    operationId: input.operationId,
    workerCount: input.workerCount,
    detail: input.detail,
  })
}

function cleanupDeepThinkingWorkers(
  context: CommanderRoutesContext,
  workers: readonly DeepThinkingWorkerLaunch[],
): void {
  const uniqueNames = new Set(workers.map((worker) => worker.sessionName))
  for (const sessionName of uniqueNames) {
    context.sessionsInterface?.deleteSession(sessionName)
  }
}

function assertDeepThinkingWorkersAvailable(outputs: readonly DeepThinkingWorkerOutput[], stage: string): void {
  const unavailable = outputs.find((output) => output.status === 'unavailable')
  if (unavailable) {
    throw new Error(`${stage} worker "${unavailable.sessionName}" was unavailable for output collection`)
  }
}

function scheduleDeepThinkingOperation(run: () => Promise<void>): void {
  const timer = setTimeout(() => {
    void run()
  }, deepThinkingOperationScheduleDelayMs)
  timer.unref?.()
}

function linkDeepThinkingAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) {
    return () => {}
  }
  if (source.aborted) {
    target.abort(source.reason)
    return () => {}
  }
  const abort = () => target.abort(source.reason)
  source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

function registerDeepThinkingOperation(operation: DeepThinkingOperationRegistration): void {
  const conversationId = operation.conversation.id
  const previous = deepThinkingOperations.get(conversationId)
  previous?.controller.abort(new Error('superseded by a newer deep-thinking request'))
  deepThinkingOperations.set(conversationId, operation)
}

function completeDeepThinkingOperation(conversationId: string, controller: AbortController): void {
  if (deepThinkingOperations.get(conversationId)?.controller === controller) {
    deepThinkingOperations.delete(conversationId)
  }
}

function cancelDeepThinkingOperation(conversationId: string, reason: string): void {
  const operation = deepThinkingOperations.get(conversationId)
  if (!operation) {
    return
  }
  if (!operation.cancellationRecorded) {
    recordDeepThinkingRoutingDecision({
      context: operation.context,
      sessionName: operation.sessionName,
      conversation: operation.conversation,
      operationId: operation.operationId,
      status: 'cancelled',
      message: 'Deep-thinking routing cancelled; dispatched workers are being cleaned up.',
      detail: reason,
    })
    operation.cancellationRecorded = true
  }
  operation.controller.abort(new Error(reason))
}

function deepThinkingCancellationAlreadyRecorded(conversationId: string, operationId: string): boolean {
  const operation = deepThinkingOperations.get(conversationId)
  return operation?.operationId === operationId && operation.cancellationRecorded
}

async function runDeepThinkingRoutingOperation(input: {
  context: CommanderRoutesContext
  conversation: Conversation
  commander: CommanderSession
  liveSession: StreamSession
  sessionName: string
  payload: ConversationMessagePayload
  sendOptions?: {
    queue?: boolean
    priority?: 'high' | 'normal' | 'low'
  }
  originalMessage: string
  operationId: string
  signal: AbortSignal
}): Promise<void> {
  const launchedWorkers: DeepThinkingWorkerLaunch[] = []
  try {
    throwIfDeepThinkingAborted(input.signal)
    const launchedResearch = await launchDeepThinkingWorkers({
      context: input.context,
      conversation: input.conversation,
      commander: input.commander,
      liveSession: input.liveSession,
      originalMessage: input.originalMessage,
      stage: 'research',
      roles: DEEP_THINKING_RESEARCH_ROLES,
      signal: input.signal,
      launchedWorkers,
    })
    if (!launchedResearch.ok) {
      cleanupDeepThinkingWorkers(input.context, launchedWorkers)
      recordDeepThinkingRoutingDecision({
        context: input.context,
        sessionName: input.sessionName,
        conversation: input.conversation,
        operationId: input.operationId,
        status: 'failed',
        message: `Deep-thinking routing failed: ${launchedResearch.error}`,
        workerCount: launchedWorkers.length,
        detail: launchedResearch.error,
      })
      return
    }

    const researchOutputs = await Promise.all(
      launchedResearch.workers.map((worker) => waitForDeepThinkingWorker(input.context, worker, {
        signal: input.signal,
        sessionName: input.sessionName,
      })),
    )
    assertDeepThinkingWorkersAvailable(researchOutputs, 'research')

    const launchedThinking = await launchDeepThinkingWorkers({
      context: input.context,
      conversation: input.conversation,
      commander: input.commander,
      liveSession: input.liveSession,
      originalMessage: input.originalMessage,
      stage: 'thinking',
      roles: DEEP_THINKING_THINKING_ROLES,
      researchOutputs,
      signal: input.signal,
      launchedWorkers,
    })
    if (!launchedThinking.ok) {
      cleanupDeepThinkingWorkers(input.context, launchedWorkers)
      recordDeepThinkingRoutingDecision({
        context: input.context,
        sessionName: input.sessionName,
        conversation: input.conversation,
        operationId: input.operationId,
        status: 'failed',
        message: `Deep-thinking routing failed: ${launchedThinking.error}`,
        workerCount: launchedWorkers.length,
        detail: launchedThinking.error,
      })
      return
    }

    const thinkingOutputs = await Promise.all(
      launchedThinking.workers.map((worker) => waitForDeepThinkingWorker(input.context, worker, {
        signal: input.signal,
        sessionName: input.sessionName,
      })),
    )
    assertDeepThinkingWorkersAvailable(thinkingOutputs, 'thinking')

    const sent = await input.context.sessionsInterface?.sendToSession(
      input.sessionName,
      {
        text: buildDeepThinkingSynthesisMessage({
          originalMessage: input.originalMessage,
          researchOutputs,
          thinkingOutputs,
        }),
        ...(input.payload.displayMessage !== undefined ? { displayText: input.payload.displayMessage.trim() } : {}),
        images: input.payload.images && input.payload.images.length > 0 ? [...input.payload.images] : undefined,
      },
      input.sendOptions,
    )
    if (!sent) {
      cleanupDeepThinkingWorkers(input.context, launchedWorkers)
      recordDeepThinkingRoutingDecision({
        context: input.context,
        sessionName: input.sessionName,
        conversation: input.conversation,
        operationId: input.operationId,
        status: 'failed',
        message: `Deep-thinking routing failed: conversation "${input.conversation.id}" session unavailable`,
        workerCount: launchedWorkers.length,
      })
      return
    }
    recordDeepThinkingRoutingDecision({
      context: input.context,
      sessionName: input.sessionName,
      conversation: input.conversation,
      operationId: input.operationId,
      status: 'completed',
      message: 'Deep-thinking routing completed; synthesis prompt sent to the conversation.',
      workerCount: launchedWorkers.length,
    })
    cleanupDeepThinkingWorkers(input.context, launchedWorkers)
  } catch (error) {
    cleanupDeepThinkingWorkers(input.context, launchedWorkers)
    const aborted = error instanceof DeepThinkingRoutingAbortError
    const timedOut = error instanceof DeepThinkingRoutingTimeoutError
    const detail = error instanceof Error ? error.message : String(error)
    if (!aborted || !deepThinkingCancellationAlreadyRecorded(input.conversation.id, input.operationId)) {
      recordDeepThinkingRoutingDecision({
        context: input.context,
        sessionName: input.sessionName,
        conversation: input.conversation,
        operationId: input.operationId,
        status: aborted ? 'cancelled' : timedOut ? 'timed_out' : 'failed',
        message: aborted
          ? 'Deep-thinking routing cancelled; dispatched workers were cleaned up.'
          : timedOut
            ? 'Deep-thinking routing timed out; dispatched workers were cleaned up.'
            : `Deep-thinking routing failed: ${detail}`,
        workerCount: launchedWorkers.length,
        detail,
      })
    }
  }
}

async function sendConversationPayloadWithDeepThinkingGuard(input: {
  context: CommanderRoutesContext
  conversation: Conversation
  commander: CommanderSession
  liveSession: StreamSession
  sessionName: string
  payload: ConversationMessagePayload
  sendOptions?: {
    queue?: boolean
    priority?: 'high' | 'normal' | 'low'
  }
  abortSignal?: AbortSignal
}): Promise<
  | {
    ok: true
  }
  | {
    ok: false
    status: number
    error: string
  }
> {
  const originalMessage = (input.payload.displayMessage ?? input.payload.message).trim()
  const hasDeepThinkingTrigger = originalMessage.length > 0
    && hasExplicitDeepThinkingTrigger(originalMessage)
  const shouldRouteDeepThinking = hasDeepThinkingTrigger
    && hasSubstantiveDeepThinkingSubject(originalMessage)

  if (hasDeepThinkingTrigger && !shouldRouteDeepThinking) {
    const operationId = deepThinkingOperationId(input.conversation.id)
    recordDeepThinkingRoutingDecision({
      context: input.context,
      sessionName: input.sessionName,
      conversation: input.conversation,
      operationId,
      status: 'skipped',
      message: 'Deep-thinking routing skipped: add a substantive task after the trigger phrase.',
    })
    return {
      ok: false,
      status: 400,
      error: 'Deep-thinking requests need substantive task text after the trigger phrase.',
    }
  }

  if (shouldRouteDeepThinking) {
    const operationId = deepThinkingOperationId(input.conversation.id)
    const controller = new AbortController()
    const unlinkAbortSignal = linkDeepThinkingAbortSignal(input.abortSignal, controller)
    registerDeepThinkingOperation({
      controller,
      context: input.context,
      conversation: input.conversation,
      sessionName: input.sessionName,
      operationId,
      cancellationRecorded: false,
    })
    recordDeepThinkingRoutingDecision({
      context: input.context,
      sessionName: input.sessionName,
      conversation: input.conversation,
      operationId,
      status: 'started',
      message: 'Deep-thinking routing started; worker fan-out is running asynchronously.',
    })
    scheduleDeepThinkingOperation(async () => {
      try {
        await runDeepThinkingRoutingOperation({
          context: input.context,
          conversation: input.conversation,
          commander: input.commander,
          liveSession: input.liveSession,
          sessionName: input.sessionName,
          payload: input.payload,
          sendOptions: input.sendOptions,
          originalMessage,
          operationId,
          signal: controller.signal,
        })
      } finally {
        unlinkAbortSignal()
        completeDeepThinkingOperation(input.conversation.id, controller)
      }
    })
    return { ok: true }
  }

  const sent = await input.context.sessionsInterface?.sendToSession(
    input.sessionName,
    {
      text: input.payload.message,
      ...(input.payload.displayMessage !== undefined ? { displayText: input.payload.displayMessage.trim() } : {}),
      images: input.payload.images && input.payload.images.length > 0 ? [...input.payload.images] : undefined,
    },
    input.sendOptions,
  )
  if (!sent) {
    return {
      ok: false,
      status: 409,
      error: `Conversation "${input.conversation.id}" session unavailable`,
    }
  }

  return { ok: true }
}

function eventType(event: StreamJsonEvent): string {
  return typeof event.type === 'string' ? event.type : ''
}

function extractAssistantReplyText(events: readonly StreamJsonEvent[]): string | null {
  const messages = mapStreamEventsToMessages(events)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.kind !== 'agent') {
      continue
    }
    const text = message.text.trim()
    if (text) {
      return text
    }
  }
  return null
}

function removeChannelReplyForwarder(
  context: CommanderRoutesContext,
  sessionName: string,
): void {
  const unsubscribe = context.channelReplyForwarders.get(sessionName)
  if (!unsubscribe) {
    return
  }
  unsubscribe()
  context.channelReplyForwarders.delete(sessionName)
}

interface ChannelReplyForwarderOptions {
  skipCompletedTurns?: number
}

function ensureChannelReplyForwarder(
  context: CommanderRoutesContext,
  conversation: Conversation,
  options: ChannelReplyForwarderOptions = {},
): void {
  if (!conversation.channelMeta || !conversation.lastRoute || !context.sessionsInterface) {
    return
  }

  const sessionName = buildConversationSessionName(conversation)
  if (context.channelReplyForwarders.has(sessionName)) {
    return
  }

  let turnEvents: StreamJsonEvent[] = []
  let skippedCompletedTurns = Math.max(0, Math.floor(options.skipCompletedTurns ?? 0))
  const unsubscribe = context.sessionsInterface.subscribeToEvents(sessionName, (event) => {
    const type = eventType(event)
    if (type === 'message_start') {
      turnEvents = [event]
    } else {
      turnEvents.push(event)
    }

    if (type !== 'result') {
      return
    }

    if (skippedCompletedTurns > 0) {
      skippedCompletedTurns -= 1
      turnEvents = []
      return
    }

    const replyText = extractAssistantReplyText(turnEvents)
    turnEvents = []
    if (!replyText) {
      return
    }

    void context.dispatchCommanderChannelReply({
      commanderId: conversation.commanderId,
      conversationId: conversation.id,
      message: replyText,
    }).then((result) => {
      if (!result.ok) {
        console.warn(
          `[channels] Failed to dispatch assistant reply for conversation "${conversation.id}": ${result.error}`,
        )
      }
    }).catch((error) => {
      console.warn(
        `[channels] Failed to dispatch assistant reply for conversation "${conversation.id}":`,
        error,
      )
    })
  })

  context.channelReplyForwarders.set(sessionName, unsubscribe)
}

export async function persistConversationRuntimeSnapshot(
  context: CommanderRoutesContext,
  conversation: Conversation,
  nextStatus: Conversation['status'],
): Promise<Conversation | null> {
  const liveSession = getLiveConversationSession(context, conversation)
  const usageCostUsd = liveSession?.usage?.costUsd ?? 0
  return context.conversationStore.update(conversation.id, (current) => ({
    ...current,
    model: liveSession?.model,
    providerContext: sanitizeConversationProviderContext(liveSession) ?? current.providerContext,
    totalCostUsd: current.totalCostUsd + usageCostUsd,
    status: nextStatus,
    lastMessageAt: new Date().toISOString(),
  }))
}

/**
 * Stop a single conversation's live stream session, persist its final snapshot,
 * stop its heartbeat, and clean up commander-level runtime references when no
 * other live conversation remains. Used by:
 *   - POST /api/conversations/:id/{pause,archive,resume}        (per-conversation lifecycle)
 *   - POST /api/commanders/:id/stop                              (sweep across every conversation)
 *   - DELETE /api/commanders/:id                                 (cascade cleanup before commander delete)
 *   - POST /api/commanders/channel-message (orphan path)         (archive when commander is gone)
 *
 * `nextStatus` is the persisted status the conversation lands in: `idle` for
 * stop/pause, `archived` for archive/delete/orphan.
 */
export async function stopConversationSession(
  context: CommanderRoutesContext,
  conversation: Conversation,
  nextStatus: Conversation['status'],
): Promise<Conversation | null> {
  cancelDeepThinkingOperation(conversation.id, 'conversation session stopped')
  const sessionName = buildConversationSessionName(conversation)
  removeChannelReplyForwarder(context, sessionName)
  const updated = await persistConversationRuntimeSnapshot(context, conversation, nextStatus)
  context.heartbeatManager.stop(conversation.id)
  context.sessionsInterface?.deleteSession(sessionName)
  const remainingConversations = await context.conversationStore.listByCommander(conversation.commanderId)
  const hasOtherLiveConversation = remainingConversations.some((candidate) => {
    if (candidate.id === conversation.id || candidate.status !== 'active') {
      return false
    }
    return Boolean(getLiveConversationSession(context, candidate))
  })
  if (!hasOtherLiveConversation) {
    context.runtimes.delete(conversation.commanderId)
  }
  if (
    !hasOtherLiveConversation ||
    context.activeCommanderSessions.get(conversation.commanderId)?.sessionName === sessionName
  ) {
    context.activeCommanderSessions.delete(conversation.commanderId)
  }
  await updateCommanderDerivedState(context, conversation.commanderId)
  return updated
}

export async function deliverConversationMessage(
  context: CommanderRoutesContext,
  conversation: Conversation,
  payload: ConversationMessagePayload,
  options?: DeliverConversationMessageOptions,
): Promise<
  | {
    ok: true
    createdSession: boolean
    conversation: Conversation
  }
  | {
    ok: false
    status: number
    error: string
  }
> {
  if (conversation.status === 'archived') {
    return { ok: false, status: 409, error: `Conversation "${conversation.id}" is archived` }
  }

  const commander = await context.sessionStore.get(conversation.commanderId)
  if (!commander) {
    return { ok: false, status: 404, error: `Commander "${conversation.commanderId}" not found` }
  }

  const sendOptions = options?.queue === undefined && options?.priority === undefined
    ? undefined
    : { queue: options.queue, priority: options.priority }

  const liveSession = getLiveConversationSession(context, conversation)
  if (!liveSession) {
    if (conversation.status === 'idle' && options?.autoStartIdle) {
      const started = await startConversationSession(
        context,
        conversation.commanderId,
        conversation,
        null,
        options.startSpawnOptions,
        undefined,
        options.dispatchChannelReplies === true,
        options.dispatchChannelReplies === true ? 1 : 0,
      )
      if (!started.sent) {
        return {
          ok: false,
          status: 503,
          error: `Conversation "${conversation.id}" could not be auto-started`,
        }
      }
      const sessionName = buildConversationSessionName(started.conversation)
      const autoStartedSendOptions = sendOptions ?? { queue: true, priority: 'normal' as const }
      const startedLiveSession = getLiveConversationSession(context, started.conversation)
      if (!startedLiveSession) {
        await stopConversationSession(context, started.conversation, 'idle')
        return {
          ok: false,
          status: 503,
          error: `Conversation "${conversation.id}" could not receive its auto-start message`,
        }
      }
      const sent = await sendConversationPayloadWithDeepThinkingGuard({
        context,
        conversation: started.conversation,
        commander,
        liveSession: startedLiveSession,
        sessionName,
        payload,
        sendOptions: autoStartedSendOptions,
        abortSignal: options?.abortSignal,
      })
      if (!sent.ok) {
        await stopConversationSession(context, started.conversation, 'idle')
        return {
          ok: false,
          status: sent.status,
          error: sent.error,
        }
      }
      const updated = await context.conversationStore.update(started.conversation.id, (current) => ({
        ...current,
        status: 'active',
        lastMessageAt: new Date().toISOString(),
      }))
      await updateCommanderDerivedState(context, conversation.commanderId)
      return {
        ok: true,
        createdSession: true,
        conversation: updated ?? started.conversation,
      }
    }
    if (conversation.status === 'idle') {
      return {
        ok: false,
        status: 409,
        error: `Conversation is idle. Call POST /api/conversations/${conversation.id}/start first.`,
      }
    }
    return {
      ok: false,
      status: 409,
      error: `Conversation "${conversation.id}" session unavailable`,
    }
  }

  const sessionName = buildConversationSessionName(conversation)
  if (options?.dispatchChannelReplies) {
    ensureChannelReplyForwarder(context, conversation)
  }
  const sent = await sendConversationPayloadWithDeepThinkingGuard({
    context,
    conversation,
    commander,
    liveSession,
    sessionName,
    payload,
    sendOptions,
    abortSignal: options?.abortSignal,
  })
  if (!sent.ok) {
    return {
      ok: false,
      status: sent.status,
      error: sent.error,
    }
  }

  const updated = await context.conversationStore.update(conversation.id, (current) => ({
    ...current,
    status: 'active',
    lastMessageAt: new Date().toISOString(),
  }))
  await updateCommanderDerivedState(context, conversation.commanderId)
  if (!context.heartbeatManager.isRunning(conversation.id)) {
    context.heartbeatManager.start(
      conversation.id,
      conversation.commanderId,
      commander.heartbeat,
    )
  }

  return {
    ok: true,
    createdSession: false,
    conversation: updated ?? conversation,
  }
}
