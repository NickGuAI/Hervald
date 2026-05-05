export interface AgentSessionStreamInputImage {
  mediaType: string
  data: string
}

export interface SendInput {
  text: string
  images?: AgentSessionStreamInputImage[]
}

export type PaintOptimistic = (text: string, images?: AgentSessionStreamInputImage[]) => void

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
  readonly submitConversationMessage: (input: { message: string }) => Promise<boolean>
}

const DEFAULT_WEBSOCKET_OPEN_STATE = 1

function normalizeInput({ text, images }: SendInput) {
  const trimmed = text.trim()
  const imagesPayload = images && images.length > 0 ? images : undefined
  const hasContent = trimmed.length > 0 || Boolean(imagesPayload)

  return { trimmed, imagesPayload, hasContent }
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
      const { trimmed, imagesPayload, hasContent } = normalizeInput(input)
      if (!sessionName || !hasContent) {
        return false
      }

      const socket = wsRef.current
      if (socket?.readyState === openReadyState) {
        paintOptimistic(trimmed, imagesPayload)
        socket.send(JSON.stringify({ type: 'input', text: trimmed, images: imagesPayload }))
        return true
      }

      paintOptimistic(trimmed, imagesPayload)
      return fallbackHttp({ text: trimmed, images: imagesPayload })
    },
  }
}

export function createHttpConversationDispatcher({
  submitConversationMessage,
}: HttpConversationDispatcherOptions): SendDispatcher {
  return {
    mode: 'http-conversation',
    async send(input, paintOptimistic) {
      const { trimmed, imagesPayload, hasContent } = normalizeInput(input)
      if (!hasContent || imagesPayload) {
        return false
      }

      paintOptimistic(trimmed)
      return submitConversationMessage({ message: trimmed })
    },
  }
}
