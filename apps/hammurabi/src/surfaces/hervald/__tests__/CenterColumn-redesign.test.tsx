// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CenterColumn, type CenterColumnProps } from '../CenterColumn'

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
    inputMode: 'edit',
    inputText: '',
    resizeTextarea: vi.fn(),
    setInputMode: vi.fn(),
    setInputText: vi.fn(),
    showDraftSaved: false,
    switchToEditMode: vi.fn(),
    textareaRef: { current: null },
    clearDraft: vi.fn(),
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

vi.mock('../QueueDock', () => ({
  QueueDock: () => createElement('div', { 'data-testid': 'queue-dock' }, 'QueueDock'),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
  })
}

function buildProps(overrides: Partial<CenterColumnProps> = {}): CenterColumnProps {
  return {
    commander: {
      id: 'athena-id',
      name: 'athena',
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
    composerSessionName: 'athena',
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
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('drops cost text and shows the running Stop button in the tab bar', async () => {
    await render(<CenterColumn {...buildProps()} />)

    expect(document.body.textContent).not.toContain('$')

    const stopButton = document.querySelector('[data-testid="commander-stop-button"]') as HTMLButtonElement | null
    expect(stopButton).not.toBeNull()
    expect(stopButton?.textContent).toContain('Stop')
  })

  it('hides the Stop button when the commander is idle', async () => {
    await render(
      <CenterColumn
        {...buildProps({
          commander: {
            id: 'athena-id',
            name: 'athena',
            status: 'idle',
            agentType: 'codex',
          },
        })}
      />,
    )

    expect(document.querySelector('[data-testid="commander-stop-button"]')).toBeNull()
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
})
