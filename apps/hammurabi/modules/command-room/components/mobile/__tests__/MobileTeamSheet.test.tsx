// @vitest-environment jsdom

import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileTeamSheet } from '../MobileTeamSheet'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

describe('MobileTeamSheet', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('counts and filters commander-local automations separately from global automations', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(MobileTeamSheet, {
        open: true,
        commander: {
          id: 'cmd-1',
          name: 'Atlas',
          status: 'running',
        },
        workers: [
          {
            id: 'worker-1',
            name: 'reviewer',
            kind: 'worker',
            state: 'running',
            commanderId: 'cmd-1',
          },
          {
            id: 'worker-2',
            name: 'other-worker',
            kind: 'worker',
            state: 'running',
            commanderId: 'cmd-2',
          },
        ],
        automationSessions: [
          {
            id: 'auto-local',
            name: 'auto-local',
            label: 'atlas-review',
            status: 'active',
            parentCommanderId: 'cmd-1',
          },
          {
            id: 'auto-global',
            name: 'auto-global',
            label: 'global-briefing',
            status: 'active',
            parentCommanderId: null,
          },
          {
            id: 'auto-other',
            name: 'auto-other',
            label: 'borealis-retro',
            status: 'active',
            parentCommanderId: 'cmd-2',
          },
        ],
        approvals: [
          {
            id: 'approval-1',
            decisionId: 'approval-1',
            commanderId: 'cmd-1',
            commanderName: 'Atlas',
            sessionName: 'commander-cmd-1',
            actionLabel: 'Approve patch',
            actionId: 'file-change',
            source: 'codex',
            requestedAt: '2026-05-01T00:00:00.000Z',
            requestId: 'approval-1',
            reason: null,
            risk: null,
            summary: null,
            previewText: null,
            details: [],
            raw: { workerId: 'worker-1' },
            context: { workerId: 'worker-1' },
          },
        ],
        onOpenApproval: vi.fn(),
        onClose: vi.fn(),
      }))
    })

    expect(document.body.textContent).toContain('1 workers · 1 automations · 1 pend')
    expect(document.body.textContent).toContain('reviewer')
    expect(document.body.textContent).toContain('atlas-review')
    expect(document.body.textContent).not.toContain('global-briefing')
    expect(document.body.textContent).not.toContain('borealis-retro')
  })
})
