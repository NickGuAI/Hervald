// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrontendNavItem } from '@/types'

const mocks = vi.hoisted(() => ({
  useAgentSessions: vi.fn(),
  useApprovalNotifications: vi.fn(),
  useApprovalNotificationsSuppressed: vi.fn(() => false),
  usePendingApprovals: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgentSessions: mocks.useAgentSessions,
}))

vi.mock('@/hooks/use-approvals', () => ({
  APPROVAL_NOTIFICATION_MAX_VISIBLE: 3,
  useApprovalNotifications: mocks.useApprovalNotifications,
  useApprovalNotificationsSuppressed: mocks.useApprovalNotificationsSuppressed,
  usePendingApprovals: mocks.usePendingApprovals,
}))

import { Shell } from '@/surfaces/desktop/Shell'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
const commandRoomModule: FrontendNavItem = {
  name: 'command-room',
  routeId: 'command-room.ui',
  label: 'Command Room',
  icon: 'dot',
  path: '/command-room',
  surfaces: ['desktop'],
  order: 20,
}

function buildMatchMedia(isMobile: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

async function renderShell(modules: FrontendNavItem[] = [commandRoomModule]) {
  container = document.createElement('div')
  document.body.appendChild(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root = createRoot(container!)
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/command-room']}>
          <Shell modules={modules}>
            <div>child</div>
          </Shell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

describe('Shell top-bar counts', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    window.matchMedia = buildMatchMedia(false)
    mocks.useAgentSessions.mockReturnValue({
      data: [
        { name: 'commander-1', status: 'active', processAlive: true },
        { name: 'worker-1', status: 'idle', processAlive: true },
        { name: 'worker-2', status: 'stale', processAlive: true },
        { name: 'worker-3', status: 'exited', processAlive: false },
        { name: 'worker-4', status: 'completed', processAlive: true },
      ],
    })
    mocks.usePendingApprovals.mockReturnValue({
      data: [{ id: 'approval-1' }, { id: 'approval-2' }],
    })
    mocks.useApprovalNotifications.mockReturnValue({
      notifications: [],
      visibleNotifications: [],
      hiddenNotificationCount: 0,
      dismissNotification: vi.fn(),
      connectionStatus: 'connected',
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    vi.clearAllMocks()
  })

  it('counts active and idle as running', async () => {
    await renderShell()

    await vi.waitFor(() => {
      const text = container?.textContent?.replace(/\s+/g, ' ') ?? ''
      expect(text).toContain('2 running')
      expect(text).toContain('2 pending')
      expect(container?.querySelector('a[aria-label="2 pending approvals"]')?.getAttribute('href')).toBe('/approvals')
    })
  })

  it('renders desktop navigation in the canonical order', async () => {
    await renderShell([
      {
        name: 'org',
        routeId: 'org.ui',
        label: 'Org',
        icon: 'Users',
        path: '/org',
        surfaces: ['desktop'],
        order: 10,
      },
      commandRoomModule,
      {
        name: 'commanders',
        routeId: 'commanders.marketplace-ui',
        label: 'Marketplace',
        icon: 'Sparkles',
        path: '/marketplace',
        surfaces: ['desktop'],
        order: 30,
      },
      {
        name: 'approvals',
        routeId: 'approvals.ui',
        label: 'Approvals',
        icon: 'ClipboardCheck',
        path: '/approvals',
        navGroup: 'secondary',
        surfaces: ['desktop'],
        order: 40,
      },
      {
        name: 'channels',
        routeId: 'channels.ui',
        label: 'Channels',
        icon: 'RadioTower',
        path: '/channels',
        surfaces: ['desktop'],
        order: 50,
      },
      {
        name: 'api-keys',
        routeId: 'api-keys.ui',
        label: 'Settings',
        icon: 'Settings',
        path: '/api-keys',
        surfaces: ['desktop'],
        order: 60,
      },
    ])

    const navItems = Array.from(
      document.body.querySelectorAll('nav > a, nav > div > button'),
      (node) => node.textContent?.trim(),
    )

    expect(navItems).toEqual([
      'Org',
      'Command Room',
      'Marketplace',
      'Ops',
      'Channels',
      'Settings',
    ])
  })
})
