// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { resolveWorkspaceSource } from '../../CommandRoom'

describe('resolveWorkspaceSource', () => {
  it('returns a target workspace source', () => {
    expect(resolveWorkspaceSource({
      targetId: 'wt-1',
      label: 'Project',
      readOnly: false,
    })).toEqual({
      kind: 'target',
      targetId: 'wt-1',
      label: 'Project',
      readOnly: false,
    })
  })

  it('returns null before a target is opened', () => {
    expect(resolveWorkspaceSource({
      targetId: null,
    })).toBeNull()
  })
})
