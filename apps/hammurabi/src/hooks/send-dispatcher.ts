import type { WorkspaceContextPayload } from '@modules/workspace/types'

export interface AgentSessionStreamInputImage {
  mediaType: string
  data: string
}

export interface SendInput {
  text: string
  images?: AgentSessionStreamInputImage[]
  clientSendId?: string
  workspaceContext?: WorkspaceContextPayload
}

export type PaintOptimistic = (
  text: string,
  images?: AgentSessionStreamInputImage[],
  clientSendId?: string,
) => void

export interface SendDispatcher {
  /** Mode label for logging and debugging. */
  readonly mode: 'ws-direct' | 'http-conversation'

  /**
   * Single user-send entry point. Implementations must call
   * paintOptimistic(text, images) before dispatching transport.
   * Returning false skips both when content is empty or the dispatcher is disabled.
   */
  send(input: SendInput, paintOptimistic: PaintOptimistic): Promise<boolean>
}

interface WritableSocket {
  readonly readyState: number
  send(data: string): void
}

interface WsDirectDispatcherOptions {
  readonly wsRef: { readonly current: WritableSocket | null }
  readonly sessionName?: string
  readonly fallbackHttp: (input: SendInput) => Promise<boolean>
  readonly openReadyState?: number
}

interface HttpConversationDispatcherOptions {
  readonly submitConversationMessage: (input: {
    message: string
    images?: AgentSessionStreamInputImage[]
    clientSendId?: string
    workspaceContext?: WorkspaceContextPayload
  }) => Promise<boolean>
}

const DEFAULT_WEBSOCKET_OPEN_STATE = 1

function normalizeInput(input: SendInput) {
  const trimmed = input.text.trim()
  const imagesPayload = input.images && input.images.length > 0 ? input.images : undefined
  const clientSendId = typeof input.clientSendId === 'string' && input.clientSendId.trim().length > 0
    ? input.clientSendId.trim()
    : undefined
  const hasContext = Boolean(
    input.workspaceContext?.filePaths?.length
    || input.workspaceContext?.directoryPaths?.length
    || input.workspaceContext?.fileAnnotations?.length,
  )
  const hasContent = trimmed.length > 0 || Boolean(imagesPayload) || hasContext

  return { trimmed, imagesPayload, clientSendId, hasContent }
}

function paintOptimisticMessage(
  paintOptimistic: PaintOptimistic,
  text: string,
  images?: AgentSessionStreamInputImage[],
  clientSendId?: string,
) {
  if (clientSendId) {
    paintOptimistic(text, images, clientSendId)
    return
  }
  paintOptimistic(text, images)
}

export function createWsDirectDispatcher({
  wsRef,
  sessionName,
  fallbackHttp,
  openReadyState = DEFAULT_WEBSOCKET_OPEN_STATE,
}: WsDirectDispatcherOptions): SendDispatcher {
  return {
    mode: 'ws-direct',
    async send(input, paintOptimistic) {
      const { trimmed, imagesPayload, clientSendId, hasContent } = normalizeInput(input)
      if (!sessionName || !hasContent) {
        return false
      }

      const socket = wsRef.current
      if (imagesPayload) {
        paintOptimisticMessage(paintOptimistic, trimmed, imagesPayload, clientSendId)
        return fallbackHttp({
          text: trimmed,
          images: imagesPayload,
          ...(clientSendId ? { clientSendId } : {}),
          ...(input.workspaceContext ? { workspaceContext: input.workspaceContext } : {}),
        })
      }

      if (socket?.readyState === openReadyState) {
        paintOptimisticMessage(paintOptimistic, trimmed, imagesPayload, clientSendId)
        socket.send(JSON.stringify({
          type: 'input',
          text: trimmed,
          images: imagesPayload,
          clientSendId,
          workspaceContext: input.workspaceContext,
        }))
        return true
      }

      paintOptimisticMessage(paintOptimistic, trimmed, imagesPayload, clientSendId)
      return fallbackHttp({
        text: trimmed,
        images: imagesPayload,
        ...(clientSendId ? { clientSendId } : {}),
        ...(input.workspaceContext ? { workspaceContext: input.workspaceContext } : {}),
      })
    },
  }
}

export function createHttpConversationDispatcher({
  submitConversationMessage,
}: HttpConversationDispatcherOptions): SendDispatcher {
  return {
    mode: 'http-conversation',
    async send(input, paintOptimistic) {
      const { trimmed, imagesPayload, clientSendId, hasContent } = normalizeInput(input)
      if (!hasContent) {
        return false
      }

      paintOptimisticMessage(paintOptimistic, trimmed, imagesPayload, clientSendId)
      return submitConversationMessage({
        message: trimmed,
        images: imagesPayload,
        ...(clientSendId ? { clientSendId } : {}),
        ...(input.workspaceContext ? { workspaceContext: input.workspaceContext } : {}),
      })
    },
  }
}
