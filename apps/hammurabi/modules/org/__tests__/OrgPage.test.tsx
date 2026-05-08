// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgTree } from '@modules/org/types'

const mocks = vi.hoisted(() => ({
  useOrgTree: vi.fn(),
  useCommander: vi.fn(),
  createCommander: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgTree', () => ({
  useOrgTree: mocks.useOrgTree,
  ORG_QUERY_KEY: ['org'],
}))

vi.mock('@modules/commanders/hooks/useCommander', () => ({
  useCommander: mocks.useCommander,
}))

vi.mock('@modules/commanders/components/CreateCommanderWizard', () => ({
  CreateCommanderWizard: ({
    onAdd,
    onClose,
  }: {
    onAdd: (input: { host: string }) => Promise<void>
    onClose: () => void
  }) => (
    <div data-testid="mock-create-commander-wizard">
      <button
        type="button"
        data-testid="mock-create-commander-confirm"
        onClick={() => {
          void onAdd({ host: 'atlas' })
          onClose()
        }}
      >
        Create mocked commander
      </button>
    </div>
  ),
}))

import { OrgPage } from '../OrgPage'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null
let originalMatchMedia: typeof window.matchMedia | undefined
let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | undefined
let scrollIntoViewSpy: ReturnType<typeof vi.fn>
let renderIteration = 0

function buildMatchMedia(isMobile: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function createOrgTree(overrides: Partial<OrgTree> = {}): OrgTree {
  const operator = {
    id: 'founder-1',
    kind: 'founder' as const,
    displayName: 'Nick Gu',
    email: 'google-oauth2|106050570920402391077@auth0.local',
    avatarUrl: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides.operator,
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
        costUsd: 4.21,
        recentActivityAt: '2026-05-01T04:00:00.000Z',
        questsInFlight: { active: 2, pending: 0 },
        channels: { whatsapp: 2, telegram: 1, discord: 0 },
        activeUiChats: 3,
        counts: { activeQuests: 2, activeWorkers: 1, activeChats: 3 },
        templateId: 'template-atlas',
        replicatedFromCommanderId: null,
      },
      {
        id: 'cmd-2',
        kind: 'commander',
        parentId: operator.id,
        displayName: 'Borealis',
        avatarUrl: null,
        status: 'running',
        costUsd: 3.14,
        recentActivityAt: '2026-05-01T06:30:00.000Z',
        questsInFlight: { active: 1, pending: 2 },
        channels: { whatsapp: 0, telegram: 2, discord: 1 },
        activeUiChats: 1,
        counts: { activeQuests: 1, activeWorkers: 2, activeChats: 1 },
        templateId: 'template-borealis',
        replicatedFromCommanderId: null,
      },
    ],
    automations: [
      {
        id: 'auto-root',
        kind: 'automation',
        parentId: operator.id,
        displayName: 'daily-briefing',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        templateId: null,
        trigger: 'schedule',
      },
      {
        id: 'auto-cmd-1',
        kind: 'automation',
        parentId: 'cmd-1',
        displayName: 'context-hygiene',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        templateId: null,
        trigger: 'schedule',
      },
      {
        id: 'auto-cmd-2',
        kind: 'automation',
        parentId: 'cmd-2',
        displayName: 'weekly-retro',
        status: 'enabled',
        costUsd: 0,
        recentActivityAt: null,
        templateId: null,
        trigger: 'schedule',
      },
    ],
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function OrgPageRoute() {
  return (
    <>
      <LocationProbe />
      <OrgPage />
    </>
  )
}

async function renderOrgPage(initialEntry: string = '/org') {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) {
    root = createRoot(container)
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  renderIteration += 1

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter key={`org-page-${renderIteration}`} initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/org" element={<OrgPageRoute />} />
            <Route path="/command-room" element={<LocationProbe />} />
            <Route path="/automations" element={<LocationProbe />} />
            <Route path="/channels" element={<LocationProbe />} />
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

async function clickButtonWithText(text: string) {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) {
    throw new Error(`Missing button with text: ${text}`)
  }
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()
  })
}

async function expectLocation(path: string) {
  await vi.waitFor(() => {
    expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe(path)
  })
}

function queryCommanderDialog(displayName: string) {
  return document.body.querySelector(`[role="dialog"][aria-label="${displayName}"]`)
}

