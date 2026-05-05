// @vitest-environment jsdom

import { act, createElement, Fragment, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ConversationStatus = 'active' | 'idle' | 'archived'

interface TestConversationRecord {
  id: string
  commanderId: string
  surface: 'ui'
  status: ConversationStatus
  currentTask: null
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  createdAt: string
  lastMessageAt: string
  liveSession: null
}

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
  useActiveConversation: vi.fn(),
  useConversations: vi.fn(),
  useCreateConversation: vi.fn(),
  useDeleteConversation: vi.fn(),
  useStartConversation: vi.fn(),
  useStopConversation: vi.fn(),
  useUpdateConversation: vi.fn(),
  useConversationMessage: vi.fn(),
  fetchCommanderActiveConversation: vi.fn(),
  observedStatusLabels: [] as string[],
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}), { virtual: true })

vi.mock('@/hooks/use-agents', () => ({
  createSession: vi.fn(),
  getDebriefStatus: vi.fn(),
  killSession: vi.fn(),
  resumeSession: vi.fn(),
  triggerPreKillDebrief: vi.fn(),
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
  verifyTailscaleHostname: vi.fn(),
}), { virtual: true })

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}), { virtual: true })

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}), { virtual: true })

vi.mock('@/hooks/send-dispatcher', () => ({
  createHttpConversationDispatcher: () => ({ send: vi.fn(async () => true) }),
}), { virtual: true })

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (value: string) => value === '__global__',
  useCommander: mocks.useCommander,
}), { virtual: true })

vi.mock('@modules/conversation/hooks/use-conversations', () => ({
  useActiveConversation: mocks.useActiveConversation,
  useConversations: mocks.useConversations,
  useCreateConversation: mocks.useCreateConversation,
  useDeleteConversation: mocks.useDeleteConversation,
  useStartConversation: mocks.useStartConversation,
  useStopConversation: mocks.useStopConversation,
  useUpdateConversation: mocks.useUpdateConversation,
  useConversationMessage: mocks.useConversationMessage,
  fetchCommanderActiveConversation: mocks.fetchCommanderActiveConversation,
  ACTIVE_CONVERSATION_FETCH_STALE_MS: 30_000,
  commanderActiveConversationQueryKey: (commanderId: string) => ['commanders', 'conversations', 'active', commanderId],
}), { virtual: true })

vi.mock('@modules/claude-adaptive-thinking.js', () => ({
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE: 'disabled',
}), { virtual: true })

vi.mock('@modules/claude-effort.js', () => ({
  DEFAULT_CLAUDE_EFFORT_LEVEL: 'medium',
}), { virtual: true })

vi.mock('@modules/agents/page-shell/session-helpers', () => ({
  formatError: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
  isNotFoundRequestFailure: () => false,
  shouldAttemptDebriefOnKill: () => false,
}), { virtual: true })

vi.mock('@modules/agents/queue-capability', () => ({
  supportsQueuedDrafts: () => false,
}), { virtual: true })

vi.mock('@modules/agents/queue-mutation', () => ({
  runQueueMutationRequest: vi.fn(async (request: () => Promise<unknown>) => {
    await request()
    return true
  }),
}), { virtual: true })

vi.mock('@modules/agents/session-queue-api', () => ({
  clearSessionQueue: vi.fn(),
  fetchSessionQueueSnapshot: vi.fn(async () => ({ currentMessage: null, items: [] })),
  queueSessionMessage: vi.fn(),
  removeQueuedSessionMessage: vi.fn(),
  reorderSessionQueue: vi.fn(),
}), { virtual: true })

vi.mock('@modules/agents/queue-state', () => ({
  EMPTY_QUEUE_SNAPSHOT: { currentMessage: null, items: [] },
  normalizeQueueSnapshot: (value: unknown) => value,
}), { virtual: true })

vi.mock('@modules/workspace/use-workspace', () => ({
  getWorkspaceSourceKey: () => 'workspace:none',
}), { virtual: true })

