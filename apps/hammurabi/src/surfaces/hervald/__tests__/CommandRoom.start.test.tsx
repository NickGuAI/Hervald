// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  createMachine: vi.fn(),
  createSession: vi.fn(),
  getDebriefStatus: vi.fn(),
  killSession: vi.fn(),
  resumeSession: vi.fn(),
  triggerPreKillDebrief: vi.fn(),
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
  verifyTailscaleHostname: vi.fn(),
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (value: string) => value === '__global__',
  useCommander: mocks.useCommander,
}))

import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined
let startCommander: ReturnType<typeof vi.fn>

function buildCommander(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cmd-1',
    host: 'athena',
    displayName: 'Test Commander',
    pid: null,
    state: 'stopped',
    created: '2026-04-20T16:00:00.000Z',
    agentType: 'claude',
    effort: 'medium',
    cwd: '/tmp/athena',
    persona: 'Primary commander',
    heartbeat: {
      intervalMs: 900_000,
      messageTemplate: '',
      lastSentAt: null,
    },
    lastHeartbeat: null,
    taskSource: null,
    currentTask: null,
    completedTasks: 0,
    questCount: 0,
    scheduleCount: 0,
    totalCostUsd: 0,
    ...overrides,
  }
}

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
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
        <BrowserRouter>
          <Routes>
            <Route path="/command-room/*" element={<CommandRoom />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>,
    )
  })
}

describe('CommandRoom desktop start control', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    originalMatchMedia = window.matchMedia
    originalCanvasGetContext = HTMLCanvasElement.prototype.getContext
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({}, {
      get: (_target, property) => {
        if (property === 'canvas') {
          return document.createElement('canvas')
        }
        if (property === 'measureText') {
          return () => ({ width: 0 })
        }
        if (property === 'getImageData') {
          return () => ({ data: new Uint8ClampedArray(4) })
        }
        if (property === 'createLinearGradient') {
          return () => ({ addColorStop: vi.fn() })
        }
        return vi.fn()
      },
    })) as typeof HTMLCanvasElement.prototype.getContext

    startCommander = vi.fn(async () => undefined)
    const commander = buildCommander()

    mocks.useCommander.mockReturnValue({
      commanders: [commander],
      selectedCommanderId: commander.id,
      selectedCommander: commander,
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(async () => undefined),
      addCronPending: false,
      toggleCron: vi.fn(async () => undefined),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(async () => undefined),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(async () => undefined),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(async () => undefined),
      deleteCronPending: false,
      deleteCronId: null,
      startCommander,
      stopCommander: vi.fn(async () => undefined),
      createCommander: vi.fn(async () => commander),
      createCommanderPending: false,
    })

    mocks.useAgentSessions.mockReturnValue({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      answerQuestion: vi.fn(),
      status: 'connected',
    })
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
    if (originalCanvasGetContext) {
      HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
    }
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('forwards the selected agent type when starting an idle commander from desktop command room', async () => {
    await renderAt('/command-room')

    const select = document.body.querySelector('[data-testid="commander-start-agent-type"]') as HTMLSelectElement | null
    const button = document.body.querySelector('[data-testid="commander-start-button"]') as HTMLButtonElement | null

    expect(select).not.toBeNull()
    expect(button).not.toBeNull()

    await act(async () => {
      if (!select) {
        throw new Error('commander start select missing')
      }
      select.value = 'codex'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      button?.click()
    })

    expect(startCommander).toHaveBeenCalledWith('cmd-1', 'codex')
  })

  it('keeps delegated workers visible under the selected commander when ownership comes from spawnedBy', async () => {
    mocks.useAgentSessions.mockReturnValue({
      data: [{
        id: 'worker-owned-1',
        name: 'worker-owned-1',
        created: '2026-04-20T16:05:00.000Z',
        pid: 31337,
        sessionType: 'worker',
        transportType: 'stream',
        status: 'active',
        agentType: 'codex',
        spawnedBy: 'commander-cmd-1',
        processAlive: true,
      }],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })

    await renderAt('/command-room')

    expect(document.body.textContent).toContain('worker-owned-1')
  })

  it('opens the CreateCommanderWizard choice screen when the New Commander button is clicked', async () => {
    await renderAt('/command-room')

    const newCommanderButton = document.body.querySelector(
      'button[aria-label="New commander"]',
    ) as HTMLButtonElement | null

    expect(newCommanderButton).not.toBeNull()

    await act(async () => {
      newCommanderButton?.click()
    })

    // Wizard's `choice` mode renders these strings; the plain CreateCommanderForm does not.
    const text = document.body.textContent ?? ''
    expect(text).toContain('Choose a creation path')
    expect(text).toContain('Quick Create')
    expect(text).toContain('Talk to Me')
    expect(text).toContain('Advanced')
  })
})
