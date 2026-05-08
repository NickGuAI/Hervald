// @vitest-environment jsdom

import { useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import type { CommanderAgentType, CommanderSession } from '@modules/commanders/hooks/useCommander'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { MsgItem } from '@modules/agents/messages/model'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'
import { MobileCommandRoom } from '../MobileCommandRoom'

const approvalDecisionSpy = vi.fn(async () => undefined)

vi.mock('@/hooks/use-approvals', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-approvals')>('@/hooks/use-approvals')
  return {
    ...actual,
    useApprovalDecision: () => ({ mutateAsync: approvalDecisionSpy }),
  }
})

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => true,
}))

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
    <div
      data-testid="mobile-session-shell"
      data-conversation-id={conversation?.id ?? ''}
    >
      {belowHeader}
      {emptyState}
    </div>
  ),
}))

vi.mock('@modules/approvals/MobileApprovalSheet', () => ({
  MobileApprovalSheet: () => null,
}))

vi.mock('@modules/automations/MobileAutomations', () => ({
  MobileAutomations: () => null,
}))

vi.mock('@modules/approvals/MobileInbox', () => ({
  MobileInbox: () => null,
}))

vi.mock('../MobileSessionsList', () => ({
  MobileSessionsList: () => null,
}))

vi.mock('@modules/settings/MobileSettings', () => ({
  MobileSettings: () => null,
}))

vi.mock('../MobileTeamSheet', () => ({
  MobileTeamSheet: () => null,
}))

vi.mock('../MobileWorkspaceSheet', () => ({
  MobileWorkspaceSheet: () => null,
}))

interface HarnessProps {
  commander?: Commander
  conversations: ConversationRecord[]
  initialConversationId?: string | null
  path: string
  onCreateConversation?: (
    commanderId: string,
    agentType: AgentType,
    model: string | null,
  ) => Promise<ConversationRecord | null> | ConversationRecord | null
  onStartConversation?: (conversationId: string) => void | Promise<void>
  onConversationSelected?: (
    conversationId: string | null,
    helpers: { refreshConversations: () => void },
  ) => void
}

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

function renderHarness({
  commander = buildCommander(),
  conversations,
  initialConversationId = null,
  path,
  onCreateConversation = async () => null,
  onStartConversation = async () => undefined,
  onConversationSelected,
}: HarnessProps) {
  function TestHarness() {
    const [conversationState, setConversationState] = useState<ConversationRecord[]>(conversations)
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId)
    const refreshConversations = () => {
      setConversationState((current) => current.map((conversation) => ({ ...conversation })))
    }

    function handleSelectConversationId(conversationId: string | null) {
      setSelectedConversationId(conversationId)
      onConversationSelected?.(conversationId, { refreshConversations })
    }

    return (
      <>
        <div data-testid="selected-conversation-id">{selectedConversationId ?? ''}</div>
        <MobileCommandRoom
          commanders={[commander]}
          commanderSessions={[] as CommanderSession[]}
          workers={[] as Worker[]}
          pendingApprovals={[] as PendingApproval[]}
          selectedCommanderId={commander.id}
          onSelectCommanderId={vi.fn()}
          selectedCommanderRunning
          selectedCommanderAgentType={'claude' satisfies CommanderAgentType}
          transcript={[] as MsgItem[]}
          onAnswer={vi.fn()}
          composerSessionName={selectedConversationId ? `conversation-${selectedConversationId}` : ''}
          composerEnabled={true}
          composerSendReady={true}
          canQueueDraft={false}
          theme="dark"
          onSetTheme={vi.fn()}
          conversations={conversationState}
          selectedConversationId={selectedConversationId}
          onSelectConversationId={handleSelectConversationId}
          isStreaming={false}
          streamStatus="connected"
          queueSnapshot={EMPTY_QUEUE}
          queueError={null}
          isQueueMutating={false}
          onClearQueue={vi.fn()}
          onMoveQueuedMessage={vi.fn()}
          onRemoveQueuedMessage={vi.fn()}
          onQueue={vi.fn()}
          onSend={vi.fn()}
          workspaceSource={null as WorkspaceSource | null}
          onCreateConversation={async (commanderId, agentType, model) => {
            const created = await onCreateConversation(commanderId, agentType, model)
            if (created) {
              setConversationState((current) => [...current, created])
            }
            return created
          }}
          onStartConversation={async (conversationId) => {
            await onStartConversation(conversationId)
            setConversationState((current) => current.map((conversation) => (
              conversation.id === conversationId
                ? { ...conversation, status: 'active' }
                : conversation
            )))
          }}
        />
      </>
    )
  }

  window.history.pushState({}, '', path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <BrowserRouter>
        <Routes>
          <Route path="/command-room/*" element={<TestHarness />} />
        </Routes>
      </BrowserRouter>,
    )
  })
}

async function flushTimers(ms = 0) {
  await Promise.resolve()
  if (ms > 0) {
    vi.advanceTimersByTime(ms)
  }
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  approvalDecisionSpy.mockClear()
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
  vi.useRealTimers()
})

