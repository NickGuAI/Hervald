import { describe, expect, it } from 'vitest'
import {
  isOwnedByCommander,
  normalizeSessionCreator,
  normalizeSessionType,
} from '../session-contract.js'

describe('session creator contract helpers', () => {
  it('normalizes valid session creators and trims ids', () => {
    expect(normalizeSessionCreator({ kind: 'commander', id: '  cmdr-athena  ' })).toEqual({
      kind: 'commander',
      id: 'cmdr-athena',
    })
    expect(normalizeSessionCreator({ kind: 'human' })).toEqual({ kind: 'human' })
  })

  it('rejects malformed creators and normalizes supported session types', () => {
    expect(normalizeSessionCreator(null)).toBeNull()
    expect(normalizeSessionCreator({ kind: 'robot' })).toBeNull()
    expect(normalizeSessionCreator({ kind: 'commander', id: '   ' })).toEqual({
      kind: 'commander',
    })
    expect(normalizeSessionType('worker')).toBe('worker')
    expect(normalizeSessionType('invalid')).toBeNull()
  })

  it('checks commander ownership from creator only', () => {
    expect(isOwnedByCommander({
      creator: { kind: 'commander', id: 'cmdr-athena' },
    }, 'cmdr-athena')).toBe(true)

    expect(isOwnedByCommander({
      creator: { kind: 'human', id: 'api-key' },
    }, 'cmdr-athena')).toBe(false)
  })
})