vi.mock('../SessionsColumn', () => ({
  SessionsColumn: ({
    commanders,
    conversations = [],
    onSelectCommander,
    onSelectConversation,
    selectedChatId,
  }: {
    commanders: Array<{ id: string; name: string }>
    conversations?: Array<{ id: string }>
    onSelectCommander: (id: string) => void
    onSelectConversation?: (id: string) => void
    selectedChatId: string | null
  }) => createElement(
    'div',
    null,
    ...commanders.map((commander) =>
      createElement(
        'button',
        {
          key: commander.id,
          type: 'button',
          'data-testid': `commander-${commander.id}`,
          onClick: () => onSelectCommander(commander.id),
        },
        commander.name,
      ),
    ),
    ...conversations.map((conversation) =>
      createElement(
        'button',
        {
          key: conversation.id,
          type: 'button',
          'data-testid': `conversation-${conversation.id}`,
          onClick: () => onSelectConversation?.(conversation.id),
        },
        conversation.id,
      ),
    ),
    createElement('div', { 'data-testid': 'selected-chat' }, selectedChatId ?? 'none'),
  ),
}), { virtual: true })

vi.mock('../CenterColumn', () => {
  function statusLabel(status: string): string {
    const normalizedStatus = status === 'running' ? 'connected' : (status || 'idle')
    if (normalizedStatus === 'connected') {
      return 'Connected'
    }
    if (normalizedStatus === 'active') {
      return 'Active'
    }
    if (normalizedStatus === 'idle') {
      return 'Idle'
    }
    return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)
  }

  return {
    CenterColumn: ({
      commander,
    }: {
      commander: { status: string }
    }) => {
      const label = statusLabel(commander.status)
      mocks.observedStatusLabels.push(label)

      return createElement(
        'div',
        { 'data-testid': 'center-column' },
        createElement('div', { 'data-testid': 'conversation-status-indicator' }, label),
      )
    },
  }
})

vi.mock('../TeamColumn', () => ({
  TeamColumn: () => null,
}))

vi.mock('../WorkspaceModal', () => ({
  WorkspaceModal: () => null,
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? createElement('div', null, children) : null),
}), { virtual: true })

vi.mock('@modules/agents/components/NewSessionForm', () => ({
  NewSessionForm: () => null,
}), { virtual: true })

vi.mock('@modules/agents/components/AddWorkerWizard', () => ({
  AddWorkerWizard: () => null,
}), { virtual: true })

vi.mock('@modules/commanders/components/CreateCommanderWizard', () => ({
  CreateCommanderWizard: () => null,
}), { virtual: true })

vi.mock('@/surfaces/mobile/MobileCommandRoom', () => ({
  MobileCommandRoom: () => null,
}), { virtual: true })

import { CommandRoom } from '../CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null
let initialEntry = '/command-room'
let selectedCommanderId = '__global__'
let conversationsByCommander: Record<string, TestConversationRecord[]> = {}
let deleteSpy: ReturnType<typeof vi.spyOn>

const setSelectedCommanderId = vi.fn((id: string) => {
  selectedCommanderId = id
})