describe('MobileCommandRoom conversation mode', () => {
  it('syncs the mobile carousel selection into the URL search param', async () => {
    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-1',
          name: 'First chat',
          lastMessageAt: '2026-05-01T08:10:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          name: 'Second chat',
          lastMessageAt: '2026-05-01T08:05:00.000Z',
          agentType: 'codex' satisfies AgentType,
        }),
      ],
      initialConversationId: 'conv-1',
      path: '/command-room?surface=mobile&commander=cmd-1&conversation=conv-1',
    })

    await flushTimers()

    const dots = document.body.querySelectorAll('[data-testid="mobile-chat-page-dot"]')
    expect(dots).toHaveLength(2)

    const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
    expect(carousel).not.toBeNull()

    Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 320,
    })
    ;(carousel as HTMLDivElement).scrollTo = vi.fn(({ left }: { left: number }) => {
      ;(carousel as HTMLDivElement).scrollLeft = left
    })

    flushSync(() => {
      ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
    })
    await flushTimers(150)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-2')
      expect(window.location.pathname).toBe('/command-room')
      expect(window.location.search).toContain('commander=cmd-1')
      expect(window.location.search).toContain('conversation=conv-2')
    })
  })

  it('keeps the manual selection when conversations re-render with fresh identities', async () => {
    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-1',
          name: 'First chat',
          createdAt: '2026-05-01T08:00:00.000Z',
          lastMessageAt: '2026-05-01T08:10:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          name: 'Second chat',
          createdAt: '2026-05-01T08:05:00.000Z',
          lastMessageAt: '2026-05-01T08:05:00.000Z',
          agentType: 'codex' satisfies AgentType,
        }),
      ],
      initialConversationId: 'conv-1',
      path: '/command-room?surface=mobile&commander=cmd-1&conversation=conv-1',
      onConversationSelected: (conversationId, { refreshConversations }) => {
        if (conversationId === 'conv-2') {
          refreshConversations()
        }
      },
    })

    await flushTimers()

    const carousel = document.body.querySelector('[data-testid="mobile-chat-carousel"]') as HTMLDivElement | null
    expect(carousel).not.toBeNull()

    Object.defineProperty(carousel as HTMLDivElement, 'clientWidth', {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(carousel as HTMLDivElement, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 320,
    })
    ;(carousel as HTMLDivElement).scrollTo = vi.fn(({ left }: { left: number }) => {
      ;(carousel as HTMLDivElement).scrollLeft = left
    })

    flushSync(() => {
      ;(carousel as HTMLDivElement).dispatchEvent(new Event('scroll'))
    })
    await flushTimers(150)

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-2')
      expect(window.location.pathname).toBe('/command-room')
      expect(window.location.search).toContain('commander=cmd-1')
      expect(window.location.search).toContain('conversation=conv-2')
    })
  })

  it('shows every non-archived conversation for the selected commander', async () => {
    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-1',
          name: 'Active chat',
          status: 'active',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
        buildConversation({
          id: 'conv-2',
          name: 'Idle chat',
          status: 'idle',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
        buildConversation({
          id: 'conv-3',
          name: 'Paused chat',
          status: 'paused',
          createdAt: '2026-05-01T08:10:00.000Z',
        }),
        buildConversation({
          id: 'conv-4',
          name: 'Exited chat',
          status: 'exited',
          createdAt: '2026-05-01T08:15:00.000Z',
        }),
        buildConversation({
          id: 'conv-5',
          name: 'Archived chat',
          status: 'archived',
          createdAt: '2026-05-01T08:20:00.000Z',
        }),
      ],
      initialConversationId: 'conv-1',
      path: '/command-room?surface=mobile&commander=cmd-1&conversation=conv-1',
    })

    await flushTimers()

    const pageIds = Array.from(document.body.querySelectorAll('[data-testid="mobile-chat-page"]'))
      .map((node) => node.getAttribute('data-conversation-id'))

    expect(pageIds).toEqual(['conv-1', 'conv-2', 'conv-3', 'conv-4'])
  })

  it('prefers the active conversation when the URL omits a conversation id', async () => {
    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-idle',
          name: 'Idle chat',
          status: 'idle',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
        buildConversation({
          id: 'conv-active',
          name: 'Active chat',
          status: 'active',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
      ],
      path: '/command-room?surface=mobile&commander=cmd-1',
    })

    await flushTimers()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-active')
      expect(window.location.pathname).toBe('/command-room')
      expect(window.location.search).toContain('commander=cmd-1')
      expect(window.location.search).toContain('conversation=conv-active')
      expect(window.location.search).not.toContain('conversation=conv-idle')
    })
  })

  it('shows registry provider/model pickers and creates an explicitly chosen chat from the empty-state CTA', async () => {
    const onCreateConversation = vi.fn(async (
      _commanderId: string,
      agentType: AgentType,
      model: string | null,
    ) => buildConversation({
      id: 'conv-new',
      name: 'Fresh chat',
      status: 'idle',
      liveSession: null,
      agentType,
      model,
    }))
    const onStartConversation = vi.fn(async () => undefined)

    renderHarness({
      conversations: [],
      path: '/command-room?surface=mobile&commander=cmd-1',
      onCreateConversation,
      onStartConversation,
    })

    await flushTimers()

    const providerSelect = document.body.querySelector(
      '[data-testid="create-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const createButton = document.body.querySelector(
      '[data-testid="create-chat-panel-button"]',
    ) as HTMLButtonElement | null
    const modelSelect = document.body.querySelector(
      '[data-testid="create-chat-model-select"]',
    ) as HTMLSelectElement | null
    expect(providerSelect).not.toBeNull()
    expect(createButton).not.toBeNull()
    expect(modelSelect).not.toBeNull()
    expect(Array.from(providerSelect?.options ?? []).map((option) => option.value)).toContain('opencode')

    flushSync(() => {
      if (providerSelect) {
        providerSelect.value = 'codex'
        providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    expect(Array.from(modelSelect?.options ?? []).map((option) => option.value)).toContain('gpt-5.5')

    flushSync(() => {
      if (modelSelect) {
        modelSelect.value = 'gpt-5.5'
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      createButton?.click()
    })
    await flushTimers()

    expect(onCreateConversation).toHaveBeenCalledWith('cmd-1', 'codex', 'gpt-5.5')
    // Per #1362 contract: never auto-start. The user must explicitly tap Start
    // chat in the session shell after creation.
    expect(onStartConversation).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-new')
    })
  })
})
