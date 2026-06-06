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
  threadIds?: string[]
}

function readThreadIdCandidate(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function collectThreadIds(value: unknown, ids: Set<string>, depth = 0): void {
  if (depth > 4 || !value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectThreadIds(entry, ids, depth + 1)
    }
    return
  }

  const record = value as Record<string, unknown>
  const directThreadId = readThreadIdCandidate(record.threadId)
  if (directThreadId) {
    ids.add(directThreadId)
  }
  const conversationId = readThreadIdCandidate(record.conversationId)
  if (conversationId) {
    ids.add(conversationId)
  }

  const threadObject = asObject(record.thread)
  const nestedThreadId = readThreadIdCandidate(threadObject?.id)
  if (nestedThreadId) {
    ids.add(nestedThreadId)
  }

  for (const nested of Object.values(record)) {
    collectThreadIds(nested, ids, depth + 1)
  }
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
  const threadIds = new Set<string>()
  collectThreadIds(params, threadIds)
  const normalizedThreadIds = [...threadIds]
  const threadId = normalizedThreadIds[0]

  return {
    ...(typeof payload.id === 'number' ? { id: payload.id } : {}),
    method,
    params: payload.params,
    result: payload.result,
    error: payload.error,
    ...(threadId ? { threadId } : {}),
    ...(normalizedThreadIds.length > 0 ? { threadIds: normalizedThreadIds } : {}),
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
