// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { act } from 'react-dom/test-utils'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

const NARROW_QUERY = '(max-width: 767px)'
const COARSE_PHONE_QUERY = '(pointer: coarse) and (max-width: 932px)'

const mocks = vi.hoisted(() => ({
  useCommander: vi.fn(),
  useAgentSessions: vi.fn(),
  useMachines: vi.fn(),
  useAgentSessionStream: vi.fn(),
  usePendingApprovals: vi.fn(),
  useActiveConversation: vi.fn(),
  useConversations: vi.fn(),
  useCreateConversation: vi.fn(),
  useStartConversation: vi.fn(),
  useStopConversation: vi.fn(),
  useUpdateConversation: vi.fn(),
  useDeleteConversation: vi.fn(),
  useConversationMessage: vi.fn(),
  lastMobileComposerSessionName: null as string | null,
  lastDesktopComposerSessionName: null as string | null,
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

vi.mock('@modules/conversation/hooks/use-conversations', () => ({
  useActiveConversation: mocks.useActiveConversation,
  useConversations: mocks.useConversations,
  useCreateConversation: mocks.useCreateConversation,
  useDeleteConversation: mocks.useDeleteConversation,
  useConversationMessage: mocks.useConversationMessage,
  useStartConversation: mocks.useStartConversation,
  useStopConversation: mocks.useStopConversation,
  useUpdateConversation: mocks.useUpdateConversation,
  fetchCommanderActiveConversation: vi.fn(async () => null),
  ACTIVE_CONVERSATION_FETCH_STALE_MS: 30_000,
  commanderActiveConversationQueryKey: (commanderId: string) => ['commanders', 'conversations', 'active', commanderId],
}))

vi.mock('../SessionsColumn', () => ({
  SessionsColumn: () => null,
}))

vi.mock('../TeamColumn', () => ({
  TeamColumn: () => null,
}))

vi.mock('../WorkspaceModal', () => ({
  WorkspaceModal: () => null,
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: () => null,
}))

vi.mock('@modules/agents/components/AddWorkerWizard', () => ({
  AddWorkerWizard: () => null,
}))

vi.mock('@modules/agents/components/NewSessionForm', () => ({
  NewSessionForm: () => null,
}))

vi.mock('@modules/commanders/components/CreateCommanderWizard', () => ({
  CreateCommanderWizard: () => null,
}))

vi.mock('../CenterColumn', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const draftModule = await vi.importActual<typeof import('@modules/agents/page-shell/use-session-draft')>(
    '@modules/agents/page-shell/use-session-draft',
  )

  function DesktopComposerProbe({
    composerSessionName,
  }: {
    composerSessionName: string
  }) {
    mocks.lastDesktopComposerSessionName = composerSessionName
    const { inputText, setInputText } = draftModule.useSessionDraft(composerSessionName)

    return React.createElement('textarea', {
      'data-testid': 'desktop-composer',
      'data-session-name': composerSessionName,
      value: inputText,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputText(event.target.value)
      },
    })
  }

  return {
    CenterColumn: DesktopComposerProbe,
  }
})

vi.mock('@/surfaces/mobile/MobileCommandRoom', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const draftModule = await vi.importActual<typeof import('@modules/agents/page-shell/use-session-draft')>(
    '@modules/agents/page-shell/use-session-draft',
  )

  function MobileComposerProbe({
    composerSessionName,
    selectedConversationId,
    onSelectConversationId,
  }: {
    composerSessionName: string
    selectedConversationId?: string | null
    onSelectConversationId?: (conversationId: string | null) => void
  }) {
    React.useEffect(() => {
      if (!selectedConversationId) {
        onSelectConversationId?.('conv-1')
      }
    }, [onSelectConversationId, selectedConversationId])

    mocks.lastMobileComposerSessionName = composerSessionName
    const { inputText, setInputText } = draftModule.useSessionDraft(composerSessionName)

    return React.createElement('textarea', {
      'data-testid': 'mobile-composer',
      'data-session-name': composerSessionName,
      value: inputText,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputText(event.target.value)
      },
    })
  }

  return {
    MobileCommandRoom: MobileComposerProbe,
  }
})

import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

type MediaQueryListener = (event: MediaQueryListEvent) => void

interface MatchMediaController {
  matchMedia: typeof window.matchMedia
  setMatches: (next: Partial<Record<string, boolean>>) => void
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalActEnvironment: boolean | undefined

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function createMatchMediaController(
  initialMatches: Record<string, boolean>,
): MatchMediaController {
  const matches = new Map(Object.entries(initialMatches))
  const mqlByQuery = new Map<string, MediaQueryList & { listeners: Set<MediaQueryListener> }>()

  function getMql(query: string) {
    let existing = mqlByQuery.get(query)
    if (existing) {
      return existing
    }

    const listeners = new Set<MediaQueryListener>()
    const next = {
      matches: Boolean(matches.get(query)),
      media: query,
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: MediaQueryListener) => {
        listeners.add(listener)
      }),
      removeEventListener: vi.fn((_type: string, listener: MediaQueryListener) => {
        listeners.delete(listener)
      }),
      addListener: vi.fn((listener: MediaQueryListener) => {
        listeners.add(listener)
      }),
      removeListener: vi.fn((listener: MediaQueryListener) => {
        listeners.delete(listener)
      }),
      dispatchEvent: vi.fn(),
      listeners,
    } as MediaQueryList & { listeners: Set<MediaQueryListener> }

