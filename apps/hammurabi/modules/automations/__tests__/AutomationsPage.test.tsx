// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgTree } from '@modules/org/types'
import { AutomationsPage } from '../page'

const mocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(),
  useOrgTree: vi.fn(),
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: mocks.useIsMobile,
}))

vi.mock('@modules/org/hooks/useOrgTree', () => ({
  useOrgTree: mocks.useOrgTree,
}))

vi.mock('@modules/commanders/components/AutomationPanel', () => ({
  AutomationPanel: ({
    scope,
    filter,
    onFilterChange,
  }: {
    scope: { kind: 'global' } | { kind: 'commander'; commander: { id: string } }
    filter: string
    onFilterChange?: (filter: string) => void
  }) => (
    <button
      type="button"
      data-testid="automation-panel"
      data-filter={filter}
      data-scope={scope.kind}
      data-commander={scope.kind === 'commander' ? scope.commander.id : 'global'}
      onClick={() => onFilterChange?.('quest')}
    >
      panel
    </button>
  ),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function buildOrgTree(): OrgTree {
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
    orgIdentity: null,
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
        questsInFlight: { active: 0, pending: 0 },
        channels: { whatsapp: 0, telegram: 0, discord: 0 },
        activeUiChats: 0,
        counts: { activeQuests: 0, activeWorkers: 0, activeChats: 0 },
        templateId: null,
        replicatedFromCommanderId: null,
      },
    ],
    automations: [],
  }
}

async function renderAt(path: string) {
  window.history.pushState({}, '', path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <BrowserRouter>
        <AutomationsPage />
      </BrowserRouter>,
    )
  })
}

async function clickButton(label: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.toLowerCase().includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing button: ${label}`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('AutomationsPage', () => {
  beforeEach(() => {
    mocks.useIsMobile.mockReturnValue(false)
    mocks.useOrgTree.mockReturnValue({
      data: buildOrgTree(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
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
    vi.clearAllMocks()
  })

  it('renders the desktop automation panel from top-level route state', async () => {
    await renderAt('/automations?trigger=schedule&commander=cmd-1')

    const panel = document.body.querySelector('[data-testid="automation-panel"]')
    expect(panel?.getAttribute('data-filter')).toBe('schedule')
    expect(panel?.getAttribute('data-scope')).toBe('commander')
    expect(panel?.getAttribute('data-commander')).toBe('cmd-1')
  })

  it('renders the mobile automation page and keeps commander selection URL-local', async () => {
    mocks.useIsMobile.mockReturnValue(true)
    await renderAt('/automations?trigger=schedule&commander=global')

    expect(document.body.querySelector('[data-testid="mobile-automations"]')).not.toBeNull()
    await clickButton('atlas')

    expect(window.location.pathname).toBe('/automations')
    expect(new URLSearchParams(window.location.search).get('commander')).toBe('cmd-1')
  })
})
