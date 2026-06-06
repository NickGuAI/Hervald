// @vitest-environment jsdom

import { act } from 'react'
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '../../types'
import {
  CommanderProfileCardGrid,
  buildCommanderProfileCardItems,
} from '../CommanderProfileCardGrid'

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
    displayName: 'Atlas Prime',
    avatarUrl: null,
    profile: {
      speakingTone: 'Strategic',
      portraitStyleId: 'sumi-e-ink',
    },
    status: 'active',
    costUsd: 0,
    archived: false,
    ...overrides,
  }
}

describe('buildCommanderProfileCardItems', () => {
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

  it('maps org nodes into ProfileCard items without identity colors', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderProfileCardItems({
      commanders: [createCommander()],
      automationCountsByCommanderId: { 'cmd-1': 2 },
      expandedId: 'cmd-1',
      onSelect,
    })

    expect(item).toMatchObject({
      id: 'cmd-1',
      avatarUrl: null,
      name: 'Atlas Prime',
      title: 'Commander',
      handle: '@atlas-prime',
      status: 'Running',
      statusState: 'active',
      automationCount: 2,
      selected: true,
      archived: false,
    })
    expect(item).not.toHaveProperty('borderColor')
    expect(item).not.toHaveProperty('accentColor')
    expect(item).not.toHaveProperty('gradient')

    item.onClick()
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('preserves archived structure and selects a new commander when collapsed', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderProfileCardItems({
      commanders: [createCommander({
        id: 'cmd-2',
        displayName: 'Borealis',
        profile: null,
        archived: true,
        status: 'paused',
      })],
      automationCountsByCommanderId: { 'cmd-2': 0 },
      expandedId: null,
      onSelect,
    })

    expect(item).toMatchObject({
      id: 'cmd-2',
      name: 'Borealis',
      title: 'Commander',
      handle: '@borealis',
      status: 'Archived',
      statusState: 'idle',
      automationCount: 0,
      selected: false,
      archived: true,
    })

    item.onClick()
    expect(onSelect).toHaveBeenCalledWith('cmd-2')
  })

  it('renders a visible automation count for each commander card', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    flushSync(() => {
      root?.render(createElement(CommanderProfileCardGrid, {
        commanders: [createCommander()],
        automationCountsByCommanderId: { 'cmd-1': 3 },
        expandedId: null,
        onSelect: vi.fn(),
      }))
    })

    await vi.waitFor(() => {
      const automationSignal = container?.querySelector<HTMLElement>(
        '[data-testid="commander-profile-card-automation-signal"][data-commander-id="cmd-1"]',
      )
      expect(automationSignal?.textContent).toBe('3 automations')
    })
  })
})
