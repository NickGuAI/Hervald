// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '../../types'
import { CommanderRow } from '../CommanderRow'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

function createCommander(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: 'cmd-1',
    kind: 'commander',
    parentId: 'founder-1',
    displayName: 'Atlas',
    avatarUrl: null,
    status: 'running',
    costUsd: 0,
    archived: false,
    counts: { activeQuests: 2, activeWorkers: 1, activeChats: 3 },
    questsInFlight: { active: 2, pending: 0 },
    channels: { whatsapp: 1, telegram: 0, discord: 0 },
    activeUiChats: 3,
    ...overrides,
  }
}

describe('CommanderRow', () => {
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

  it('renders a visible Edit button and removes the check-on arrow glyph', async () => {
    const commander = createCommander()
    const onEdit = vi.fn()

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
          <MemoryRouter>
            <CommanderRow
              commander={commander}
              automations={[]}
              highlighted={false}
              onEdit={onEdit}
              onReplicate={vi.fn()}
              onDelete={vi.fn()}
              onRestore={vi.fn()}
              onSaveTemplate={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      )
    })

    const editButton = document.body.querySelector<HTMLButtonElement>('[data-testid="commander-edit-button"]')
    expect(editButton?.textContent).toBe('Edit')
    expect(document.body.querySelector('[data-testid="commander-check-on-hero"]')?.textContent).toBe('Check On Atlas')

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onEdit).toHaveBeenCalledWith(commander)
  })
})
