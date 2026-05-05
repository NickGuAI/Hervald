// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgTree } from '@modules/org/types'
import { MobileOrgPage } from '../MobileOrgPage'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

function createOrgTree(): OrgTree {
  const operator = {
    id: 'founder-1',
    kind: 'founder' as const,
    displayName: 'Nick Gu',
    email: null,
    avatarUrl: null,
    createdAt: '2026-05-01T00:00:00.000Z',
  }

  return {
    operator,
    orgIdentity: {
      name: 'Gehirn Inc.',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
    archivedCommandersCount: 0,
    commanders: [
      {
        id: 'cmd-1',
        kind: 'commander',
        parentId: operator.id,
        displayName: 'Atlas',
        roleKey: 'engineering',
        avatarUrl: null,
        status: 'active',
        costUsd: 0,
        recentActivityAt: null,
        questsInFlight: { active: 3, pending: 1 },
        channels: { whatsapp: 2, telegram: 0, discord: 1 },
        activeUiChats: 1,
        counts: { activeQuests: 3, activeWorkers: 2, activeChats: 1 },
        templateId: null,
        replicatedFromCommanderId: null,
      },
    ],
    automations: [
      {
        id: 'auto-1',
        kind: 'automation',
        parentId: 'cmd-1',
        displayName: 'validator',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        trigger: 'schedule',
        templateId: null,
      },
    ],
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

async function renderMobileOrgPage(tree: OrgTree = createOrgTree()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/org']}>
        <Routes>
          <Route
            path="/org"
            element={(
              <MobileOrgPage
                tree={tree}
                commanders={tree.commanders}
                operatorAutomationCount={0}
                showArchived={false}
                highlightedCommanderId={null}
                restoringCommanderId={null}
                onToggleArchived={vi.fn()}
                onHire={vi.fn()}
                onEdit={vi.fn()}
                onReplicate={vi.fn()}
                onDelete={vi.fn()}
                onRestore={vi.fn()}
                onSaveTemplate={vi.fn()}
                getCommanderAutomations={(commanderId) =>
                  tree.automations.filter((automation) => automation.parentId === commanderId)}
              />
            )}
          />
          <Route path="/command-room" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
}

async function click(selector: string) {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`)
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('MobileOrgPage', () => {
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

  it('starts collapsed and expands a commander into compact mobile cards', async () => {
    await renderMobileOrgPage()

    expect(document.body.querySelector('[data-testid="mobile-org-page"]')).not.toBeNull()
    const tile = document.body.querySelector('[data-testid="mobile-org-commander-tile"]')
    expect(tile?.className).toContain('rounded-[8px]')
    expect(document.body.textContent).toContain('Atlas')
    expect(document.body.querySelector('[data-testid="mobile-org-check-on"]')).toBeNull()

    await click('[data-testid="mobile-org-commander-toggle"]')

    expect(document.body.querySelector('[data-testid="mobile-org-check-on"]')?.textContent).toContain('Check On Atlas')
    expect(document.body.textContent).toContain('Status')
    expect(document.body.textContent).toContain('Automations')
    expect(document.body.textContent).toContain('Channels')
    expect(document.body.textContent).toContain('More')
  })

  it('More button meets 44px minimum tap target', async () => {
    await renderMobileOrgPage()

    await click('[data-testid="mobile-org-commander-toggle"]')

    const moreButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="More actions for Atlas"]')
    expect(moreButton?.className).toContain('h-11')
    expect(moreButton?.className).toContain('w-11')
  })

  it('navigates from the expanded Check On hero', async () => {
    await renderMobileOrgPage()

    await click('[data-testid="mobile-org-commander-toggle"]')
    await click('[data-testid="mobile-org-check-on"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/command-room?commander=cmd-1')
    })
  })
})
