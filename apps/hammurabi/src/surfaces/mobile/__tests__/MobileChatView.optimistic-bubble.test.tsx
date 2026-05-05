// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { MsgItem } from '@modules/agents/messages/model'

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

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => true,
}))

vi.mock('@/hooks/use-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-providers')>()
  return {
    ...actual,
    useProviderRegistry: mocks.useProviderRegistry,
  }
})

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

vi.mock('@/surfaces/hervald/CenterColumn', () => ({
  CenterColumn: () => null,
}))

vi.mock('@/surfaces/hervald/SessionsColumn', () => ({
  SessionsColumn: () => null,
}))

vi.mock('@/surfaces/hervald/TeamColumn', () => ({
  TeamColumn: () => null,
}))

vi.mock('@/surfaces/hervald/WorkspaceModal', () => ({
  WorkspaceModal: () => null,
}))

vi.mock('@/surfaces/mobile/MobileCommandRoom', () => ({
  MobileCommandRoom: ({
    transcript,
    selectedConversationId,
    onSend,
  }: {
    transcript: MsgItem[]
    selectedConversationId?: string | null
    onSend?: (payload: { text: string; images?: { mediaType: string; data: string }[] }) => boolean | Promise<boolean | void> | void
  }) => (
    <div
      data-testid="mobile-command-room-probe"
      data-selected-conversation-id={selectedConversationId ?? ''}
    >
      <button
        type="button"
        data-testid="mobile-send-probe"
        onClick={() => {
          void onSend?.({ text: 'Ship the mobile bubble' })
        }}
      >
        Send
      </button>
      <div data-testid="mobile-transcript-probe">
        {transcript.map((message) => `${message.kind}:${message.text}`).join('|')}
      </div>
    </div>
  ),
}))

import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined
let conversationMessageResolve: ((value: { accepted: boolean }) => void) | null = null

const pushOptimisticUserMessageSpy = vi.fn()
const streamSendInputSpy = vi.fn(async () => true)
const answerQuestionSpy = vi.fn()
const conversationMessageSpy = vi.fn(() => new Promise<{ accepted: boolean }>((resolve) => {
  conversationMessageResolve = resolve
}))

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
    displayName: 'Atlas',
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
    id: 'conv-1',
    commanderId: 'cmd-1',
    surface: 'ui',
    status: 'active',
    currentTask: null,
    lastHeartbeat: null,
    heartbeat: {
      intervalMs: 300000,
      messageTemplate: '',
      lastSentAt: null,
    },
    agentType: 'claude',
    providerContext: null,
    liveSession: {
      id: 'session-conv-1',
      name: 'conversation-conv-1',
      status: 'active',
      transportType: 'stream',
      processAlive: true,
    } as ConversationRecord['liveSession'],
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

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/command-room/*" element={<CommandRoom />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

describe('MobileChatView optimistic user bubble', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    originalCanvasGetContext = HTMLCanvasElement.prototype.getContext
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
    const conversation = buildConversation()

    pushOptimisticUserMessageSpy.mockReset()
    streamSendInputSpy.mockClear()
    answerQuestionSpy.mockClear()
    conversationMessageSpy.mockClear()
    conversationMessageResolve = null

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
    mocks.useAgentSessionStream.mockImplementation(() => {
      const [messages, setMessages] = useState<MsgItem[]>([])

      return {
        messages,
        sendInput: streamSendInputSpy,
        sendDispatcher: { mode: 'ws-direct', send: streamSendInputSpy },
        pushOptimisticUserMessage: (text: string, images?: { mediaType: string; data: string }[]) => {
          pushOptimisticUserMessageSpy(text, images)
          setMessages((prev) => [
            ...prev,
            {
              id: `user-${prev.length + 1}`,
              kind: 'user',
              text: text || '[image]',
              images,
            },
          ])
        },
        answerQuestion: answerQuestionSpy,
        isStreaming: false,
        status: 'connected',
      }
    })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
    mocks.useActiveConversation.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    })
    mocks.useConversations.mockImplementation(() => ({
      conversations: [conversation],
      selectedConversation: conversation,
    }))
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useStartConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useDeleteConversation.mockReturnValue({ mutateAsync: vi.fn(async () => undefined) })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: conversationMessageSpy })
  })

  afterEach(() => {
    if (conversationMessageResolve) {
      conversationMessageResolve({ accepted: true })
      conversationMessageResolve = null
    }
    if (root) {
      root.unmount()
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    if (originalCanvasGetContext) {
      HTMLCanvasElement.prototype.getContext = originalCanvasGetContext
    }
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    vi.clearAllMocks()
  })

  it('renders the optimistic user bubble before the conversation HTTP send resolves', async () => {
    await renderAt('/command-room/sessions/cmd-1?surface=mobile&conversation=conv-1')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-command-room-probe"]')).not.toBeNull()
    })

    await act(async () => {
      const sendProbe = document.body.querySelector('[data-testid="mobile-send-probe"]') as HTMLButtonElement | null
      sendProbe?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(pushOptimisticUserMessageSpy).toHaveBeenCalledWith('Ship the mobile bubble', undefined)
      expect(conversationMessageSpy).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        message: 'Ship the mobile bubble',
        queue: false,
      })
      const transcriptProbe = document.body.querySelector('[data-testid="mobile-transcript-probe"]')
      expect(transcriptProbe?.textContent).toContain('user:Ship the mobile bubble')
    })

    expect(pushOptimisticUserMessageSpy.mock.invocationCallOrder[0]).toBeLessThan(
      conversationMessageSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(streamSendInputSpy).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="mobile-transcript-probe"]')?.textContent).toBe(
      'user:Ship the mobile bubble',
    )

    await act(async () => {
      conversationMessageResolve?.({ accepted: true })
      conversationMessageResolve = null
      await Promise.resolve()
    })

    expect(document.body.querySelector('[data-testid="mobile-transcript-probe"]')?.textContent).toBe(
      'user:Ship the mobile bubble',
    )
  })
})
