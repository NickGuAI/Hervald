// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { MsgItem } from '@modules/agents/messages/model'
import type { Commander, Worker } from '@/surfaces/hervald/SessionRow'
import { MobileChatView } from '../MobileChatView'

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    conversation,
    belowHeader,
    emptyState,
  }: {
    conversation?: { id: string } | null
    belowHeader?: ReactNode
    emptyState?: ReactNode
  }) => (
    <div data-testid="mobile-session-shell" data-conversation-id={conversation?.id ?? ''}>
      {belowHeader}
      {emptyState}
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

  it('keeps active conversation in viewport when a non-selected conversation flips active→idle', () => {
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

    expect(getPageOrder()).toEqual(['conv-2', 'conv-3'])
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'auto' })
    expect((carousel as HTMLDivElement).scrollLeft).toBe(0)
    expect(onSelectConversationId).not.toHaveBeenCalled()
  })
})
