// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSessionQueueSnapshot } from '@modules/agents/session-queue-api'

type ConversationStatus = 'active' | 'idle' | 'archived'

interface TestConversationRecord {
  id: string
  commanderId: string
  isDefaultConversation?: boolean
  surface: 'ui'
  status: ConversationStatus
  currentTask: null
  lastHeartbeat: string | null
  heartbeatTickCount: number
  completedTasks: number
  totalCostUsd: number
  createdAt: string
  lastMessageAt: string
  liveSession: null | {
    name: string
    id?: string
    status?: string
    transportType?: string
    processAlive?: boolean
    agentType?: string
    created?: string
    pid?: number
  }
  websocketReady?: boolean
  sendTarget?: {
    kind: 'conversation'
    conversationId: string
    commanderId: string
    sessionName: string
    transportType: string
    agentType: string
    queue: { supported: boolean; reason: string | null }
    media: { supported: boolean; reason: string | null }
  } | null
  allowedActions?: Record<string, boolean>
}

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
  useActiveConversation: vi.fn(),
  useConversations: vi.fn(),
  useConversationMessages: vi.fn(() => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  })),
  useCreateConversation: vi.fn(),
  useDeleteConversation: vi.fn(),
  useStartConversation: vi.fn(),
  useStopConversation: vi.fn(),
  useUpdateConversation: vi.fn(),
  useConversationMessage: vi.fn(),
  fetchCommanderActiveConversation: vi.fn(),
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
  useConversationMessages: mocks.useConversationMessages,
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
  fetchWorkspacePathResolution: vi.fn(async (_source: unknown, requestedPath: string) => ({
    workspace: {},
    requestedPath,
    path: requestedPath,
    type: 'file',
    treePath: '',
  })),
  getWorkspaceSourceKey: () => 'workspace:none',
  materializeWorkspaceContext: vi.fn(async () => ({ text: '', filePaths: [], directoryPaths: [], fileAnnotations: [] })),
  fetchWorkspaceTree: vi.fn(async () => ({ nodes: [], parentPath: '' })),
  fetchWorkspaceExpandedTree: vi.fn(async () => ({ nodes: [], parentPath: '' })),
  openWorkspaceTarget: vi.fn(async () => ({
    targetId: 'wt-test',
    label: 'Local',
    host: 'local',
    readOnly: false,
  })),
  useWorkspaceActions: () => ({
    invalidateAll: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    initGit: vi.fn(),
    uploadFiles: vi.fn(),
  }),
  useWorkspaceFilePreview: () => ({ data: null, isLoading: false, error: null }),
  useWorkspaceGitStatus: () => ({ data: null, isLoading: false, error: null }),
  useWorkspaceGitLog: () => ({ data: null, isLoading: false, error: null }),
}), { virtual: true })

vi.mock('../SessionsColumn', () => ({
  SessionsColumn: ({
    commanders,
    conversations = [],
    onSelectCommander,
    onSelectConversation,
    onArchiveConversation,
    selectedChatId,
    sessionActionError,
  }: {
    commanders: Array<{ id: string; name: string }>
    conversations?: Array<{ id: string }>
    onSelectCommander: (id: string) => void
    onSelectConversation?: (id: string) => void
    onArchiveConversation?: (id: string) => void | Promise<void>
    selectedChatId: string | null
    sessionActionError?: string | null
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
    ...conversations.flatMap((conversation) => [
      createElement(
        'button',
        {
          key: `select-${conversation.id}`,
          type: 'button',
          'data-testid': `conversation-${conversation.id}`,
          onClick: () => onSelectConversation?.(conversation.id),
        },
        conversation.id,
      ),
      createElement(
        'button',
        {
          key: `archive-${conversation.id}`,
          type: 'button',
          'data-testid': `archive-${conversation.id}`,
          onClick: () => {
            const archiveResult = onArchiveConversation?.(conversation.id)
            if (archiveResult && typeof archiveResult.catch === 'function') {
              void archiveResult.catch(() => undefined)
            }
          },
        },
        `archive ${conversation.id}`,
      ),
    ]),
    createElement('div', { 'data-testid': 'selected-chat' }, selectedChatId ?? 'none'),
    createElement('div', { 'data-testid': 'session-action-error' }, sessionActionError ?? ''),
  ),
}), { virtual: true })

vi.mock('../CenterColumn', () => ({
  CenterColumn: ({
    hasSelectedConversation,
    conversationLoadError,
    onRetryConversations,
    onQueue,
    queueSnapshot,
    queueError,
  }: {
    hasSelectedConversation?: boolean
    conversationLoadError?: string | null
    onRetryConversations?: () => void
    onQueue?: (draft: { text: string; images?: never }) => void | Promise<void>
    queueSnapshot?: { totalCount?: number; items?: unknown[] }
    queueError?: string | null
  }) => createElement(
    'div',
    { 'data-testid': 'center-column' },
    createElement('div', { 'data-testid': 'queue-count' }, String(queueSnapshot?.totalCount ?? queueSnapshot?.items?.length ?? 0)),
    createElement('div', { 'data-testid': 'queue-error' }, queueError ?? ''),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'queue-draft',
        onClick: () => {
          const queueResult = onQueue?.({ text: 'Queue this draft' })
          if (queueResult && typeof queueResult.catch === 'function') {
            void queueResult.catch(() => undefined)
          }
        },
      },
      'Queue draft',
    ),
    conversationLoadError
      ? createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'conversation-retry',
            onClick: onRetryConversations,
          },
          conversationLoadError,
        )
      : hasSelectedConversation
      ? 'Chat selected'
      : createElement('button', { type: 'button' }, 'Create Chat'),
  ),
}), { virtual: true })

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

