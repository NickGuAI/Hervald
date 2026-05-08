import { describe, expect, it, vi } from 'vitest'
import type { OrgNode } from '../../types'
import { buildCommanderChromaItems } from '../CommanderTileGrid'

function createCommander(overrides: Partial<OrgNode> = {}): OrgNode {
  return {
    id: 'cmd-1',
    kind: 'commander',
    parentId: 'founder-1',
    displayName: 'Atlas Prime',
    avatarUrl: null,
    profile: {
      borderColor: '#1c1c1c',
      accentColor: '#c23b22',
    },
    status: 'active',
    costUsd: 0,
    archived: false,
    ...overrides,
  }
}

describe('buildCommanderChromaItems', () => {
  it('maps org nodes into ChromaGrid items without the legacy card shell classes', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderChromaItems({
      commanders: [createCommander()],
      expandedId: 'cmd-1',
      onSelect,
      theme: 'dark',
    })

    expect(item).toMatchObject({
      id: 'cmd-1',
      title: 'Atlas Prime',
      subtitle: 'Commander',
      handle: '@atlas-prime',
      location: 'Running',
      borderColor: '#1c1c1c',
      gradient: 'linear-gradient(165deg,#c23b22,#000)',
    })
    expect(item.image).toMatch(/^data:image\/svg\+xml/)

    const cardProps = item.cardProps as Record<string, unknown> | undefined
    expect(cardProps).toMatchObject({
      'aria-pressed': true,
      'data-testid': 'commander-tile',
      'data-commander-card': 'cmd-1',
    })
    expect(item.cardClassName).not.toContain('bg-washi-white')
    expect(item.cardClassName).not.toContain('card-sumi')

    item.onClick?.()
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('preserves archived opacity and selects a new commander when the tile is not expanded', () => {
    const onSelect = vi.fn()
    const [item] = buildCommanderChromaItems({
      commanders: [createCommander({
        id: 'cmd-2',
        displayName: 'Borealis',
        profile: null,
        archived: true,
        status: 'paused',
      })],
      expandedId: null,
      onSelect,
      theme: 'light',
    })

    expect(item.subtitle).toBe('Commander')
    expect(item.location).toBe('Archived')
    expect(item.cardClassName).toContain('opacity-60')
    expect(item.gradient).toBeUndefined()

    item.onClick?.()
    expect(onSelect).toHaveBeenCalledWith('cmd-2')
  })
})
