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

import { Shell } from '@/surfaces/hervald/Shell'

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
  })
}

/**
 * Regression guards for #1152 — the immersive chat view on mobile had a
 * ~4rem white bar at the bottom because Shell unconditionally reserved bottom
 * padding for MobileBottomTabs while MobileBottomTabs self-hides on
 * `/command-room/sessions/:id`. The padding gate must match the tab-bar
 * mount gate: apply only when `isMobile && !inChat`.
 */
describe('Shell — mobile chat padding gate (#1152)', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    mocks.useAgentSessions.mockReturnValue({ data: [] })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    vi.clearAllMocks()
  })

  it('does NOT reserve bottom padding on the immersive chat route (mobile)', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room/sessions/some-id')

    const mainEl = document.body.querySelector('main')
    expect(mainEl).not.toBeNull()
    expect(mainEl!.className).not.toContain('pb-[calc(4rem')
  })

  it('reserves bottom padding on the command-room landing route (mobile)', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room')

    const mainEl = document.body.querySelector('main')
    expect(mainEl).not.toBeNull()
    expect(mainEl!.className).toContain('pb-[calc(4rem')
  })
})
