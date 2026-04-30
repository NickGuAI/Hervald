import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSession } from '@/types'
import { SessionCard } from '../SessionCard'

function renderSessionCardHtml(session: AgentSession): string {
  return renderToStaticMarkup(
    createElement(SessionCard, {
      session,
      selected: false,
      onSelect: vi.fn(),
      onKill: vi.fn(),
      onResume: vi.fn(),
    }),
  )
}

describe('SessionCard', () => {
  it('hides Kill button and shows exited badge when process is not alive', () => {
    const html = renderSessionCardHtml({
      name: 'commander-exited',
      created: '2026-03-09T00:00:00.000Z',
      pid: 111,
      processAlive: false,
      sessionType: 'stream',
      agentType: 'claude',
    } as AgentSession)

    expect(html).toContain('commander-exited')
    expect(html).toContain('>exited<')
    expect(html).not.toContain('>Kill<')
  })

  it('shows done-worker summary for sessions with all workers completed', () => {
    const html = renderSessionCardHtml({
      name: 'commander-completed-workers',
      created: '2026-03-09T00:00:00.000Z',
      pid: 222,
      processAlive: true,
      sessionType: 'stream',
      agentType: 'claude',
      spawnedWorkers: ['worker-a', 'worker-b'],
      workerSummary: { total: 2, running: 0, starting: 0, down: 0, done: 2 },
    } as AgentSession)

    expect(html).toContain('commander-completed-workers')
    expect(html).toContain('✓ 2 done')
    expect(html).toContain('>Kill<')
  })

  it('shows Resume for stale resumable Codex sessions even while the wrapper is still alive', () => {
    const html = renderSessionCardHtml({
      name: 'commander-codex-watchdog-stale',
      created: '2026-03-09T00:00:00.000Z',
      pid: 333,
      processAlive: true,
      sessionType: 'stream',
      agentType: 'codex',
      status: 'stale',
      resumeAvailable: true,
    } as AgentSession)

    expect(html).toContain('commander-codex-watchdog-stale')
    expect(html).toContain('>Resume<')
    expect(html).toContain('>Kill<')
    expect(html).toContain('>stale<')
  })
})
