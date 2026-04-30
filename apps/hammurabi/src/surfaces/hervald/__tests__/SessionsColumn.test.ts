import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SessionsColumn } from '../SessionsColumn'

vi.mock('@modules/agents/page-shell/SessionCard', () => ({
  SessionCard: ({ session, variant }: { session: { name: string; sessionType?: string }; variant?: string }) => createElement(
    'div',
    null,
    `SessionCard:${session.name}:${session.sessionType ?? 'none'}:${variant ?? 'card'}`,
  ),
}))

describe('SessionsColumn', () => {
  it('preserves sessionType when rendering worker session cards', () => {
    const html = renderToStaticMarkup(
      createElement(SessionsColumn, {
        selectedCommanderId: 'commander-1',
        onSelectCommander: vi.fn(),
        onCreateCommander: vi.fn(),
        onCreateSession: vi.fn(),
        selectedChatId: 'worker-pty',
        onSelectChat: vi.fn(),
        onKillSession: vi.fn(),
        onResumeSession: vi.fn(),
        commanders: [{
          id: 'commander-1',
          name: 'Marcus',
          status: 'running',
        }],
        workers: [],
        approvals: [],
        workerSessions: [{
          id: 'worker-pty',
          name: 'worker-pty',
          label: 'Worker PTY',
          created: '2026-04-20T12:00:00.000Z',
          pid: 4242,
          sessionType: 'pty',
          status: 'active',
          agentType: 'codex',
        }],
        cronSessions: [],
        sentinelSessions: [],
      }),
    )

    expect(html).toContain('SessionCard:worker-pty:pty:row')
  })

  it('shows nested delegated workers for the selected commander', () => {
    const html = renderToStaticMarkup(
      createElement(SessionsColumn, {
        selectedCommanderId: 'commander-1',
        onSelectCommander: vi.fn(),
        onCreateCommander: vi.fn(),
        onCreateSession: vi.fn(),
        selectedChatId: null,
        onSelectChat: vi.fn(),
        onKillSession: vi.fn(),
        onResumeSession: vi.fn(),
        commanders: [{
          id: 'commander-1',
          name: 'Marcus',
          status: 'running',
        }],
        workers: [{
          id: 'worker-nested',
          name: 'worker-nested',
          state: 'running',
          commanderId: 'commander-1',
        }],
        approvals: [],
        workerSessions: [],
        cronSessions: [],
        sentinelSessions: [],
      }),
    )

    expect(html).toContain('worker-nested')
  })
})
