import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TeamColumn } from '../TeamColumn'

describe('Hervald TeamColumn creator filter', () => {
  it('shows only workers explicitly created by the selected commander', () => {
    const html = renderToStaticMarkup(
      createElement(TeamColumn, {
        commander: {
          id: 'cmdr-1',
          name: 'Test Commander',
          status: 'running',
        },
        workers: [
          {
            id: 'worker-owned',
            name: 'worker-owned',
            label: 'Owned worker',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-1' },
          },
          {
            id: 'worker-other-commander',
            name: 'worker-other-commander',
            label: 'Other commander worker',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: 'cmdr-2' },
          },
          {
            id: 'worker-human',
            name: 'worker-human',
            label: 'Human worker',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'human', id: 'api-key' },
          },
        ],
        approvals: [],
        selectedWorkerId: undefined,
        onSelectWorker: vi.fn(),
        onOpenWorkspace: vi.fn(),
      }),
    )

    expect(html).toContain('TEAM · 1')
    expect(html).toContain('worker-owned')
    expect(html).not.toContain('worker-other-commander')
    expect(html).not.toContain('worker-human')
  })

  // Issue #1223: workers dispatched via the URL-baked
  // POST /api/commanders/:id/workers route persist with
  // creator: { kind: "commander", id: <url-id> } and must therefore
  // appear on the dispatching commander's TEAM panel — even though
  // the underlying API key is operating on behalf of an external
  // process (Test Commander heartbeat, scripted dispatch, etc.) instead of
  // the commander runtime itself.
  it('matches workers dispatched via the URL-baked /api/commanders/:id/workers route to their commander', () => {
    const commanderId = 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e'
    const html = renderToStaticMarkup(
      createElement(TeamColumn, {
        commander: {
          id: commanderId,
          name: 'Test Commander',
          status: 'running',
        },
        workers: [
          {
            id: 'worker-attributed-via-url-route',
            name: 'worker-attributed-via-url-route',
            label: 'Worker dispatched via /api/commanders/:id/workers',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'commander', id: commanderId },
          },
          // Pre-#1223 worker — externally dispatched but never attributed.
          // Stays invisible (the bug we are fixing for new dispatches).
          {
            id: 'worker-pre-1223-orphan',
            name: 'worker-pre-1223-orphan',
            label: 'Worker dispatched before #1223 (no commander attribution)',
            kind: 'worker',
            state: 'running',
            creator: { kind: 'human', id: 'api-key' },
          },
        ],
        approvals: [],
        selectedWorkerId: undefined,
        onSelectWorker: vi.fn(),
        onOpenWorkspace: vi.fn(),
      }),
    )

    expect(html).toContain('TEAM · 1')
    expect(html).toContain('worker-attributed-via-url-route')
    expect(html).not.toContain('worker-pre-1223-orphan')
  })
})
