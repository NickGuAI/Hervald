// @vitest-environment jsdom

import { act, createElement, Fragment } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLocalStorage } from './ensureLocalStorage'
import { ModuleGraphProvider } from '@/module-graph-context'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'
import { COMMAND_ROOM_ROUTE_METADATA } from '../route-metadata'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  useAgentSessionStream: vi.fn(),
  createMachine: vi.fn(),
  createSession: vi.fn(),
  useAgentSessions: vi.fn(),
  useDirectories: vi.fn(),
  useMachines: vi.fn(),
  verifyTailscaleHostname: vi.fn(),
  useCommander: vi.fn(),
  usePendingApprovals: vi.fn(),
  useApprovalDecision: vi.fn(),
  useOpenAITranscriptionConfig: vi.fn(),
  useOpenAITranscription: vi.fn(),
  useSpeechRecognition: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  useAgentSessionStream: mocks.useAgentSessionStream,
}))

vi.mock('@/hooks/use-agents', () => ({
  createMachine: mocks.createMachine,
  createSession: mocks.createSession,
  useAgentSessions: mocks.useAgentSessions,
  useDirectories: mocks.useDirectories,
  useMachines: mocks.useMachines,
  verifyTailscaleHostname: mocks.verifyTailscaleHostname,
}))

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: mocks.usePendingApprovals,
  useApprovalDecision: mocks.useApprovalDecision,
}))

vi.mock('@/hooks/use-openai-transcription', () => ({
  useOpenAITranscriptionConfig: mocks.useOpenAITranscriptionConfig,
  useOpenAITranscription: mocks.useOpenAITranscription,
}))

vi.mock('@/hooks/use-speech-recognition', () => ({
  useSpeechRecognition: mocks.useSpeechRecognition,
}))

vi.mock('../../agents/components/SkillsPicker', () => ({
  SkillsPicker: () => null,
}))

vi.mock('../../commanders/hooks/useCommander', () => ({
  GLOBAL_COMMANDER_ID: '__global__',
  isGlobalCommanderId: (commanderId: string | null | undefined) => commanderId === '__global__',
  useCommander: mocks.useCommander,
}))

vi.mock('../components/desktop/SessionsColumn', () => ({
  SessionsColumn: ({
    onCreateSession,
    commanders = [],
    onSelectCommander,
  }: {
    onCreateSession?: () => void
    commanders?: Array<{ id: string; name: string }>
    onSelectCommander?: (id: string) => void
  }) => createElement(
    'div',
    undefined,
    createElement(
      'button',
      {
        type: 'button',
        onClick: onCreateSession,
      },
      'Open new session',
    ),
    ...commanders.map((commander) => createElement(
      'button',
      {
        key: commander.id,
        type: 'button',
        onClick: () => onSelectCommander?.(commander.id),
      },
      commander.name,
    )),
    'SessionsColumn',
  ),
}))

vi.mock('../../commanders/components/QuestBoard', () => ({
  QuestBoard: () => createElement('div', undefined, 'QuestBoard panel'),
}))

vi.mock('../../commanders/components/CommanderSentinelsTab', () => ({
  CommanderSentinelsTab: () => createElement('div', undefined, 'Sentinels panel'),
}))

vi.mock('../../commanders/components/AutomationPanel', () => ({
  AutomationPanel: () => createElement('div', undefined, 'Automation panel'),
}))

vi.mock('../../commanders/components/CommanderIdentityTab', () => ({
  CommanderIdentityTab: () => createElement('div', undefined, 'Identity panel'),
}))

import CommandRoomPage from '../page'

const moduleGraph: HammurabiModuleGraphResponse = {
  modules: [
    {
      id: 'command-room',
      label: 'Command Room',
      status: 'public',
      summary: 'Command room test graph.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        routes: [{
          id: 'command-room.ui',
          path: '/command-room',
          componentKey: 'modules/command-room/page',
          surfaces: ['desktop', 'mobile'],
          metadata: COMMAND_ROOM_ROUTE_METADATA,
        }],
        surfaces: ['desktop', 'mobile'],
      },
    },
  ],
  routes: [],
  parsers: [],
  websockets: [{
    id: 'conversation.session-stream',
    moduleId: 'conversation',
    path: '/api/conversations/:id/ws',
    match: 'exact',
    auth: 'api-key-or-auth0',
  }],
  storage: [],
  nav: [],
  providers: [],
}

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
let previousActEnvironment: boolean | undefined
let mountedRoots: Root[] = []
let setIntervalSpy: ReturnType<typeof vi.spyOn> | null = null
let clearIntervalSpy: ReturnType<typeof vi.spyOn> | null = null
let originalMatchMedia: typeof window.matchMedia | undefined

