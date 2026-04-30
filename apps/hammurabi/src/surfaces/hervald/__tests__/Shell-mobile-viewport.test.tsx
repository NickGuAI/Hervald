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
 * Regression guards for #1107 — viewport overflow containment must live at
 * Shell (architectural boundary that owns viewport bounds), NOT at individual
 * route components. PR #1105 briefly moved the invariant to MobileCommandRoom
 * via `fixed inset-0 z-40`, which covered BottomNav (z-20) and intercepted
 * taps. These tests lock in the correct layer.
 */
describe('Shell — mobile viewport frame ownership (#1107)', () => {
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

  it('Shell <main> contains horizontal overflow at the viewport layer', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room/sessions')

    const mainEl = document.body.querySelector('main')
    expect(mainEl).not.toBeNull()

    // Shell owns the viewport bound; this is THE architectural place that
    // clips horizontal overflow from any route content.
    expect((mainEl as HTMLElement).style.overflowX).toBe('hidden')

    // Vertical scroll still works for long transcripts.
    expect((mainEl as HTMLElement).style.overflowY).toBe('auto')

    // Bottom padding reserves space for MobileBottomTabs + iOS safe-area.
    expect(mainEl?.className).toContain('pb-[calc(4rem+env(safe-area-inset-bottom,0px))]')
  })

  it('Shell root frame is viewport-bounded with overflow: hidden', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room/sessions')

    // The Shell root is the outermost div inside the mount container.
    const shellRoot = container?.firstElementChild as HTMLElement | null
    expect(shellRoot).not.toBeNull()

    // NOTE: jsdom drops `height: 100dvh` during style serialization because
    // it does not recognize the `dvh` unit. We can't assert height here;
    // the real-browser behavior is covered by Playwright in manual QA.
    // Everything else the Shell frame depends on is verifiable:
    expect(shellRoot!.style.width).toBe('100vw')
    expect(shellRoot!.style.overflow).toBe('hidden')
    expect(shellRoot!.style.display).toBe('flex')
    expect(shellRoot!.style.flexDirection).toBe('column')
  })

  it('mobile BottomNav is a sibling of <main>, not a descendant — stays at z-20 with no overlay above it', async () => {
    window.matchMedia = buildMatchMedia(true)
    await renderShell('/command-room/inbox')

    const tabs = document.body.querySelector('[data-testid="hervald-mobile-tabs"]')
    expect(tabs).not.toBeNull()

    const nav = tabs!.querySelector('nav')
    expect(nav).not.toBeNull()

    // Nav pins to viewport bottom at z-20. Any descendant of Shell with
    // position:fixed and z-index > 20 will shadow it — this test runs
    // alongside the MobileCommandRoom test that guarantees no such descendant.
    expect(nav!.className).toContain('fixed')
    expect(nav!.className).toContain('bottom-0')
    expect(nav!.className).toContain('z-20')

    // Sibling-of-main contract: BottomNav must be rendered by Shell itself,
    // not nested inside route content. Walking up from nav, we should reach
    // the Shell root without passing through <main>.
    let cursor: HTMLElement | null = nav
    let sawMain = false
    while (cursor && cursor !== document.body) {
      if (cursor.tagName === 'MAIN') {
        sawMain = true
        break
      }
      cursor = cursor.parentElement
    }
    expect(sawMain, 'BottomNav must be a Shell sibling of <main>, not a descendant').toBe(false)
  })
})
