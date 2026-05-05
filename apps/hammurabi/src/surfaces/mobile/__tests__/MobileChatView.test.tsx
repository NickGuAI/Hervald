import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MobileChatView } from '../MobileChatView'

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    sessionName,
    sessionLabel,
    isStreaming,
    theme,
    rootClassName,
    approvals,
    workers,
    emptyState,
  }: {
    sessionName: string
    sessionLabel: string
    isStreaming?: boolean
    theme?: string
    rootClassName?: string
    approvals?: unknown[]
    workers?: unknown[]
    emptyState?: unknown
  }) => createElement(
    'div',
    {
      'data-testid': 'mobile-session-shell',
      'data-session-name': sessionName,
      'data-session-label': sessionLabel,
      'data-is-streaming': String(Boolean(isStreaming)),
      'data-theme': theme,
      'data-root-class': rootClassName,
      'data-approval-count': String(approvals?.length ?? 0),
      'data-worker-count': String(workers?.length ?? 0),
      'data-has-empty-state': String(Boolean(emptyState)),
    },
    'MobileSessionShell',
  ),
}))

describe('MobileChatView', () => {
  it('adapts Hervald chat props into the shared mobile shell and forwards theme', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'running',
          description: 'Primary commander',
          avatarUrl: null,
          ui: { accentColor: '#f59e0b' },
        },
        workers: [
          { id: 'worker-1', name: 'worker-1', state: 'running', commanderId: 'cmd-1' },
        ],
        transcript: [],
        approvals: [{
          id: 'approval-1',
          decisionId: 'approval-1',
          actionLabel: 'Approve tool use',
          actionId: 'tool_use',
          source: 'codex',
          commanderId: 'cmd-1',
          commanderName: 'Test Commander',
          sessionName: 'commander-cmd-1',
          requestedAt: '2026-04-21T15:00:00.000Z',
          requestId: 'approval-1',
          reason: 'Needs approval',
          risk: 'high',
          summary: 'Run a command',
          previewText: null,
          details: [],
          raw: {},
          context: null,
        }],
        sessionName: 'commander-cmd-1',
        composerEnabled: true,
        composerSendReady: true,
        canQueueDraft: true,
        isStreaming: true,
        agentType: 'claude',
        wsStatus: 'connected',
        costUsd: 0.42,
        durationSec: 90,
        theme: 'light',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
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
        onSend: vi.fn(() => true),
        onQueue: vi.fn(() => true),
      }),
    )

    expect(html).toContain('data-testid="mobile-session-shell"')
    expect(html).toContain('data-session-label="Test Commander"')
    expect(html).toContain('data-is-streaming="true"')
    expect(html).toContain('data-theme="light"')
    expect(html).toContain('data-root-class="mobile-session-shell session-view-overlay hv-light"')
    expect(html).toContain('data-approval-count="1"')
    expect(html).toContain('data-worker-count="1"')
    expect(html).toContain('data-has-empty-state="false"')
  })

  it('does not pass the removed commander-start empty state when no conversation is selected', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'idle',
          description: 'Primary commander',
        },
        workers: [],
        transcript: [],
        approvals: [],
        sessionName: 'commander-cmd-1',
        composerEnabled: false,
        composerSendReady: false,
        canQueueDraft: false,
        theme: 'dark',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
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
      }),
    )

    expect(html).toContain('data-testid="mobile-session-shell"')
    expect(html).toContain('data-has-empty-state="false"')
  })

  it('does not use legacy commander liveSession names for conversation pages', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Test Commander',
          status: 'running',
          description: 'Primary commander',
        },
        workers: [],
        transcript: [],
        approvals: [],
        sessionName: '',
        composerEnabled: false,
        composerSendReady: false,
        canQueueDraft: false,
        conversations: [{
          id: 'conv-1',
          commanderId: 'cmd-1',
          surface: 'ui',
          status: 'active',
          currentTask: null,
          lastHeartbeat: null,
          heartbeatTickCount: 0,
          completedTasks: 0,
          totalCostUsd: 0,
          name: 'Chat 1',
          createdAt: '2026-05-01T00:00:00.000Z',
          lastMessageAt: '2026-05-01T00:00:00.000Z',
          liveSession: {
            name: 'commander-cmd-1',
          },
        }],
        selectedConversationId: 'conv-1',
        theme: 'dark',
        onSetTheme: vi.fn(),
        queueSnapshot: {
          currentMessage: null,
          items: [],
          totalCount: 0,
          maxSize: 8,
        },
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
      }),
    )

    expect(html).toContain('data-session-name="conversation-conv-1"')
    expect(html).not.toContain('data-session-name="commander-cmd-1"')
  })
})
