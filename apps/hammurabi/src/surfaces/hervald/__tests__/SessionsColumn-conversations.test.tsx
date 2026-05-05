// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import { SessionsColumn } from '../SessionsColumn'

describe('SessionsColumn conversations', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  let originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

  beforeEach(() => {
    originalActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    flushSync(() => {
      root?.unmount()
    })
    container?.remove()
    root = null
    container = null
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  })

  function buildConversation(
    id: string,
    status: ConversationRecord['status'],
  ): ConversationRecord {
    return {
      id,
      commanderId: 'atlas',
      surface: 'ui',
      status,
      currentTask: status === 'active'
        ? {
            issueNumber: 1216,
            issueUrl: 'https://example.com/issues/1216',
            startedAt: '2026-05-01T08:00:00.000Z',
            title: 'Active chat',
          }
        : null,
      lastHeartbeat: null,
      heartbeat: {
        intervalMs: 300000,
        messageTemplate: 'Still working',
        lastSentAt: null,
      },
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-01T08:00:00.000Z',
      lastMessageAt: '2026-05-01T08:05:00.000Z',
      liveSession: null,
    }
  }

  it('routes the selected commander New Chat button to the provider-picker request callback', async () => {
    const onCreateChatForCommander = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'atlas',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateWorker: vi.fn(),
          onCreateSession: vi.fn(),
          onCreateChatForCommander,
          selectedChatId: null,
          onSelectChat: vi.fn(),
          onSelectConversation: vi.fn(),
          commanders: [
            {
              id: 'atlas',
              name: 'Atlas',
              status: 'running',
            },
            {
              id: 'hephaestus',
              name: 'Hephaestus',
              status: 'idle',
            },
          ],
          conversations: [],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const launchButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New Chat'),
    )
    if (!(launchButton instanceof HTMLButtonElement)) {
      throw new Error('expected selected commander New Chat button to render')
    }

    expect(container.textContent).not.toContain('Attach')

    flushSync(() => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onCreateChatForCommander).toHaveBeenCalledTimes(1)
    expect(onCreateChatForCommander).toHaveBeenCalledWith('atlas')
  })

  it('shows Start for idle and paused chats and Stop for active chats', async () => {
    const onStartConversation = vi.fn()
    const onStopConversation = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'atlas',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateWorker: vi.fn(),
          onCreateSession: vi.fn(),
          onCreateChatForCommander: vi.fn(),
          selectedChatId: 'conv-active',
          onSelectChat: vi.fn(),
          onSelectConversation: vi.fn(),
          onStartConversation,
          onStopConversation,
          commanders: [
            {
              id: 'atlas',
              name: 'Atlas',
              status: 'running',
            },
          ],
          conversations: [
            buildConversation('conv-idle', 'idle'),
            buildConversation('conv-paused', 'paused'),
            buildConversation('conv-active', 'active'),
          ],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const startButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="commander-chat-start-button"]'),
    )
    const stopButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="commander-chat-stop-button"]',
    )

    expect(startButtons).toHaveLength(2)
    expect(stopButton).toBeInstanceOf(HTMLButtonElement)

    flushSync(() => {
      startButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onStartConversation).toHaveBeenCalledTimes(1)
    expect(onStartConversation).toHaveBeenCalledWith('conv-idle')
    expect(onStopConversation).toHaveBeenCalledTimes(1)
    expect(onStopConversation).toHaveBeenCalledWith('conv-active')
  })

  it('nests each commander\'s chats under the commander block (chats only render for the selected commander)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const athenaChat = buildConversation('conv-atlas-1', 'idle')
    const jakeChat: ConversationRecord = {
      ...buildConversation('conv-jake-1', 'idle'),
      commanderId: 'jake',
    }

    flushSync(() => {
      root?.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'atlas',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateWorker: vi.fn(),
          onCreateSession: vi.fn(),
          onCreateChatForCommander: vi.fn(),
          selectedChatId: null,
          onSelectChat: vi.fn(),
          onSelectConversation: vi.fn(),
          onStartConversation: vi.fn(),
          onStopConversation: vi.fn(),
          commanders: [
            { id: 'atlas', name: 'Atlas', status: 'running' },
            { id: 'jake', name: 'Jake', status: 'idle' },
          ],
          // Both commanders' chats are passed; the column must filter by commanderId
          // and nest each chat under its parent commander block.
          conversations: [athenaChat, jakeChat],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const blocks = Array.from(
      container.querySelectorAll<HTMLDivElement>('[data-testid="commander-block"]'),
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.dataset.commanderId).toBe('atlas')
    expect(blocks[1]?.dataset.commanderId).toBe('jake')

    // Selected commander's block contains its chat list, scoped to its commanderId.
    const athenaChatList = blocks[0]?.querySelector<HTMLDivElement>(
      '[data-testid="commander-chat-list"]',
    )
    expect(athenaChatList).not.toBeNull()
    expect(athenaChatList?.dataset.commanderId).toBe('atlas')

    const athenaRows = blocks[0]?.querySelectorAll<HTMLDivElement>(
      '[data-testid="commander-chat-row"]',
    )
    expect(athenaRows?.length).toBe(1)
    expect(athenaRows?.[0]?.dataset.conversationId).toBe('conv-atlas-1')

    // Non-selected commander's block must NOT render a chat list, even though a
    // matching conversation was passed in. This is the "chats only under selected
    // commander" contract — non-selected commanders intentionally collapse to the
    // commander row alone, mirroring the New Chat button visibility rule.
    const jakeChatList = blocks[1]?.querySelector<HTMLDivElement>(
      '[data-testid="commander-chat-list"]',
    )
    expect(jakeChatList).toBeNull()
  })

  it('hides the synthetic default commander conversation row', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(
        createElement(SessionsColumn, {
          selectedCommanderId: 'atlas',
          onSelectCommander: vi.fn(),
          onCreateCommander: vi.fn(),
          onCreateWorker: vi.fn(),
          onCreateSession: vi.fn(),
          onCreateChatForCommander: vi.fn(),
          selectedChatId: null,
          onSelectChat: vi.fn(),
          onSelectConversation: vi.fn(),
          onStartConversation: vi.fn(),
          onStopConversation: vi.fn(),
          commanders: [
            { id: 'atlas', name: 'Atlas', status: 'running' },
          ],
          conversations: [
            {
              ...buildConversation('conv-default', 'idle'),
              isDefaultConversation: true,
            },
            buildConversation('conv-real', 'idle'),
          ],
          workers: [],
          approvals: [],
          workerSessions: [],
          cronSessions: [],
          sentinelSessions: [],
        }),
      )
    })

    const rows = Array.from(
      container.querySelectorAll<HTMLDivElement>('[data-testid="commander-chat-row"]'),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.dataset.conversationId).toBe('conv-real')
    expect(container.textContent).not.toContain('conv-default')
  })
})
