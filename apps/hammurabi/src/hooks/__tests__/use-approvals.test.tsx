// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => 'token-123'),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    getAccessToken: mocks.getAccessToken,
  }
})

import {
  setApprovalNotificationSuppression,
  useApprovalNotificationSuppression,
  useApprovalNotifications,
  useApprovalNotificationsSuppressed,
} from '@/hooks/use-approvals'

type ApprovalNotificationsState = ReturnType<typeof useApprovalNotifications>

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  binaryType: BinaryType = 'blob'
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', Object.assign(new Event('close'), {
      code: 1000,
      reason: '',
      wasClean: true,
    }) as CloseEvent)
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', new Event('open'))
  }

  emitMessage(payload: Record<string, unknown>): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  private emit(type: 'open' | 'message' | 'error' | 'close', event: Event): void {
    const propertyHandler = this[`on${type}`] as ((event: Event) => void) | null
    propertyHandler?.(event)
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(event)
      } else {
        listener.handleEvent(event)
      }
    }
  }
}

interface NotificationsHarnessProps {
  drawerOpen?: boolean
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null
let originalWebSocket: typeof WebSocket | undefined
let latestNotifications: ApprovalNotificationsState | null = null
let latestSuppressed = false

function NotificationsHarness({ drawerOpen = false }: NotificationsHarnessProps) {
  useApprovalNotificationSuppression('approval-drawer-test', drawerOpen)
  const suppressed = useApprovalNotificationsSuppressed()
  latestSuppressed = suppressed
  latestNotifications = useApprovalNotifications({
    maxVisible: 10,
    suppressNotifications: suppressed,
    ttlMs: null,
  })
  return null
}

async function renderHarness(props: NotificationsHarnessProps = {}): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(NotificationsHarness, props),
      ),
    )
  })
  await vi.waitFor(() => {
    expect(FakeWebSocket.instances.length).toBe(1)
  })
}

async function rerenderHarness(props: NotificationsHarnessProps = {}): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(NotificationsHarness, props),
      ),
    )
  })
}

function buildApproval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'approval-1',
    requestId: 'request-1',
    actionLabel: 'Send Email',
    source: 'codex',
    commanderName: 'Atlas',
    requestedAt: '2026-05-30T14:00:00.000Z',
    summary: 'Review the outbound message.',
    ...overrides,
  }
}

describe('useApprovalNotifications', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    latestNotifications = null
    latestSuppressed = false
    originalWebSocket = window.WebSocket
    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    mocks.getAccessToken.mockReset()
    mocks.getAccessToken.mockResolvedValue('token-123')
  })

  afterEach(async () => {
    setApprovalNotificationSuppression('approval-drawer-test', false)
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    queryClient?.clear()
    queryClient = null
    root = null
    container?.remove()
    container = null
    window.WebSocket = originalWebSocket as typeof WebSocket
    vi.clearAllMocks()
  })

  it('removes an approval notification when the stream resolves the matching request id', async () => {
    await renderHarness()
    const socket = FakeWebSocket.instances[0]

    await act(async () => {
      socket.emitOpen()
      socket.emitMessage({
        type: 'approval.enqueued',
        approval: buildApproval({
          id: 'approval-visible-id',
          requestId: 'request-42',
        }),
      })
    })

    await vi.waitFor(() => {
      expect(latestNotifications?.notifications).toHaveLength(1)
    })
    expect(latestNotifications?.notifications[0]?.approval.id).toBe('approval-visible-id')

    await act(async () => {
      socket.emitMessage({
        type: 'approval.resolved',
        approvalId: 'request-42',
      })
    })

    await vi.waitFor(() => {
      expect(latestNotifications?.notifications).toHaveLength(0)
    })
  })

  it('suppresses drawer-visible approvals without notifying them again after the drawer closes', async () => {
    await renderHarness({ drawerOpen: true })
    const socket = FakeWebSocket.instances[0]

    await vi.waitFor(() => {
      expect(latestSuppressed).toBe(true)
    })

    await act(async () => {
      socket.emitOpen()
      socket.emitMessage({
        type: 'approval.enqueued',
        approval: buildApproval(),
      })
    })

    expect(latestNotifications?.notifications).toHaveLength(0)

    await rerenderHarness({ drawerOpen: false })
    await vi.waitFor(() => {
      expect(latestSuppressed).toBe(false)
    })

    await act(async () => {
      socket.emitMessage({
        type: 'approval.enqueued',
        approval: buildApproval(),
      })
    })

    expect(latestNotifications?.notifications).toHaveLength(0)
  })
})
