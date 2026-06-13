import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  MessageQueueFullError,
  SessionMessageQueue,
  type QueuedMessage,
  type QueuedMessageImage,
  type QueuedMessagePriority,
} from '../message-queue.js'
import { getProvider } from '../providers/registry.js'
import type { AnySession, StreamJsonEvent, StreamSession } from '../types.js'

const MESSAGE_QUEUE_RETRY_INITIAL_MS = 250
const MESSAGE_QUEUE_RETRY_MAX_MS = 5000

type StreamSendAttemptResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string }

interface SessionQueueRuntimeDeps {
  sessions: Map<string, AnySession>
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  writeToStdin(session: StreamSession, data: string): boolean
  resetActiveTurnState(session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  awaitAutoRotationIfNeeded(sessionName: string): Promise<StreamSession | null>
}

export function createSessionQueueRuntime(deps: SessionQueueRuntimeDeps) {
  function getQueuedBacklogItems(session: StreamSession): QueuedMessage[] {
    const pendingDirectSendMessages = session.currentQueuedMessage
      ? session.pendingDirectSendMessages
      : session.pendingDirectSendMessages.slice(1)
    return [...pendingDirectSendMessages, ...session.messageQueue.list()]
  }

  function getCurrentQueueMessage(session: StreamSession): QueuedMessage | null {
    return session.currentQueuedMessage ?? session.pendingDirectSendMessages[0] ?? null
  }

  function getQueuedBacklogCount(session: StreamSession): number {
    return session.pendingDirectSendMessages.length + session.messageQueue.size
  }

  function replaceQueuedBacklog(
    session: StreamSession,
    messages: readonly QueuedMessage[],
    options?: { preservePendingCurrentDirectSend?: boolean },
  ): void {
    const preservedCurrentDirectSend = options?.preservePendingCurrentDirectSend && !session.currentQueuedMessage
      ? session.pendingDirectSendMessages[0]
      : undefined
    session.pendingDirectSendMessages = [
      ...(preservedCurrentDirectSend ? [preservedCurrentDirectSend] : []),
      ...messages.filter((message) => message.priority === 'high'),
    ]
    session.messageQueue = new SessionMessageQueue(
      DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
      messages.filter((message) => message.priority !== 'high'),
    )
  }

  function removePendingDirectSendById(
    session: StreamSession,
    messageId: string,
    options?: { includeCurrentSlot?: boolean },
  ): QueuedMessage | undefined {
    const startIndex = options?.includeCurrentSlot || session.currentQueuedMessage
      ? 0
      : 1
    const index = session.pendingDirectSendMessages.findIndex((message, candidateIndex) => {
      return candidateIndex >= startIndex && message.id === messageId
    })
    if (index === -1) {
      return undefined
    }

    const [removed] = session.pendingDirectSendMessages.splice(index, 1)
    return removed
  }

  function getQueuedMessageById(session: StreamSession, messageId: string): QueuedMessage | undefined {
    return session.pendingDirectSendMessages.find((message) => message.id === messageId)
      ?? session.messageQueue.list().find((message) => message.id === messageId)
  }

  function getQueueUpdatePayload(session: StreamSession): Extract<StreamJsonEvent, { type: 'queue_update' }> {
    const queuedBacklogItems = getQueuedBacklogItems(session)
    return {
      type: 'queue_update',
      queue: {
        items: queuedBacklogItems,
        currentMessage: getCurrentQueueMessage(session),
        maxSize: session.messageQueue.maxSize,
        totalCount: getQueuedBacklogCount(session),
      },
    }
  }

  function broadcastQueueUpdate(session: StreamSession): void {
    deps.broadcastStreamEvent(session, getQueueUpdatePayload(session))
  }

  function clearQueuedMessageRetry(session: StreamSession): void {
    if (session.queuedMessageRetryTimer) {
      clearTimeout(session.queuedMessageRetryTimer)
      session.queuedMessageRetryTimer = undefined
    }
    session.queuedMessageRetryMessageId = undefined
  }

  function scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void {
    if (session.queuedMessageDrainScheduled) {
      session.queuedMessageDrainPending = true
      if (options?.force) {
        session.queuedMessageDrainPendingForce = true
      }
      return
    }

    session.queuedMessageDrainScheduled = true
    queueMicrotask(() => {
      void drainQueuedMessages(session, options)
        .catch((error) => {
          console.warn(
            `[agents] Failed to drain queued messages for ${session.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
        .finally(() => {
          const pendingDrain = session.queuedMessageDrainPending
          const pendingForce = session.queuedMessageDrainPendingForce
          session.queuedMessageDrainScheduled = false
          session.queuedMessageDrainPending = false
          session.queuedMessageDrainPendingForce = false
          if (pendingDrain) {
            scheduleQueuedMessageDrain(session, pendingForce ? { force: true } : undefined)
          }
        })
    })
  }

  function isQueueBackpressureError(error: string): boolean {
    return error.startsWith('Queue is full')
  }

  function scheduleQueuedMessageRetry(session: StreamSession, messageId: string): void {
    clearQueuedMessageRetry(session)
    session.queuedMessageRetryMessageId = messageId
    const retryTarget = getQueuedMessageById(session, messageId)
    const keepHot = retryTarget?.priority === 'high'
    const delayMs = keepHot
      ? MESSAGE_QUEUE_RETRY_INITIAL_MS
      : (session.queuedMessageRetryDelayMs ?? MESSAGE_QUEUE_RETRY_INITIAL_MS)
    session.queuedMessageRetryTimer = setTimeout(() => {
      session.queuedMessageRetryTimer = undefined
      session.queuedMessageRetryMessageId = undefined
      scheduleQueuedMessageDrain(session, { force: true })
    }, delayMs)
    session.queuedMessageRetryDelayMs = keepHot
      ? MESSAGE_QUEUE_RETRY_INITIAL_MS
      : Math.min(delayMs * 2, MESSAGE_QUEUE_RETRY_MAX_MS)
  }

  function resetQueuedMessageRetryDelay(session: StreamSession): void {
    session.queuedMessageRetryDelayMs = MESSAGE_QUEUE_RETRY_INITIAL_MS
  }

  function createQueuedMessage(
    text: string,
    priority: QueuedMessagePriority,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
  ): QueuedMessage {
    return {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      ...(displayText !== undefined ? { displayText: displayText.trim() } : {}),
      images: images && images.length > 0 ? [...images] : undefined,
      ...(clientSendId ? { clientSendId } : {}),
      priority,
      queuedAt: new Date().toISOString(),
    }
  }

  function removeQueuedMessageById(session: StreamSession, messageId: string): QueuedMessage | undefined {
    return removePendingDirectSendById(session, messageId) ?? session.messageQueue.remove(messageId)
  }

  function reorderVisibleQueuedMessages(session: StreamSession, order: readonly string[]): boolean {
    const queuedBacklogItems = getQueuedBacklogItems(session)
    if (order.length !== queuedBacklogItems.length) {
      return false
    }

    const visibleById = new Map(queuedBacklogItems.map((message) => [message.id, message]))
    if (new Set(order).size !== order.length || order.some((id) => !visibleById.has(id))) {
      return false
    }

    const reorderedVisibleMessages = order.map((id) => visibleById.get(id)!)
    const preservesVisiblePriorityBands = reorderedVisibleMessages.every(
      (message, index) => message.priority === queuedBacklogItems[index]?.priority,
    )
    if (!preservesVisiblePriorityBands) {
      return false
    }

    replaceQueuedBacklog(session, reorderedVisibleMessages, { preservePendingCurrentDirectSend: true })
    return true
  }

  function clearVisibleQueuedMessages(session: StreamSession): void {
    if (getQueuedBacklogCount(session) === 0) {
      return
    }

    session.pendingDirectSendMessages = []
    session.messageQueue = new SessionMessageQueue(DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT)
    clearQueuedMessageRetry(session)
    resetQueuedMessageRetryDelay(session)
  }

  function buildPromptContent(
    text: string,
    images?: QueuedMessageImage[],
  ): string | Array<
    { type: 'text'; text: string } |
    { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > {
    if (!images || images.length === 0) {
      return text
    }

    return [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((image) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mediaType,
          data: image.data,
        },
      })),
    ]
  }

  function buildUserEvent(
    text: string,
    images?: QueuedMessageImage[],
    subtype?: string,
    displayText?: string,
    clientSendId?: string,
  ): StreamJsonEvent {
    return {
      type: 'user',
      ...(subtype ? { subtype } : {}),
      ...(displayText !== undefined ? { displayText: displayText.trim() } : {}),
      ...(clientSendId ? { clientSendId } : {}),
      message: { role: 'user', content: buildPromptContent(text, images) },
    } as unknown as StreamJsonEvent
  }

  async function attemptSendPromptToStreamSession(
    session: StreamSession,
    prompt: Pick<QueuedMessage, 'text' | 'displayText' | 'images' | 'clientSendId'>,
    options: { userEventSubtype?: string } = {},
  ): Promise<StreamSendAttemptResult> {
    const text = prompt.text
    const images = prompt.images ?? []

    if (session.adapter) {
      const result = await session.adapter.dispatchSend(
        session,
        text,
        'live',
        images,
        {
          ...options,
          displayText: prompt.displayText,
          clientSendId: prompt.clientSendId,
        },
      )
      if (!result.ok) {
        return result
      }
      return { ok: true }
    }

    const userEvent = buildUserEvent(text, images, options.userEventSubtype)
    const sent = deps.writeToStdin(session, `${JSON.stringify(userEvent)}\n`)
    if (!sent) {
      if (session.stdinDraining) {
        return { ok: false, retryable: true, reason: 'Process stdin is busy' }
      }
      return { ok: false, retryable: false, reason: 'Stream session unavailable' }
    }

    deps.resetActiveTurnState(session)
    const displayEvent = buildUserEvent(text, images, options.userEventSubtype, prompt.displayText, prompt.clientSendId)
    deps.appendStreamEvent(session, displayEvent)
    deps.broadcastStreamEvent(session, displayEvent)
    return { ok: true }
  }

  async function sendTextToStreamSession(session: StreamSession, text: string): Promise<boolean> {
    const result = await attemptSendPromptToStreamSession(session, { text })
    return result.ok
  }

  async function queueTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
  ): Promise<{ ok: true; message: QueuedMessage; position: number } | { ok: false; status: number; error: string }> {
    if (session.adapter) {
      const result = await session.adapter.dispatchSend(session, text, 'queue', images, { displayText, clientSendId })
      if (!result.ok) {
        const status = isQueueBackpressureError(result.reason) ? 409 : 400
        return { ok: false, status, error: result.reason }
      }
      if (result.delivered !== 'queued') {
        return { ok: false, status: 503, error: 'Stream session unavailable' }
      }
      broadcastQueueUpdate(session)
      deps.schedulePersistedSessionsWrite()
      return {
        ok: true,
        message: result.message,
        position: result.position,
      }
    }

    const message = createQueuedMessage(text, 'normal', images, displayText, clientSendId)
    const queued = enqueueQueuedMessage(session, message)
    if (!queued.ok) {
      return queued
    }
    return {
      ok: true,
      message,
      position: queued.position,
    }
  }

  function enqueueQueuedMessage(
    session: StreamSession,
    message: QueuedMessage,
  ): { ok: true; position: number } | { ok: false; status: number; error: string } {
    if (getQueuedBacklogCount(session) >= session.messageQueue.maxSize) {
      return { ok: false, status: 409, error: `Queue is full (max ${session.messageQueue.maxSize} messages)` }
    }

    try {
      session.messageQueue.enqueue(message)
      const position = getQueuedBacklogItems(session).findIndex((entry) => entry.id === message.id) + 1
      broadcastQueueUpdate(session)
      deps.schedulePersistedSessionsWrite()
      return { ok: true, position }
    } catch (error) {
      if (error instanceof MessageQueueFullError) {
        return { ok: false, status: 409, error: error.message }
      }
      throw error
    }
  }

  async function drainQueuedMessages(
    session: StreamSession,
    options?: { force?: boolean },
  ): Promise<void> {
    if (deps.sessions.get(session.name) !== session || session.currentQueuedMessage) {
      return
    }

    const liveSession = await deps.awaitAutoRotationIfNeeded(session.name)
    if (!liveSession || liveSession.kind !== 'stream') {
      return
    }
    if (liveSession !== session) {
      scheduleQueuedMessageDrain(liveSession, options)
      return
    }

    const nextMessage = session.pendingDirectSendMessages[0] ?? session.messageQueue.peek()
    if (!nextMessage) {
      return
    }

    if (getProvider(session.agentType)?.runtimeWatchdog && !session.lastTurnCompleted && nextMessage.priority === 'high') {
      return
    }

    if (!session.lastTurnCompleted && nextMessage.priority !== 'high' && !options?.force) {
      return
    }

    session.currentQueuedMessage = nextMessage
    broadcastQueueUpdate(session)
    deps.schedulePersistedSessionsWrite()

    const result = await attemptSendPromptToStreamSession(session, nextMessage, {
      userEventSubtype: 'queued_message',
    })
    if (!result.ok) {
      if (session.currentQueuedMessage?.id === nextMessage.id) {
        session.currentQueuedMessage = undefined
      }
      if (result.retryable) {
        broadcastQueueUpdate(session)
        deps.schedulePersistedSessionsWrite()
        scheduleQueuedMessageRetry(session, nextMessage.id)
        return
      }

      const removed = removePendingDirectSendById(session, nextMessage.id, { includeCurrentSlot: true })
        ?? session.messageQueue.remove(nextMessage.id)
      if (removed && removed.priority !== 'low') {
        const errorEvent: StreamJsonEvent = {
          type: 'system',
          text: `Queued message failed: ${result.reason}`,
        }
        deps.appendStreamEvent(session, errorEvent)
        deps.broadcastStreamEvent(session, errorEvent)
      }
      broadcastQueueUpdate(session)
      deps.schedulePersistedSessionsWrite()
      return
    }

    clearQueuedMessageRetry(session)
    resetQueuedMessageRetryDelay(session)
    removePendingDirectSendById(session, nextMessage.id, { includeCurrentSlot: true })
      ?? session.messageQueue.remove(nextMessage.id)
    broadcastQueueUpdate(session)
    deps.schedulePersistedSessionsWrite()
  }

  async function sendImmediateTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
    displayText?: string,
    clientSendId?: string,
  ): Promise<{ ok: true; queued: boolean; message: QueuedMessage } | { ok: false; error: string }> {
    const liveSession = await deps.awaitAutoRotationIfNeeded(session.name)
    if (!liveSession || liveSession.kind !== 'stream') {
      return { ok: false, error: 'Stream session unavailable' }
    }

    const message = createQueuedMessage(text, 'high', images, displayText, clientSendId)

    if (
      liveSession.lastTurnCompleted &&
      !liveSession.currentQueuedMessage &&
      liveSession.pendingDirectSendMessages.length === 0
    ) {
      liveSession.currentQueuedMessage = message
      broadcastQueueUpdate(liveSession)
      deps.schedulePersistedSessionsWrite()
      const result = await attemptSendPromptToStreamSession(liveSession, message, {
        userEventSubtype: 'queued_message',
      })
      if (result.ok) {
        clearQueuedMessageRetry(liveSession)
        resetQueuedMessageRetryDelay(liveSession)
        if (liveSession.currentQueuedMessage?.id === message.id) {
          liveSession.currentQueuedMessage = undefined
        }
        broadcastQueueUpdate(liveSession)
        deps.schedulePersistedSessionsWrite()
        return { ok: true, queued: false, message }
      }
      liveSession.currentQueuedMessage = undefined
      broadcastQueueUpdate(liveSession)
      deps.schedulePersistedSessionsWrite()
      if (!result.retryable) {
        return { ok: false, error: result.reason }
      }
    }

    if (
      !liveSession.lastTurnCompleted &&
      (
        liveSession.pendingDirectSendMessages.length === 0
        || Boolean(getProvider(liveSession.agentType)?.runtimeWatchdog)
      )
    ) {
      const result = await attemptSendPromptToStreamSession(liveSession, message, {
        userEventSubtype: 'queued_message',
      })
      if (result.ok) {
        clearQueuedMessageRetry(liveSession)
        resetQueuedMessageRetryDelay(liveSession)
        return { ok: true, queued: false, message }
      }
      if (!result.retryable) {
        return { ok: false, error: result.reason }
      }
    }

    if (getQueuedBacklogCount(liveSession) >= liveSession.messageQueue.maxSize) {
      return { ok: false, error: `Queue is full (max ${liveSession.messageQueue.maxSize} messages)` }
    }

    liveSession.pendingDirectSendMessages.unshift(message)
    broadcastQueueUpdate(liveSession)
    deps.schedulePersistedSessionsWrite()
    scheduleQueuedMessageDrain(
      liveSession,
      liveSession.lastTurnCompleted ? { force: true } : undefined,
    )
    return { ok: true, queued: true, message }
  }

  function applyRestoredQueueState(
    session: StreamSession,
    source: {
      currentQueuedMessage?: QueuedMessage
      pendingDirectSendMessages?: QueuedMessage[]
      queuedMessages?: QueuedMessage[]
    },
    queueOptions?: { includeCurrentMessage?: boolean },
  ): void {
    const restoredCurrentMessage = queueOptions?.includeCurrentMessage === false
      ? undefined
      : source.currentQueuedMessage
    const restoredPendingDirectSends = source.pendingDirectSendMessages
      ? [...source.pendingDirectSendMessages]
      : []
    const restoredQueuedMessages = source.queuedMessages
      ? [...source.queuedMessages]
      : []

    if (restoredCurrentMessage) {
      if (restoredCurrentMessage.priority === 'high') {
        restoredPendingDirectSends.unshift(restoredCurrentMessage)
      } else {
        restoredQueuedMessages.unshift(restoredCurrentMessage)
      }
    }

    session.pendingDirectSendMessages = restoredPendingDirectSends.filter((message, index, messages) => {
      return message.priority === 'high'
        && messages.findIndex((candidate) => candidate.id === message.id) === index
    })
    session.messageQueue = new SessionMessageQueue(
      DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
      restoredQueuedMessages.filter((message, index, messages) => {
        return message.priority !== 'high'
          && messages.findIndex((candidate) => candidate.id === message.id) === index
      }),
    )
    session.currentQueuedMessage = undefined
    resetQueuedMessageRetryDelay(session)
    clearQueuedMessageRetry(session)
  }

  function resumeRestoredQueueDrain(session: StreamSession): void {
    if (getQueuedBacklogCount(session) === 0) {
      return
    }
    scheduleQueuedMessageDrain(session, { force: true })
  }

  function getQueueSnapshot(session: StreamSession) {
    const queue = getQueueUpdatePayload(session).queue
    return {
      ...queue,
      items: queue.items ?? [],
      currentMessage: queue.currentMessage ?? null,
      maxSize: queue.maxSize ?? session.messageQueue.maxSize,
      totalCount: queue.totalCount ?? getQueuedBacklogCount(session),
    }
  }

  return {
    applyRestoredQueueState,
    broadcastQueueUpdate,
    clearQueuedMessageRetry,
    clearVisibleQueuedMessages,
    createQueuedMessage,
    enqueueQueuedMessage,
    getQueueSnapshot,
    getQueueUpdatePayload,
    getQueuedBacklogCount,
    isQueueBackpressureError,
    queueTextToStreamSession,
    removeQueuedMessageById,
    reorderVisibleQueuedMessages,
    resetQueuedMessageRetryDelay,
    resumeRestoredQueueDrain,
    scheduleQueuedMessageDrain,
    sendImmediateTextToStreamSession,
    sendTextToStreamSession,
  }
}
