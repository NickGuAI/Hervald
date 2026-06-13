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
  useProviderRegistry: vi.fn(),
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
  useDirectories: vi.fn(() => ({ data: undefined, error: null, isLoading: false })),
  verifyTailscaleHostname: vi.fn(),
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
}))

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (value: string) => value === '__global__',
  useCommander: mocks.useCommander,
}))

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
  fetchCommanderActiveConversation: vi.fn(async () => null),
  ACTIVE_CONVERSATION_FETCH_STALE_MS: 30_000,
  commanderActiveConversationQueryKey: (commanderId: string) => ['commanders', 'conversations', 'active', commanderId],
}))

import { CommandRoom } from '@modules/command-room/components/CommandRoom'

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
    allowedActions: {
      send: false,
      queue: false,
      media: false,
      start: true,
      pause: false,
      resume: true,
      archive: true,
      delete: true,
      updateProvider: true,
    },
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

function buildProvider(id: string, label: string) {
  return {
    id,
    label,
    eventProvider: id,
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
      supportsMessageImages: true,
    },
    uiCapabilities: {
      supportsEffort: id === 'claude',
      supportsAdaptiveThinking: id === 'claude',
      supportsMaxThinkingTokens: id === 'claude',
      supportsSkills: id === 'claude',
      supportsLoginMode: id !== 'gemini',
      permissionModes: [{ value: 'default', label: 'default', description: label }],
    },
    availableModels: [],
    supportedTransports: ['stream', 'pty'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: null,
      ...(id === 'claude'
        ? {
            effort: 'max',
            adaptiveThinking: 'disabled',
            maxThinkingTokens: 128000,
          }
        : {}),
    },
    disabledReason: null,
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
  return document.body.querySelector('button[aria-label="Start chat"]') as HTMLButtonElement | null
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
    mocks.useProviderRegistry.mockReturnValue({
      data: [
        buildProvider('claude', 'Claude'),
        buildProvider('codex', 'Codex'),
        buildProvider('gemini', 'Gemini'),
      ],
      isLoading: false,
      error: null,
    })
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
    mocks.useConversationMessages.mockReturnValue({
      data: { pages: [] },
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
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
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    if (originalCanvasGetContext) {
      HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
    }
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('starts an idle chat directly with the conversation’s persisted agentType and model (no modal)', async () => {
    mocks.useConversations.mockReturnValue({
      conversations: [buildIdleConversation({ id: 'conv-codex', agentType: 'codex', model: 'gpt-5.5' })],
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
      model: 'gpt-5.5',
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

  it('renders backend historical messages for a selected conversation before websocket replay arrives', async () => {
    const conversation = buildIdleConversation({
      id: 'conv-history',
      status: 'active',
    })
    mocks.useConversations.mockImplementation((_, selectedConversationId: string | null) => ({
      conversations: [conversation],
      selectedConversation: selectedConversationId === conversation.id ? conversation : null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }))
    const fetchNextPage = vi.fn()
    mocks.useConversationMessages.mockReturnValue({
      data: {
        pages: [{
          conversationId: conversation.id,
          sessionName: 'commander-cmd-1-conversation-conv-history',
          source: 'transcript',
          limit: 10,
          before: null,
          nextBefore: '3',
          hasMore: true,
          totalMessages: 13,
          messages: [
            { id: 'history-1', kind: 'user', text: 'Earlier user message' },
            { id: 'history-2', kind: 'agent', text: 'Earlier assistant reply' },
          ],
        }],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    })

    await renderAt('/command-room?commander=cmd-1&conversation=conv-history')

    await vi.waitFor(() => {
      expect(document.body.textContent ?? '').toContain('Earlier assistant reply')
    })
    expect(mocks.useConversationMessages).toHaveBeenCalledWith('conv-history', true)
    const loadOlderButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load older')) as HTMLButtonElement | undefined
    expect(loadOlderButton).toBeDefined()

    flushSync(() => {
      loadOlderButton?.click()
    })

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('waits for backend websocketReady before opening a selected conversation websocket', async () => {
    const conversation = buildIdleConversation({
      id: 'conv-starting',
      status: 'active',
      runtimeState: 'starting',
      websocketReady: false,
      liveSession: {
        name: 'commander-cmd-1-conversation-conv-starting',
        created: '2026-05-01T08:00:00.000Z',
        lastActivityAt: '2026-05-01T08:00:00.000Z',
        pid: 0,
        transportType: 'stream',
        processAlive: true,
        hadResult: false,
        status: 'running',
        agentType: 'claude',
      },
      sendTarget: {
        kind: 'conversation',
        conversationId: 'conv-starting',
        commanderId: 'cmd-1',
        sessionName: 'commander-cmd-1-conversation-conv-starting',
        transportType: 'stream',
        agentType: 'claude',
        queue: { supported: false, reason: 'Conversation is starting' },
        media: { supported: false, reason: 'Conversation is starting' },
      },
      allowedActions: {
        send: false,
        queue: false,
        media: false,
        start: false,
        pause: true,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: false,
      },
      displayState: {
        status: 'active',
        runtimeState: 'starting',
        websocketReady: false,
        runtimeError: null,
        isVisible: true,
        isDefaultConversation: false,
        hasLiveSession: true,
        isSendable: false,
        isQueueable: false,
        isMediaSendable: false,
        label: 'Starting chat',
        disabledReasons: {
          send: 'Conversation is starting',
          queue: 'Conversation is starting',
          media: 'Conversation is starting',
          start: 'Conversation is already starting',
          pause: null,
          resume: 'Conversation is already starting',
          archive: null,
          delete: null,
          updateProvider: 'Conversation is starting',
        },
      },
    })
    mocks.useConversations.mockImplementation((_, selectedConversationId: string | null) => ({
      conversations: [conversation],
      selectedConversation: selectedConversationId === conversation.id ? conversation : null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }))

    await renderAt('/command-room?commander=cmd-1&conversation=conv-starting')

    await vi.waitFor(() => expect(mocks.useAgentSessionStream).toHaveBeenCalled())
    expect(mocks.useAgentSessionStream).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({
        enabled: false,
        websocketPath: undefined,
      }),
    )
  })

  it('shows the provider picker and creates with the selected provider from the New Chat row action', async () => {
    mocks.useCommander.mockReturnValue(buildCommanderState(buildCommander({ agentType: 'codex' })))
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
    expect(document.body.querySelector('[data-testid="create-chat-reasoning-settings"]')).toBeNull()
    expect(createMutateAsync).not.toHaveBeenCalled()

    const providerSelect = document.body.querySelector(
      '[data-testid="create-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const createButton = document.body.querySelector(
      '[data-testid="create-chat-panel-button"]',
    ) as HTMLButtonElement | null
    expect(providerSelect).not.toBeNull()
    expect(providerSelect?.disabled).toBe(false)
    expect(Array.from(providerSelect?.options ?? []).map((option) => option.value)).toContain('codex')
    expect(providerSelect?.value).toBe('codex')
    expect(document.body.querySelectorAll('[data-testid="create-chat-provider-select"]')).toHaveLength(1)
    expect(createButton).not.toBeNull()
    expect(createButton?.disabled).toBe(false)

    flushSync(() => {
      createButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(createMutateAsync).toHaveBeenCalledTimes(1)
    expect(createMutateAsync).toHaveBeenCalledWith({
      commanderId: 'cmd-1',
      surface: 'ui',
      agentType: 'codex',
      model: null,
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
