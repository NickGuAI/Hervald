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
import { readTranscriptEvents } from '../../agents/transcript-store.js'
import { STARTUP_PROMPT } from './context.js'
import type { CommanderSession } from '../store.js'
import { resolveCommanderWorkflow } from '../workflow-resolution.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderRoutesContext } from './types.js'
import { sanitizeProviderContextForPersistence } from '../../agents/providers/provider-context-migration.js'
import { asClaudeProviderContext } from '../../agents/providers/provider-session-context.js'
import { getProvider } from '../../agents/providers/registry.js'
import { resolveProviderDefaults } from '../../agents/providers/provider-adapter.js'

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

export async function getConversationMessagesPage(
  context: CommanderRoutesContext,
  conversation: Conversation,
  options: ConversationMessagesPageOptions = {},
): Promise<ConversationMessagesPage> {
  const sessionName = buildConversationSessionName(conversation)
  const liveEvents = getLiveConversationSession(context, conversation)?.events ?? []
  const transcriptEvents = await readTranscriptEvents(sessionName)
  const hasFresherLiveBuffer = liveEvents.length > transcriptEvents.length
  const sourceEvents = hasFresherLiveBuffer
    ? liveEvents
    : transcriptEvents.length > 0
      ? transcriptEvents
      : liveEvents
  const source: ConversationMessagesPage['source'] = sourceEvents.length === 0
    ? 'empty'
    : hasFresherLiveBuffer
      ? 'live'
      : transcriptEvents.length > 0
        ? 'transcript'
        : 'live'
  const allMessages = mapStreamEventsToMessages(sourceEvents as readonly StreamJsonEvent[])
  const limit = normalizeConversationMessagesLimit(options.limit)
  const endExclusive = options.before === null || options.before === undefined
    ? allMessages.length
    : Math.max(0, Math.min(allMessages.length, Math.floor(options.before)))
  const startInclusive = Math.max(0, endExclusive - limit)
  const messages = allMessages.slice(startInclusive, endExclusive)
  const nextBefore = startInclusive > 0 ? String(startInclusive) : null

  return {
    conversationId: conversation.id,
    sessionName,
    source,
    limit,
    before: options.before === null || options.before === undefined ? null : String(endExclusive),
    nextBefore,
    hasMore: nextBefore !== null,
    totalMessages: allMessages.length,
    messages,
  }
}

export interface ConversationSpawnOptions {
  agentType?: AgentType
  model?: string | null
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
    ? commander.effort ?? conversationClaudeContext?.effort ?? providerDefaults?.effort
    : undefined
  const adaptiveThinking = provider?.uiCapabilities.supportsAdaptiveThinking
    ? spawnOptions?.adaptiveThinking
      ?? conversationClaudeContext?.adaptiveThinking
      ?? providerDefaults?.adaptiveThinking
    : undefined
  const maxThinkingTokens = provider?.uiCapabilities.supportsMaxThinkingTokens
    ? spawnOptions?.maxThinkingTokens
      ?? conversationClaudeContext?.maxThinkingTokens
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

  return {
    commander,
    sessionName: buildConversationSessionName(conversation),
    createSessionInput: {
      name: buildConversationSessionName(conversation),
      commanderId,
      conversationId: conversation.id,
      systemPrompt: built.systemPrompt,
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
}

export interface ConversationMessagePayload {
  message: string
  images?: QueuedMessageImage[]
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
  const sessionPayload = {
    text: payload.message,
    images: payload.images && payload.images.length > 0 ? [...payload.images] : undefined,
  }

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
      const sent = await context.sessionsInterface?.sendToSession(
        sessionName,
        sessionPayload,
        autoStartedSendOptions,
      )
      if (!sent) {
        await stopConversationSession(context, started.conversation, 'idle')
        return {
          ok: false,
          status: 503,
          error: `Conversation "${conversation.id}" could not receive its auto-start message`,
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
  const sent = await context.sessionsInterface?.sendToSession(sessionName, sessionPayload, sendOptions)
  if (!sent) {
    return {
      ok: false,
      status: 409,
      error: `Conversation "${conversation.id}" session unavailable`,
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
