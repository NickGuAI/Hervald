import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TeamColumn } from './TeamColumn'

describe('Hervald TeamColumn', () => {
  it('includes worker sessions in the team list', () => {
    const html = renderToStaticMarkup(
      createElement(TeamColumn, {
        commander: {
          id: 'cmdr-1',
          name: 'Test Commander',
          status: 'running',
        },
        workers: [
          {
            id: 'worker-1',
            name: 'worker-1',
            label: 'Research task',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
            commanderId: 'cmdr-1',
          },
          {
            id: 'cron-1',
            name: 'cron-1',
            label: 'Nightly job',
            kind: 'cron',
            state: 'running',
            creator: { kind: 'cron', id: 'cron-1' },
            commanderId: 'cmdr-1',
          },
        ],
        approvals: [],
        selectedWorkerId: undefined,
        onSelectWorker: vi.fn(),
        onOpenWorkspace: vi.fn(),
      }),
    )

    expect(html).toContain('TEAM · 1')
    expect(html).toContain('worker-1')
    expect(html).not.toContain('cron-1')
  })

  it('shows every owned worker without a five-row cap and surfaces lifecycle state plus dismiss affordance', () => {
    const html = renderToStaticMarkup(
      createElement(TeamColumn, {
        commander: {
          id: 'cmdr-1',
          name: 'Test Commander',
          status: 'running',
        },
        workers: [
          {
            id: 'worker-1',
            name: 'worker-1',
            label: 'Task 1',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-2',
            name: 'worker-2',
            label: 'Task 2',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-3',
            name: 'worker-3',
            label: 'Task 3',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-4',
            name: 'worker-4',
            label: 'Task 4',
            kind: 'worker',
            state: 'stale',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-5',
            name: 'worker-5',
            label: 'Task 5',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-6',
            name: 'worker-6',
            label: 'Task 6',
            kind: 'worker',
            state: 'exited',
            creator: { kind: 'commander', id: 'cmdr-1' },
            processAlive: false,
            resumeAvailable: true,
          },
        ],
        approvals: [],
        selectedWorkerId: 'worker-6',
        onSelectWorker: vi.fn(),
        onOpenWorkspace: vi.fn(),
        onDismissWorker: vi.fn(),
      }),
    )

    expect(html).toContain('TEAM · 6')
    expect(html).toContain('worker-6')
    expect(html).toContain('exited')
    expect(html).toContain('Dismiss')
    expect(html).toContain('resume handle')
  })
})
