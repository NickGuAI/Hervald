import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MobileChatView } from '../MobileChatView'

vi.mock('@modules/agents/page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({
    sessionLabel,
    isStreaming,
    theme,
    rootClassName,
    approvals,
    workers,
    emptyState,
  }: {
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
  it('adapts Hervald chat props into the shared dark mobile shell', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Athena',
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
          commanderName: 'Athena',
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
    expect(html).toContain('data-session-label="Athena"')
    expect(html).toContain('data-is-streaming="true"')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('data-root-class="mobile-session-shell session-view-overlay hv-dark"')
    expect(html).toContain('data-approval-count="1"')
    expect(html).toContain('data-worker-count="1"')
    expect(html).toContain('data-has-empty-state="false"')
  })

  it('passes an idle empty state into the shell when the commander is stopped', () => {
    const html = renderToStaticMarkup(
      createElement(MobileChatView, {
        commander: {
          id: 'cmd-1',
          name: 'Athena',
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
        onStartCommander: vi.fn(),
        onAnswer: vi.fn(),
        onApproveApproval: vi.fn(),
        onDenyApproval: vi.fn(),
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
      }),
    )

    expect(html).toContain('data-testid="mobile-session-shell"')
    expect(html).toContain('data-has-empty-state="true"')
  })
})