vi.mock('@modules/command-room/components/mobile/MobileCommandRoom', () => ({
  MobileCommandRoom: () => null,
}), { virtual: true })

import { CommandRoom } from '../../CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let selectedCommanderId = '__global__'
let conversationsByCommander: Record<string, TestConversationRecord[]> = {}
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

function buildLiveQueueConversation(
  id: string,
  commanderId: string,
  sessionName: string,
): TestConversationRecord {
  return {
    ...buildConversation(id, commanderId, 'active', '2026-05-01T00:50:00.000Z'),
    websocketReady: true,
    liveSession: {
      name: sessionName,
      status: 'active',
      transportType: 'stream',
      processAlive: true,
      agentType: 'claude',
      created: '2026-05-01T00:45:00.000Z',
      pid: 123,
    },
    sendTarget: {
      kind: 'conversation',
      conversationId: id,
      commanderId,
      sessionName,
      transportType: 'stream',
      agentType: 'claude',
      queue: { supported: true, reason: null },
      media: { supported: true, reason: null },
    },
    allowedActions: {
      send: true,
      queue: true,
      media: true,
      start: false,
      pause: false,
      resume: false,
      archive: true,
      delete: true,
      updateProvider: true,
    },
  }
}

function getMockBackendActiveChat(commanderId: string | null): TestConversationRecord | null {
  if (!commanderId) {
    return null
  }
  const [active] = [...(conversationsByCommander[commanderId] ?? [])]
    .filter((conversation) => (
      conversation.isDefaultConversation !== true
      && (conversation.status === 'active' || conversation.status === 'idle')
    ))
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
    const conversations = commanderId ? conversationsByCommander[commanderId] ?? [] : []
    return {
      conversations,
      selectedConversation: conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    }
  })
  mocks.useActiveConversation.mockImplementation((
    commanderId: string | null,
    enabled = true,
  ) => ({
    data: enabled ? getMockBackendActiveChat(commanderId) : undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }))
  mocks.fetchCommanderActiveConversation.mockImplementation(async (commanderId: string) =>
    getMockBackendActiveChat(commanderId),
  )
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