function LocationProbe() {
  const location = useLocation()
  return createElement(
    'div',
    { 'data-testid': 'location-probe' },
    `${location.pathname}${location.search}`,
  )
}

function CommandRoomRoute() {
  return createElement(
    Fragment,
    null,
    createElement(CommandRoomPage),
    createElement(LocationProbe),
  )
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderAt(pathname: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ModuleGraphProvider,
          { graph: moduleGraph },
          createElement(
            MemoryRouter,
            { initialEntries: [pathname] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/command-room',
                element: createElement(CommandRoomRoute),
              }),
            ),
          ),
        ),
      ),
    )
  })

  return {
    root,
    container,
  }
}

function currentLocationText(): string {
  return document.body.querySelector('[data-testid="location-probe"]')?.textContent ?? ''
}

function clickButton(label: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) {
    throw new Error(`Could not find button: ${label}`)
  }
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function composerQueueButton(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === 'Open queue',
  ) as HTMLButtonElement | undefined
}

function changeComposerText(value: string) {
  const input = Array.from(document.body.querySelectorAll('textarea, input')).find(
    (candidate) => candidate.getAttribute('placeholder')?.includes('Send a message to'),
  ) as HTMLTextAreaElement | HTMLInputElement | undefined
  if (!input) {
    throw new Error('Could not find composer input')
  }

  const prototype = input instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  flushSync(() => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function pressComposerEnter() {
  const input = Array.from(document.body.querySelectorAll('textarea, input')).find(
    (candidate) => candidate.getAttribute('placeholder')?.includes('Send a message to'),
  )
  if (!input) {
    throw new Error('Could not find composer input')
  }

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

function pressComposerTab() {
  const input = Array.from(document.body.querySelectorAll('textarea, input')).find(
    (candidate) => candidate.getAttribute('placeholder')?.includes('Send a message to'),
  )
  if (!input) {
    throw new Error('Could not find composer input')
  }

  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
}

async function attachComposerImage(base64 = 'ZmFrZS1pbWFnZQ==', mediaType = 'image/png') {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement | null
  if (!input) {
    throw new Error('Could not find composer file input')
  }

  const originalFileReader = globalThis.FileReader
  class MockFileReader {
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null

    readAsDataURL() {
      this.onload?.({
        target: {
          result: `data:${mediaType};base64,${base64}`,
        },
      } as ProgressEvent<FileReader>)
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader
  const file = new File(['image'], 'attachment.png', { type: mediaType })
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  })

  try {
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    await flushAsync()
  } finally {
    globalThis.FileReader = originalFileReader
  }
}

function composerInput(): HTMLTextAreaElement | HTMLInputElement | undefined {
  return Array.from(document.body.querySelectorAll('textarea, input')).find(
    (candidate) => candidate.getAttribute('placeholder')?.includes('Send a message to'),
  ) as HTMLTextAreaElement | HTMLInputElement | undefined
}

function latestConversationMessagePostBody(): Record<string, unknown> {
  const call = [...mocks.fetchJson.mock.calls].reverse().find(([path, init]) => (
    path === '/api/conversations/conversation-1/message'
    && (init as RequestInit | undefined)?.method === 'POST'
  ))
  if (!call) {
    throw new Error('Expected a conversation message POST')
  }

  const init = call[1] as RequestInit | undefined
  expect(init?.headers).toEqual({
    'content-type': 'application/json',
  })
  expect(typeof init?.body).toBe('string')
  return JSON.parse(init?.body as string) as Record<string, unknown>
}

const LIVE_CONVERSATION_SESSION_NAME = 'commander-commander-1-conversation-conversation-1'

function buildLiveConversation() {
  return {
    id: 'conversation-1',
    commanderId: 'commander-1',
    surface: 'ui',
    name: 'Live conversation',
    status: 'active',
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 1.25,
    createdAt: '2026-05-01T08:00:00.000Z',
    lastMessageAt: '2026-05-01T08:05:00.000Z',
    canonicalOrder: 0,
    displayState: {
      status: 'active',
      isVisible: true,
      isDefaultConversation: true,
      hasLiveSession: true,
      websocketReady: true,
      isSendable: true,
      isQueueable: true,
      isMediaSendable: true,
      label: 'Active',
      disabledReasons: {
        send: null,
        queue: null,
        media: null,
        start: null,
        pause: null,
        resume: 'Conversation is already active.',
        archive: null,
        delete: null,
        updateProvider: 'Pause the active conversation before changing provider.',
      },
    },
    sendTarget: {
      kind: 'conversation',
      conversationId: 'conversation-1',
      commanderId: 'commander-1',
      sessionName: LIVE_CONVERSATION_SESSION_NAME,
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
      pause: true,
      resume: false,
      archive: true,
      delete: true,
      updateProvider: false,
    },
    liveSession: {
      name: LIVE_CONVERSATION_SESSION_NAME,
      label: 'Live conversation',
      created: '2026-05-01T08:00:00.000Z',
      pid: 123,
      transportType: 'stream',
      agentType: 'claude',
      status: 'active',
      processAlive: true,
    },
    websocketReady: true,
  }
}

function mockConversationEndpoints(
  conversation = buildLiveConversation(),
  queueSnapshot = {
    items: [],
    currentMessage: null,
    totalCount: 0,
    maxSize: 20,
  },
) {
  mocks.fetchJson.mockImplementation(async (path: string) => {
    if (path === '/api/agents/sessions' || path === '/api/approvals/pending') {
      return []
    }
    if (path === '/api/workspace/preferences') {
      return { panelDefault: 'last-used' }
    }
    if (path === '/api/workspace/open') {
      return {
        targetId: 'wt-test',
        label: 'Local',
        host: 'local',
        readOnly: false,
      }
    }
    if (path === '/api/commanders/commander-1/conversations') {
      return [conversation]
    }
    if (path === '/api/commanders/commander-1/conversations/active') {
      return conversation
    }
    if (path === '/api/conversations/conversation-1') {
      return conversation
    }
    if (path.startsWith('/api/conversations/conversation-1/messages')) {
      return {
        conversationId: 'conversation-1',
        sessionName: LIVE_CONVERSATION_SESSION_NAME,
        source: 'empty',
        limit: 100,
        before: null,
        nextBefore: null,
        hasMore: false,
        totalMessages: 0,
        messages: [],
      }
    }
    if (path === '/api/conversations/conversation-1/message') {
      return {
        accepted: true,
        createdSession: false,
        conversation,
      }
    }
    if (path === `/api/agents/sessions/${LIVE_CONVERSATION_SESSION_NAME}/queue`) {
      return queueSnapshot
    }
    return []
  })
}

describe('Hervald command-room routing', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 1 as never)
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined)
    originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    ensureLocalStorage().clear()
    document.documentElement.className = 'hv-light'

    mocks.fetchJson.mockImplementation(async (path: string) => {
      if (path === '/api/agents/sessions' || path === '/api/approvals/pending') {
        return []
      }
      if (path === '/api/workspace/preferences') {
        return { panelDefault: 'last-used' }
      }
      if (path === '/api/workspace/open') {
        return {
          targetId: 'wt-test',
          label: 'Local',
          host: 'local',
          readOnly: false,
        }
      }
      if (path === '/api/agents/sessions/commander-commander-1/queue') {
        return {
          items: [],
          currentMessage: null,
          totalCount: 0,
        }
      }
      return []
    })
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.createSession.mockResolvedValue({
      sessionName: 'session-99',
      mode: 'default',
      sessionType: 'stream',
      created: true,
    })
    mocks.useAgentSessions.mockReturnValue({
      data: [],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    })
    mocks.useDirectories.mockReturnValue({
      data: {
        parent: '/Users/yugu',
        directories: [],
      },
    })
    mocks.useMachines.mockReturnValue({
      data: [],
    })
    mocks.usePendingApprovals.mockReturnValue({
      data: [],
    })
    mocks.useApprovalDecision.mockReturnValue({
      mutateAsync: vi.fn(),
    })
    mocks.useOpenAITranscriptionConfig.mockReturnValue({
      data: { openaiConfigured: false },
    })
    mocks.useOpenAITranscription.mockReturnValue({
      isSupported: false,
      isListening: false,
      transcript: '',
      startListening: vi.fn(),
      stopListening: vi.fn(),
    })
    mocks.useSpeechRecognition.mockReturnValue({
      isSupported: false,
      isListening: false,
      transcript: '',
      startListening: vi.fn(),
      stopListening: vi.fn(),
    })
    mocks.useCommander.mockReturnValue({
      selectedCommanderId: 'commander-1',
      selectedCommander: {
        id: 'commander-1',
        host: 'swe-mbp',
        displayName: 'Marcus',
        state: 'running',
        totalCostUsd: 1.25,
        heartbeat: {
          intervalMs: 900_000,
          messageTemplate: 'Check status',
          lastSentAt: null,
        },
        lastHeartbeat: null,
        taskSource: null,
        currentTask: null,
        completedTasks: 0,
        questCount: 0,
        scheduleCount: 0,
        effort: 'max',
      },
      commanders: [
        {
          id: 'commander-1',
          host: 'swe-mbp',
          displayName: 'Marcus',
          state: 'running',
          currentTask: null,
        },
      ],
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(),
      addCronPending: false,
      startCommander: vi.fn(),
      stopCommander: vi.fn(),
      toggleCron: vi.fn(),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      deleteCronId: null,
    })
  })

  afterEach(async () => {
    mocks.fetchJson.mockReset()
    mocks.useAgentSessionStream.mockReset()
    mocks.createMachine.mockReset()
    mocks.createSession.mockReset()
    mocks.useAgentSessions.mockReset()
    mocks.useDirectories.mockReset()
    mocks.useMachines.mockReset()
    mocks.verifyTailscaleHostname.mockReset()
    mocks.useCommander.mockReset()
    mocks.usePendingApprovals.mockReset()
    mocks.useApprovalDecision.mockReset()
    mocks.useOpenAITranscriptionConfig.mockReset()
    mocks.useOpenAITranscription.mockReset()
    mocks.useSpeechRecognition.mockReset()
    setIntervalSpy?.mockRestore()
    clearIntervalSpy?.mockRestore()
    setIntervalSpy = null
    clearIntervalSpy = null
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    for (const root of mountedRoots) {
      await act(async () => {
        root.unmount()
      })
    }
    mountedRoots = []
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    document.body.innerHTML = ''
    ensureLocalStorage().clear()
    document.documentElement.className = ''
  })

  it('keeps users on /command-room while switching center tabs', async () => {
    await renderAt('/command-room?panel=quests')
    await flushAsync()

    expect(currentLocationText()).toBe('/command-room?panel=quests')
    expect(document.body.textContent).toContain('QuestBoard panel')

    await act(async () => {
      clickButton('Automations')
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(currentLocationText()).toBe('/command-room?panel=automation&commander=global')
    })
    expect(document.body.textContent).toContain('Automation panel')

    await act(async () => {
      clickButton('Identity')
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(currentLocationText()).toBe('/command-room?panel=identity&commander=global')
    })
    expect(document.body.textContent).toContain('Identity panel')
  })

  it('switches back to Automation when the Global pseudo-commander is selected', async () => {
    await renderAt('/command-room?panel=quests')
    await flushAsync()

    await act(async () => {
      clickButton('Global')
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(currentLocationText()).toBe('/command-room?panel=automation&commander=global')
    })
  })

  it('forces Automation and hides non-global tabs when Global scope is selected', async () => {
    mocks.useCommander.mockReturnValue({
      selectedCommanderId: '__global__',
      selectedCommander: null,
      commanders: [
        {
          id: 'commander-1',
          host: 'swe-mbp',
          displayName: 'Marcus',
          state: 'running',
          currentTask: null,
        },
      ],
      setSelectedCommanderId: vi.fn(),
      crons: [
        {
          id: 'global-1',
          schedule: '0 * * * *',
          instruction: 'Check unattached automations.',
          enabled: true,
          lastRun: null,
          nextRun: null,
        },
      ],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(),
      addCronPending: false,
      startCommander: vi.fn(),
      stopCommander: vi.fn(),
      toggleCron: vi.fn(),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      deleteCronId: null,
    })

    await renderAt('/command-room?commander=global&panel=automation')
    await flushAsync()
    await flushAsync()

    expect(currentLocationText()).toBe('/command-room?commander=global&panel=automation')
    expect(document.body.textContent).toContain('Automation panel')

    expect(document.body.querySelector('[data-testid="global-automation-center-panel"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="workspace-right-column"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="right-panel-actions"]')).toBeNull()
  })

  it('removes the desktop center status chrome for active conversations', async () => {
    mockConversationEndpoints()
    await renderAt('/command-room?commander=commander-1&conversation=conversation-1')
    await flushAsync()

    const conversationStatus = document.body.querySelector(
      '[data-testid="conversation-status-indicator"]',
    ) as HTMLElement | null

    expect(conversationStatus).toBeNull()
    expect(document.body.querySelector('[data-testid="commander-status-indicator"]')).toBeNull()
  })

  it('shows the create-chat state and disables the composer when no conversation is selected', async () => {
    const startCommander = vi.fn().mockResolvedValue(undefined)

    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'disconnected',
    })
    mocks.useCommander.mockReturnValue({
      selectedCommanderId: 'commander-1',
      selectedCommander: {
        id: 'commander-1',
        host: 'swe-mbp',
        displayName: 'Marcus',
        state: 'idle',
        agentType: 'claude',
        totalCostUsd: 1.25,
        heartbeat: {
          intervalMs: 900_000,
          messageTemplate: 'Check status',
          lastSentAt: null,
        },
        lastHeartbeat: null,
        taskSource: null,
        currentTask: null,
        completedTasks: 0,
        questCount: 0,
        scheduleCount: 0,
        effort: 'max',
      },
      commanders: [
        {
          id: 'commander-1',
          host: 'swe-mbp',
          displayName: 'Marcus',
          state: 'idle',
          currentTask: null,
        },
      ],
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(),
      addCronPending: false,
      startCommander,
      stopCommander: vi.fn(),
      toggleCron: vi.fn(),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      deleteCronId: null,
    })

    await renderAt('/command-room')
    await flushAsync()

    expect(mocks.useAgentSessionStream).toHaveBeenCalled()
    const lastStreamHookCall = mocks.useAgentSessionStream.mock.calls.at(-1)
    expect(lastStreamHookCall?.[1]).toEqual(
      expect.objectContaining({
        enabled: false,
      }),
    )
    // The empty-state Create Conversation panel (#1362) renders a provider
    // dropdown plus a Create button — no commander start controls.
    expect(document.body.querySelector('[data-testid="create-chat-panel-button"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Start Marcus')
    expect(composerInput()?.hasAttribute('disabled')).toBe(true)
    expect(startCommander).not.toHaveBeenCalled()
  })

  it('does not render the state-B stop control when the header is in conversation status vocabulary', async () => {
    const stopCommander = vi.fn().mockResolvedValue(undefined)

    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.useCommander.mockReturnValue({
      selectedCommanderId: 'commander-1',
      selectedCommander: {
        id: 'commander-1',
        host: 'swe-mbp',
        displayName: 'Marcus',
        state: 'running',
        agentType: 'claude',
        totalCostUsd: 1.25,
        heartbeat: {
          intervalMs: 900_000,
          messageTemplate: 'Check status',
          lastSentAt: null,
        },
        lastHeartbeat: null,
        taskSource: null,
        currentTask: null,
        completedTasks: 0,
        questCount: 0,
        scheduleCount: 0,
        effort: 'max',
      },
      commanders: [
        {
          id: 'commander-1',
          host: 'swe-mbp',
          displayName: 'Marcus',
          state: 'running',
          currentTask: null,
        },
      ],
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(),
      addCronPending: false,
      startCommander: vi.fn(),
      stopCommander,
      toggleCron: vi.fn(),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      deleteCronId: null,
    })

    await renderAt('/command-room')
    await flushAsync()

    expect(document.body.textContent).not.toContain('Stop')
    expect(stopCommander).not.toHaveBeenCalled()
  })

  it('queues composer drafts on Tab instead of sending immediately for running sessions', async () => {
    const sendInput = vi.fn().mockResolvedValue(true)

    mockConversationEndpoints()
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput,
      sendDispatcher: { mode: 'ws-direct', send: vi.fn(async () => true) },
      answerQuestion: vi.fn(),
      status: 'connected',
    })
    mocks.useCommander.mockReturnValue({
      selectedCommanderId: 'commander-1',
      selectedCommander: {
        id: 'commander-1',
        host: 'swe-mbp',
        displayName: 'Marcus',
        state: 'running',
        agentType: 'claude',
        totalCostUsd: 1.25,
        heartbeat: {
          intervalMs: 900_000,
          messageTemplate: 'Check status',
          lastSentAt: null,
        },
        lastHeartbeat: null,
        taskSource: null,
        currentTask: null,
        completedTasks: 0,
        questCount: 0,
        scheduleCount: 0,
        effort: 'max',
      },
      commanders: [
        {
          id: 'commander-1',
          host: 'swe-mbp',
          displayName: 'Marcus',
          state: 'running',
          currentTask: null,
        },
      ],
      setSelectedCommanderId: vi.fn(),
      crons: [],
      cronsLoading: false,
      cronsError: null,
      addCron: vi.fn(),
      addCronPending: false,
      startCommander: vi.fn(),
      stopCommander: vi.fn(),
      toggleCron: vi.fn(),
      toggleCronPending: false,
      toggleCronId: null,
      updateCron: vi.fn(),
      updateCronPending: false,
      updateCronId: null,
      triggerCron: vi.fn(),
      triggerCronPending: false,
      triggerCronId: null,
      deleteCron: vi.fn(),
      deleteCronPending: false,
      deleteCronId: null,
    })

    await renderAt('/command-room?commander=commander-1&conversation=conversation-1')
    await flushAsync()
    await vi.waitFor(() => {
      expect(
        mocks.useAgentSessionStream.mock.calls.some(([sessionName, options]) => (
          sessionName === LIVE_CONVERSATION_SESSION_NAME
          && options?.enabled === true
          && options?.websocketPath === '/api/conversations/conversation-1/ws'
        )),
      ).toBe(true)
    })
    await flushAsync()
    mocks.fetchJson.mockClear()

    await act(async () => {
      changeComposerText('Queue this follow-up.')
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(composerQueueButton()?.disabled).toBe(false)
    })
    await act(async () => {
      pressComposerTab()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendInput).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        '/api/conversations/conversation-1/message',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ message: 'Queue this follow-up.', queue: true }),
        }),
      )
    })
  })

  it('queues composer image prompts on Tab without dropping attachments', async () => {
    const rawSend = vi.fn(async () => true)

    mockConversationEndpoints()
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: rawSend },
      pushOptimisticUserMessage: vi.fn(),
      answerQuestion: vi.fn(),
      status: 'connected',
    })

    await renderAt('/command-room?commander=commander-1&conversation=conversation-1')
    await flushAsync()
    mocks.fetchJson.mockClear()

    await attachComposerImage()

    await act(async () => {
      changeComposerText('Queue this screenshot.')
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(composerQueueButton()?.disabled).toBe(false)
    })
    await act(async () => {
      pressComposerTab()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rawSend).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(latestConversationMessagePostBody()).toEqual({
        message: 'Queue this screenshot.',
        images: [
          {
            mediaType: 'image/png',
            data: 'ZmFrZS1pbWFnZQ==',
          },
        ],
        clientSendId: expect.any(String),
        queue: true,
      })
    })
  })

  it('sends selected-conversation image prompts through the conversation endpoint', async () => {
    const rawSend = vi.fn(async () => true)

    mockConversationEndpoints()
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: rawSend },
      pushOptimisticUserMessage: vi.fn(),
      answerQuestion: vi.fn(),
      status: 'connected',
    })

    await renderAt('/command-room?commander=commander-1&conversation=conversation-1')
    await flushAsync()
    mocks.fetchJson.mockClear()

    await attachComposerImage()

    await act(async () => {
      changeComposerText('Send this screenshot.')
      await Promise.resolve()
      pressComposerEnter()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rawSend).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(latestConversationMessagePostBody()).toEqual({
        message: 'Send this screenshot.',
        images: [
          {
            mediaType: 'image/png',
            data: 'ZmFrZS1pbWFnZQ==',
          },
        ],
        clientSendId: expect.any(String),
      })
    })
  })

  it('sends selected-conversation image-only prompts through the conversation endpoint', async () => {
    const rawSend = vi.fn(async () => true)

    mockConversationEndpoints()
    mocks.useAgentSessionStream.mockReturnValue({
      messages: [],
      sendInput: vi.fn(),
      sendDispatcher: { mode: 'ws-direct', send: rawSend },
      pushOptimisticUserMessage: vi.fn(),
      answerQuestion: vi.fn(),
      status: 'connected',
    })

    await renderAt('/command-room?commander=commander-1&conversation=conversation-1')
    await flushAsync()
    mocks.fetchJson.mockClear()

    await attachComposerImage()

    await act(async () => {
      pressComposerEnter()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rawSend).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(latestConversationMessagePostBody()).toEqual({
        message: '',
        images: [
          {
            mediaType: 'image/png',
            data: 'ZmFrZS1pbWFnZQ==',
          },
        ],
        clientSendId: expect.any(String),
      })
    })
  })

  it('keeps the composer-only queue affordance on non-chat tabs without a selected conversation and removes the top-rail theme toggle', async () => {
    let currentTheme: 'light' | 'dark' = 'light'
    mocks.fetchJson.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/agents/sessions' || path === '/api/approvals/pending') {
        return []
      }
      if (path === '/api/settings') {
        if (init?.method === 'PATCH') {
          const body = typeof init.body === 'string'
            ? JSON.parse(init.body) as { theme?: 'light' | 'dark' }
            : {}
          currentTheme = body.theme === 'dark' ? 'dark' : 'light'
        }
        return {
          settings: {
            theme: currentTheme,
            updatedAt: '2026-05-03T00:00:00.000Z',
          },
        }
      }
      return []
    })

    await renderAt('/command-room?commander=commander-1&panel=cron')
    await flushAsync()

    expect(document.body.textContent).toContain('Automation panel')
    expect(document.body.textContent).toContain('Queue')
    expect(document.body.textContent).not.toContain('Select a conversation to stack follow-ups.')
    expect(document.body.textContent).toContain('Create a chat to message Marcus.')
    expect(composerInput()?.hasAttribute('disabled')).toBe(true)
    expect(composerQueueButton()?.disabled).toBe(true)

    expect(document.documentElement.className).toContain('hv-light')
    expect(document.body.querySelector('button[aria-label="Use light theme"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="Use dark theme"]')).toBeNull()

    await act(async () => {
      clickButton('Identity')
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(currentLocationText()).toBe('/command-room?commander=commander-1&panel=identity')
    })
    expect(document.body.textContent).toContain('Identity panel')
    expect(document.body.textContent).not.toContain('Select a conversation to stack follow-ups.')
    expect(document.body.textContent).toContain('Create a chat to message Marcus.')
    expect(composerInput()?.hasAttribute('disabled')).toBe(true)
    expect(composerQueueButton()?.disabled).toBe(true)
  })

  it('opens the legacy new-session popup from the sessions header button', async () => {
    await renderAt('/command-room')
    await flushAsync()

    await act(async () => {
      clickButton('Open new session')
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('New Session')
    expect(document.body.textContent).toContain('Session Name')
    expect(document.body.textContent).toContain('Initial Task (Optional)')
  })

  it('exposes a full-height shell contract for the Hervald route host', async () => {
    await renderAt('/command-room')
    await flushAsync()

    const shell = document.body.querySelector('[data-testid="command-room-shell"]') as HTMLElement | null
    expect(shell).not.toBeNull()
    expect(shell?.style.display).toBe('flex')
    expect(shell?.style.flexDirection).toBe('column')
    expect(shell?.style.minHeight).toBe('100%')
    expect(shell?.style.minWidth).toBe('100%')
  })
})
