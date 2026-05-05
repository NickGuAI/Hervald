// @vitest-environment jsdom

import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

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

vi.mock('@modules/conversation/hooks/use-conversations', () => ({
  useActiveConversation: mocks.useActiveConversation,
  useConversations: mocks.useConversations,
  useCreateConversation: mocks.useCreateConversation,
  useDeleteConversation: mocks.useDeleteConversation,
  useStartConversation: mocks.useStartConversation,
  useStopConversation: mocks.useStopConversation,
  useUpdateConversation: mocks.useUpdateConversation,
  useConversationMessage: mocks.useConversationMessage,
  fetchCommanderActiveConversation: vi.fn(async () => null),
  ACTIVE_CONVERSATION_FETCH_STALE_MS: 30_000,
  commanderActiveConversationQueryKey: (commanderId: string) => ['commanders', 'conversations', 'active', commanderId],
}))

import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined
let startMutateAsync: ReturnType<typeof vi.fn>
let createMutateAsync: ReturnType<typeof vi.fn>

function buildIdleConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: 'conv-idle-1',
    commanderId: 'cmd-1',
    surface: 'ui',
    status: 'idle',
    currentTask: null,
    lastHeartbeat: null,
    heartbeat: {
      intervalMs: 300000,
      messageTemplate: '',
      lastSentAt: null,
    },
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    createdAt: '2026-05-01T08:00:00.000Z',
    lastMessageAt: '2026-05-01T08:00:00.000Z',
    liveSession: null,
    ...overrides,
  }
}

function buildCommander(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  }
}

function buildCommanderState(commander = buildCommander()) {
  return {
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

  flushSync(() => {
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

function findStartButtonForChat(): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === 'Start') ?? null
}

function findNewChatButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.includes('New Chat')) ?? null
}

describe('CommandRoom chat-row Start (one-click resume)', () => {
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

    const commander = buildCommander()
    mocks.useCommander.mockReturnValue(buildCommanderState(commander))

    mocks.useAgentSessions.mockReturnValue({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
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
    mocks.useActiveConversation.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    })

    startMutateAsync = vi.fn(async (input: { conversationId: string }) => buildIdleConversation({
      id: input.conversationId,
      status: 'active',
    }))
    createMutateAsync = vi.fn(async (input: { commanderId: string, agentType?: string }) =>
      buildIdleConversation({
        id: 'conv-new',
        commanderId: input.commanderId,
        agentType: input.agentType as ConversationRecord['agentType'],
      }))
    mocks.useStartConversation.mockReturnValue({ mutateAsync: startMutateAsync })
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: createMutateAsync })
    mocks.useDeleteConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: vi.fn() })
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
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    if (originalCanvasGetContext) {
      HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
    }
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('starts an idle chat directly with the conversation’s persisted agentType (no modal)', async () => {
    mocks.useConversations.mockReturnValue({
      conversations: [buildIdleConversation({ id: 'conv-codex', agentType: 'codex' })],
      selectedConversation: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderAt('/command-room')

    const startButton = findStartButtonForChat()
    expect(startButton).not.toBeNull()

    // Bug guard: a "Start Conversation" modal must not appear before or after the click.
    expect(document.body.textContent ?? '').not.toContain('Start Conversation')

    flushSync(() => {
      startButton?.click()
    })

    expect(startMutateAsync).toHaveBeenCalledTimes(1)
    expect(startMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-codex',
      agentType: 'codex',
    })

    // Bug guard (post-click): Direct one-click resume — never a wizard.
    expect(document.body.textContent ?? '').not.toContain('Start Conversation')
  })

  it('falls back to commander.agentType when the conversation has no persisted agentType', async () => {
    mocks.useConversations.mockReturnValue({
      conversations: [buildIdleConversation({ id: 'conv-fresh', agentType: null })],
      selectedConversation: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })

    // Override commander's agentType to verify the fallback chain explicitly.
    const commanderWithCodex = buildCommander({ agentType: 'codex' })
    mocks.useCommander.mockReturnValue(buildCommanderState(commanderWithCodex))

    await renderAt('/command-room')

    const startButton = findStartButtonForChat()
    expect(startButton).not.toBeNull()

    flushSync(() => {
      startButton?.click()
    })

    expect(startMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-fresh',
      agentType: 'codex',
    })
  })

  it('shows the provider picker and creates with the explicitly chosen provider from the New Chat row action', async () => {
    const conversations = [buildIdleConversation({ id: 'conv-existing', agentType: 'claude' })]
    createMutateAsync.mockImplementation(async (input: { commanderId: string, agentType?: string }) => {
      const created = buildIdleConversation({
        id: 'conv-new',
        commanderId: input.commanderId,
        agentType: input.agentType as ConversationRecord['agentType'],
      })
      conversations.push(created)
      return created
    })
    mocks.useConversations.mockImplementation((_, selectedConversationId: string | null) => ({
      conversations,
      selectedConversation: conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }))

    await renderAt('/command-room?commander=cmd-1&conversation=conv-existing')

    const newChatButton = findNewChatButton()
    expect(newChatButton).not.toBeNull()

    flushSync(() => {
      newChatButton?.click()
    })

    expect(document.body.querySelector('[data-testid="start-conversation-panel"]')).not.toBeNull()
    expect(createMutateAsync).not.toHaveBeenCalled()

    const providerSelect = document.body.querySelector(
      '[data-testid="create-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const createButton = document.body.querySelector(
      '[data-testid="create-chat-panel-button"]',
    ) as HTMLButtonElement | null

    expect(providerSelect).not.toBeNull()
    expect(createButton).not.toBeNull()

    flushSync(() => {
      if (providerSelect) {
        providerSelect.value = 'codex'
        providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      createButton?.click()
    })

    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(createMutateAsync).toHaveBeenCalledWith({
      commanderId: 'cmd-1',
      surface: 'ui',
      agentType: 'codex',
    })
  })

  it('does not POST synchronously when the New Chat row action is clicked for an existing commander', async () => {
    const conversations = [buildIdleConversation({ id: 'conv-existing', agentType: 'claude' })]
    mocks.useConversations.mockImplementation((_, selectedConversationId: string | null) => ({
      conversations,
      selectedConversation: conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }))

    await renderAt('/command-room?commander=cmd-1&conversation=conv-existing')

    const newChatButton = findNewChatButton()
    expect(newChatButton).not.toBeNull()

    flushSync(() => {
      newChatButton?.click()
    })

    expect(createMutateAsync).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="start-conversation-panel"]')).not.toBeNull()
  })
})