describe('OrgPage', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalMatchMedia = window.matchMedia
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    window.matchMedia = buildMatchMedia(false)
    document.documentElement.className = 'hv-light'
    scrollIntoViewSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewSpy,
    })
    mocks.useOrgTree.mockReset()
    mocks.useCommander.mockReset()
    mocks.createCommander.mockReset()
    mocks.createCommander.mockResolvedValue(undefined)
    mocks.useCommander.mockReturnValue({
      createCommander: mocks.createCommander,
      createCommanderPending: false,
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
    document.documentElement.className = ''
    window.matchMedia = originalMatchMedia as typeof window.matchMedia
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    renderIteration = 0
    vi.clearAllMocks()
  })

  it('renders org identity and never leaks a synthetic Auth0 identifier', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    expect(document.body.textContent).toContain('Gehirn Inc.')
    expect(document.body.textContent).toContain('Nick Gu')
    expect(document.body.textContent).not.toContain('@auth0.local')
    expect(document.body.textContent).not.toContain('auth0|')
  })

  it('renders the desktop org sections in heading, founder, automation, grid order', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    const heading = document.body.querySelector('[data-testid="org-heading-section"]')
    const founder = document.body.querySelector('[data-testid="org-founder-section"]')
    const automation = document.body.querySelector('[data-testid="org-global-automation-section"]')
    const grid = document.body.querySelector('[data-testid="org-commander-grid-section"]')

    expect(heading).not.toBeNull()
    expect(founder).not.toBeNull()
    expect(automation).not.toBeNull()
    expect(grid).not.toBeNull()
    expect(heading?.querySelector('[data-testid="commander-hire-button"]')).not.toBeNull()
    expect(heading?.compareDocumentPosition(founder as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(founder?.compareDocumentPosition(automation as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(automation?.compareDocumentPosition(grid as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders commander tiles collapsed by default', async () => {
    const orgTree = createOrgTree()
    mocks.useOrgTree.mockReturnValue({
      data: orgTree,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    expect(document.body.querySelector('[data-testid="global-automation-chip"]')?.textContent).toContain(
      'Global Automation',
    )
    expect(document.body.querySelectorAll('[data-testid="commander-tile"]')).toHaveLength(orgTree.commanders.length)
    expect(queryCommanderDialog('Atlas')).toBeNull()
    expect(queryCommanderDialog('Borealis')).toBeNull()
    expect(document.body.querySelector('[data-testid="commander-check-on-hero"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="commander-status-card"]')).toBeNull()
  })

  it('renders a three-commander grid', async () => {
    const baseTree = createOrgTree()
    const orgTree = createOrgTree({
      commanders: [
        ...baseTree.commanders,
        {
          id: 'cmd-3',
          kind: 'commander',
          parentId: 'founder-1',
          displayName: 'Cassiopeia',
          avatarUrl: null,
          status: 'idle',
          costUsd: 1.73,
          recentActivityAt: '2026-05-01T07:00:00.000Z',
          questsInFlight: { active: 0, pending: 1 },
          channels: { whatsapp: 1, telegram: 0, discord: 0 },
          activeUiChats: 0,
          counts: { activeQuests: 0, activeWorkers: 0, activeChats: 0 },
          templateId: 'template-cassiopeia',
          replicatedFromCommanderId: null,
        },
      ],
    })
    mocks.useOrgTree.mockReturnValue({
      data: orgTree,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    expect(document.body.querySelectorAll('[data-testid="commander-tile"]')).toHaveLength(3)
  })

  it('expands one commander body at a time when clicking commander tiles', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    expect(queryCommanderDialog('Atlas')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-row"][data-commander-card="cmd-1"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-check-on-hero"]')?.textContent).toBe('Check On Atlas')
    expect(document.body.querySelector('[data-testid="commander-edit-button"]')?.textContent).toBe('Edit')
    expect(queryCommanderDialog('Borealis')).toBeNull()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-2"]')
    expect(queryCommanderDialog('Atlas')).toBeNull()
    expect(queryCommanderDialog('Borealis')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-row"][data-commander-card="cmd-2"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="commander-check-on-hero"]')?.textContent).toBe('Check On Borealis')
  })

  it('collapses the commander body when clicking the same card again', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    expect(queryCommanderDialog('Atlas')).not.toBeNull()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    expect(queryCommanderDialog('Atlas')).toBeNull()
  })

  it('collapses the commander body on Escape', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    expect(queryCommanderDialog('Atlas')).not.toBeNull()

    await pressEscape()
    expect(queryCommanderDialog('Atlas')).toBeNull()
  })

  it('collapses the commander body on backdrop click', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    expect(queryCommanderDialog('Atlas')).not.toBeNull()

    await click('button[aria-label="Close Atlas"]')

    expect(queryCommanderDialog('Atlas')).toBeNull()
  })

  it('routes the Check On hero to the commander command room', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    await click('[data-testid="commander-check-on-hero"]')
    await expectLocation('/command-room?commander=cmd-1')
  })

  it('routes the global automation chip to the top-level automations page', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="global-automation-chip"]')
    await expectLocation('/automations?commander=global')
  })

  it('routes the commander automation card to the top-level automations page', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    await click('[data-testid="commander-automations-card"]')
    await expectLocation('/automations?commander=cmd-1')
  })

  it('routes the channels card to the channels configuration page', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    await click('[data-testid="commander-channels-card"]')
    await expectLocation('/channels?commander=cmd-1')
  })

  it('opens the More menu with Edit, Replicate, Save as Template, and Delete', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    await click('[data-testid="commander-tile"][data-commander-card="cmd-1"]')
    await click('[data-testid="commander-actions-menu"]')
    for (const label of ['Edit', 'Replicate', 'Save as Template', 'Delete']) {
      expect(document.body.textContent).toContain(label)
    }
  })

  it('scrolls the highlighted commander tile into view from the URL param', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage('/org?highlight=cmd-2')

    await vi.waitFor(() => {
      expect(scrollIntoViewSpy).toHaveBeenCalled()
    })
  })

  it('drops the legacy card shell classes from commander tiles', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage()

    const tiles = Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="commander-tile"]'))
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) {
      expect(tile.className).not.toContain('bg-sumi-black')
      expect(tile.className).not.toContain('bg-washi-white')
      expect(tile.className).not.toContain('card-sumi')
    }
  })

  it('renders a retryable error state when the org request fails', async () => {
    const refetch = vi.fn()
    mocks.useOrgTree.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
      refetch,
    })

    await renderOrgPage()

    expect(document.body.querySelector('[data-testid="org-page-error"]')?.textContent).toContain('boom')
    await clickButtonWithText('Retry')
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the zero-commander CTA, opens the wizard, and clears after a commander is created', async () => {
    let orgTree = createOrgTree({ commanders: [] })
    mocks.useOrgTree.mockImplementation(() => ({
      data: orgTree,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }))

    await renderOrgPage()

    expect(document.body.querySelector('[data-testid="empty-org-hire-button"]')?.textContent).toBe('Open wizard')
    expect(document.body.querySelector('[data-testid="mock-create-commander-wizard"]')).toBeNull()

    await click('[data-testid="empty-org-hire-button"]')
    expect(document.body.querySelector('[data-testid="mock-create-commander-wizard"]')).not.toBeNull()

    await click('[data-testid="mock-create-commander-confirm"]')
    expect(mocks.createCommander).toHaveBeenCalledWith({ host: 'atlas' })

    orgTree = createOrgTree({
      commanders: [
        {
          id: 'cmd-new',
          kind: 'commander',
          parentId: 'founder-1',
          displayName: 'Atlas',
          avatarUrl: null,
          status: 'idle',
          costUsd: 0,
          recentActivityAt: null,
          questsInFlight: { active: 0, pending: 0 },
          channels: { whatsapp: 0, telegram: 0, discord: 0 },
          activeUiChats: 0,
          counts: { activeQuests: 0, activeWorkers: 0, activeChats: 0 },
          templateId: null,
          replicatedFromCommanderId: null,
        },
      ],
    })

    await renderOrgPage()

    expect(document.body.querySelector('[data-testid="empty-org-hire-button"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="mock-create-commander-wizard"]')).toBeNull()
    expect(document.body.querySelectorAll('[data-testid="commander-tile"]')).toHaveLength(1)
  })

  it('auto-opens the wizard once when the first-run onboarding signal is present', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree({ commanders: [] }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage('/org?firstRun=true')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/org')
    })
    expect(document.body.querySelector('[data-testid="mock-create-commander-wizard"]')).not.toBeNull()
  })

  it('does not auto-open the wizard for a regular zero-commander org page', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: createOrgTree({ commanders: [] }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderOrgPage('/org')

    expect(document.body.querySelector('[data-testid="empty-org-hire-button"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="mock-create-commander-wizard"]')).toBeNull()
  })
})
