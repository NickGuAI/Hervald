// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'
import type { OrgTree } from '@modules/org/types'
import { MobileOrgPage } from '../MobileOrgPage'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
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

async function renderMobileOrgPage(
  tree: OrgTree = createOrgTree(),
  authUser?: {
    name?: string | null
    email?: string | null
    picture?: string | null
  },
) {
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
        <AuthProvider signOut={vi.fn()} user={authUser}>
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
        </AuthProvider>
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
    mocks.fetchJson.mockReset()
    mocks.fetchJson.mockResolvedValue({
      target: {
        routeId: 'command-room.ui',
        path: '/command-room?commander=cmd-1',
        commanderId: 'cmd-1',
        conversationId: null,
      },
    })
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

    let page: HTMLElement | null = null
    await vi.waitFor(() => {
      page = document.body.querySelector<HTMLElement>('[data-testid="mobile-org-page"]')
      expect(page).not.toBeNull()
    })
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

  it('renders the founder profile image when the org read model includes an avatar URL', async () => {
    const tree = createOrgTree()
    tree.operator.avatarUrl = 'https://example.com/nick.png'

    await renderMobileOrgPage(tree)

    const image = document.body.querySelector<HTMLImageElement>('[data-testid="agent-avatar"] img[alt="Nick Gu"]')
    expect(image?.src).toBe('https://example.com/nick.png')
  })

  it('falls back to the authenticated user picture when the founder avatar is null', async () => {
    const tree = createOrgTree()
    tree.operator.avatarUrl = null

    await renderMobileOrgPage(tree, {
      name: 'Nick Gu',
      email: 'nick@example.com',
      picture: 'https://example.com/auth0-nick.png',
    })

    const image = document.body.querySelector<HTMLImageElement>('[data-testid="agent-avatar"] img[alt="Nick Gu"]')
    expect(image?.src).toBe('https://example.com/auth0-nick.png')
    expect(document.body.querySelector('[data-testid="mobile-founder-avatar-initials"]')).toBeNull()
  })

  it('renders founder initials when all avatar sources are missing', async () => {
    const tree = createOrgTree()
    tree.operator.avatarUrl = null

    await renderMobileOrgPage(tree)

    expect(document.body.querySelector('[data-testid="mobile-founder-avatar-initials"]')?.textContent).toBe('NG')
  })

  it('falls back to Organization when the org identity name is missing', async () => {
    const tree = createOrgTree()
    tree.orgIdentity = null

    await renderMobileOrgPage(tree)

    expect(document.body.querySelector('h1')?.textContent).toBe('Organization')
  })

  it('opens commander details inside a bottom sheet', async () => {
    await renderMobileOrgPage()

    const tile = document.body.querySelector<HTMLElement>('[data-testid="mobile-org-commander-tile"]')
    expect(tile?.className).toContain('border-[color:var(--hv-border-soft)]')
    expect(tile?.textContent).toContain('1 automation')

    await click('[data-testid="mobile-org-commander-toggle"]')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="mobile-org-commander-sheet"]')).not.toBeNull()
    })

    expect(document.body.querySelector('[data-testid="commander-row"][data-commander-card="cmd-1"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-edit-button"]')?.textContent).toBe('Edit')
  })

  it('navigates from the commander sheet Check On hero', async () => {
    mocks.fetchJson.mockResolvedValue({
      target: {
        routeId: 'command-room.ui',
        path: '/command-room?commander=cmd-1&conversation=conv-9',
        commanderId: 'cmd-1',
        conversationId: 'conv-9',
      },
    })

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
