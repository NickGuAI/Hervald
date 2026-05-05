// @vitest-environment jsdom

import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
  getAccessToken: vi.fn(),
  createMachine: vi.fn(),
  createSession: vi.fn(),
  verifyTailscaleHostname: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('../../../src/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
  getAccessToken: mocks.getAccessToken,
}))

vi.mock('../../../src/lib/api-base', () => ({
  getWsBase: () => '',
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-agents', () => ({
  createMachine: mocks.createMachine,
  createSession: mocks.createSession,
  verifyTailscaleHostname: mocks.verifyTailscaleHostname,
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('../../../src/surfaces/hervald/CenterColumn', () => ({
  CenterColumn: ({ commander }: { commander?: { name?: string } }) => createElement(
    'div',
    { 'data-testid': 'selected-commander' },
    commander?.name ?? 'No commander',
  ),
}))

vi.mock('../../../src/surfaces/hervald/TeamColumn', () => ({
  TeamColumn: () => null,
}))

vi.mock('../../../src/surfaces/hervald/WorkspaceModal', () => ({
  WorkspaceModal: () => null,
}))

import { CommandRoom } from '../../../src/surfaces/hervald/CommandRoom'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let mountedRoots: Root[] = []
let originalMatchMedia: typeof window.matchMedia | undefined

function buildCommander(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3',
    host: 'atlas',
    displayName: 'Test Commander',
    pid: null,
    state: 'idle',
    created: '2026-04-20T16:00:00.000Z',
    agentType: 'claude',
    effort: 'medium',
    cwd: '/tmp/atlas',
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

async function renderCommandRoom() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          null,
          createElement(CommandRoom),
        ),
      ),
    )
  })

  return { container, queryClient, root }
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : input instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function clickButtonByLabel(label: string) {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) {
    throw new Error(`Could not find button with aria-label: ${label}`)
  }
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('Hervald create commander workflow', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

    mocks.fetchJson.mockReset()
    mocks.fetchVoid.mockReset()
    mocks.getAccessToken.mockReset()
    mocks.createMachine.mockReset()
    mocks.createSession.mockReset()
    mocks.verifyTailscaleHostname.mockReset()
    mocks.useAgentSessions.mockReset()
    mocks.useMachines.mockReset()
    mocks.useAgentSessionStream.mockReset()
    mocks.usePendingApprovals.mockReset()

    originalMatchMedia = window.matchMedia
    // Force desktop surface — useIsMobile uses `(max-width: 767px)`; returning
    // matches:false keeps the responsive branch on the desktop CommandRoom tree
    // so the mocked CenterColumn (with data-testid="selected-commander") mounts.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    mocks.fetchVoid.mockResolvedValue(undefined)
    mocks.getAccessToken.mockResolvedValue(null)
    mocks.createMachine.mockResolvedValue({
      id: 'home-mac',
      label: 'Home Mac',
      host: '100.101.102.103',
      tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
    })
    mocks.useAgentSessions.mockReturnValue({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.verifyTailscaleHostname.mockResolvedValue({
      tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
      resolvedHost: '100.101.102.103',
    })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'disconnected',
    })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
  })

  afterEach(async () => {
    for (const root of mountedRoots.splice(0)) {
      await act(async () => {
        root.unmount()
      })
    }
    document.body.innerHTML = ''
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    vi.restoreAllMocks()
  })

  it('opens, closes, and submits the commander modal from SessionsColumn using the existing POST path', async () => {
    let commanders = [buildCommander()]
    const createBodies: Array<Record<string, unknown>> = []

    mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/commanders' && (!init?.method || init.method === 'GET')) {
        return commanders
      }
      if (url === '/api/commanders/runtime-config') {
        return {
          defaults: { maxTurns: 18 },
          limits: { maxTurns: 25 },
        }
      }
      if (url === '/api/commanders' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { host: string; displayName?: string; maxTurns?: number }
        createBodies.push(payload as Record<string, unknown>)
        const createdCommander = buildCommander({
          id: '7568a67d-abc5-458e-b560-bc94eae4e335',
          host: payload.host,
          displayName: payload.displayName ?? payload.host,
          persona: undefined,
        })
        commanders = [...commanders, createdCommander]
        return createdCommander
      }
      if (url === '/api/agents/sessions') {
        return []
      }
      if (url === '/api/approvals/pending') {
        return []
      }
      throw new Error(`Unexpected fetchJson call: ${url}`)
    })

    await renderCommandRoom()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('Test Commander')
    })

    await act(async () => {
      clickButtonByLabel('New commander')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="New Commander"]')).not.toBeNull()
    })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="New Commander"]')).toBeNull()
    })

    await act(async () => {
      clickButtonByLabel('New commander')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="New Commander"]')).not.toBeNull()
    })

    await act(async () => {
      clickButtonByLabel('Close New Commander')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="New Commander"]')).toBeNull()
    })

    await act(async () => {
      clickButtonByLabel('New commander')
    })

    // The Hervald "New Commander" modal renders CreateCommanderWizard. Its
    // default mode is the choice screen ("Quick Create" / "Talk to Me" /
    // "Advanced"); the "Advanced" branch is the CreateCommanderForm path,
    // which matches this test's POST flow (host input + "+ Create" button).
    const advancedButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Advanced')
        && button.textContent?.includes('Full form'),
    )
    if (!(advancedButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find wizard Advanced mode button')
    }

    await act(async () => {
      advancedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const hostInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="host (e.g. my-agent-1)"]',
    )
    if (!hostInput) {
      throw new Error('Could not find commander host input')
    }

    await act(async () => {
      setInputValue(hostInput, 'hera')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('input[type="number"][max="25"]')).not.toBeNull()
    })

    const maxTurnsInput = document.body.querySelector<HTMLInputElement>('input[type="number"][max="25"]')
    if (!maxTurnsInput) {
      throw new Error('Could not find max turns input')
    }

    await act(async () => {
      setInputValue(maxTurnsInput, '22')
    })

    const submitButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '+ Create',
    )
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find create commander submit button')
    }

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        '/api/commanders',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    expect(createBodies).toEqual([
      expect.objectContaining({
        host: 'hera',
        maxTurns: 22,
      }),
    ])

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="New Commander"]')).toBeNull()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('hera')
    })
  })

  it('opens the add-worker modal, verifies a tailscale hostname, and registers the worker', async () => {
    mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/commanders' && (!init?.method || init.method === 'GET')) {
        return [buildCommander()]
      }
      if (url === '/api/commanders/runtime-config') {
        return {
          defaults: { maxTurns: 18 },
          limits: { maxTurns: 25 },
        }
      }
      if (url === '/api/agents/sessions') {
        return []
      }
      if (url === '/api/approvals/pending') {
        return []
      }
      throw new Error(`Unexpected fetchJson call: ${url}`)
    })

    await renderCommandRoom()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('Test Commander')
    })

    await act(async () => {
      clickButtonByLabel('Add worker')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="Add Worker"]')).not.toBeNull()
    })

    const idInput = document.body.querySelector<HTMLInputElement>('#worker-id')
    const labelInput = document.body.querySelector<HTMLInputElement>('#worker-label')
    const hostnameInput = document.body.querySelector<HTMLInputElement>('#worker-tailscale-hostname')
    const userInput = document.body.querySelector<HTMLInputElement>('#worker-user')
    const cwdInput = document.body.querySelector<HTMLInputElement>('#worker-cwd')
    if (!idInput || !labelInput || !hostnameInput || !userInput || !cwdInput) {
      throw new Error('Expected add-worker fields to be present.')
    }

    await act(async () => {
      setInputValue(idInput, 'home-mac')
      setInputValue(labelInput, 'Home Mac')
      setInputValue(hostnameInput, 'home-mac.tail2bb6ea.ts.net')
      setInputValue(userInput, 'yugu')
      setInputValue(cwdInput, '/Users/yugu')
    })

    const verifyButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Verify',
    )
    if (!(verifyButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find Verify button')
    }

    await act(async () => {
      verifyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(mocks.verifyTailscaleHostname).toHaveBeenCalledWith('home-mac.tail2bb6ea.ts.net')
      expect(document.body.textContent).toContain('Verified. Server can reach')
    })

    const submitButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Register Worker',
    )
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find Register Worker button')
    }

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(mocks.createMachine).toHaveBeenCalledWith({
        id: 'home-mac',
        label: 'Home Mac',
        tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
        user: 'yugu',
        port: undefined,
        cwd: '/Users/yugu',
      })
    })
  })

  it('preserves Global selection when the real commander list becomes empty', async () => {
    mocks.fetchJson.mockImplementation(async (url: string) => {
      if (url === '/api/commanders') {
        return [buildCommander()]
      }
      if (url === '/api/commanders/runtime-config') {
        return {
          defaults: { maxTurns: 18 },
          limits: { maxTurns: 25 },
        }
      }
      if (url === '/api/commanders/72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3/tasks') {
        return []
      }
      if (url === '/api/automations?parentCommanderId=72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3&trigger=schedule') {
        return []
      }
      if (url === '/api/automations?parentCommanderId=null&trigger=schedule') {
        return []
      }
      if (url === '/api/agents/sessions') {
        return []
      }
      if (url === '/api/approvals/pending') {
        return []
      }
      throw new Error(`Unexpected fetchJson call: ${url}`)
    })

    const { queryClient } = await renderCommandRoom()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('Test Commander')
    })

    const globalButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Global'),
    )
    if (!(globalButton instanceof HTMLButtonElement)) {
      throw new Error('Could not find Global pseudo-commander row')
    }

    await act(async () => {
      globalButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/automations?parentCommanderId=null&trigger=schedule')
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('Global')
    })

    await act(async () => {
      queryClient.setQueryData(['commanders', 'sessions'], [])
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-commander"]')?.textContent).toContain('Global')
    })
  })
})
