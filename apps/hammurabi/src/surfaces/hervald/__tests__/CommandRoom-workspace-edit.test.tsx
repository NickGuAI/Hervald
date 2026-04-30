// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { resolveWorkspaceSource } from '../CommandRoom'

describe('resolveWorkspaceSource', () => {
  it('returns a writable commander workspace source', () => {
    expect(resolveWorkspaceSource({
      selectedCommanderId: 'cmd-1',
    })).toEqual({
      kind: 'commander',
      commanderId: 'cmd-1',
      readOnly: false,
    })
  })

  it('keeps agent-session workspace sources read-only', () => {
    expect(resolveWorkspaceSource({
      activeSessionName: 'worker-1',
      selectedCommanderId: 'cmd-1',
    })).toEqual({
      kind: 'agent-session',
      sessionName: 'worker-1',
      readOnly: true,
    })
  })
})
