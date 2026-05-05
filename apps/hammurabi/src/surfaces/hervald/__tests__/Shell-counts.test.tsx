// @vitest-environment jsdom

import { flushSync } from 'react-dom'
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

async function renderShell() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  flushSync(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/command-room']}>
          <Shell
            modules={[{
              name: 'command-room',
              label: 'Command Room',
              icon: 'dot',
              path: '/command-room',
            }]}
          >
            <div>child</div>
          </Shell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

describe('Shell top-bar counts', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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
  })

  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    vi.clearAllMocks()
  })

  it('counts active and idle as running', async () => {
    await renderShell()

    const text = document.body.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(text).toContain('2 running')
  })
})
