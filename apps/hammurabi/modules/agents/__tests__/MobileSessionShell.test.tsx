// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingApproval } from '@/hooks/use-approvals'
import { MobileSessionShell } from '../page-shell/MobileSessionShell'

const openImagePickerSpy = vi.fn()
const openSkillsPickerSpy = vi.fn()

vi.mock('@modules/agents/components/Transcript', () => ({
  default: ({
    dark,
    sessionId,
  }: {
    dark?: boolean
    sessionId: string
  }) => (
    <div
      data-testid="transcript"
      data-dark={String(Boolean(dark))}
      data-session-id={sessionId}
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
      }: {
        disabled?: boolean
        isStreaming?: boolean
        theme?: 'light' | 'dark'
        variant?: 'desktop' | 'mobile'
        onOpenAddToChat?: () => void
        showWorkspaceShortcut?: boolean
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
    sessionName: 'commander-athena',
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

function buildProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    sessionName: 'commander-athena',
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

function clickButtonByText(label: string) {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label))
  expect(button, `Expected button with text: ${label}`).toBeTruthy()
  ;(button as HTMLButtonElement).click()
}

beforeEach(() => {
  openImagePickerSpy.mockReset()
  openSkillsPickerSpy.mockReset()
})

afterEach(() => {
  if (root) {
    flushSync(() => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('MobileSessionShell', () => {
  it('renders the header with label and meta', async () => {
    renderShell()

    expect(document.body.textContent).toContain('Test Commander')
    expect(document.body.textContent).toContain('connected')
    expect(document.body.textContent).toContain('$1.23')
    expect(document.body.textContent).toContain('2m 05s')
  })

  it('opens the kebab menu with workers, workspace, kill, and back actions', async () => {
    renderShell()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })

    expect(document.body.textContent).toContain('Workers')
    expect(document.body.textContent).toContain('Workspace')
    expect(document.body.textContent).toContain('Kill Session')
    expect(document.body.textContent).toContain('Back to Sessions')
  })

  it('invokes window.confirm before kill and only calls onKill when confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const onKill = vi.fn(async () => undefined)

    renderShell({ onKill })

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickButtonByText('Kill Session')
    })

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onKill).not.toHaveBeenCalled()

    flushSync(() => {
      clickSelector('button[aria-label="Session actions"]')
    })
    flushSync(() => {
      clickButtonByText('Kill Session')
    })

    expect(confirmSpy).toHaveBeenCalledTimes(2)
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

  it('renders the queue dock header collapsed by default when queueing is enabled and items exist', async () => {
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

    expect(document.body.textContent).toContain('Queue')
    expect(document.body.textContent).toContain('1 queued')

    // Initial render: only the one-line header is visible. Detail content
    // (current-message card, queued-item list, empty hint) is hidden.
    expect(document.body.querySelector('[data-testid="mobile-queue-details"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Investigate the mobile shell gap')

    const header = document.body.querySelector('[data-testid="mobile-queue-header"]')
    expect(header?.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands the queue panel when the header is tapped and collapses on second tap', async () => {
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

    const header = document.body.querySelector('[data-testid="mobile-queue-header"]') as HTMLElement | null
    expect(header).not.toBeNull()
    expect(header?.getAttribute('aria-expanded')).toBe('false')

    flushSync(() => {
      ;(header as HTMLElement).click()
    })

    const headerExpanded = document.body.querySelector('[data-testid="mobile-queue-header"]')
    expect(headerExpanded?.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[data-testid="mobile-queue-details"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Investigate the mobile shell gap')

    flushSync(() => {
      ;(headerExpanded as HTMLElement).click()
    })

    const headerCollapsed = document.body.querySelector('[data-testid="mobile-queue-header"]')
    expect(headerCollapsed?.getAttribute('aria-expanded')).toBe('false')
    expect(document.body.querySelector('[data-testid="mobile-queue-details"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Investigate the mobile shell gap')
  })

  it('does not toggle the queue panel when Clear is tapped (event propagation stops)', async () => {
    const onClearQueue = vi.fn()
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
      onClearQueue,
    })

    const header = document.body.querySelector('[data-testid="mobile-queue-header"]') as HTMLElement | null
    expect(header?.getAttribute('aria-expanded')).toBe('false')

    // Expand first so we can confirm Clear does not collapse.
    flushSync(() => {
      ;(header as HTMLElement).click()
    })

    const headerExpanded = document.body.querySelector('[data-testid="mobile-queue-header"]')
    expect(headerExpanded?.getAttribute('aria-expanded')).toBe('true')

    const clearButton = Array.from(document.body.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === 'Clear') as HTMLButtonElement | undefined
    expect(clearButton).toBeTruthy()

    flushSync(() => {
      clearButton?.click()
    })

    expect(onClearQueue).toHaveBeenCalledTimes(1)

    const headerAfterClear = document.body.querySelector('[data-testid="mobile-queue-header"]')
    expect(headerAfterClear?.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[data-testid="mobile-queue-details"]')).not.toBeNull()
  })

  it('keeps Clear enabled when a direct-send preemption slot is pending', async () => {
    renderShell({
      queueSnapshot: {
        currentMessage: {
          id: 'send-1',
          text: 'stop',
          priority: 'high',
          queuedAt: '2026-04-21T15:00:00.000Z',
        },
        items: [],
        totalCount: 1,
        maxSize: 8,
      },
    })

    const clearButton = Array.from(document.body.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Clear'))
    expect(clearButton).toBeTruthy()
    expect((clearButton as HTMLButtonElement).disabled).toBe(false)
    expect(document.body.textContent).toContain('Working on send')
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

  it('renders approvals and forwards approve/reject callbacks', async () => {
    const approval = buildApproval()
    const onApprovalDecision = vi.fn(async () => undefined)

    renderShell({
      approvals: [approval],
      onApprovalDecision,
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
