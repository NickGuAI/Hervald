import { useEffect, useState } from 'react'
import type { StreamEvent } from '@/types'
import { getAccessToken } from '@/lib/api'
import {
  agentSessionWsUrl,
  decodeAgentSessionSocketData,
  type AgentSessionStreamStatus,
} from '@/hooks/use-agent-session-stream'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../agents/ws-reconnect'

const MAX_FLEET_STREAM_EVENTS = 600

export interface FleetSessionStreamSnapshot {
  status: AgentSessionStreamStatus
  events: StreamEvent[]
}

export type FleetSessionStreamMap = Record<string, FleetSessionStreamSnapshot>

function trimEvents(events: StreamEvent[]): StreamEvent[] {
  return events.length > MAX_FLEET_STREAM_EVENTS
    ? events.slice(-MAX_FLEET_STREAM_EVENTS)
    : events
}

export function useFleetSessionStreams(
  sessionNames: readonly string[],
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true
  const requestedNames = [...new Set(
    sessionNames
      .map((sessionName) => sessionName.trim())
      .filter((sessionName) => sessionName.length > 0),
  )].sort()
  const sessionKey = requestedNames.join('|')
  const [streams, setStreams] = useState<FleetSessionStreamMap>({})

  useEffect(() => {
    if (!enabled || requestedNames.length === 0) {
      setStreams({})
      return
    }

    let disposed = false
    const requestedSet = new Set(requestedNames)
    const sockets = new Map<string, WebSocket>()
    const reconnectTimers = new Map<string, number>()
    const reconnectBackoffs = new Map<string, ReturnType<typeof createReconnectBackoff>>()

    setStreams((current) => {
      const next: FleetSessionStreamMap = {}
      for (const sessionName of requestedNames) {
        next[sessionName] = current[sessionName] ?? {
          status: 'disconnected',
          events: [],
        }
      }
      return next
    })

    const setSnapshot = (
      sessionName: string,
      updater: (current: FleetSessionStreamSnapshot) => FleetSessionStreamSnapshot,
    ) => {
      setStreams((current) => {
        if (!requestedSet.has(sessionName)) {
          return current
        }

        const previous = current[sessionName] ?? {
          status: 'disconnected' as const,
          events: [],
        }
        return {
          ...current,
          [sessionName]: updater(previous),
        }
      })
    }

    const clearReconnectTimer = (sessionName: string) => {
      const reconnectTimer = reconnectTimers.get(sessionName)
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
        reconnectTimers.delete(sessionName)
      }
    }

    const scheduleReconnect = (sessionName: string) => {
      if (disposed || reconnectTimers.has(sessionName)) {
        return
      }

      setSnapshot(sessionName, (current) => ({ ...current, status: 'connecting' }))
      const reconnectBackoff = reconnectBackoffs.get(sessionName) ?? createReconnectBackoff()
      reconnectBackoffs.set(sessionName, reconnectBackoff)
      const reconnectTimer = window.setTimeout(() => {
        reconnectTimers.delete(sessionName)
        void connect(sessionName)
      }, reconnectBackoff.nextDelayMs())
      reconnectTimers.set(sessionName, reconnectTimer)
    }

    const connect = async (sessionName: string) => {
      clearReconnectTimer(sessionName)
      setSnapshot(sessionName, (current) => ({ ...current, status: 'connecting' }))

      const token = await getAccessToken()
      if (disposed || !requestedSet.has(sessionName)) {
        return
      }

      const nextSocket = new WebSocket(agentSessionWsUrl(sessionName, token))
      sockets.set(sessionName, nextSocket)

      nextSocket.onopen = () => {
        if (disposed || sockets.get(sessionName) !== nextSocket) {
          return
        }
        reconnectBackoffs.get(sessionName)?.reset()
        setSnapshot(sessionName, (current) => ({ ...current, status: 'connected' }))
      }

      nextSocket.onclose = (event) => {
        if (disposed || sockets.get(sessionName) !== nextSocket) {
          return
        }

        sockets.delete(sessionName)
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect(sessionName)
          return
        }

        setSnapshot(sessionName, (current) => ({ ...current, status: 'disconnected' }))
      }

      nextSocket.onerror = () => {
        if (disposed || sockets.get(sessionName) !== nextSocket) {
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
        if (disposed || sockets.get(sessionName) !== nextSocket) {
          return
        }

        const rawText = decodeAgentSessionSocketData(event.data)
        if (!rawText) {
          return
        }

        try {
          const payload = JSON.parse(rawText) as {
            type?: string
            events?: StreamEvent[]
          }
          if (payload.type === 'replay' && Array.isArray(payload.events)) {
            setSnapshot(sessionName, (current) => ({
              ...current,
              status: 'connected',
              events: trimEvents(payload.events),
            }))
            return
          }
          if (payload.type === 'queue_update') {
            return
          }
          setSnapshot(sessionName, (current) => ({
            ...current,
            events: trimEvents([...current.events, payload as StreamEvent]),
          }))
        } catch {
          // Ignore malformed payloads and keep the stream alive.
        }
      }
    }

    for (const sessionName of requestedNames) {
      reconnectBackoffs.set(sessionName, createReconnectBackoff())
      void connect(sessionName)
    }

    return () => {
      disposed = true
      for (const reconnectTimer of reconnectTimers.values()) {
        window.clearTimeout(reconnectTimer)
      }
      reconnectTimers.clear()
      for (const socket of sockets.values()) {
        socket.close()
      }
      sockets.clear()
    }
  }, [enabled, sessionKey])

  return { streams }
}
