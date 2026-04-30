import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSession } from '@/types'

const mocks = vi.hoisted(() => ({
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  resumeSession: vi.fn(),
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {},
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {},
}))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}))
vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class {},
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {},
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {},
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {},
}))

import AgentsPage from '../page'

function renderAgentsPageHtml(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(AgentsPage)),
    ),
  )
}

describe('AgentsPage default session tab', () => {
  it('defaults to commander and shows commander sessions on initial render', () => {
    const sessions: AgentSession[] = [
      {
        name: 'commander-alpha',
        created: '2026-03-09T00:00:00.000Z',
        pid: 101,
        sessionType: 'commander',
        transportType: 'pty',
        agentType: 'claude',
      },
      {
        name: 'worker-beta',
        created: '2026-03-09T00:00:00.000Z',
        pid: 102,
        sessionType: 'worker',
        transportType: 'pty',
        agentType: 'claude',
      },
    ]

    mocks.useAgentSessions.mockReturnValue({
      data: sessions,
      isLoading: false,
    })
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderAgentsPageHtml()

    expect(html).toMatch(
      /class="[^"]*badge-sumi capitalize transition-colors[^"]*bg-sumi-black text-white[^"]*"[^>]*>commander<\/button>/,
    )
    expect(html).toMatch(
      /class="[^"]*badge-sumi capitalize transition-colors[^"]*hover:bg-washi-shadow[^"]*"[^>]*>worker<\/button>/,
    )
    expect(html).toContain('commander-alpha')
    expect(html).not.toContain('worker-beta')
  })

  it('hides Kill button and shows exited badge when process is not alive', () => {
    const sessions = [
      {
        name: 'commander-exited',
        created: '2026-03-09T00:00:00.000Z',
        pid: 111,
        processAlive: false,
        sessionType: 'commander',
        transportType: 'stream',
        agentType: 'claude',
      },
    ] as AgentSession[]

    mocks.useAgentSessions.mockReturnValue({
      data: sessions,
      isLoading: false,
    })
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderAgentsPageHtml()

    expect(html).toContain('commander-exited')
    expect(html).toContain('>exited<')
    expect(html).not.toContain('>Kill<')
  })

  it('shows done-worker summary for sessions with all workers completed', () => {
    const sessions = [
      {
        name: 'commander-completed-workers',
        created: '2026-03-09T00:00:00.000Z',
        pid: 222,
        processAlive: true,
        sessionType: 'commander',
        transportType: 'stream',
        agentType: 'claude',
        spawnedWorkers: ['worker-a', 'worker-b'],
        workerSummary: { total: 2, running: 0, starting: 0, down: 0, done: 2 },
      },
    ] as AgentSession[]

    mocks.useAgentSessions.mockReturnValue({
      data: sessions,
      isLoading: false,
    })
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderAgentsPageHtml()

    expect(html).toContain('commander-completed-workers')
    expect(html).toContain('✓ 2 done')
    expect(html).toContain('>Kill<')
  })

  it('shows a queued-message badge on the session card when queued work exists', () => {
    const sessions = [
      {
        name: 'commander-queued-work',
        created: '2026-03-09T00:00:00.000Z',
        pid: 444,
        processAlive: true,
        sessionType: 'commander',
        transportType: 'stream',
        agentType: 'claude',
        queuedMessageCount: 3,
      },
    ] as AgentSession[]

    mocks.useAgentSessions.mockReturnValue({
      data: sessions,
      isLoading: false,
    })
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderAgentsPageHtml()

    expect(html).toContain('commander-queued-work')
    expect(html).toContain('3 queued')
  })

  it('shows Resume for stale resumable Codex sessions even while the wrapper is still alive', () => {
    const sessions = [
      {
        name: 'commander-codex-watchdog-stale',
        created: '2026-03-09T00:00:00.000Z',
        pid: 333,
        processAlive: true,
        sessionType: 'commander',
        transportType: 'stream',
        agentType: 'codex',
        status: 'stale',
        resumeAvailable: true,
      },
    ] as AgentSession[]

    mocks.useAgentSessions.mockReturnValue({
      data: sessions,
      isLoading: false,
    })
    mocks.useMachines.mockReturnValue({
      data: [],
      isLoading: false,
    })

    const html = renderAgentsPageHtml()

    expect(html).toContain('commander-codex-watchdog-stale')
    expect(html).toContain('>Resume<')
    expect(html).toContain('>Kill<')
    expect(html).toContain('>stale<')
  })
})
