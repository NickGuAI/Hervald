// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { MsgItem } from '@modules/agents/messages/model'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'
import { MobileChatView } from '../MobileChatView'

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    conversation,
    headerAccessory,
    emptyState,
    messages = [],
    composerEnabled = false,
    rootClassName,
  }: {
    conversation?: { id: string } | null
    headerAccessory?: ReactNode
    emptyState?: ReactNode
    messages?: Array<{ id: string, text: string }>
    composerEnabled?: boolean
    rootClassName?: string
  }) => (
    <div
      data-testid="mobile-session-shell"
      data-conversation-id={conversation?.id ?? ''}
      data-message-count={messages.length}
      data-composer-enabled={composerEnabled ? 'true' : 'false'}
      data-root-class={rootClassName}
    >
      {headerAccessory}
      {emptyState}
      {messages.map((message) => (
        <div key={message.id} data-testid="mobile-session-message">
          {message.text}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@modules/commanders/components/CommanderStartControl', () => ({
  CommanderStartControl: () => null,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

const EMPTY_QUEUE: SessionQueueSnapshot = {
  currentMessage: null,
  items: [],
  totalCount: 0,
  maxSize: 8,
}

function buildCommander(overrides: Partial<Commander> = {}): Commander {
  return {
    id: 'cmd-1',
    name: 'Atlas',
    status: 'running',
    description: 'Primary commander',
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
    liveSession: null,
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:05:00.000Z',
    lastMessageAt: '2026-05-01T08:05:00.000Z',
    name: 'Chat 1',
    ...overrides,
  }
}

function renderView(overrides: Partial<Parameters<typeof MobileChatView>[0]> = {}) {
  const commander = buildCommander()
  const workers: Worker[] = []
  const transcript: MsgItem[] = []
  const approvals: PendingApproval[] = []
  const baseProps = {
    commander,
    workers,
    transcript,
    approvals,
    sessionName: 'conversation-conv-1',
    composerEnabled: true,
    composerSendReady: true,
    canQueueDraft: false,
    theme: 'dark' as const,
    onSetTheme: vi.fn(),
    queueSnapshot: EMPTY_QUEUE,
    queueError: null,
    isQueueMutating: false,
    onBack: vi.fn(),
    onOpenTeam: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onAnswer: vi.fn(),
    onApproveApproval: vi.fn(),
    onDenyApproval: vi.fn(),
    onClearQueue: vi.fn(),
    onMoveQueuedMessage: vi.fn(),
    onRemoveQueuedMessage: vi.fn(),
  } satisfies Parameters<typeof MobileChatView>[0]

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const rerender = (nextOverrides: Partial<Parameters<typeof MobileChatView>[0]> = {}) => {
    flushSync(() => {
      root?.render(createElement(MobileChatView, {
        ...baseProps,
        ...overrides,
        ...nextOverrides,
      }))
    })
  }

  rerender()
  return { rerender }
}

function getPageOrder(): string[] {
  return Array.from(document.body.querySelectorAll('[data-testid="mobile-chat-page"]'))
    .map((node) => node.getAttribute('data-conversation-id') ?? '')
}

function getShellByConversationId(conversationId: string): HTMLElement {
  const shell = document.body.querySelector(
    `[data-testid="mobile-session-shell"][data-conversation-id="${conversationId}"]`,
  )
  expect(shell).not.toBeNull()
  return shell as HTMLElement
}

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
})

describe('MobileChatView carousel', () => {
  it('keeps page order and scroll position stable when lastMessageAt changes', async () => {
    const onSelectConversationId = vi.fn()
    const conversations = [
      buildConversation({
        id: 'conv-1',
        name: 'Chat 1',
        createdAt: '2026-05-01T08:00:00.000Z',
        lastMessageAt: '2026-05-01T08:01:00.000Z',
      }),
      buildConversation({
        id: 'conv-2',
        name: 'Chat 2',
        createdAt: '2026-05-01T08:05:00.000Z',
        lastMessageAt: '2026-05-01T08:06:00.000Z',
      }),
      buildConversation({
        id: 'conv-3',
        name: 'Chat 3',
        createdAt: '2026-05-01T08:10:00.000Z',
        lastMessageAt: '2026-05-01T08:11:00.000Z',
      }),
    ]

    const { rerender } = renderView({
      conversations,
      selectedConversationId: null,
      onSelectConversationId,
    })

    const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
    expect(carousel).not.toBeNull()

    Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 0,
    })
    const scrollTo = vi.fn(({ left }: { left: number }) => {
      ;(carousel as HTMLDivElement).scrollLeft = left
    })
    ;(carousel as HTMLDivElement).scrollTo = scrollTo

    rerender({
      conversations,
      selectedConversationId: 'conv-2',
      onSelectConversationId,
    })

    expect(getPageOrder()).toEqual(['conv-1', 'conv-2', 'conv-3'])
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect((carousel as HTMLDivElement).scrollLeft).toBe(320)

    ;(carousel as HTMLDivElement).scrollLeft = 160

    rerender({
      conversations: conversations.map((conversation) => (
        conversation.id === 'conv-1'
          ? { ...conversation, lastMessageAt: '2026-05-01T09:30:00.000Z' }
          : { ...conversation }
      )),
      selectedConversationId: 'conv-2',
      onSelectConversationId,
    })

    expect(getPageOrder()).toEqual(['conv-1', 'conv-2', 'conv-3'])
    expect((carousel as HTMLDivElement).scrollLeft).toBe(160)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(onSelectConversationId).not.toHaveBeenCalled()
  })

  it('keeps idle non-selected conversations visible without disturbing the active page', () => {
    const onSelectConversationId = vi.fn()
    const conversations = [
      buildConversation({
        id: 'conv-1',
        name: 'Chat 1',
        createdAt: '2026-05-01T08:00:00.000Z',
      }),
      buildConversation({
        id: 'conv-2',
        name: 'Chat 2',
        createdAt: '2026-05-01T08:05:00.000Z',
      }),
      buildConversation({
        id: 'conv-3',
        name: 'Chat 3',
        createdAt: '2026-05-01T08:10:00.000Z',
      }),
    ]

    const { rerender } = renderView({
      conversations,
      selectedConversationId: null,
      onSelectConversationId,
    })

    const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
    expect(carousel).not.toBeNull()

    Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 0,
    })
    const scrollTo = vi.fn(({ left }: { left: number }) => {
      ;(carousel as HTMLDivElement).scrollLeft = left
    })
    ;(carousel as HTMLDivElement).scrollTo = scrollTo

    rerender({
      conversations,
      selectedConversationId: 'conv-2',
      onSelectConversationId,
    })

    expect(getPageOrder()).toEqual(['conv-1', 'conv-2', 'conv-3'])
    expect(scrollTo).toHaveBeenCalledWith({ left: 320, behavior: 'auto' })
    expect((carousel as HTMLDivElement).scrollLeft).toBe(320)

    rerender({
      conversations: conversations.map((conversation) => (
        conversation.id === 'conv-1'
          ? { ...conversation, status: 'idle' }
          : { ...conversation }
      )),
      selectedConversationId: 'conv-2',
      onSelectConversationId,
    })

    expect(getPageOrder()).toEqual(['conv-1', 'conv-2', 'conv-3'])
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect((carousel as HTMLDivElement).scrollLeft).toBe(320)
    expect(onSelectConversationId).not.toHaveBeenCalled()
  })

  it('ignores snap-back scroll events after the selected conversation changes', () => {
    vi.useFakeTimers()
    try {
      const onSelectConversationId = vi.fn()
      const conversations = [
        buildConversation({
          id: 'conv-1',
          name: 'Chat 1',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          name: 'Chat 2',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
        buildConversation({
          id: 'conv-3',
          name: 'Chat 3',
          createdAt: '2026-05-01T08:10:00.000Z',
        }),
      ]

      const { rerender } = renderView({
        conversations,
        selectedConversationId: 'conv-1',
        onSelectConversationId,
      })

      const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
      expect(carousel).not.toBeNull()

      Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
        configurable: true,
        value: 320,
      })
      Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
        configurable: true,
        writable: true,
        value: 0,
      })
      const scrollTo = vi.fn(({ left }: { left: number }) => {
        ;(carousel as HTMLDivElement).scrollLeft = left
      })
      ;(carousel as HTMLDivElement).scrollTo = scrollTo

      rerender({
        conversations,
        selectedConversationId: 'conv-2',
        onSelectConversationId,
      })

      expect(scrollTo).toHaveBeenCalledWith({ left: 320, behavior: 'auto' })
      expect((carousel as HTMLDivElement).scrollLeft).toBe(320)

      ;(carousel as HTMLDivElement).scrollLeft = 0
      flushSync(() => {
        ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
      })
      vi.advanceTimersByTime(150)

      expect(onSelectConversationId).not.toHaveBeenCalledWith('conv-1')

      vi.advanceTimersByTime(251)
      ;(carousel as HTMLDivElement).scrollLeft = 640
      flushSync(() => {
        ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
      })
      vi.advanceTimersByTime(150)

      expect(onSelectConversationId).toHaveBeenCalledWith('conv-3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the previous conversation hydrated while selection settles', () => {
    const conversations = [
      buildConversation({
        id: 'conv-1',
        name: 'Chat 1',
        createdAt: '2026-05-01T08:00:00.000Z',
      }),
      buildConversation({
        id: 'conv-2',
        name: 'Chat 2',
        createdAt: '2026-05-01T08:05:00.000Z',
      }),
    ]

    const conv1Transcript: MsgItem[] = [{
      id: 'conv-1-message',
      kind: 'agent',
      text: 'conversation one still visible',
    }]
    const conv2Transcript: MsgItem[] = [{
      id: 'conv-2-message',
      kind: 'agent',
      text: 'conversation two selected',
    }]

    const { rerender } = renderView({
      conversations,
      selectedConversationId: 'conv-1',
      transcript: conv1Transcript,
    })

    expect(getShellByConversationId('conv-1').textContent).toContain('conversation one still visible')

    rerender({
      conversations,
      selectedConversationId: 'conv-2',
      transcript: conv2Transcript,
    })

    expect(getShellByConversationId('conv-1').textContent).toContain('conversation one still visible')
    expect(getShellByConversationId('conv-2').textContent).toContain('conversation two selected')
  })

  it('allows the next swipe to advance while stale previous-page scrolls are guarded', () => {
    vi.useFakeTimers()
    try {
      const onSelectConversationId = vi.fn()
      const conversations = [
        buildConversation({
          id: 'conv-1',
          name: 'Chat 1',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          name: 'Chat 2',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
        buildConversation({
          id: 'conv-3',
          name: 'Chat 3',
          createdAt: '2026-05-01T08:10:00.000Z',
        }),
      ]

      const { rerender } = renderView({
        conversations,
        selectedConversationId: 'conv-1',
        onSelectConversationId,
      })

      const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
      expect(carousel).not.toBeNull()

      Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
        configurable: true,
        value: 320,
      })
      Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
        configurable: true,
        writable: true,
        value: 0,
      })
      ;(carousel as HTMLDivElement).scrollTo = vi.fn(({ left }: { left: number }) => {
        ;(carousel as HTMLDivElement).scrollLeft = left
      })

      rerender({
        conversations,
        selectedConversationId: 'conv-2',
        onSelectConversationId,
      })

      ;(carousel as HTMLDivElement).scrollLeft = 0
      flushSync(() => {
        ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
      })
      expect(onSelectConversationId).not.toHaveBeenCalledWith('conv-1')

      ;(carousel as HTMLDivElement).scrollLeft = 640
      flushSync(() => {
        ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
      })

      expect(onSelectConversationId).toHaveBeenCalledWith('conv-3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps non-archived chats for the active commander in the carousel and forwards the light theme class', () => {
    renderView({
      theme: 'light',
      conversations: [
        buildConversation({
          id: 'conv-1',
          commanderId: 'cmd-1',
          status: 'active',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          commanderId: 'cmd-1',
          status: 'idle',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
        buildConversation({
          id: 'conv-3',
          commanderId: 'cmd-1',
          status: 'paused',
          createdAt: '2026-05-01T08:10:00.000Z',
        }),
        buildConversation({
          id: 'conv-4',
          commanderId: 'cmd-2',
          status: 'active',
          createdAt: '2026-05-01T08:15:00.000Z',
        }),
        buildConversation({
          id: 'conv-5',
          commanderId: 'cmd-1',
          status: 'archived',
          createdAt: '2026-05-01T08:20:00.000Z',
        }),
      ],
      selectedConversationId: 'conv-1',
    })

    expect(getPageOrder()).toEqual(['conv-1', 'conv-2', 'conv-3'])

    const shells = Array.from(document.body.querySelectorAll('[data-testid="mobile-session-shell"]'))
    expect(shells).toHaveLength(3)
    shells.forEach((shell) => {
      expect(shell.getAttribute('data-root-class')).toBe('mobile-session-shell session-view-overlay hv-light')
    })
  })
})
