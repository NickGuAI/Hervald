// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSource } from '../../../src/surfaces/hervald/CommandRoom'

describe('resolveWorkspaceSource', () => {
  it('builds a commander workspace source when a commander is selected', () => {
    expect(resolveWorkspaceSource({
      activeSessionName: null,
      selectedCommanderId: 'cmdr-7',
    })).toEqual({
      kind: 'commander',
      commanderId: 'cmdr-7',
      readOnly: false,
    })
  })

  it('builds an agent-session workspace source when a worker session is selected', () => {
    expect(resolveWorkspaceSource({
      activeSessionName: 'worker-session-42',
      selectedCommanderId: 'cmdr-7',
    })).toEqual({
      kind: 'agent-session',
      sessionName: 'worker-session-42',
      readOnly: true,
    })
  })

  it('returns null when nothing is selected', () => {
    expect(resolveWorkspaceSource({
      activeSessionName: null,
      selectedCommanderId: null,
    })).toBeNull()
  })

  it('returns null for the Global pseudo-commander scope', () => {
    expect(resolveWorkspaceSource({
      activeSessionName: null,
      selectedCommanderId: '__global__',
    })).toBeNull()
  })
})
