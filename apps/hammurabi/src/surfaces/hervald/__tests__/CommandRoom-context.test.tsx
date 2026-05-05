// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
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
}))

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (value: string) => value === '__global__',
  useCommander: mocks.useCommander,
}))

vi.mock('../SessionsColumn', () => ({
  SessionsColumn: ({
    onSelectChat,
  }: {
    onSelectChat: (sessionId: string) => void
  }) => createElement(
    'button',
    {
      type: 'button',
      'data-testid': 'select-chat',
      onClick: () => onSelectChat('worker-1'),
    },
    'Select worker chat',
  ),
}))

vi.mock('../CenterColumn', () => ({
  CenterColumn: ({
    contextFilePaths = [],
    onRemoveContextFilePath,
    onClearContextFilePaths,
    onOpenWorkspace,
  }: {
    contextFilePaths?: string[]
    onRemoveContextFilePath?: (path: string) => void
    onClearContextFilePaths?: () => void
    onOpenWorkspace?: () => void
  }) => createElement(
    'div',
    null,
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'open-workspace',
        onClick: () => onOpenWorkspace?.(),
      },
      'Open workspace',
    ),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'remove-context',
        onClick: () => onRemoveContextFilePath?.('docs/spec.md'),
      },
      'Remove context path',
    ),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'clear-context',
        onClick: () => onClearContextFilePaths?.(),
      },
      'Clear context paths',
    ),
    createElement(
      'div',
      {
        'data-testid': 'context-paths',
        'data-context-paths': contextFilePaths.join('|'),
      },
      contextFilePaths.join('|'),
    ),
  ),
}))

vi.mock('../TeamColumn', () => ({
  TeamColumn: () => null,
}))

vi.mock('../WorkspaceModal', () => ({
  WorkspaceModal: ({
    open,
    onInsertPath,
  }: {
    open: boolean
    onInsertPath?: (path: string) => void
  }) => open
    ? createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'insert-path',
        onClick: () => onInsertPath?.('docs/spec.md'),
      },
      'Insert docs/spec.md',
    )
    : null,
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? createElement('div', null, children) : null),
}))

vi.mock('@modules/agents/components/NewSessionForm', () => ({
  NewSessionForm: () => null,
}))

vi.mock('@modules/commanders/components/CreateCommanderWizard', () => ({
  CreateCommanderWizard: () => null,
}))

vi.mock('@/surfaces/mobile/MobileCommandRoom', () => ({
  MobileCommandRoom: () => null,
}))

import { CommandRoom } from '../CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildCommander() {
  return {
    id: 'cmd-1',
    host: 'atlas',
    displayName: 'Test Commander',
    pid: null,
    state: 'running',
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
    avatarUrl: null,
    ui: null,
  }
}

async function renderRoom() {
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
          <Routes>
            <Route path="/command-room/*" element={<CommandRoom />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

describe('CommandRoom context file wiring', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      startCommander: vi.fn(async () => undefined),
      stopCommander: vi.fn(async () => undefined),
      createCommander: vi.fn(async () => commander),
      createCommanderPending: false,
    })

    mocks.useAgentSessions.mockReturnValue({
      data: [
        {
          id: 'worker-1',
          name: 'worker-1',
          label: 'Worker 1',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4242,
          status: 'running',
          agentType: 'codex',
          sessionType: 'worker',
          transportType: 'stream',
          processAlive: true,
          spawnedBy: 'commander-cmd-1',
        },
      ],
      refetch: vi.fn(async () => ({ data: [] })),
    })
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
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
    vi.clearAllMocks()
  })

  it('resets contextFilePaths when the workspace source key changes', async () => {
    await renderRoom()

    const contextPaths = () => document.body.querySelector('[data-testid="context-paths"]')
      ?.getAttribute('data-context-paths') ?? ''

    expect(contextPaths()).toBe('')

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="open-workspace"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="insert-path"]')).not.toBeNull()
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="insert-path"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('docs/spec.md')
    })

    flushSync(() => {
      ;(document.body.querySelector('[data-testid="select-chat"]') as HTMLButtonElement).click()
    })

    await vi.waitFor(() => {
      expect(contextPaths()).toBe('')
    })
  })
})
