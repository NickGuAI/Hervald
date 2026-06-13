import { liveSessionToApiPayload } from '../../agents/session/state.js'
import { getProvider } from '../../agents/providers/registry.js'
import type { AgentSession, AgentType, StreamSession } from '../../agents/types.js'
import { buildDefaultCommanderConversationId } from '../store.js'
import type { Conversation } from '../conversation-store.js'
import type { CommanderRoutesContext } from './types.js'
import {
  buildConversationSessionName,
  getLiveConversationSession,
} from './conversation-runtime.js'
import {
  getConversationRuntimeOverlay,
  type ConversationRuntimeState,
} from './conversation-runtime-state.js'

type ConversationAction =
  | 'send'
  | 'queue'
  | 'media'
  | 'start'
  | 'pause'
  | 'resume'
  | 'archive'
  | 'delete'
  | 'updateProvider'

type ConversationDisabledReasons = Record<ConversationAction, string | null>
type ConversationAllowedActions = Record<ConversationAction, boolean>
type ConversationTransportType = 'stream' | 'pty' | 'external' | null

interface LiveConversationSessionLike {
  kind?: string
  agentType?: AgentType
}

function hasSerializableStreamShape(
  liveSession: LiveConversationSessionLike,
): liveSession is StreamSession {
  const stream = liveSession as Partial<StreamSession>
  const clients = stream.clients as { size?: unknown } | undefined
  return liveSession.kind === 'stream'
    && Array.isArray(stream.events)
    && typeof clients?.size === 'number'
}

/**
 * Backend-owned conversation read model for Command Room clients.
 *
 * The DTO keeps the persisted conversation fields for compatibility, then adds
 * the projected lifecycle/sendability contract desktop and mobile should
 * consume instead of parsing session names or raw live-session process fields.
 */
export interface ConversationSummaryDTO extends Conversation {
  runtimeState: ConversationRuntimeState
  websocketReady: boolean
  runtimeError: string | null
  isDefaultConversation: boolean
  liveSession: AgentSession | null
  canonicalOrder: number
  displayState: {
    status: Conversation['status']
    runtimeState: ConversationRuntimeState
    websocketReady: boolean
    runtimeError: string | null
    isVisible: boolean
    isDefaultConversation: boolean
    hasLiveSession: boolean
    isSendable: boolean
    isQueueable: boolean
    isMediaSendable: boolean
    label: string
    disabledReasons: ConversationDisabledReasons
  }
  sendTarget: null | {
    kind: 'conversation'
    conversationId: string
    commanderId: string
    sessionName: string
    transportType: ConversationTransportType
    agentType: AgentType | null
    queue: {
      supported: boolean
      reason: string | null
    }
    media: {
      supported: boolean
      reason: string | null
    }
  }
  allowedActions: ConversationAllowedActions
}

function resolveTransportType(liveSession: LiveConversationSessionLike | undefined): ConversationTransportType {
  if (!liveSession) {
    return null
  }
  return liveSession.kind === 'stream' || liveSession.kind === 'pty' || liveSession.kind === 'external'
    ? liveSession.kind
    : null
}

function serializeMinimalLiveSession(liveSession: LiveConversationSessionLike): AgentSession {
  const created = (liveSession as { createdAt?: string }).createdAt ?? new Date(0).toISOString()
  const transportType = resolveTransportType(liveSession) ?? 'stream'
  const process = (liveSession as { process?: { pid?: number } }).process
  const isStream = transportType === 'stream'

  return {
    name: (liveSession as { name?: string }).name ?? '',
    created,
    lastActivityAt: (liveSession as { lastEventAt?: string }).lastEventAt ?? created,
    pid: typeof process?.pid === 'number' ? process.pid : 0,
    transportType,
    processAlive: isStream,
    hadResult: Boolean((liveSession as { finalResultEvent?: unknown }).finalResultEvent),
    status: isStream ? 'active' : 'idle',
    ...(liveSession.agentType ? { agentType: liveSession.agentType } : {}),
  }
}

function serializeLiveSession(liveSession: LiveConversationSessionLike | undefined): AgentSession | null {
  if (!liveSession) {
    return null
  }
  if (hasSerializableStreamShape(liveSession)) {
    return liveSessionToApiPayload(liveSession as StreamSession)
  }

  return serializeMinimalLiveSession(liveSession)
}

function buildLabel(conversation: Conversation): string {
  const name = conversation.name?.trim()
  if (name) {
    return name
  }
  const displayName = conversation.channelMeta?.displayName?.trim()
  if (displayName) {
    return displayName
  }
  return `Conversation ${conversation.id.slice(0, 8)}`
}

function providerSupportsMessageImages(liveSession: LiveConversationSessionLike | undefined): boolean {
  if (!liveSession?.agentType) {
    return false
  }
  return getProvider(liveSession.agentType)?.capabilities.supportsMessageImages === true
}

