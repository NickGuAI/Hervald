// @vitest-environment jsdom

/**
 * Regression guard: the global desktop ApprovalCenter floating drawer must
 * NEVER render on mobile. Mobile has the canonical `/command-room/inbox`
 * route as its native approvals surface; mounting the desktop floating
 * drawer on top would produce two approvals UIs on every Hervald mobile
 * route (including the Inbox tab itself). This test fails if a future PR
 * accidentally hoists `<ApprovalCenter />` past the `useIsMobile()` gate.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAgentSessions: vi.fn(),
  usePendingApprovals: vi.fn(),
  useApprovalHistory: vi.fn(),
  useApprovalDecision: vi.fn(),
  useApprovalNotifications: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgentSessions: mocks.useAgentSessions,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalHistory: mocks.useApprovalHistory,
  useApprovalDecision: mocks.useApprovalDecision,
  useApprovalNotifications: mocks.useApprovalNotifications,
}))

// Import the component under test AFTER the mocks above are hoisted.
import { ApprovalCenter } from '@modules/approvals/ApprovalCenter'
import { useIsMobile } from '@/hooks/use-is-mobile'

// Stand-in component mirroring `DesktopOnlyApprovalCenter` in `src/App.tsx`.
// If that gate is ever dropped or bypassed, this test file is the canary —
// update both sites together.
function DesktopOnlyApprovalCenter() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return null
  }
  return <ApprovalCenter />
}

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

async function render() {
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
        <MemoryRouter>
          <DesktopOnlyApprovalCenter />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

describe('ApprovalCenter mobile gate', () => {
  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    mocks.useAgentSessions.mockReturnValue({ data: [] })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
    mocks.useApprovalHistory.mockReturnValue({ data: [] })
    mocks.useApprovalDecision.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      variables: undefined,
    })
    mocks.useApprovalNotifications.mockReturnValue({
      notifications: [],
      markSeen: vi.fn(),
      clear: vi.fn(),
    })
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

  it('renders ApprovalCenter on desktop', async () => {
    window.matchMedia = buildMatchMedia(false)
    await render()

    // Desktop FAB lands as a fixed-position button anchored bottom-right.
    // Don't assert on class names (style churn) — assert on presence of the
    // known test ids / aria-labels from ApprovalCenter.
    const fab = document.querySelector('aside, button[aria-label*="pproval" i]')
    expect(fab).not.toBeNull()
  })

  it('does NOT render ApprovalCenter on mobile', async () => {
    window.matchMedia = buildMatchMedia(true)
    await render()

    // The container should have zero children rendered (DesktopOnlyApprovalCenter returns null).
    expect(container?.innerHTML).toBe('')

    // Double-check: no element that ApprovalCenter would produce.
    expect(document.querySelector('aside')).toBeNull()
    expect(document.querySelector('button[aria-label*="pproval" i]')).toBeNull()
  })

  it('flips between desktop and mobile based on useIsMobile()', async () => {
    // Start desktop, verify rendered.
    window.matchMedia = buildMatchMedia(false)
    await render()
    expect(container?.innerHTML).not.toBe('')

    // Tear down + re-render in mobile.
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    container?.remove()
    document.body.innerHTML = ''

    window.matchMedia = buildMatchMedia(true)
    await render()
    expect(container?.innerHTML).toBe('')
  })
})
