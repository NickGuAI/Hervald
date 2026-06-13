// @vitest-environment jsdom

import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalNotification, PendingApproval } from '@/hooks/use-approvals'

const mocks = vi.hoisted(() => ({
  dismissNotification: vi.fn(),
  useApprovalNotifications: vi.fn(),
}))

vi.mock('@/hooks/use-approvals', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-approvals')>('@/hooks/use-approvals')
  return {
    ...actual,
    useApprovalNotifications: mocks.useApprovalNotifications,
  }
})

import { ApprovalNotificationCenter } from '../ApprovalNotificationCenter'

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'approval-1',
    decisionId: 'approval-1',
    actionLabel: 'Send Email',
    actionId: 'email.send',
    source: 'codex',
    commanderId: 'commander-1',
    commanderName: 'Atlas',
    sessionName: 'atlas-dev',
    requestedAt: '2026-05-30T14:00:00.000Z',
    requestId: 'approval-1',
    reason: null,
    risk: null,
    summary: 'Review the outbound message before it is sent.',
    previewText: null,
    details: [],
    raw: {},
    context: null,
    ...overrides,
  }
}

async function renderCenter(
  notifications: ApprovalNotification[],
  options: {
    connectionStatus?: 'connecting' | 'connected' | 'disconnected'
    maxVisible?: number
  } = {},
) {
  const maxVisible = options.maxVisible ?? notifications.length
  const visibleNotifications = notifications.slice(0, maxVisible)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.useApprovalNotifications.mockReturnValue({
    notifications,
    visibleNotifications,
    hiddenNotificationCount: Math.max(0, notifications.length - visibleNotifications.length),
    dismissNotification: mocks.dismissNotification,
    connectionStatus: options.connectionStatus ?? 'connected',
  })

  await act(async () => {
    flushSync(() => {
      root?.render(
        <MemoryRouter>
          <ApprovalNotificationCenter />
        </MemoryRouter>,
      )
    })
  })
}

describe('ApprovalNotificationCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-30T14:05:00.000Z'))
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders pending approval notifications with a review link', async () => {
    await renderCenter([
      {
        id: 'notification-1',
        approval: buildApproval(),
        createdAt: Date.now(),
      },
    ])

    expect(document.body.textContent).toContain('Approval requested')
    expect(document.body.textContent).toContain('Send Email')
    expect(document.body.textContent).toContain('Atlas')
    expect(document.body.textContent).toContain('Review the outbound message')
    expect(document.body.querySelector('a[href="/approvals"]')?.textContent).toBe('Review')
  })

  it('dismisses a notification', async () => {
    await renderCenter([
      {
        id: 'notification-1',
        approval: buildApproval(),
        createdAt: Date.now(),
      },
    ])

    const dismissButton = document.body.querySelector('button[aria-label="Dismiss Send Email"]') as HTMLButtonElement
    expect(dismissButton).not.toBeNull()

    act(() => {
      dismissButton.click()
    })

    expect(mocks.dismissNotification).toHaveBeenCalledWith('notification-1')
  })

  it('renders nothing when there are no notifications', async () => {
    await renderCenter([])

    expect(document.body.textContent).toBe('')
    expect(document.body.querySelector('[aria-label="Approval notifications"]')).toBeNull()
  })

  it('renders the disconnected stream status even when there are no notifications', async () => {
    await renderCenter([], { connectionStatus: 'disconnected' })

    expect(document.body.textContent).toContain('Approval stream disconnected')
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
  })

  it('shows an overflow link when more approvals are pending than visible cards', async () => {
    await renderCenter([
      {
        id: 'notification-1',
        approval: buildApproval({ id: 'approval-1', decisionId: 'approval-1', actionLabel: 'Send Email' }),
        createdAt: Date.now(),
      },
      {
        id: 'notification-2',
        approval: buildApproval({ id: 'approval-2', decisionId: 'approval-2', actionLabel: 'Deploy Service' }),
        createdAt: Date.now(),
      },
    ], { maxVisible: 1 })

    expect(document.body.textContent).toContain('Send Email')
    expect(document.body.textContent).not.toContain('Deploy Service')
    expect(document.body.textContent).toContain('1 more approval awaiting review')
    const approvalLinks = Array.from(document.body.querySelectorAll('a[href="/approvals"]'))
    expect(approvalLinks.some((link) => link.textContent?.includes('1 more approval'))).toBe(true)
  })
})
