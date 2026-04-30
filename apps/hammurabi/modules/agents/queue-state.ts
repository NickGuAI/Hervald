import type { QueuedMessage, SessionQueueSnapshot } from '@/types'

export const EMPTY_QUEUE_SNAPSHOT: SessionQueueSnapshot = {
  items: [],
  currentMessage: null,
  totalCount: 0,
}

export function getQueuePendingCount(snapshot?: SessionQueueSnapshot | null): number {
  if (typeof snapshot?.totalCount === 'number') {
    return snapshot.totalCount
  }

  const items = Array.isArray(snapshot?.items) ? snapshot.items.length : 0
  return items + (snapshot?.currentMessage ? 1 : 0)
}

export function normalizeQueueSnapshot(snapshot?: SessionQueueSnapshot | null): SessionQueueSnapshot {
  return {
    items: Array.isArray(snapshot?.items) ? snapshot.items : [],
    currentMessage: snapshot?.currentMessage ?? null,
    maxSize: typeof snapshot?.maxSize === 'number' ? snapshot.maxSize : undefined,
    totalCount: getQueuePendingCount(snapshot),
  }
}

export function formatQueuePreview(
  value: string | Pick<QueuedMessage, 'text' | 'images'>,
  maxLength = 96,
): string {
  const text = typeof value === 'string' ? value : value.text
  const imageCount = typeof value === 'string' ? 0 : (value.images?.length ?? 0)
  const normalized = text.replace(/\s+/g, ' ').trim()
  const imageLabel = imageCount > 0
    ? `${imageCount} image${imageCount === 1 ? '' : 's'}`
    : ''

  if (!normalized) {
    return imageLabel
  }

  const truncatedText = normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`

  return imageLabel ? `${truncatedText} · ${imageLabel}` : truncatedText
}

export function getQueuedMessageLabel(message: Pick<QueuedMessage, 'priority'>): string {
  if (message.priority === 'high') return 'send'
  if (message.priority === 'low') return 'heartbeat'
  return 'queued'
}
