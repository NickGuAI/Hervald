// @vitest-environment jsdom

import { createElement, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CenterColumn, type CenterColumnProps } from '../CenterColumn'

vi.mock('@/hooks/use-providers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-providers')>('@/hooks/use-providers')
  const { testProviderRegistry } = await vi.importActual<
    typeof import('../../../../agents/__tests__/provider-registry-fixture')
  >('../../../../agents/__tests__/provider-registry-fixture')
  return {
    ...actual,
    useProviderRegistry: () => ({ data: testProviderRegistry }),
  }
})

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: () => ({ data: [] }),
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-openai-transcription', () => ({
  useOpenAITranscription: () => ({
    isSupported: false,
    isListening: false,
    transcript: '',
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
  useOpenAITranscriptionConfig: () => ({ data: { openaiConfigured: false } }),
}))

vi.mock('@/hooks/use-speech-recognition', () => ({
  useSpeechRecognition: () => ({
    isSupported: false,
    isListening: false,
    transcript: '',
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('@modules/agents/page-shell/use-session-draft', () => ({
  useSessionDraft: () => ({
    inputText: '',
    setInputText: vi.fn(),
    showDraftSaved: false,
    focusTextarea: vi.fn(),
    textareaRef: { current: null },
    clearDraft: vi.fn(),
    pendingImages: [],
    setPendingImages: vi.fn(),
  }),
}))

vi.mock('@modules/agents/components/SkillsPicker', () => ({
  SkillsPicker: () => null,
}))

vi.mock('@modules/agents/page-shell/TerminalView', () => ({
  TerminalView: ({ sessionName }: { sessionName: string }) => createElement('div', null, `TerminalView:${sessionName}`),
}))

vi.mock('@modules/commanders/components/QuestBoard', () => ({
  QuestBoard: () => createElement('div', null, 'QuestBoard'),
}))

vi.mock('@modules/commanders/components/CommanderSentinelsTab', () => ({
  CommanderSentinelsTab: () => createElement('div', null, 'CommanderSentinelsTab'),
}))

vi.mock('@modules/commanders/components/CommanderCronTab', () => ({
  CommanderCronTab: () => createElement('div', null, 'CommanderCronTab'),
}))

vi.mock('@modules/commanders/components/CommanderIdentityTab', () => ({
  CommanderIdentityTab: () => createElement('div', null, 'CommanderIdentityTab'),
}))

vi.mock('@modules/commanders/components/CommanderStartControl', () => ({
  CommanderStartControl: () => createElement('div', null, 'CommanderStartControl'),
}))

vi.mock('../ChatPane', () => ({
  ChatPane: () => createElement('div', { 'data-testid': 'chat-pane' }, 'ChatPane'),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

async function render(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  flushSync(() => {
    root?.render(
      <QueryClientProvider client={queryClient!}>
        {element}
      </QueryClientProvider>,
    )
  })
}

function buildProps(overrides: Partial<CenterColumnProps> = {}): CenterColumnProps {
  return {
    commander: {
      id: 'atlas-id',
      name: 'atlas',
      status: 'running',
      agentType: 'codex',
      description: 'engineering commander',
      cost: 559.71,
    },
    activeChatSession: null,
    transcript: [],
    workers: [],
    activeTab: 'chat',
    setActiveTab: vi.fn(),
    crons: [],
    onAnswer: vi.fn(),
    composerSessionName: 'atlas',
    composerEnabled: true,
    composerSendReady: true,
    canQueueDraft: true,
    queueSnapshot: { items: [] },
    onClearQueue: vi.fn(),
    onMoveQueuedMessage: vi.fn(),
    onRemoveQueuedMessage: vi.fn(),
    onStopCommander: vi.fn(),
    onSend: vi.fn(),
    onQueue: vi.fn(),
    theme: 'light',
    onSetTheme: vi.fn(),
    ...overrides,
  }
}

describe('CenterColumn redesign', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    })
  })

  afterEach(async () => {
    if (root) {
      flushSync(() => {
        root?.unmount()
      })
    }
    queryClient?.clear()
    queryClient = null
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('removes the desktop center header chrome and boxes the bottom composer', async () => {
    await render(<CenterColumn {...buildProps()} />)

    expect(document.body.textContent).not.toContain('$')
    expect(document.querySelector('[data-testid="commander-stop-button"]')).toBeNull()
    expect(document.querySelector('[data-testid="conversation-status-indicator"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Use light theme"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Use dark theme"]')).toBeNull()

    const composerBox = document.querySelector<HTMLElement>('[data-testid="compact-chat-composer"]')
    expect(composerBox).not.toBeNull()
    expect(composerBox?.style.boxShadow).toBe('var(--hv-shadow-block)')
  })

  it('shows a Create Conversation panel with a provider dropdown, and only POSTs on explicit Create click', async () => {
    const onCreateChat = vi.fn()
    await render(
      <CenterColumn
        {...buildProps({
          hasSelectedConversation: false,
          activeChatSession: null,
          onCreateChat,
        })}
      />,
    )

    expect(document.querySelector('[data-testid="start-conversation-panel"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Create chat')
    expect(document.body.textContent).not.toContain('CommanderStartControl')

    // Per #1362 contract: rendering the panel must NOT create an idle artifact.
    expect(onCreateChat).not.toHaveBeenCalled()

    const select = document.querySelector('[data-testid="create-chat-provider-select"]') as HTMLSelectElement | null
    const modelSelect = document.querySelector('[data-testid="create-chat-model-select"]') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    expect(modelSelect).not.toBeNull()
    // Default is the commander's persisted agentType (codex in buildProps).
    expect(select?.value).toBe('codex')
    expect(Array.from(modelSelect?.options ?? []).map((option) => option.value)).toContain('gpt-5.5')

    // User picks a concrete model.
    flushSync(() => {
      if (modelSelect) {
        modelSelect.value = 'gpt-5.5'
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    // User picks a different provider; the previous provider's model is cleared.
    flushSync(() => {
      if (select) {
        select.value = 'claude'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    expect(modelSelect?.value).toBe('')

    const button = document.querySelector('[data-testid="create-chat-panel-button"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    flushSync(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onCreateChat).toHaveBeenCalledTimes(1)
    expect(onCreateChat).toHaveBeenCalledWith('claude', null, {
      effort: 'max',
      adaptiveThinking: 'disabled',
      maxThinkingTokens: 128000,
    })
  })

  it('shows the composer workspace shortcut when onOpenWorkspace is provided', async () => {
    await render(
      <CenterColumn
        {...buildProps({
          onOpenWorkspace: vi.fn(),
        })}
      />,
    )

    expect(document.body.textContent).toContain('⌘K workspace')
  })

  it('shows commander-local automations in the delegated overview strip', async () => {
    await render(
      <CenterColumn
        {...buildProps({
          workers: [{
            id: 'worker-1',
            name: 'reviewer',
            kind: 'worker',
            state: 'running',
          }],
          automationSessions: [{
            id: 'auto-atlas',
            name: 'auto-atlas',
            label: 'Atlas Review',
            created: '2026-05-15T12:00:00.000Z',
            pid: 4242,
            status: 'active',
            parentCommanderId: 'atlas-id',
          }],
        })}
      />,
    )

    expect(document.body.querySelector('[data-testid="delegated-subagents-strip"]')?.textContent)
      .toContain('Delegated · 1 sub-agents · 1 automations')
    expect(document.body.querySelector('[data-testid="commander-center-automation-chip"]')?.textContent)
      .toBe('Atlas Review')
  })

  it('opens the shared queue panel from the desktop composer queue button', async () => {
    await render(
      <CenterColumn
        {...buildProps({
          hasSelectedConversation: true,
          activeChatSession: {
            id: 'atlas-chat',
            name: 'atlas-chat',
            label: 'Atlas Chat',
            created: '2026-05-15T12:00:00.000Z',
            pid: 4242,
            sessionType: 'stream',
            agentType: 'codex',
            status: 'running',
          },
          queueSnapshot: {
            currentMessage: null,
            items: [{
              id: 'queued-desktop-1',
              text: 'Follow up from the desktop composer',
              priority: 'normal',
              queuedAt: '2026-05-15T12:05:00.000Z',
            }],
            totalCount: 1,
            maxSize: 8,
          },
        })}
      />,
    )

    expect(document.querySelector('[data-testid="queue-dock"]')).toBeNull()

    const queueButton = document.querySelector('button[aria-label="Open queue"]') as HTMLButtonElement | null
    expect(queueButton).not.toBeNull()
    expect(queueButton?.textContent).toBe('Queue 1/8')

    flushSync(() => {
      queueButton?.click()
    })

    const panel = document.body.querySelector('[data-testid="queue-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('Follow up from the desktop composer')
    expect(panel?.textContent).toContain('Press Tab')
    expect(panel?.textContent).toContain('Clear')
  })
})
