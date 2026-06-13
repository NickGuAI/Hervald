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
import type { CreateConversationReasoningConfig } from '@modules/conversation/components/CreateConversationPanel'
import type { MsgItem } from '@modules/agents/messages/model'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'
import { MobileCommandRoom } from '../MobileCommandRoom'

const approvalDecisionSpy = vi.fn(async () => undefined)

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
    headerAccessory,
    emptyState,
  }: {
    conversation?: { id: string } | null
    headerAccessory?: ReactNode
    emptyState?: ReactNode
  }) => (
    <div
      data-testid="mobile-session-shell"
      data-conversation-id={conversation?.id ?? ''}
    >
      {headerAccessory}
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
    reasoningConfig: CreateConversationReasoningConfig,
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
    const [requestedNewChatCommanderId, setRequestedNewChatCommanderId] = useState<string | null>(null)
    const refreshConversations = () => {
      setConversationState((current) => current.map((conversation) => ({ ...conversation })))
    }

    function handleSelectConversationId(conversationId: string | null) {
      setSelectedConversationId(conversationId)
      const params = new URLSearchParams(window.location.search)
      params.set('commander', commander.id)
      if (conversationId) {
        params.set('conversation', conversationId)
      } else {
        params.delete('conversation')
      }
      window.history.replaceState({}, '', `/command-room?${params.toString()}`)
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
          onCreateChatForCommander={(commanderId) => {
            setRequestedNewChatCommanderId(commanderId)
            handleSelectConversationId(null)
          }}
          requestedNewChatCommanderId={requestedNewChatCommanderId}
          onCreateConversation={async (commanderId, agentType, model, reasoningConfig) => {
            const created = await onCreateConversation(commanderId, agentType, model, reasoningConfig)
            if (created) {
              setConversationState((current) => [...current, created])
              setRequestedNewChatCommanderId(null)
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

  it('does not replace an explicit URL conversation with a visible fallback while selection is loading', async () => {
    const onConversationSelected = vi.fn()

    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-active',
          name: 'Active chat',
          status: 'active',
          createdAt: '2026-05-01T08:05:00.000Z',
        }),
      ],
      initialConversationId: null,
      path: '/command-room?surface=mobile&commander=cmd-1&conversation=conv-target',
      onConversationSelected,
    })

    await flushTimers()

    expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('')
    expect(window.location.pathname).toBe('/command-room')
    expect(window.location.search).toContain('commander=cmd-1')
    expect(window.location.search).toContain('conversation=conv-target')
    expect(window.location.search).not.toContain('conversation=conv-active')
    expect(onConversationSelected).not.toHaveBeenCalled()
  })

  it('leaves backend active-chat selection to the parent when the URL omits a conversation id', async () => {
    const onConversationSelected = vi.fn()

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
      onConversationSelected,
    })

    await flushTimers()

    expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('')
    expect(window.location.pathname).toBe('/command-room')
    expect(window.location.search).toContain('commander=cmd-1')
    expect(window.location.search).not.toContain('conversation=')
    expect(onConversationSelected).not.toHaveBeenCalled()
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

    expect(onCreateConversation).toHaveBeenCalledWith('cmd-1', 'codex', 'gpt-5.5', {})
    // Per #1362 contract: never auto-start. The user must explicitly tap Start
    // chat in the session shell after creation.
    expect(onStartConversation).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-new')
    })
  })

  it('opens the create-chat panel from an existing mobile conversation', async () => {
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
      createdAt: '2026-05-01T08:15:00.000Z',
      lastMessageAt: '2026-05-01T08:15:00.000Z',
    }))
    const onStartConversation = vi.fn(async () => undefined)

    renderHarness({
      conversations: [
        buildConversation({
          id: 'conv-existing',
          name: 'Existing chat',
          status: 'active',
          createdAt: '2026-05-01T08:00:00.000Z',
        }),
      ],
      initialConversationId: 'conv-existing',
      path: '/command-room?surface=mobile&commander=cmd-1&conversation=conv-existing',
      onCreateConversation,
      onStartConversation,
    })

    await flushTimers()

    const newChatButton = document.body.querySelector(
      '[data-testid="mobile-new-chat-button"]',
    ) as HTMLButtonElement | null
    expect(newChatButton).not.toBeNull()

    flushSync(() => {
      newChatButton?.click()
    })
    await flushTimers()

    expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('')
    expect(window.location.search).toContain('commander=cmd-1')
    expect(window.location.search).not.toContain('conversation=')

    const providerSelect = document.body.querySelector(
      '[data-testid="create-chat-provider-select"]',
    ) as HTMLSelectElement | null
    const modelSelect = document.body.querySelector(
      '[data-testid="create-chat-model-select"]',
    ) as HTMLSelectElement | null
    const createButton = document.body.querySelector(
      '[data-testid="create-chat-panel-button"]',
    ) as HTMLButtonElement | null
    expect(providerSelect).not.toBeNull()
    expect(modelSelect).not.toBeNull()
    expect(createButton).not.toBeNull()

    flushSync(() => {
      if (providerSelect) {
        providerSelect.value = 'codex'
        providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (modelSelect) {
        modelSelect.value = 'gpt-5.5'
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      createButton?.click()
    })
    await flushTimers()

    expect(onCreateConversation).toHaveBeenCalledWith('cmd-1', 'codex', 'gpt-5.5', {})
    expect(onStartConversation).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="selected-conversation-id"]')?.textContent).toBe('conv-new')
    })
  })
})
