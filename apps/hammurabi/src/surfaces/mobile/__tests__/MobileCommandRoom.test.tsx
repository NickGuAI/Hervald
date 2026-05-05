// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useProviderRegistry: vi.fn(),
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
  createSession: vi.fn(),
  getDebriefStatus: vi.fn(),
  killSession: vi.fn(),
  resumeSession: vi.fn(),
  triggerPreKillDebrief: vi.fn(),
  useAgentSessions: mocks.useAgentSessions,
  useMachines: mocks.useMachines,
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-providers')>()
  return {
    ...actual,
    useProviderRegistry: mocks.useProviderRegistry,
  }
})

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
let startCommander: ReturnType<typeof vi.fn>

function buildProvider(id: string, label: string) {
  return {
    id,
    label,
    uiCapabilities: {
      supportsEffort: id === 'claude',
      supportsAdaptiveThinking: id === 'claude',
      supportsSkills: id === 'claude',
      supportsLoginMode: id !== 'gemini',
      forcedTransport: id === 'gemini' ? 'stream' : undefined,
      permissionModes: [{ value: 'default', label: 'default', description: label }],
    },
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

function buildConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
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
    agentType: 'claude',
    providerContext: null,
    liveSession: null,
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:05:00.000Z',
    lastMessageAt: '2026-05-01T08:05:00.000Z',
    name: 'Chat 1',
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

  root?.render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/command-room/*" element={<CommandRoom />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  )
  await Promise.resolve()
}

describe('CommandRoom mobile branch', () => {
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
    startCommander = vi.fn(async () => undefined)

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
    mocks.usePendingApprovals.mockReturnValue({
      data: [
        {
          id: 'approval-1',
          decisionId: 'approval-1',
          actionLabel: 'File Change',
          actionId: 'file_change',
          source: 'codex',
          commanderId: 'cmd-1',
          commanderName: 'Test Commander',
          sessionName: 'commander-cmd-1',
          requestedAt: '2026-04-21T15:00:00.000Z',
          requestId: 'approval-1',
          reason: 'Needs approval',
          risk: 'high',
          summary: 'Apply a file patch',
          previewText: null,
          details: [],
          raw: {},
          context: null,
        },
      ],
    })
    mocks.useActiveConversation.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    })
    mocks.useConversations.mockReturnValue({
      conversations: [],
      selectedConversation: null,
    })
    mocks.useCreateConversation.mockReturnValue({
      mutateAsync: vi.fn(async ({ commanderId }: { commanderId: string }) =>
        buildConversation({ commanderId }),
      ),
    })
    mocks.useStartConversation.mockReturnValue({
      mutateAsync: vi.fn(async ({ conversationId }: { conversationId: string }) =>
        buildConversation({
          id: conversationId,
          status: 'active',
          liveSession: {
            id: `session-${conversationId}`,
            name: `conversation-${conversationId}`,
            status: 'active',
            transportType: 'stream',
          } as ConversationRecord['liveSession'],
        }),
      ),
    })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn(async () => buildConversation()) })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: vi.fn(async () => buildConversation()) })
    mocks.useDeleteConversation.mockReturnValue({ mutateAsync: vi.fn(async () => undefined) })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: vi.fn(async () => ({ accepted: true })) })
  })

  afterEach(async () => {
    if (root) {
      root?.unmount()
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

  it('renders the inbox tab from the route when ?surface=mobile is set', async () => {
    await renderAt('/command-room/inbox?surface=mobile')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-inbox"]')).not.toBeNull()
    })
  })

  it('renders the settings tab from the route when ?surface=mobile is set', async () => {
    await renderAt('/command-room/settings?surface=mobile')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-settings"]')).not.toBeNull()
    })
  })

  it('normalizes /command-room?surface=mobile to the sessions screen', async () => {
    await renderAt('/command-room?surface=mobile')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-sessions-list"]')).not.toBeNull()
    })
  })

  it('MobileCommandRoom is a normal flex-fill (no fixed-overlay) so BottomNav stays tappable', async () => {
    // Regression guard for #1107: PR #1105 briefly made MobileCommandRoom
    // a `fixed inset-0 z-40` overlay, which covered the BottomNav (z-20)
    // and intercepted taps on the mobile tab bar. Viewport containment
    // now lives at Shell's <main>; MobileCommandRoom must NOT recreate
    // the overlay or we re-break the bottom nav.
    await renderAt('/command-room/sessions/cmd-1?surface=mobile')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-command-room"]')).not.toBeNull()
    })

    const commandRoom = document.body.querySelector('[data-testid="mobile-command-room"]')
    expect(commandRoom).not.toBeNull()

    const overlayTokens = ['fixed', 'inset-0', 'z-40', 'w-screen', 'max-w-[100vw]']
    for (const token of overlayTokens) {
      expect(commandRoom?.className).not.toContain(token)
    }

    const flexFillTokens = ['flex', 'min-h-0', 'flex-1', 'w-full', 'flex-col']
    for (const token of flexFillTokens) {
      expect(commandRoom?.className).toContain(token)
    }

    // overflow-x-hidden remains here as defence-in-depth under Shell's
    // architectural overflowX:hidden (see Shell.tsx).
    expect(commandRoom?.className).toContain('overflow-x-hidden')
  })

  it('shows the provider picker and only creates after explicit confirmation in the mobile empty state', async () => {
    const commander = buildCommander({ state: 'stopped', agentType: 'claude' })
    startCommander = vi.fn(async () => undefined)
    const createConversation = vi.fn(async ({ commanderId }: { commanderId: string }) =>
      buildConversation({ id: 'conv-new', commanderId }),
    )
    const startConversation = vi.fn(async ({ conversationId }: { conversationId: string }) =>
      buildConversation({
        id: conversationId,
        status: 'active',
        liveSession: {
          id: `session-${conversationId}`,
          name: `conversation-${conversationId}`,
          status: 'active',
          transportType: 'stream',
        } as ConversationRecord['liveSession'],
      }),
    )

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
    mocks.useConversations.mockReturnValue({
      conversations: [],
      selectedConversation: null,
    })
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: createConversation })
    mocks.useStartConversation.mockReturnValue({ mutateAsync: startConversation })

    await renderAt('/command-room/sessions/cmd-1?surface=mobile')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="create-chat-panel-button"]')).not.toBeNull()
    })

    const providerSelect = document.body.querySelector(
      '[data-testid="create-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const createButton = document.body.querySelector(
      '[data-testid="create-chat-panel-button"]',
    ) as HTMLButtonElement | null

    expect(providerSelect).not.toBeNull()
    expect(createButton).not.toBeNull()

    if (providerSelect) {
      providerSelect.value = 'codex'
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    createButton?.click()

    await vi.waitFor(() => {
      expect(createConversation).toHaveBeenCalledWith({
        commanderId: 'cmd-1',
        surface: 'ui',
        agentType: 'codex',
      })
    })
    // Per #1362 contract: never auto-start. The empty-state CTA only creates;
    // the user must tap Start chat in the session shell explicitly.
    expect(startConversation).not.toHaveBeenCalled()
    expect(startCommander).not.toHaveBeenCalled()
  })
})
