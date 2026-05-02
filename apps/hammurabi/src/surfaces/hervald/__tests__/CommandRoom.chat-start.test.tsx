// @vitest-environment jsdom

import { act } from 'react'
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
  useConversations: vi.fn(),
  useCreateConversation: vi.fn(),
  useStartConversation: vi.fn(),
  useStopConversation: vi.fn(),
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
  useConversations: mocks.useConversations,
  useCreateConversation: mocks.useCreateConversation,
  useStartConversation: mocks.useStartConversation,
  useStopConversation: mocks.useStopConversation,
  useConversationMessage: mocks.useConversationMessage,
}))

import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined
let startMutateAsync: ReturnType<typeof vi.fn>

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
    host: 'athena',
    displayName: 'Test Commander',
    pid: null,
    state: 'running',
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

function findStartButtonForChat(): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === 'Start') ?? null
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
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.usePendingApprovals.mockReturnValue({ data: [] })

    startMutateAsync = vi.fn(async (input: { conversationId: string }) => buildIdleConversation({
      id: input.conversationId,
      status: 'active',
    }))
    mocks.useStartConversation.mockReturnValue({ mutateAsync: startMutateAsync })
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn() })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: vi.fn() })
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

    await act(async () => {
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
    mocks.useCommander.mockReturnValue({
      ...mocks.useCommander.getMockImplementation()?.(),
      commanders: [commanderWithCodex],
      selectedCommanderId: commanderWithCodex.id,
      selectedCommander: commanderWithCodex,
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
      createCommander: vi.fn(async () => commanderWithCodex),
      createCommanderPending: false,
    })

    await renderAt('/command-room')

    const startButton = findStartButtonForChat()
    expect(startButton).not.toBeNull()

    await act(async () => {
      startButton?.click()
    })

    expect(startMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-fresh',
      agentType: 'codex',
    })
  })
})
