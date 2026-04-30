import { randomUUID } from 'node:crypto'

type AsyncTask<T> = () => Promise<T> | T

export type QueuedMessagePriority = 'high' | 'normal' | 'low'

export interface QueuedMessageImage {
  mediaType: string
  data: string
}

export interface QueuedMessage {
  id: string
  text: string
  images?: QueuedMessageImage[]
  priority: QueuedMessagePriority
  queuedAt: string
}

export interface SessionMessageQueueState {
  items: QueuedMessage[]
  limit: number
}

export const DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT = 20

function priorityRank(priority: QueuedMessagePriority): number {
  if (priority === 'high') return 0
  if (priority === 'normal') return 1
  return 2
}

function normalizeQueueState(items: readonly QueuedMessage[]): QueuedMessage[] {
  const grouped: Record<QueuedMessagePriority, QueuedMessage[]> = {
    high: [],
    normal: [],
    low: [],
  }

  for (const item of items) {
    grouped[item.priority].push(item)
  }

  return [...grouped.high, ...grouped.normal, ...grouped.low]
}

export class MessageQueueFullError extends Error {
  readonly limit: number

  constructor(limit: number) {
    super(`Queue is full (max ${limit} messages)`)
    this.limit = limit
    this.name = 'MessageQueueFullError'
  }
}

export class SessionMessageQueue {
  private items: QueuedMessage[]

  constructor(
    private readonly limit = DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
    initialItems: readonly QueuedMessage[] = [],
  ) {
    this.items = normalizeQueueState(initialItems)
  }

  get size(): number {
    return this.items.length
  }

  get maxSize(): number {
    return this.limit
  }

  enqueue(input: {
    text: string
    images?: QueuedMessageImage[]
    priority?: QueuedMessagePriority
    id?: string
    queuedAt?: string
  }): { message: QueuedMessage; position: number } {
    if (this.items.length >= this.limit) {
      throw new MessageQueueFullError(this.limit)
    }

    const priority = input.priority ?? 'normal'
    const message: QueuedMessage = {
      id: input.id?.trim() || randomUUID(),
      text: input.text,
      images: input.images && input.images.length > 0 ? [...input.images] : undefined,
      priority,
      queuedAt: input.queuedAt ?? new Date().toISOString(),
    }

    const insertIndex = this.items.findIndex((entry) => priorityRank(entry.priority) > priorityRank(priority))
    if (insertIndex === -1) {
      this.items.push(message)
    } else {
      this.items.splice(insertIndex, 0, message)
    }

    return {
      message,
      position: this.items.findIndex((entry) => entry.id === message.id) + 1,
    }
  }

  dequeue(): QueuedMessage | undefined {
    return this.items.shift()
  }

  peek(): QueuedMessage | undefined {
    return this.items[0]
  }

  clear(): void {
    this.items = []
  }

  remove(id: string): QueuedMessage | undefined {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index === -1) {
      return undefined
    }
    const [removed] = this.items.splice(index, 1)
    return removed
  }

  reorder(order: readonly string[]): boolean {
    if (order.length !== this.items.length) {
      return false
    }

    const ids = new Set(order)
    if (ids.size !== order.length || this.items.some((entry) => !ids.has(entry.id))) {
      return false
    }

    const orderIndex = new Map(order.map((id, index) => [id, index]))
    this.items = [...this.items].sort((left, right) => {
      const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority)
      if (priorityDiff !== 0) {
        return priorityDiff
      }
      return (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    })
    return true
  }

  list(): QueuedMessage[] {
    return [...this.items]
  }

  snapshot(): SessionMessageQueueState {
    return {
      items: this.list(),
      limit: this.limit,
    }
  }
}

export class KeyedAsyncQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  enqueue<T>(key: string, task: AsyncTask<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => task())
    const next = run.finally(() => {
      if (this.tails.get(key) === next) {
        this.tails.delete(key)
      }
    })
    this.tails.set(key, next)
    return run
  }

  clear(key: string): void {
    this.tails.delete(key)
  }
}

export function enqueueKeyedTask<T>(
  queue: KeyedAsyncQueue,
  key: string,
  task: AsyncTask<T>,
): Promise<T> {
  return queue.enqueue(key, task)
}
