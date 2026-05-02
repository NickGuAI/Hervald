import {
  buildCommanderSessionSeedFromResolvedWorkflow,
} from '../memory/module.js'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { AgentType } from '../../agents/types.js'
import { STARTUP_PROMPT, toCommanderSessionName } from './context.js'
import { buildLegacyCommanderConversationId } from '../store.js'
import { resolveCommanderWorkflow } from '../workflow-resolution.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderRoutesContext } from './types.js'

function isLegacyConversation(conversation: Conversation): boolean {
  return conversation.id === buildLegacyCommanderConversationId(conversation.commanderId)
}

export function buildConversationSessionName(conversation: Conversation): string {
  return isLegacyConversation(conversation)
    ? toCommanderSessionName(conversation.commanderId)
    : `commander-${conversation.commanderId}-conversation-${conversation.id}`
}

export function getLiveConversationSession(
  context: CommanderRoutesContext,
  conversation: Conversation,
) {
  return context.sessionsInterface?.getSession(buildConversationSessionName(conversation))
}

export interface ConversationSpawnOptions {
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  cwd?: string
  host?: string
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
): Promise<{ conversation: Conversation; sent: boolean }> {
  const commander = await context.sessionStore.get(commanderId)
  if (!commander) {
    throw new Error(`Commander "${commanderId}" not found`)
  }
  if (!context.sessionsInterface) {
    throw new Error('sessionsInterface not configured')
  }

  const agentType = spawnOptions?.agentType ?? commander.agentType ?? 'claude'
  const effort = agentType === 'claude'
    ? (spawnOptions?.effort ?? (
        commander.agentType === 'claude' || commander.agentType === undefined
          ? commander.effort
          : undefined
      ))
    : undefined
  const adaptiveThinking = agentType === 'claude'
    ? spawnOptions?.adaptiveThinking
    : undefined
  const cwd = spawnOptions?.cwd ?? commander.cwd ?? undefined
  const host = spawnOptions?.host ?? commander.host ?? undefined
  const workflow = await resolveCommanderWorkflow(
    commanderId,
    cwd,
    context.commanderBasePath,
  )
  const built = await buildCommanderSessionSeedFromResolvedWorkflow(
    {
      commanderId,
      cwd,
      persona: commander.persona,
      currentTask: conversation.currentTask,
      taskSource: commander.taskSource,
      maxTurns: commander.maxTurns,
      memoryBasePath: context.commanderBasePath,
    },
    workflow,
  )
  const sessionName = buildConversationSessionName(conversation)
  context.sessionsInterface.deleteSession(sessionName)
  const createSessionInput = {
    name: sessionName,
    commanderId,
    conversationId: conversation.id,
    systemPrompt: built.systemPrompt,
    agentType,
    effort,
    adaptiveThinking,
    cwd,
    host,
    resumeSessionId: conversation.claudeSessionId,
    resumeCodexThreadId: conversation.codexThreadId,
    resumeGeminiSessionId: conversation.geminiSessionId,
    maxTurns: built.maxTurns,
  }
  await context.sessionsInterface.createCommanderSession(createSessionInput)

  const updated = await context.conversationStore.update(conversation.id, (current) => ({
    ...current,
    agentType: spawnOptions?.agentType ?? current.agentType ?? null,
    status: 'active',
    lastHeartbeat: null,
    heartbeat: {
      ...current.heartbeat,
      lastSentAt: null,
    },
    heartbeatTickCount: 0,
    lastMessageAt: new Date().toISOString(),
  }))
  await updateCommanderDerivedState(context, commanderId)
  const heartbeatConversation = updated ?? conversation
  context.heartbeatManager.start(
    heartbeatConversation.id,
    commanderId,
    heartbeatConversation.heartbeat,
  )

  const messageToSend = initialMessage ?? STARTUP_PROMPT
  const sent = await context.sessionsInterface.sendToSession(sessionName, messageToSend, sendOptions)
  if (!sent) {
    context.heartbeatManager.stop(heartbeatConversation.id)
    context.sessionsInterface.deleteSession(sessionName)
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

export interface DeliverConversationMessageOptions {
  queue?: boolean
  priority?: 'high' | 'normal' | 'low'
  /**
   * When `true`, an `idle` conversation is auto-started using `message` as the
   * initial prompt instead of returning 409. This is the explicit opt-in for
   * channel webhook surfaces (whatsapp/telegram/discord) where the inbound
   * message itself is the implicit start signal — UI surfaces must keep the
   * default `false` so explicit Start clicks remain the only resume path.
   * See codex-review P1 on PR #1279 (comment 3174904129).
   */
  autoStartIdle?: boolean
  /**
   * Spawn options applied when `autoStartIdle` triggers `startConversationSession`.
   * Ignored when the conversation is already active.
   */
  startSpawnOptions?: ConversationSpawnOptions
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
    claudeSessionId: liveSession?.claudeSessionId ?? current.claudeSessionId,
    codexThreadId: liveSession?.codexThreadId ?? current.codexThreadId,
    geminiSessionId: liveSession?.geminiSessionId ?? current.geminiSessionId,
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
  message: string,
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
        message,
        options.startSpawnOptions,
        sendOptions,
      )
      if (!started.sent) {
        return {
          ok: false,
          status: 503,
          error: `Conversation "${conversation.id}" could not be auto-started`,
        }
      }
      return {
        ok: true,
        createdSession: true,
        conversation: started.conversation,
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
  const sent = await context.sessionsInterface?.sendToSession(sessionName, message, sendOptions)
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
      (updated ?? conversation).heartbeat,
    )
  }

  return {
    ok: true,
    createdSession: false,
    conversation: updated ?? conversation,
  }
}
