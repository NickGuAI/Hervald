import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/api'
import { getWsBase } from '@/lib/api-base'
import type { SessionQueueSnapshot, StreamEvent } from '@/types'
import { useStreamEventProcessor } from '../../modules/agents/components/use-stream-event-processor'
import { capMessages, createUserMessage, type MsgItem } from '../../modules/agents/messages/model'
import {
  EMPTY_QUEUE_SNAPSHOT,
  normalizeQueueSnapshot,
} from '../../modules/agents/queue-state'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../../modules/agents/ws-reconnect'

export type AgentSessionStreamStatus = 'connecting' | 'connected' | 'disconnected'
export interface AgentSessionStreamInputImage {
  mediaType: string
  data: string
}

export interface AgentSessionStreamSendInput {
  text: string
  images?: AgentSessionStreamInputImage[]
}

export function decodeAgentSessionSocketData(data: unknown): string | null {
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data)
  }
  return null
}

export function agentSessionWsUrl(sessionName: string, token: string | null): string {
  const params = new URLSearchParams()
  if (token) {
    params.set('access_token', token)
  }

  const query = params.toString()
  const sessionPath = `/api/agents/sessions/${encodeURIComponent(sessionName)}/ws`
  const suffix = query ? `?${query}` : ''
  const wsBase = getWsBase()
  if (wsBase) {
    return `${wsBase}${sessionPath}${suffix}`
  }

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${sessionPath}${suffix}`
}

interface AgentSessionStreamOptions {
  enabled?: boolean
  onQueueUpdate?: (snapshot: SessionQueueSnapshot) => void
}

/**
 * POST the pending input to the queue-backed /message endpoint when the
 * WebSocket transport is not available (reconnecting, disconnected, or never
 * attached). Kept as a standalone export so test harnesses can exercise the
 * fallback path without having to render the full hook with a mocked
 * WebSocket lifecycle.
 *
 * Returns true if the POST succeeded (response.ok), false otherwise. Never
 * throws — all errors are converted to a false return so callers can decide
 * how to surface the failure in the UI.
 */
export async function postInputViaHttpFallback(
  sessionName: string,
  body: AgentSessionStreamSendInput,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const token = await getToken()
    const response = await fetchImpl(`/api/agents/sessions/${encodeURIComponent(sessionName)}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text: body.text,
        images: body.images && body.images.length > 0 ? body.images : undefined,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

export function useAgentSessionStream(sessionName?: string, options: AgentSessionStreamOptions = {}) {
  const enabled = options.enabled ?? true
  const onQueueUpdate = options.onQueueUpdate
  const {
    messages,
    processEvent,
    resetMessages,
    setMessages,
    isStreaming,
    markAskAnswered,
  } = useStreamEventProcessor({})
  const [status, setStatus] = useState<AgentSessionStreamStatus>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  // Track the previously-seen sessionName so we only reset optimistic/rendered
  // messages when the caller genuinely switches sessions. Without this, every
  // WS-setup effect re-run (enabled flicker, processEvent/resetMessages
  // identity change, etc.) would wipe the optimistic message added by
  // sendInput and make follow-up sends appear to no-op.
  const prevSessionNameRef = useRef<string | undefined>(undefined)

  // Reset messages + queue ONLY when sessionName changes. Kept separate from
  // the WS-setup effect so dep-identity churn on other values (enabled,
  // processEvent identity, onQueueUpdate identity) never wipes state mid-turn.
  useEffect(() => {
    if (prevSessionNameRef.current !== sessionName) {
      resetMessages()
      onQueueUpdate?.(EMPTY_QUEUE_SNAPSHOT)
      prevSessionNameRef.current = sessionName
    }
  }, [sessionName, resetMessages, onQueueUpdate])

  useEffect(() => {
    if (!sessionName || !enabled) {
      setStatus('disconnected')
      return
    }

    let disposed = false
    let reconnectTimer: number | null = null
    const reconnectBackoff = createReconnectBackoff()

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return
      }

      setStatus('connecting')
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, reconnectBackoff.nextDelayMs())
    }

    const connect = async () => {
      clearReconnectTimer()
      setStatus('connecting')

      const token = await getAccessToken()
      if (disposed) {
        return
      }

      const nextSocket = new WebSocket(agentSessionWsUrl(sessionName, token))
      wsRef.current = nextSocket

      nextSocket.onopen = () => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }
        reconnectBackoff.reset()
        setStatus('connected')
      }

      nextSocket.onclose = (event) => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }

        wsRef.current = null
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect()
          return
        }

        setStatus('disconnected')
      }

      nextSocket.onerror = () => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }

        if (
          nextSocket.readyState === WebSocket.CONNECTING
          || nextSocket.readyState === WebSocket.OPEN
        ) {
          nextSocket.close()
        }
      }

      nextSocket.onmessage = (event) => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }

        const rawText = decodeAgentSessionSocketData(event.data)
        if (!rawText) {
          return
        }

        try {
          const raw = JSON.parse(rawText) as {
            type?: string
            events?: StreamEvent[]
            queue?: SessionQueueSnapshot
            toolId?: string
          }
          if (raw.type === 'replay' && Array.isArray(raw.events)) {
            resetMessages()
            for (const replayEvent of raw.events) {
              if (replayEvent.type === 'queue_update') {
                onQueueUpdate?.(normalizeQueueSnapshot(replayEvent.queue))
                continue
              }
              processEvent(replayEvent, true)
            }
            return
          }
          if (raw.type === 'queue_update') {
            onQueueUpdate?.(normalizeQueueSnapshot(raw.queue))
            return
          }
          if (raw.type === 'tool_answer_ack' && raw.toolId) {
            markAskAnswered(raw.toolId)
            setMessages((prev) => prev.map((message) => (
              message.toolId === raw.toolId
                ? { ...message, askSubmitting: false }
                : message
            )))
            return
          }
          if (raw.type === 'tool_answer_error' && raw.toolId) {
            setMessages((prev) => prev.map((message) => (
              message.toolId === raw.toolId
                ? { ...message, askSubmitting: false }
                : message
            )))
            return
          }
          processEvent(raw as StreamEvent)
        } catch {
          // Ignore malformed websocket payloads and keep the stream alive.
        }
      }
    }

    void connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, onQueueUpdate, processEvent, resetMessages, sessionName])

  const sendInput = useCallback(async ({ text, images }: AgentSessionStreamSendInput): Promise<boolean> => {
    const trimmed = text.trim()
    const hasContent = trimmed.length > 0 || Boolean(images && images.length > 0)
    if (!sessionName || !hasContent) {
      return false
    }

    const socket = wsRef.current
    const optimisticId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticMessage = createUserMessage(optimisticId, trimmed || '[image]', images)
    const imagesPayload = images && images.length > 0 ? images : undefined

    if (socket?.readyState === WebSocket.OPEN) {
      setMessages((prev) => capMessages([...prev, optimisticMessage]))
      socket.send(JSON.stringify({ type: 'input', text: trimmed, images: imagesPayload }))
      return true
    }

    // WS is not OPEN (reconnecting, disconnected, or never-connected). Fall
    // back to POST /api/agents/sessions/:name/message — the queue-backed HTTP
    // route waits for turn completion on the server side and can resume
    // delivery even when raw stdin writes fail. This matches the doctrine
    // noted in .claude/rules/hammurabi.md under "workers send vs queued
    // session messages" and makes follow-up sends reliable during the
    // reconnect window.
    const fallbackOk = await postInputViaHttpFallback(
      sessionName,
      { text: trimmed, images: imagesPayload },
      getAccessToken,
    )
    if (!fallbackOk) {
      return false
    }
    setMessages((prev) => capMessages([...prev, optimisticMessage]))
    return true
  }, [sessionName, setMessages])

  const answerQuestion = useCallback((toolId: string, answers: Record<string, string[]>) => {
    const socket = wsRef.current
    if (!toolId || socket?.readyState !== WebSocket.OPEN) {
      return false
    }

    setMessages((prev: MsgItem[]) => prev.map((message) => (
      message.toolId === toolId ? { ...message, askSubmitting: true } : message
    )))
    socket.send(JSON.stringify({ type: 'tool_answer', toolId, answers }))
    return true
  }, [setMessages])

  return {
    messages,
    sendInput,
    answerQuestion,
    isStreaming,
    status,
  }
}