async function selectCommander(id: string) {
  const button = document.body.querySelector(`[data-testid="commander-${id}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing commander button ${id}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function selectConversation(id: string) {
  const button = document.body.querySelector(`[data-testid="conversation-${id}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing conversation button ${id}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('CommandRoom backend active chat selection', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    selectedCommanderId = '__global__'
    conversationsByCommander = {
      atlas: [
        buildConversation('conv-new', 'atlas', 'active', '2026-05-01T00:20:00.000Z'),
        buildConversation('conv-old', 'atlas', 'active', '2026-05-01T00:10:00.000Z'),
      ],
      hermes: [],
    }
    setSelectedCommanderId.mockClear()
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
    vi.clearAllMocks()
  })

  it('normalizes the command room landing route to global automation', async () => {
    await renderAt('/command-room')

    await vi.waitFor(() => {
      expect(setSelectedCommanderId).toHaveBeenCalledWith('__global__')
    })
    expect(window.location.search).toContain('commander=global')
    expect(window.location.search).toContain('panel=automation')
    expect(window.location.search).not.toContain('conversation=')
  })

  it('selecting a commander applies the backend active chat and writes conversation to the URL', async () => {
    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-new')
    })
    expect(window.location.search).toContain('commander=atlas')
    expect(window.location.search).toContain('conversation=conv-new')
    expect(window.location.search).not.toContain('panel=automation')
  })

  it('commits the commander selection before the active chat lookup resolves', async () => {
    let resolveActive!: (value: TestConversationRecord | null) => void
    mocks.fetchCommanderActiveConversation.mockImplementationOnce(async () =>
      new Promise<TestConversationRecord | null>((resolve) => {
        resolveActive = resolve
      }),
    )

    await renderAt('/command-room')
    await selectCommander('atlas')

    expect(setSelectedCommanderId).toHaveBeenCalledWith('atlas')
    expect(window.location.search).toContain('commander=atlas')
    expect(window.location.search).not.toContain('conversation=')
    expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('none')

    await act(async () => {
      resolveActive(conversationsByCommander.atlas[0] ?? null)
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-new')
    })
    expect(window.location.search).toContain('conversation=conv-new')
  })

  it('loads target commander conversation metadata while URL selection is settling', async () => {
    selectedCommanderId = 'hermes'
    conversationsByCommander.hermes = [
      buildConversation('conv-hermes', 'hermes', 'active', '2026-05-01T00:30:00.000Z'),
    ]

    await renderAt('/command-room?commander=atlas&conversation=conv-old')

    expect(mocks.useConversations.mock.calls.some(([commanderId, selectedConversationId]) =>
      commanderId === 'atlas' && selectedConversationId === null)).toBe(true)
    expect(document.body.querySelector('[data-testid="conversation-conv-new"]')).not.toBeNull()
    expect(mocks.useConversationMessages).not.toHaveBeenCalledWith('conv-old', true)
  })

  it('does not let a stale active chat response override a newer commander selection', async () => {
    conversationsByCommander.hermes = [
      buildConversation('conv-hermes', 'hermes', 'active', '2026-05-01T00:30:00.000Z'),
    ]
    let resolveAthena!: (value: TestConversationRecord | null) => void
    mocks.fetchCommanderActiveConversation.mockImplementation(async (commanderId: string) => {
      if (commanderId === 'atlas') {
        return new Promise<TestConversationRecord | null>((resolve) => {
          resolveAthena = resolve
        })
      }
      return getMockBackendActiveChat(commanderId)
    })

    await renderAt('/command-room')
    await selectCommander('atlas')
    await selectCommander('hermes')

    await vi.waitFor(() => {
      expect(window.location.search).toContain('commander=hermes')
    })

    await act(async () => {
      resolveAthena(conversationsByCommander.atlas[0] ?? null)
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-hermes')
    })
    expect(window.location.search).toContain('commander=hermes')
    expect(window.location.search).toContain('conversation=conv-hermes')
    expect(window.location.search).not.toContain('conv-new')
  })

  it('restores commander and conversation state from the URL', async () => {
    await renderAt('/command-room?commander=atlas&conversation=conv-old')

    await vi.waitFor(() => {
      expect(setSelectedCommanderId).toHaveBeenCalledWith('atlas')
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-old')
    })
  })

  it('updates the URL when the user selects a different chat', async () => {
    await renderAt('/command-room?commander=atlas&conversation=conv-new')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-new')
    })
    await selectConversation('conv-old')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-old')
    })
    expect(window.location.search).toContain('commander=atlas')
    expect(window.location.search).toContain('conversation=conv-old')
    expect(window.location.search).not.toContain('conversation=conv-new')
  })

  it('shows a conversation fetch error instead of the create-chat empty state', async () => {
    mocks.useConversations.mockImplementation(() => ({
      conversations: [],
      selectedConversation: null,
      isLoading: false,
      isFetching: false,
      error: new Error('Request failed (401): Unauthorized'),
      refetch: vi.fn(async () => undefined),
    }))

    await renderAt('/command-room?commander=atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="conversation-retry"]')?.textContent)
        .toContain('Request failed (401): Unauthorized')
    })
    expect(document.body.textContent).not.toContain('Create Chat')
  })

  it('preserves the previous queue snapshot when a refresh fails', async () => {
    conversationsByCommander.atlas = [
      buildLiveQueueConversation('conv-live', 'atlas', 'conversation-live'),
    ]
    mocks.useConversationMessage.mockReturnValue({
      mutateAsync: vi.fn(async () => ({ accepted: true })),
    })
    vi.mocked(fetchSessionQueueSnapshot)
      .mockResolvedValueOnce({
        currentMessage: null,
        items: [{
          id: 'queued-1',
          text: 'Keep this visible',
          priority: 'normal',
          queuedAt: '2026-05-01T00:55:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      })
      .mockRejectedValueOnce(new Error('Request failed (401): Unauthorized'))

    await renderAt('/command-room?commander=atlas&conversation=conv-live')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="queue-count"]')?.textContent).toBe('1')
    })

    const queueButton = document.body.querySelector('[data-testid="queue-draft"]')
    if (!(queueButton instanceof HTMLButtonElement)) {
      throw new Error('missing queue button')
    }
    await act(async () => {
      queueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="queue-error"]')?.textContent).toContain('401')
    })
    expect(document.body.querySelector('[data-testid="queue-count"]')?.textContent).toBe('1')
  })

  it('does not let the previous default commander active chat overwrite a deep-linked conversation', async () => {
    selectedCommanderId = 'hermes'
    conversationsByCommander = {
      atlas: [
        buildConversation('conv-old', 'atlas', 'active', '2026-05-01T00:10:00.000Z'),
      ],
      hermes: [
        buildConversation('conv-hermes', 'hermes', 'active', '2026-05-01T00:30:00.000Z'),
      ],
    }

    await renderAt('/command-room?commander=atlas&conversation=conv-old')

    await vi.waitFor(() => {
      expect(setSelectedCommanderId).toHaveBeenCalledWith('atlas')
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-old')
    })
    expect(window.location.search).toContain('commander=atlas')
    expect(window.location.search).toContain('conversation=conv-old')
    expect(window.location.search).not.toContain('conv-hermes')
  })

  it('uses the backend active chat when archived conversations exist', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-archived', 'atlas', 'archived', '2026-05-01T00:30:00.000Z'),
      buildConversation('conv-active', 'atlas', 'active', '2026-05-01T00:10:00.000Z'),
    ]

    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-active')
    })
    expect(window.location.search).toContain('conversation=conv-active')
  })

  it('loads the backend-selected idle chat when there is no active chat', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-idle', 'atlas', 'idle', '2026-05-01T00:30:00.000Z'),
      buildConversation('conv-archived', 'atlas', 'archived', '2026-05-01T00:40:00.000Z'),
    ]

    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-idle')
    })
    expect(window.location.search).toContain('conversation=conv-idle')
  })

  it('leaves selection empty and does not open the commander stream when the backend has no active or idle chat', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-archived', 'atlas', 'archived', '2026-05-01T00:40:00.000Z'),
    ]

    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('none')
    })
    expect(document.body.textContent).toContain('Create Chat')
    expect(window.location.search).not.toContain('conversation=')
    expect(window.location.search).not.toContain('panel=automation')
    expect(mocks.useAgentSessionStream.mock.calls.map(([sessionName]) => sessionName))
      .not.toContain('commander-atlas')
  })

  it('clears a stale default conversation selection and keeps the create-chat state', async () => {
    conversationsByCommander.atlas = [
      {
        ...buildConversation('conv-default', 'atlas', 'idle', '2026-05-01T00:40:00.000Z'),
        isDefaultConversation: true,
      },
    ]

    await renderAt('/command-room?commander=atlas&conversation=conv-default')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('none')
    })
    expect(document.body.textContent).toContain('Create Chat')
    expect(window.location.search).toContain('commander=atlas')
    expect(window.location.search).toContain('conversation=conv-default')
    expect(mocks.useAgentSessionStream.mock.calls.map(([sessionName]) => sessionName))
      .not.toContain('commander-atlas')
  })

  it('selects the backend active chat with a single fetch and never oscillates on re-clicks (#1362)', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-only', 'atlas', 'idle', '2026-05-01T00:30:00.000Z'),
    ]

    await renderAt('/command-room')

    // Initial click selects Atlas. Per #1362 contract: exactly one backend
    // call, settled state, no transient null between renders.
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-only')
    })
    expect(window.location.search).toContain('conversation=conv-only')
    expect(mocks.fetchCommanderActiveConversation).toHaveBeenCalledTimes(1)
    expect(mocks.fetchCommanderActiveConversation).toHaveBeenCalledWith('atlas')

    // Re-clicking the same commander must NOT re-fetch (cached within
    // staleTime) and must not flip selection through null. The previous
    // poll-driven design oscillated between selected and unselected here.
    await selectCommander('atlas')
    await selectCommander('atlas')

    expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-only')
    expect(window.location.search).toContain('conversation=conv-only')
    expect(mocks.fetchCommanderActiveConversation).toHaveBeenCalledTimes(1)
  })

  it('does not auto-create or auto-select a conversation when the commander has none (#1362)', async () => {
    conversationsByCommander.atlas = []
    const createMutateAsync = vi.fn(async () => {
      throw new Error('createConversation should NOT be called by passive commander selection')
    })
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: createMutateAsync, isPending: false })

    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('none')
    })
    expect(document.body.textContent).toContain('Create Chat')
    // Per #1362 contract: rendering the empty state must NOT POST to create.
    expect(createMutateAsync).not.toHaveBeenCalled()
    expect(window.location.search).not.toContain('conversation=')
    expect(mocks.useAgentSessionStream.mock.calls.map(([sessionName]) => sessionName))
      .not.toContain('commander-atlas')
  })

  it('clears selection and ?conversation= when the user archives the selected chat (#1362)', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-only', 'atlas', 'active', '2026-05-01T00:30:00.000Z'),
    ]
    const updateMutateAsync = vi.fn(async ({ conversationId }: { conversationId: string }) => {
      const conversation = conversationsByCommander.atlas.find((entry) => entry.id === conversationId)
      const archived = { ...(conversation as TestConversationRecord), status: 'archived' as ConversationStatus }
      conversationsByCommander.atlas = conversationsByCommander.atlas
        .map((entry) => entry.id === conversationId ? archived : entry)
      return archived
    })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: updateMutateAsync, isPending: false })

    await renderAt('/command-room?commander=atlas&conversation=conv-only')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-only')
    })

    const archiveButton = document.body.querySelector('[data-testid="archive-conv-only"]')
    if (!(archiveButton instanceof HTMLButtonElement)) {
      throw new Error('missing archive button')
    }
    await act(async () => {
      archiveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'conv-only',
        status: 'archived',
      }))
      expect(window.location.search).not.toContain('conversation=')
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('none')
    })
  })

  it('surfaces archive failures with archive copy in the sessions column', async () => {
    conversationsByCommander.atlas = [
      buildConversation('conv-only', 'atlas', 'active', '2026-05-01T00:30:00.000Z'),
    ]
    const updateMutateAsync = vi.fn(async () => {
      throw new Error('Failed to archive conversation')
    })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: updateMutateAsync, isPending: false })

    await renderAt('/command-room?commander=atlas&conversation=conv-only')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-only')
    })

    const archiveButton = document.body.querySelector('[data-testid="archive-conv-only"]')
    if (!(archiveButton instanceof HTMLButtonElement)) {
      throw new Error('missing archive button')
    }

    await act(async () => {
      archiveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await vi.waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'conv-only',
        status: 'archived',
      }))
      expect(document.body.querySelector('[data-testid="session-action-error"]')?.textContent)
        .toContain('Failed to archive conversation')
    })
  })

  it('does not attach to a legacy commander stream reported as a conversation live session', async () => {
    conversationsByCommander.atlas = [
      {
        ...buildConversation('conv-legacy', 'atlas', 'active', '2026-05-01T00:30:00.000Z'),
        liveSession: {
          name: 'commander-atlas',
          id: 'commander-atlas',
          status: 'active',
          transportType: 'stream',
          processAlive: true,
          agentType: 'claude',
          created: '2026-05-01T00:00:00.000Z',
          pid: 1234,
        },
      },
    ]

    await renderAt('/command-room')
    await selectCommander('atlas')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-chat"]')?.textContent).toBe('conv-legacy')
    })
    expect(mocks.useAgentSessionStream.mock.calls.map(([sessionName]) => sessionName))
      .not.toContain('commander-atlas')
  })
})
