import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CenterColumn } from '../CenterColumn'

vi.mock('@/hooks/use-approvals', () => ({
  usePendingApprovals: () => ({ data: [] }),
  useApprovalDecision: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@modules/agents/page-shell/TerminalView', () => ({
  TerminalView: ({ sessionName }: { sessionName: string }) => createElement('div', null, `TerminalView:${sessionName}`),
}))

vi.mock('../ChatPane', () => ({
  ChatPane: () => createElement('div', null, 'ChatPane'),
}))

vi.mock('../QueueDock', () => ({
  QueueDock: () => createElement('div', null, 'QueueDock'),
}))

vi.mock('@modules/agents/components/SessionComposer', () => ({
  SessionComposer: () => createElement('div', null, 'SessionComposer'),
}))

describe('CenterColumn', () => {
  it('renders TerminalView instead of ChatPane for PTY chat sessions', () => {
    const html = renderToStaticMarkup(
      createElement(CenterColumn, {
        commander: {
          id: '',
          name: 'Worker PTY',
          status: 'active',
          agentType: 'codex',
        },
        activeChatSession: {
          id: 'worker-pty',
          name: 'worker-pty',
          label: 'Worker PTY',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4242,
          sessionType: 'pty',
          agentType: 'codex',
          status: 'active',
        },
        transcript: [],
        workers: [],
        activeTab: 'chat',
        setActiveTab: vi.fn(),
        crons: [],
        onAnswer: vi.fn(),
        composerSessionName: 'worker-pty',
        composerEnabled: false,
        composerSendReady: false,
        canQueueDraft: false,
        queueSnapshot: { items: [] },
        onClearQueue: vi.fn(),
        onMoveQueuedMessage: vi.fn(),
        onRemoveQueuedMessage: vi.fn(),
        theme: 'light',
        onSetTheme: vi.fn(),
        onCloseActiveChat: vi.fn(),
        onKillSession: vi.fn(),
      }),
    )

    expect(html).toContain('TerminalView:worker-pty')
    expect(html).not.toContain('ChatPane')
    expect(html).not.toContain('QueueDock')
    expect(html).not.toContain('SessionComposer')
  })
})
