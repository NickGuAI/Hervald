import { asObject } from '../../session/state.js'
import type { CodexProtocolMessage } from '../../types.js'

interface RawCodexProtocolPayload {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export interface ParsedCodexProtocolPayload {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
  threadId?: string
}

export function parseCodexProtocolPayload(payloadText: string): ParsedCodexProtocolPayload {
  const payload = JSON.parse(payloadText) as RawCodexProtocolPayload
  const method = typeof payload.method === 'string' ? payload.method.trim() : undefined
  if (!method) {
    return {
      ...(typeof payload.id === 'number' ? { id: payload.id } : {}),
      result: payload.result,
      error: payload.error,
    }
  }

  const params = asObject(payload.params)
  const threadId = typeof params?.threadId === 'string' && params.threadId.trim().length > 0
    ? params.threadId.trim()
    : undefined

  return {
    ...(typeof payload.id === 'number' ? { id: payload.id } : {}),
    method,
    params: payload.params,
    result: payload.result,
    error: payload.error,
    threadId,
  }
}

export function toCodexProtocolMessage(
  payload: ParsedCodexProtocolPayload,
): CodexProtocolMessage | null {
  if (!payload.method) {
    return null
  }

  return {
    method: payload.method,
    params: payload.params,
    ...(typeof payload.id === 'number' ? { requestId: payload.id } : {}),
  }
}
