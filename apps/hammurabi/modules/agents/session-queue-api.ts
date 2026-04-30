import { fetchJson } from '@/lib/api'
import type { SessionQueueSnapshot } from '@/types'

interface QueueMessagePayload {
  text: string
  images?: { mediaType: string; data: string }[]
}

function sessionQueueBasePath(sessionName: string): string {
  return `/api/agents/sessions/${encodeURIComponent(sessionName)}`
}

export async function fetchSessionQueueSnapshot(sessionName: string): Promise<SessionQueueSnapshot> {
  return fetchJson<SessionQueueSnapshot>(`${sessionQueueBasePath(sessionName)}/queue`)
}

export async function queueSessionMessage(
  sessionName: string,
  payload: QueueMessagePayload,
): Promise<unknown> {
  return fetchJson(`${sessionQueueBasePath(sessionName)}/message?queue=true`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function reorderSessionQueue(
  sessionName: string,
  order: string[],
): Promise<unknown> {
  return fetchJson(`${sessionQueueBasePath(sessionName)}/queue/reorder`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ order }),
  })
}

export async function removeQueuedSessionMessage(
  sessionName: string,
  messageId: string,
): Promise<unknown> {
  return fetchJson(`${sessionQueueBasePath(sessionName)}/queue/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  })
}

export async function clearSessionQueue(sessionName: string): Promise<unknown> {
  return fetchJson(`${sessionQueueBasePath(sessionName)}/queue`, {
    method: 'DELETE',
  })
}