function buildCommander(id: string, displayName: string) {
  return {
    id,
    host: displayName.toLowerCase(),
    displayName,
    state: 'running',
    created: '2026-05-01T00:00:00.000Z',
    agentType: 'claude',
    effort: 'medium',
    cwd: '/tmp',
    persona: null,
    heartbeat: {
      intervalMs: 900_000,
      messageTemplate: '[HB {{timestamp}}]',
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

function buildConversation(
  id: string,
  commanderId: string,
  status: ConversationStatus,
  lastMessageAt: string,
): TestConversationRecord {
  return {
    id,
    commanderId,
    surface: 'ui',
    status,
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    createdAt: '2026-05-01T00:00:00.000Z',
    lastMessageAt,
    liveSession: null,
  }
}

function getMockBackendActiveChat(commanderId: string | null): TestConversationRecord | null {
  if (!commanderId) {
    return null
  }
  const [active] = [...(conversationsByCommander[commanderId] ?? [])]
    .filter((conversation) => conversation.status === 'active')
    .sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt))
  return active ?? null
}

function configureMocks() {
  const commanders = [
    buildCommander('atlas', 'Atlas'),
    buildCommander('hermes', 'Hermes'),
  ]
  mocks.useCommander.mockImplementation(() => ({
    commanders,
    selectedCommanderId,
    selectedCommander: commanders.find((commander) => commander.id === selectedCommanderId) ?? null,
    setSelectedCommanderId,
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
    createCommander: vi.fn(async () => commanders[0]),
    createCommanderPending: false,
  }))
  mocks.useConversations.mockImplementation((
    commanderId: string | null,
    selectedConversationId: string | null,
  ) => {
    const fullList = commanderId ? conversationsByCommander[commanderId] ?? [] : []
    const conversations = commanderId === 'hermes' && selectedConversationId === 'conv-hermes'
      ? []
      : fullList

    return {
      conversations,
      selectedConversation: conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    }
  })
  mocks.useActiveConversation.mockImplementation((commanderId: string | null) => ({
    data: getMockBackendActiveChat(commanderId),
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }))
  mocks.fetchCommanderActiveConversation.mockImplementation(async (commanderId: string) =>
    getMockBackendActiveChat(commanderId),
  )
}

function renderTree() {
  if (!queryClient) {
    throw new Error('query client not initialized')
  }

  return (
      <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/command-room/*"
            element={(
              <Fragment>
                <CommandRoom />
              </Fragment>
            )}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function renderAt(path: string) {
  initialEntry = path
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(renderTree())
  })
}

async function rerenderAfterPoll() {
  await act(async () => {
    vi.advanceTimersByTime(1000)
    root?.render(renderTree())
  })
}

async function rerenderCommandRoom() {
  await act(async () => {
    root?.render(renderTree())
  })
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function selectCommander(id: string) {
  const button = document.body.querySelector(`[data-testid="commander-${id}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing commander button ${id}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function conversationDeleteCount() {
  return deleteSpy.mock.calls.filter(([key]) => key === 'conversation').length
}

describe('CommandRoom click status stability', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    selectedCommanderId = '__global__'
    conversationsByCommander = {
      atlas: [
        buildConversation('conv-atlas', 'atlas', 'active', '2026-05-01T00:20:00.000Z'),
      ],
      hermes: [
        buildConversation('conv-hermes', 'hermes', 'active', '2026-05-01T00:30:00.000Z'),
      ],
    }
    mocks.observedStatusLabels.length = 0
    setSelectedCommanderId.mockClear()
    deleteSpy = vi.spyOn(URLSearchParams.prototype, 'delete')
    configureMocks()
    mocks.useAgentSessions.mockReturnValue({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })
    mocks.useMachines.mockReturnValue({ data: [] })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendDispatcher: { send: vi.fn(async () => true) },
      pushOptimisticUserMessage: vi.fn(),
      answerQuestion: vi.fn(),
      isStreaming: false,
      status: 'disconnected',
    })
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useDeleteConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useStartConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: vi.fn() })
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container?.remove()
    root = null
    container = null
    queryClient = null
    deleteSpy.mockRestore()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('keeps the status pill stable while the list query lags behind the active-chat endpoint', async () => {
    const allowedLabels = new Set(['Active', 'Idle'])

    await renderAt('/command-room')
    const deletesBeforeClick = conversationDeleteCount()

    await selectCommander('hermes')
    await rerenderCommandRoom()
    await flushAsync()

    expect(mocks.useConversations.mock.calls.some(([commanderId, selectedConversationId]) =>
      commanderId === 'hermes' && selectedConversationId === 'conv-hermes')).toBe(true)
    // Per #1362: when an active chat exists, the click handler writes
    // ?conversation=<active-id> directly via .set() — no need to .delete()
    // first. The previous design clobbered then restored the param via the
    // poll-driven auto-select effect, which is gone.
    expect(conversationDeleteCount() - deletesBeforeClick).toBe(0)

    const deletesAfterInitialSelect = conversationDeleteCount()

    for (let index = 0; index < 5; index += 1) {
      await rerenderAfterPoll()

      expect(document.body.querySelector('[data-testid="conversation-status-indicator"]')?.textContent)
        .not.toBe('Connected')
      expect(conversationDeleteCount()).toBe(deletesAfterInitialSelect)
    }

    expect(mocks.observedStatusLabels.length).toBeGreaterThan(0)
    expect(mocks.observedStatusLabels).not.toContain('Connected')
    expect(mocks.observedStatusLabels.every((label) => allowedLabels.has(label))).toBe(true)
  })
})