export function buildConversationSummaryDTO(
  context: CommanderRoutesContext,
  conversation: Conversation,
  canonicalOrder = 0,
): ConversationSummaryDTO {
  const liveSession = getLiveConversationSession(context, conversation) as LiveConversationSessionLike | undefined
  const transportType = resolveTransportType(liveSession)
  const hasLiveSession = Boolean(liveSession)
  const isDefaultConversation = conversation.id === buildDefaultCommanderConversationId(conversation.commanderId)
  const sessionName = buildConversationSessionName(conversation)
  const isArchived = conversation.status === 'archived'
  const displayRuntimeOverlay = getConversationRuntimeOverlay(conversation.id)
  const runtimeState: ConversationRuntimeState = isArchived
    ? 'archived'
    : displayRuntimeOverlay?.state === 'starting'
      ? 'starting'
      : displayRuntimeOverlay?.state === 'failed'
        ? 'failed'
        : conversation.status === 'active' && hasLiveSession
          ? 'active'
          : 'idle'
  const websocketReady = runtimeState === 'active' && hasLiveSession
  const hasActiveStream = websocketReady && transportType === 'stream'
  const canStartOrResume = (
    (conversation.status === 'idle' || runtimeState === 'failed')
    && runtimeState !== 'starting'
    && !hasLiveSession
  )

  const noActiveStreamReason = 'Conversation image transport requires an active stream session'
  const canSendMedia = hasActiveStream && providerSupportsMessageImages(liveSession)
  let sendReason: string | null = null
  if (isArchived) {
    sendReason = 'Conversation is archived'
  } else if (runtimeState === 'starting') {
    sendReason = 'Conversation is starting'
  } else if (runtimeState === 'failed') {
    sendReason = 'Conversation start failed'
  } else if (!hasActiveStream) {
    sendReason = conversation.status !== 'active'
      ? 'Conversation must be active before sending'
      : transportType === null
        ? 'Conversation has no live session'
        : 'Conversation live session is not stream-sendable'
  }
  const queueReason = hasActiveStream ? null : sendReason
  const mediaReason = canSendMedia
    ? null
    : hasActiveStream
      ? 'Conversation provider does not support image attachments'
      : noActiveStreamReason

  const allowedActions: ConversationAllowedActions = {
    send: hasActiveStream,
    queue: hasActiveStream,
    media: canSendMedia,
    start: canStartOrResume,
    pause: (runtimeState === 'starting' || conversation.status === 'active') && !isArchived,
    resume: canStartOrResume,
    archive: true,
    delete: true,
    updateProvider: conversation.status === 'idle' && runtimeState !== 'starting' && !hasLiveSession,
  }
  const disabledReasons: ConversationDisabledReasons = {
    send: allowedActions.send ? null : sendReason,
    queue: allowedActions.queue ? null : queueReason,
    media: allowedActions.media ? null : mediaReason,
    start: allowedActions.start
      ? null
      : isArchived
        ? 'Archived conversations cannot be started'
        : runtimeState === 'starting'
          ? 'Conversation is already starting'
          : hasLiveSession
            ? 'Conversation already has a live session'
            : 'Conversation is not idle',
    pause: allowedActions.pause
      ? null
      : isArchived
        ? 'Archived conversations cannot be paused'
        : 'Conversation is not active',
    resume: allowedActions.resume
      ? null
      : isArchived
        ? 'Archived conversations cannot be resumed'
        : runtimeState === 'starting'
          ? 'Conversation is already starting'
          : hasLiveSession
            ? 'Conversation already has a live session'
            : 'Conversation is not idle',
    archive: null,
    delete: null,
    updateProvider: allowedActions.updateProvider
      ? null
      : isArchived
        ? 'Archived conversations cannot change provider'
        : runtimeState === 'starting'
          ? 'Conversation is starting'
          : hasLiveSession || conversation.status === 'active'
            ? 'Stop the conversation before changing provider or model'
            : 'Conversation provider cannot be updated in the current state',
  }

  const queueSupport = {
    supported: allowedActions.queue,
    reason: disabledReasons.queue,
  }
  const mediaSupport = {
    supported: allowedActions.media,
    reason: disabledReasons.media,
  }

  return {
    ...conversation,
    runtimeState,
    websocketReady,
    runtimeError: displayRuntimeOverlay?.error ?? null,
    isDefaultConversation,
    liveSession: serializeLiveSession(liveSession),
    canonicalOrder,
    displayState: {
      status: conversation.status,
      runtimeState,
      websocketReady,
      runtimeError: displayRuntimeOverlay?.error ?? null,
      isVisible: conversation.status !== 'archived',
      isDefaultConversation,
      hasLiveSession,
      isSendable: allowedActions.send,
      isQueueable: allowedActions.queue,
      isMediaSendable: allowedActions.media,
      label: buildLabel(conversation),
      disabledReasons,
    },
    sendTarget: isArchived
      ? null
      : {
          kind: 'conversation',
          conversationId: conversation.id,
          commanderId: conversation.commanderId,
          sessionName,
          transportType,
          agentType: liveSession?.agentType ?? conversation.agentType ?? null,
          queue: queueSupport,
          media: mediaSupport,
        },
    allowedActions,
  }
}
