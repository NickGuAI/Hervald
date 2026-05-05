// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChannelsCard } from '../components/ChannelsCard'
import type { OrgNode } from '../types'

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
    roleKey: 'engineering',
    avatarUrl: null,
    status: 'active',
    costUsd: 0,
    recentActivityAt: null,
    questsInFlight: { active: 0, pending: 0 },
    channels: { whatsapp: 2, telegram: 1, discord: 0 },
    activeUiChats: 0,
    counts: { activeQuests: 0, activeWorkers: 0, activeChats: 0 },
    templateId: null,
    replicatedFromCommanderId: null,
    ...overrides,
  }
}

async function renderChannelsCard(commander = createCommander()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ChannelsCard commander={commander} />
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
}

describe('ChannelsCard', () => {
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

  it('labels conversation-derived channel counts as channels', async () => {
    await renderChannelsCard()

    expect(document.body.textContent).toContain('3 channels')
    expect(document.body.textContent).not.toContain('bindings')
  })
})
