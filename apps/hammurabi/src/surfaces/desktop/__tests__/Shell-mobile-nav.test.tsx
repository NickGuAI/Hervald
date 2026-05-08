// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAgentSessions: vi.fn(),
  usePendingApprovals: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgentSessions: mocks.useAgentSessions,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
}))

import { Shell } from '@/surfaces/desktop/Shell'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined

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

async function renderShell(pathname: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[pathname]}>
          <Shell modules={[]}>
            <div data-testid="shell-child">child</div>
          </Shell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

describe('Shell — canonical mobile tab bar ownership', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    mocks.useAgentSessions.mockReturnValue({ data: [] })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
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

  it('renders the 4-tab bar on mobile non-chat routes, with no Fleet leak', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room/inbox')

    const tabs = document.body.querySelectorAll('[data-testid="hervald-mobile-tabs"]')
    expect(tabs.length, 'Shell should render exactly one mobile nav').toBe(1)
    expect(tabs[0]?.querySelectorAll('a')).toHaveLength(4)

    const labels = Array.from(tabs[0]!.querySelectorAll('span'))
      .map((span) => span.textContent?.trim().toUpperCase())
      .filter((text): text is string => Boolean(text))

    // Canonical 4-tab IA from the org-anchored mobile shell.
    expect(labels).toContain('ORG')
    expect(labels).toContain('AUTOMATIONS')
    expect(labels).toContain('INBOX')
    expect(labels).toContain('SETTINGS')
    expect(labels).not.toContain('SESSIONS')

    const automationLink = Array.from(tabs[0]!.querySelectorAll('a')).find((link) =>
      link.textContent?.toUpperCase().includes('AUTOMATIONS'),
    )
    expect(automationLink?.getAttribute('href')).toBe('/automations')

    // Regression guard for the Shell-generic BottomNav leak.
    expect(labels).not.toContain('FLEET')
    expect(labels).not.toContain('TELEMETRY')
    expect(labels).not.toContain('SERVICES')
    expect(labels).not.toContain('POLICIES')
    expect(labels).not.toContain('WORKSPACE')
  })

  it('self-hides the mobile tab bar on the immersive chat route', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room?commander=atlas')

    expect(document.body.querySelectorAll('[data-testid="hervald-mobile-tabs"]').length).toBe(0)
  })

  it('keeps the mobile tab bar visible on commander-scoped automation panels', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room?commander=global&panel=automation')

    expect(document.body.querySelectorAll('[data-testid="hervald-mobile-tabs"]').length).toBe(1)
  })

  it('does not render the mobile tab bar on desktop', async () => {
    window.matchMedia = buildMatchMedia(false)
    await renderShell('/command-room/inbox')

    expect(document.body.querySelectorAll('[data-testid="hervald-mobile-tabs"]').length).toBe(0)
  })

  it('renders the mobile tab bar on non-Command-Room routes (canonical IA everywhere)', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/api-keys')

    const tabs = document.body.querySelectorAll('[data-testid="hervald-mobile-tabs"]')
    expect(tabs.length).toBe(1)
    const labels = Array.from(tabs[0]!.querySelectorAll('span'))
      .map((span) => span.textContent?.trim().toUpperCase())
      .filter((text): text is string => Boolean(text))
    expect(labels).toContain('ORG')
    expect(labels).toContain('AUTOMATIONS')
    expect(labels).toContain('INBOX')
    expect(labels).toContain('SETTINGS')
    expect(labels).not.toContain('SESSIONS')
  })
})
