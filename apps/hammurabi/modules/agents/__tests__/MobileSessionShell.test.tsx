// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingApproval } from '@/hooks/use-approvals'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import { MobileSessionShell } from '../page-shell/MobileSessionShell'

const openImagePickerSpy = vi.fn()
const openSkillsPickerSpy = vi.fn()

vi.mock('@/hooks/use-providers', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-providers')>('@/hooks/use-providers')
  const { testProviderRegistry } = await vi.importActual<
    typeof import('./provider-registry-fixture')
  >('./provider-registry-fixture')
  return {
    ...actual,
    useProviderRegistry: () => ({ data: testProviderRegistry }),
  }
})

vi.mock('@modules/agents/components/Transcript', () => ({
  default: ({
    className,
    dark,
    sessionId,
  }: {
    className?: string
    dark?: boolean
    sessionId: string
  }) => (
    <div
      data-testid="transcript"
      data-dark={String(Boolean(dark))}
      data-session-id={sessionId}
      className={['messages-area', className].filter(Boolean).join(' ')}
    >
      Transcript
    </div>
  ),
}))

vi.mock('@modules/agents/components/SessionComposer', async () => {
  const React = await import('react')
  return {
    SessionComposer: React.forwardRef(function MockSessionComposer(
      {
        disabled,
        isStreaming,
        theme,
        variant,
        onOpenAddToChat,
        showWorkspaceShortcut,
        queueSnapshot,
      }: {
        disabled?: boolean
        isStreaming?: boolean
        theme?: 'light' | 'dark'
        variant?: 'desktop' | 'mobile'
        onOpenAddToChat?: () => void
        showWorkspaceShortcut?: boolean
        queueSnapshot?: { totalCount?: number; maxSize?: number }
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        seedText: vi.fn(),
        openImagePicker: openImagePickerSpy,
        openSkillsPicker: openSkillsPickerSpy,
      }), [])

      return (
        <div
          data-testid="session-composer"
          data-disabled={String(Boolean(disabled))}
          data-is-streaming={String(Boolean(isStreaming))}
          data-theme={theme}
          data-variant={variant}
          data-workspace-shortcut={String(Boolean(showWorkspaceShortcut))}
          data-queue-total={String(queueSnapshot?.totalCount ?? 0)}
          data-queue-max={String(queueSnapshot?.maxSize ?? 0)}
        >
          SessionComposer
          <button type="button" onClick={onOpenAddToChat}>
            Open Add To Chat
          </button>
        </div>
      )
    }),
  }
})

vi.mock('@modules/agents/components/AddToChatSheet', () => ({
  AddToChatSheet: ({
    open,
    onClose,
    onPickFile,
    onPickImage,
    onPickSkill,
  }: {
    open: boolean
    onClose: () => void
    onPickFile: () => void
    onPickImage: () => void
    onPickSkill: () => void
  }) => (open ? (
    <div data-testid="add-to-chat-sheet">
      <button type="button" onClick={() => { onPickImage(); onClose() }}>Photos</button>
      <button type="button" onClick={() => { onPickSkill(); onClose() }}>Skills</button>
      <button type="button" onClick={() => { onPickFile(); onClose() }}>Files</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ) : null),
}))

type ShellProps = ComponentProps<typeof MobileSessionShell>

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'approval-1',
    decisionId: 'approval-1',
    actionLabel: 'Apply patch',
    actionId: 'file_change',
    source: 'codex',
    commanderId: 'cmd-1',
    commanderName: 'Test Commander',
    sessionName: 'commander-atlas',
    requestedAt: '2026-04-21T15:00:00.000Z',
    requestId: 'approval-1',
    reason: 'Needs approval',
    risk: 'high',
    summary: 'Update the shared shell',
    previewText: null,
    details: [],
    raw: {},
    context: null,
    ...overrides,
  }
}

function buildConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  const status = overrides.status ?? 'active'
  const idleLike = status === 'idle'
  return {
    id: 'conv-1',
    commanderId: 'cmd-1',
    surface: 'ui',
    status,
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
    name: 'Health Coach',
    allowedActions: {
      send: status === 'active',
      queue: status === 'active',
      media: status === 'active',
      start: idleLike,
      pause: status === 'active',
      resume: idleLike,
      archive: true,
      delete: true,
      updateProvider: idleLike,
    },
    ...overrides,
  }
}

function buildProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    sessionName: 'commander-atlas',
    sessionLabel: 'Test Commander',
    agentType: 'claude',
    wsStatus: 'connected',
    costUsd: 1.23,
    durationSec: 125,
    messages: [],
    onAnswer: vi.fn(),
    approvals: [buildApproval()],
    onApprovalDecision: vi.fn(async () => undefined),
    onSend: vi.fn(() => true),
    onQueue: vi.fn(async () => undefined),
    onClearQueue: vi.fn(),
    canQueueDraft: true,
    queueSnapshot: {
      currentMessage: null,
      items: [],
      totalCount: 0,
      maxSize: 8,
    },
    queueError: null,
    isQueueMutating: false,
    composerEnabled: true,
    composerSendReady: true,
    theme: 'dark',
    onSetTheme: vi.fn(),
    onBack: vi.fn(),
    onKill: vi.fn(async () => undefined),
    onOpenWorkspace: vi.fn(),
    workers: [{ id: 'worker-1', label: 'worker-1', status: 'running' }],
    onOpenWorkers: vi.fn(),
    rootClassName: 'session-view-overlay hv-dark',
    ...overrides,
  }
}

function renderShell(overrides: Partial<ShellProps> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(<MobileSessionShell {...buildProps(overrides)} />)
  })
}

function clickSelector(selector: string) {
  const element = document.body.querySelector(selector)
  expect(element, `Expected selector to resolve: ${selector}`).not.toBeNull()
  ;(element as HTMLButtonElement).click()
}

function findButtonByText(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label))
  expect(button, `Expected button with text: ${label}`).toBeTruthy()
  return button as HTMLButtonElement
}

function queryButtonByText(label: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label)) as HTMLButtonElement | undefined ?? null
}

function clickButtonByText(label: string) {
  findButtonByText(label).click()
}

function cleanupShell() {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
}

beforeEach(() => {
  openImagePickerSpy.mockReset()
  openSkillsPickerSpy.mockReset()
})

afterEach(() => {
  cleanupShell()
  vi.restoreAllMocks()
})

function expectSemanticMenuButton(element: Element | null) {
  expect(element).not.toBeNull()
  expect(element?.classList.contains('text-sumi-black')).toBe(true)
  expect(element?.classList.contains('hover:bg-ink-wash')).toBe(true)
  expect(element?.classList.contains('text-washi-white/85')).toBe(false)
  expect(element?.classList.contains('hover:bg-white/5')).toBe(false)
}