    mqlByQuery.set(query, next)
    return next
  }

  return {
    matchMedia: vi.fn().mockImplementation((query: string) => getMql(query)),
    setMatches(next) {
      for (const [query, value] of Object.entries(next)) {
        const mql = getMql(query)
        if (mql.matches === value) {
          continue
        }

        matches.set(query, value)
        mql.matches = value
        const event = { matches: value, media: query } as MediaQueryListEvent
        mql.listeners.forEach((listener) => listener(event))
        mql.onchange?.(event)
      }
    },
  }
}

function buildCommander() {
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
      intervalMs: 900000,
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

function buildConversation(): ConversationRecord {
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
      id: 'stream-conv-1',
      name: 'commander-cmd-1-conv-1-claude-stream',
      created: '2026-05-01T08:00:00.000Z',
      pid: 123,
      status: 'active',
      agentType: 'claude',
      transportType: 'stream',
      processAlive: true,
    },
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:05:00.000Z',
    lastMessageAt: '2026-05-01T08:05:00.000Z',
    name: 'Chat 1',
  }
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve()
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
    await flushMicrotasks()
  })
}

function expectComposer(testId: 'mobile-composer' | 'desktop-composer'): HTMLTextAreaElement {
  const composer = document.body.querySelector(`[data-testid="${testId}"]`)
  expect(composer).not.toBeNull()
  return composer as HTMLTextAreaElement
}

async function settle(rounds = 4) {
  await act(async () => {
    await flushMicrotasks(rounds)
  })
}

async function advanceTime(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
    await flushMicrotasks()
  })
}

async function setComposerText(composer: HTMLTextAreaElement, value: string) {
  await act(async () => {
    flushSync(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      descriptor?.set?.call(composer, value)
      composer.dispatchEvent(new Event('input', { bubbles: true }))
      composer.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushMicrotasks()
  })
}

describe('CommandRoom composer draft survives surface flips', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    originalMatchMedia = window.matchMedia
    originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.lastMobileComposerSessionName = null
    mocks.lastDesktopComposerSessionName = null

    const commander = buildCommander()
    const conversation = buildConversation()

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
    mocks.usePendingApprovals.mockReturnValue({ data: [] })
    mocks.useActiveConversation.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(async () => true),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      pushOptimisticUserMessage: vi.fn(),
      answerQuestion: vi.fn(),
      isStreaming: false,
      status: 'connected',
    })
    mocks.useConversations.mockImplementation((_commanderId: string | null, selectedConversationId: string | null) => ({
      conversations: [conversation],
      selectedConversation: selectedConversationId === conversation.id ? conversation : null,
    }))
    mocks.useCreateConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useStartConversation.mockReturnValue({ mutateAsync: vi.fn(async () => ({ conversation })) })
    mocks.useStopConversation.mockReturnValue({ mutateAsync: vi.fn(async () => undefined) })
    mocks.useUpdateConversation.mockReturnValue({ mutateAsync: vi.fn(async () => conversation) })
    mocks.useDeleteConversation.mockReturnValue({ mutateAsync: vi.fn(async () => undefined) })
    mocks.useConversationMessage.mockReturnValue({ mutateAsync: vi.fn(async () => ({ accepted: true })) })
    window.localStorage.clear()
  })

  afterEach(() => {
    if (root) {
      act(() => {
        flushSync(() => {
          root?.unmount()
        })
      })
    }

    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    window.localStorage.clear()
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('restores the conversation draft after a mobile-to-desktop matchMedia flip', async () => {
    const matchMediaController = createMatchMediaController({
      [NARROW_QUERY]: true,
      [COARSE_PHONE_QUERY]: false,
    })
    window.matchMedia = matchMediaController.matchMedia

    await renderAt('/command-room')
    await settle()

    const mobileComposer = expectComposer('mobile-composer')
    expect(mobileComposer.dataset.sessionName).toBe('conversation-conv-1')

    await setComposerText(mobileComposer, 'draft survives rotation')
    expect(mobileComposer.value).toBe('draft survives rotation')
    await advanceTime(500)
    expect(window.localStorage.getItem('hammurabi:draft:conversation-conv-1')).toBe('draft survives rotation')

    act(() => {
      matchMediaController.setMatches({
        [NARROW_QUERY]: false,
        [COARSE_PHONE_QUERY]: false,
      })
    })
    await settle()
    await settle()

    const desktopComposer = expectComposer('desktop-composer')
    expect(desktopComposer.value).toBe('draft survives rotation')
    expect(window.localStorage.getItem('hammurabi:draft:commander-cmd-1-conv-1-claude-stream')).toBeNull()
  })

  it('derives the same composer session key on both surfaces for a live conversation', async () => {
    const matchMediaController = createMatchMediaController({
      [NARROW_QUERY]: true,
      [COARSE_PHONE_QUERY]: false,
    })
    window.matchMedia = matchMediaController.matchMedia

    await renderAt('/command-room')
    await settle()
    expect(mocks.lastMobileComposerSessionName).toBe('conversation-conv-1')

    act(() => {
      matchMediaController.setMatches({
        [NARROW_QUERY]: false,
        [COARSE_PHONE_QUERY]: false,
      })
    })
    await settle()

    expect(mocks.lastDesktopComposerSessionName).toBe('conversation-conv-1')
    expect(mocks.lastDesktopComposerSessionName).toBe(mocks.lastMobileComposerSessionName)
  })
})
