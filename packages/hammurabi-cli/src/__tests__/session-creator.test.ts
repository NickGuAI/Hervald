import { describe, expect, it } from 'vitest'
import {
  isOwnedByCommander,
  normalizeSessionCreator,
  normalizeSessionType,
} from '../session-contract.js'

describe('session creator contract helpers', () => {
  it('normalizes valid session creators and trims ids', () => {
    expect(normalizeSessionCreator({ kind: 'commander', id: '  cmdr-atlas  ' })).toEqual({
      kind: 'commander',
      id: 'cmdr-atlas',
    })
    expect(normalizeSessionCreator({ kind: 'human' })).toEqual({ kind: 'human' })
  })

  it('rejects malformed creators and normalizes supported session types', () => {
    expect(normalizeSessionCreator(null)).toBeNull()
    expect(normalizeSessionCreator({ kind: 'robot' })).toBeNull()
    expect(normalizeSessionCreator({ kind: 'commander', id: '   ' })).toEqual({
      kind: 'commander',
    })
    expect(normalizeSessionCreator({ kind: 'sentinel', id: ' auto-1 ' })).toEqual({
      kind: 'automation',
      id: 'auto-1',
    })
    expect(normalizeSessionType('worker')).toBe('worker')
    expect(normalizeSessionType('cron')).toBe('automation')
    expect(normalizeSessionType('sentinel')).toBe('automation')
    expect(normalizeSessionType('automation')).toBe('automation')
    expect(normalizeSessionType('invalid')).toBeNull()
  })

  it('checks commander ownership from creator only', () => {
    expect(isOwnedByCommander({
      creator: { kind: 'commander', id: 'cmdr-atlas' },
    }, 'cmdr-atlas')).toBe(true)

    expect(isOwnedByCommander({
      creator: { kind: 'human', id: 'api-key' },
    }, 'cmdr-atlas')).toBe(false)
  })
})