describe('MobileSessionShell', () => {
  it('renders the compact header row with the required ordered elements', async () => {
    renderShell({
      chatLabel: 'granite-cliff',
      headerAccessory: (
        <div data-testid="mobile-chat-page-dots">
          <button type="button" data-testid="mobile-chat-page-dot" aria-label="Go to chat 1" />
          <button type="button" data-testid="mobile-chat-page-dot" aria-label="Go to chat 2" />
        </div>
      ),
    })

    const header = document.body.querySelector('[data-testid="mobile-session-compact-header"]')
    expect(header).not.toBeNull()
    expect(header?.classList.contains('h-12')).toBe(true)
    expect(header?.classList.contains('max-h-12')).toBe(true)
    expect(header?.textContent).toContain('Test Commander')
    expect(header?.textContent).toContain('granite-cliff')
    expect(header?.textContent).not.toContain('connected')
    expect(header?.textContent).not.toContain('2m 05s')
    expect(header?.textContent).not.toContain('$1.23')

    const orderedItems = Array.from(header?.querySelectorAll('[data-mobile-header-item]') ?? [])
      .map((item) => item.getAttribute('data-mobile-header-item'))
    expect(orderedItems).toEqual([
      'back',
      'avatar',
      'commander',
      'separator',
      'chat',
      'status',
      'page-dots',
      'menu',
    ])
    expect(document.body.querySelector('[data-testid="mobile-session-avatar"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-testid="mobile-chat-page-dot"]')).toHaveLength(2)
    expect(document.body.querySelector('[data-testid="mobile-session-connected-dot"]')?.classList.contains('bg-emerald-500')).toBe(true)

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.textContent).toContain('Test Commander')
    expect(document.body.textContent).toContain('$1.23')
  })

  it('renders chatLabel inline with truncation rather than as a second row', async () => {
    renderShell({ chatLabel: 'Health Coach' })

    const chatLabel = document.body.querySelector('.session-header-chat')
    expect(chatLabel?.textContent).toBe('Health Coach')
    expect(chatLabel?.classList.contains('truncate')).toBe(true)
    expect(document.body.querySelector('.session-header-name')?.textContent).toBe('Test Commander')
    expect(document.body.querySelector('.session-header-name')?.classList.contains('truncate')).toBe(true)
    expect(document.body.querySelector('.session-header-center')).toBeNull()
  })

  it('keeps mobile header navigation controls at 44px with accessible names', async () => {
    renderShell()

    const backButton = document.body.querySelector('button[aria-label="Back to org"]')
    expect(backButton).not.toBeNull()
    expect(backButton?.classList.contains('h-11')).toBe(true)
    expect(backButton?.classList.contains('w-11')).toBe(true)
    expect(backButton?.classList.contains('h-8')).toBe(false)
    expect(backButton?.classList.contains('w-8')).toBe(false)

    const overflowButton = document.body.querySelector('button[aria-label="Session actions"]')
    expect(overflowButton).not.toBeNull()
    expect(overflowButton?.classList.contains('h-11')).toBe(true)
    expect(overflowButton?.classList.contains('w-11')).toBe(true)
    expect(overflowButton?.classList.contains('h-8')).toBe(false)
    expect(overflowButton?.classList.contains('w-8')).toBe(false)
  })

  it('keeps long commander and conversation names constrained to truncating row text', async () => {
    renderShell({
      sessionLabel: 'A very long commander name that should never wrap the compact mobile header',
      chatLabel: 'A very long conversation name that should also truncate instead of wrapping',
    })

    const header = document.body.querySelector('[data-testid="mobile-session-compact-header"]')
    const commanderName = document.body.querySelector('[data-testid="mobile-session-commander-name"]')
    const chatLabel = document.body.querySelector('[data-testid="mobile-session-chat-label"]')

    expect(header?.classList.contains('h-12')).toBe(true)
    expect(commanderName?.classList.contains('truncate')).toBe(true)
    expect(commanderName?.classList.contains('min-w-0')).toBe(true)
    expect(chatLabel?.classList.contains('truncate')).toBe(true)
    expect(chatLabel?.classList.contains('min-w-0')).toBe(true)
  })

  it('uses only a binary connected-dot state in the header', async () => {
    renderShell({ wsStatus: 'disconnected' })

    const disconnectedDot = document.body.querySelector('[data-testid="mobile-session-connected-dot"]')
    expect(disconnectedDot?.classList.contains('bg-emerald-500')).toBe(false)
    expect(disconnectedDot?.classList.contains('opacity-0')).toBe(true)

    cleanupShell()
    renderShell({ wsStatus: 'connected' })

    const connectedDot = document.body.querySelector('[data-testid="mobile-session-connected-dot"]')
    expect(connectedDot?.classList.contains('bg-emerald-500')).toBe(true)
    expect(connectedDot?.classList.contains('opacity-100')).toBe(true)
  })

  it('surfaces cost in the overflow menu drawer', async () => {
    renderShell()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.textContent).toContain('Cost')
    expect(document.body.textContent).toContain('$1.23')
  })

  it('omits the cost row when costUsd is undefined', async () => {
    renderShell({ costUsd: undefined })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.textContent).not.toContain('Cost')
    expect(document.body.textContent).not.toContain('$1.23')
  })

  it('opens the kebab menu with workers, workspace, kill, and back actions', async () => {
    renderShell()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.textContent).toContain('Workers')
    expect(document.body.textContent).toContain('Workspace')
    expect(document.body.textContent).toContain('Kill Session')
    expect(document.body.textContent).toContain('Back to Org')
  })

  it('uses semantic overflow menu foreground and divider tokens in both themes', async () => {
    for (const theme of ['dark', 'light'] as const) {
      renderShell({
        theme,
        rootClassName: `session-view-overlay hv-${theme}`,
        onNewQuest: vi.fn(),
        conversation: buildConversation({ status: 'active' }),
        onStopConversation: vi.fn(async () => undefined),
        onRenameConversation: vi.fn(async () => undefined),
        onSwapConversationProvider: vi.fn(async () => undefined),
        onArchiveConversation: vi.fn(async () => undefined),
        onRemoveConversation: vi.fn(async () => undefined),
      })

      flushSync(() => {
        clickSelector('button[aria-label="Session actions"]')
      })

      const menu = document.body.querySelector('[data-testid="mobile-session-overflow-menu"]')
      expect(menu).not.toBeNull()
      expect(menu?.classList.contains('text-sumi-black')).toBe(true)

      expectSemanticMenuButton(document.body.querySelector('button[aria-label="Approvals (1 pending)"]'))
      expectSemanticMenuButton(findButtonByText('New Quest'))
      expectSemanticMenuButton(findButtonByText('Workers'))
      expectSemanticMenuButton(findButtonByText('Workspace'))
      expectSemanticMenuButton(document.body.querySelector('[data-testid="mobile-chat-rename-button"]'))
      expect(document.body.querySelector('[data-testid="mobile-chat-provider-menu-button"]')).toBeNull()
      expectSemanticMenuButton(document.body.querySelector('[data-testid="mobile-chat-archive-button"]'))
      expectSemanticMenuButton(findButtonByText('Stop chat'))

      const backToOrg = findButtonByText('Back to Org')
      expect(backToOrg.classList.contains('text-sumi-diluted')).toBe(true)
      expect(backToOrg.classList.contains('hover:bg-ink-wash')).toBe(true)
      expect(backToOrg.classList.contains('text-washi-white/65')).toBe(false)
      expect(backToOrg.classList.contains('hover:bg-white/5')).toBe(false)

      expect(document.body.querySelector('[data-testid="mobile-chat-remove-button"]')?.classList.contains('text-accent-vermillion')).toBe(true)
      expect(findButtonByText('Kill Session').classList.contains('text-accent-vermillion')).toBe(true)

      const dividers = Array.from(menu?.querySelectorAll('div') ?? [])
        .filter((element) => element.classList.contains('h-px'))
      expect(dividers.length).toBeGreaterThan(0)
      for (const divider of dividers) {
        expect(divider.classList.contains('bg-ink-border')).toBe(true)
        expect(divider.classList.contains('bg-white/10')).toBe(false)
      }

      cleanupShell()
    }
  })

  it('uses semantic foreground tokens for Resume chat in both themes', async () => {
    for (const theme of ['dark', 'light'] as const) {
      renderShell({
        theme,
        rootClassName: `session-view-overlay hv-${theme}`,
        conversation: buildConversation({ status: 'idle' }),
        onStartConversation: vi.fn(async () => undefined),
      })

      flushSync(() => {
        clickSelector('button[aria-label="Session actions"]')
      })

      expectSemanticMenuButton(findButtonByText('Resume chat'))

      cleanupShell()
    }
  })

  it('opens a confirmation modal before kill and only calls onKill when confirmed', async () => {
    const onKill = vi.fn(async () => undefined)

    renderShell({ onKill })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickButtonByText('Kill Session')
    })

    expect(document.body.textContent).toContain('Kill session?')
    expect(onKill).not.toHaveBeenCalled()

    flushSync(() => {
      clickButtonByText('Cancel')
    })

    expect(document.body.textContent).not.toContain('Kill session?')
    expect(onKill).not.toHaveBeenCalled()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickButtonByText('Kill Session')
    })
    await act(async () => {
      clickButtonByText('Kill session')
      await Promise.resolve()
    })

    expect(onKill).toHaveBeenCalledTimes(1)
  })

  it('triggers workspace open on Cmd+K', async () => {
    const onOpenWorkspace = vi.fn()
    renderShell({ onOpenWorkspace })

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
      }))
    })

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1)
  })

  it('removes the legacy queue header strip above the composer', async () => {
    renderShell({
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-1',
          text: 'Investigate the mobile shell gap',
          priority: 'normal',
          queuedAt: '2026-04-21T15:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
    })

    expect(document.body.querySelector('[data-testid="mobile-queue-header"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="mobile-queue-details"]')).toBeNull()
  })

  it('passes queue state through to SessionComposer for the mobile queue button', async () => {
    renderShell({
      queueSnapshot: {
        currentMessage: null,
        items: [{
          id: 'queued-1',
          text: 'Investigate the mobile shell gap',
          priority: 'normal',
          queuedAt: '2026-04-21T15:00:00.000Z',
        }],
        totalCount: 1,
        maxSize: 8,
      },
    })

    const composer = document.body.querySelector('[data-testid="session-composer"]')
    expect(composer?.getAttribute('data-queue-total')).toBe('1')
    expect(composer?.getAttribute('data-queue-max')).toBe('8')
  })

  it('reveals Load older only when the message pane reaches the top edge', async () => {
    const onLoadOlderMessages = vi.fn()
    renderShell({
      hasOlderMessages: true,
      onLoadOlderMessages,
    })

    expect(queryButtonByText('Load older')).toBeNull()

    const transcript = document.body.querySelector('.messages-area') as HTMLDivElement | null
    expect(transcript).not.toBeNull()
    Object.defineProperty(transcript as HTMLDivElement, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 120,
    })

    await act(async () => {
      ;(transcript as HTMLDivElement).dispatchEvent(new Event('scroll'))
    })

    expect(queryButtonByText('Load older')).toBeNull()

    ;(transcript as HTMLDivElement).scrollTop = 0
    await act(async () => {
      ;(transcript as HTMLDivElement).dispatchEvent(new Event('scroll'))
    })

    const loadOlderButton = queryButtonByText('Load older')
    expect(loadOlderButton).not.toBeNull()
    expect(document.body.querySelector('[data-testid="mobile-load-older-reveal"]')).not.toBeNull()

    await act(async () => {
      loadOlderButton?.click()
    })

    expect(onLoadOlderMessages).toHaveBeenCalledTimes(1)
  })

  it('passes the mobile composer variant and streaming state through to SessionComposer', async () => {
    renderShell({ isStreaming: true })

    const composer = document.body.querySelector('[data-testid="session-composer"]')
    expect(composer).not.toBeNull()
    expect(composer?.getAttribute('data-variant')).toBe('mobile')
    expect(composer?.getAttribute('data-is-streaming')).toBe('true')
  })

  it('opens the add-to-chat sheet and wires photos, skills, and files actions', async () => {
    const onOpenWorkspace = vi.fn()
    renderShell({ onOpenWorkspace })

    flushSync(() => {
      clickButtonByText('Open Add To Chat')
    })
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).not.toBeNull()

    flushSync(() => {
      clickButtonByText('Photos')
    })
    expect(openImagePickerSpy).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).toBeNull()

    flushSync(() => {
      clickButtonByText('Open Add To Chat')
    })
    flushSync(() => {
      clickButtonByText('Skills')
    })
    expect(openSkillsPickerSpy).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).toBeNull()

    flushSync(() => {
      clickButtonByText('Open Add To Chat')
    })
    flushSync(() => {
      clickButtonByText('Files')
    })
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-testid="add-to-chat-sheet"]')).toBeNull()
  })

  it('renders exactly one kebab on the header right side', async () => {
    renderShell({
      conversation: buildConversation(),
      onRenameConversation: vi.fn(async () => undefined),
      onSwapConversationProvider: vi.fn(async () => undefined),
      onArchiveConversation: vi.fn(async () => undefined),
      onRemoveConversation: vi.fn(async () => undefined),
    })

    expect(document.body.querySelectorAll('button[aria-label="Session actions"]')).toHaveLength(1)
    expect(document.body.querySelector('[data-testid="mobile-chat-actions-button"]')).toBeNull()
  })

  it('does not render a top-level Stop button', async () => {
    renderShell({
      conversation: buildConversation({ status: 'active' }),
      onStopConversation: vi.fn(async () => undefined),
    })

    expect(document.body.querySelector('[data-testid="mobile-chat-stop-button"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Stop chat')
  })

  it('exposes a Theme toggle in the overflow drawer', async () => {
    const onSetTheme = vi.fn()
    renderShell({
      theme: 'light',
      onSetTheme,
      rootClassName: 'session-view-overlay hv-light',
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickSelector('button[aria-label="Use dark theme"]')
    })

    expect(onSetTheme).toHaveBeenCalledWith('dark')
  })

  it('shows a resume panel instead of transcript and composer for stopped conversations', async () => {
    const onStartConversation = vi.fn(async () => undefined)
    renderShell({
      conversation: buildConversation({ status: 'idle' }),
      composerEnabled: false,
      composerSendReady: false,
      onStartConversation,
    })

    expect(document.body.querySelector('[data-testid="mobile-stopped-conversation-panel"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="transcript"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="session-composer"]')).toBeNull()

    flushSync(() => {
      clickSelector('[data-testid="mobile-stopped-conversation-start-button"]')
    })
    await Promise.resolve()

    expect(onStartConversation).toHaveBeenCalledWith('conv-1')
  })

  it('shows a loading panel after tapping resume until the start request settles', async () => {
    let resolveStart: (() => void) | null = null
    const onStartConversation = vi.fn(() => new Promise<void>((resolve) => {
      resolveStart = resolve
    }))

    renderShell({
      conversation: buildConversation({ status: 'idle' }),
      composerEnabled: false,
      composerSendReady: false,
      onStartConversation,
    })

    await act(async () => {
      clickSelector('[data-testid="mobile-stopped-conversation-start-button"]')
    })

    expect(onStartConversation).toHaveBeenCalledWith('conv-1')
    expect(document.body.querySelector('[data-testid="mobile-conversation-starting-panel"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Preparing chat...')
    expect(document.body.querySelector('[data-testid="transcript"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="session-composer"]')).toBeNull()

    await act(async () => {
      resolveStart?.()
    })
  })

  it('keeps showing the loading panel while the conversation read model is starting', async () => {
    renderShell({
      conversation: buildConversation({
        status: 'active',
        runtimeState: 'starting',
        websocketReady: false,
        allowedActions: {
          send: false,
          queue: false,
          media: false,
          start: false,
          pause: false,
          resume: false,
          archive: true,
          delete: true,
          updateProvider: false,
        },
      }),
      composerEnabled: false,
      composerSendReady: false,
      onStartConversation: vi.fn(async () => undefined),
    })

    expect(document.body.querySelector('[data-testid="mobile-conversation-starting-panel"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="mobile-stopped-conversation-panel"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="transcript"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="session-composer"]')).toBeNull()
  })

  it('shows a failed startup panel when the conversation read model reports failure', async () => {
    const onStartConversation = vi.fn(async () => undefined)

    renderShell({
      conversation: buildConversation({
        status: 'idle',
        runtimeState: 'failed',
        runtimeError: 'Provider login expired.',
      }),
      composerEnabled: false,
      composerSendReady: false,
      onStartConversation,
    })

    expect(document.body.querySelector('[data-testid="mobile-conversation-start-failed-panel"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Chat failed to start')
    expect(document.body.textContent).toContain('Provider login expired.')
    expect(document.body.querySelector('[data-testid="transcript"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="session-composer"]')).toBeNull()

    flushSync(() => {
      clickSelector('[data-testid="mobile-conversation-start-retry-button"]')
    })

    expect(onStartConversation).toHaveBeenCalledWith('conv-1')
  })

  it('exposes conversation Resume in drawer when canStartConversation', async () => {
    const onStartConversation = vi.fn(async () => undefined)
    renderShell({
      conversation: buildConversation({ status: 'idle' }),
      onStartConversation,
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    expect(document.body.textContent).toContain('Resume chat')

    flushSync(() => {
      clickButtonByText('Resume chat')
    })

    expect(onStartConversation).toHaveBeenCalledWith('conv-1')
  })

  it('exposes conversation Stop in drawer when canStopConversation', async () => {
    const onStopConversation = vi.fn(async () => undefined)
    renderShell({
      conversation: buildConversation({ status: 'active' }),
      onStopConversation,
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    expect(document.body.textContent).toContain('Stop chat')

    flushSync(() => {
      clickButtonByText('Stop chat')
    })

    expect(onStopConversation).toHaveBeenCalledWith('conv-1')
  })

  it('exposes Rename, Provider / model, Archive, and Remove inside the drawer for idle chats', async () => {
    renderShell({
      conversation: buildConversation({ status: 'idle' }),
      onRenameConversation: vi.fn(async () => undefined),
      onSwapConversationProvider: vi.fn(async () => undefined),
      onArchiveConversation: vi.fn(async () => undefined),
      onRemoveConversation: vi.fn(async () => undefined),
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.querySelector('[data-testid="mobile-chat-rename-button"]')?.textContent).toContain('Rename')
    expect(document.body.querySelector('[data-testid="mobile-chat-provider-menu-button"]')?.textContent).toContain('Provider / model')
    expect(document.body.querySelector('[data-testid="mobile-chat-archive-button"]')?.textContent).toContain('Archive')
    expect(document.body.querySelector('[data-testid="mobile-chat-remove-button"]')?.textContent).toContain('Remove')
  })

  it('saves provider and model edits for idle chats from the overflow drawer', async () => {
    const onSwapConversationProvider = vi.fn(async () => undefined)
    renderShell({
      conversation: buildConversation({ status: 'idle', agentType: 'claude', model: null }),
      onSwapConversationProvider,
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickSelector('[data-testid="mobile-chat-provider-menu-button"]')
    })

    const providerSelect = document.body.querySelector(
      '[data-testid="mobile-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const modelSelect = document.body.querySelector(
      '[data-testid="mobile-chat-model-select"]',
    ) as HTMLSelectElement | null
    const saveButton = document.body.querySelector(
      '[data-testid="mobile-chat-provider-save-button"]',
    ) as HTMLButtonElement | null

    expect(providerSelect).not.toBeNull()
    expect(modelSelect).not.toBeNull()
    expect(saveButton).not.toBeNull()

    flushSync(() => {
      if (providerSelect) {
        providerSelect.value = 'codex'
        providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    flushSync(() => {
      if (modelSelect) {
        modelSelect.value = 'gpt-5.5'
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      saveButton?.click()
    })
    await Promise.resolve()

    expect(onSwapConversationProvider).toHaveBeenCalledWith('conv-1', 'codex', 'gpt-5.5')
  })

  it('moves Approvals from the header into the drawer when there are pending items', async () => {
    renderShell({
      approvals: [buildApproval(), buildApproval({ id: 'approval-2', decisionId: 'approval-2', requestId: 'approval-2' })],
      onApprovalDecision: vi.fn(async () => undefined),
    })

    expect(document.body.querySelector('button[aria-label="Approvals (2 pending)"]')).toBeNull()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    const approvalsButton = document.body.querySelector('button[aria-label="Approvals (2 pending)"]')
    expect(approvalsButton).not.toBeNull()
    expect(approvalsButton?.textContent).toContain('Approvals')
    expect(approvalsButton?.textContent).toContain('2')
  })

  it('renders approvals and forwards approve/reject callbacks', async () => {
    const approval = buildApproval()
    const onApprovalDecision = vi.fn(async () => undefined)

    renderShell({
      approvals: [approval],
      onApprovalDecision,
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickSelector('button[aria-label="Approvals (1 pending)"]')
    })
    flushSync(() => {
      clickButtonByText('Approve')
    })
    expect(onApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'approval-1' }),
      'approve',
    )

    flushSync(() => {
      root?.unmount()
    })
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''

    renderShell({
      approvals: [approval],
      onApprovalDecision,
    })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickSelector('button[aria-label="Approvals (1 pending)"]')
    })
    flushSync(() => {
      clickButtonByText('Reject')
    })

    expect(onApprovalDecision).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'approval-1' }),
      'reject',
    )
  })
})
