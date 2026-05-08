// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgTree } from '@modules/org/types'
import { MobileOrgPage } from '../MobileOrgPage'

const mocks = vi.hoisted(() => ({
  fetchCommanderActiveConversation: vi.fn(async () => null),
}))

vi.mock('@modules/conversation/hooks/use-conversations', () => ({
  ACTIVE_CONVERSATION_FETCH_STALE_MS: 30_000,
  commanderActiveConversationQueryKey: (commanderId: string) => ['commanders', 'conversations', 'active', commanderId],
  fetchCommanderActiveConversation: mocks.fetchCommanderActiveConversation,
}))

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
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
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
            <Route path="/automations" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
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
    mocks.fetchCommanderActiveConversation.mockReset()
    mocks.fetchCommanderActiveConversation.mockResolvedValue(null)
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

  it('makes the org page root the mobile scroll container', async () => {
    await renderMobileOrgPage()

    const page = document.body.querySelector<HTMLElement>('[data-testid="mobile-org-page"]')
    expect(page).not.toBeNull()
    expect(page?.className).toContain('flex-1')
    expect(page?.className).toContain('min-h-0')
    expect(page?.className).toContain('overflow-y-auto')
  })

  it('shows the org identity name in the mobile header when present', async () => {
    const tree = createOrgTree()
    tree.orgIdentity = {
      name: 'Pioneering Minds AI',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }

    await renderMobileOrgPage(tree)

    expect(document.body.querySelector('h1')?.textContent).toBe('Pioneering Minds AI')
  })

  it('falls back to Organization when the org identity name is missing', async () => {
    const tree = createOrgTree()
    tree.orgIdentity = null

    await renderMobileOrgPage(tree)

    expect(document.body.querySelector('h1')?.textContent).toBe('Organization')
  })

  it('opens commander details inside a bottom sheet', async () => {
    await renderMobileOrgPage()

    await click('[data-testid="mobile-org-commander-toggle"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-org-commander-sheet"]')).not.toBeNull()
    })

    expect(document.body.querySelector('[data-testid="commander-row"][data-commander-card="cmd-1"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-edit-button"]')?.textContent).toBe('Edit')
  })

  it('navigates from the commander sheet Check On hero', async () => {
    mocks.fetchCommanderActiveConversation.mockResolvedValue({ id: 'conv-9' })

    await renderMobileOrgPage()

    await click('[data-testid="mobile-org-commander-toggle"]')
    await click('[data-testid="commander-check-on-hero"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent)
        .toBe('/command-room?commander=cmd-1&conversation=conv-9')
    })
  })

  it('navigates the global automation chip to the top-level automations page', async () => {
    await renderMobileOrgPage()

    await click('[data-testid="mobile-global-automation-chip"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent)
        .toBe('/automations?commander=global')
    })
  })
})
