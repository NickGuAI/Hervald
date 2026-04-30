import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSION_TAB, filterSessionsByTab } from '../session-tab'

type SessionFixture = {
  name: string
  sessionType?: 'commander' | 'worker' | 'cron' | 'sentinel'
}

const FIXTURES: SessionFixture[] = [
  { name: 'commander-alpha', sessionType: 'commander' },
  { name: 'worker-1710000000000' },
  { name: 'command-room-gamma', sessionType: 'cron' },
  { name: 'sentinel-delta', sessionType: 'sentinel' },
  { name: 'session-plain' },
  { name: 'commander' },
]

describe('session tab helpers', () => {
  it('uses commander as the default tab', () => {
    expect(DEFAULT_SESSION_TAB).toBe('commander')
  })

  it('commander filter returns only commander sessions', () => {
    expect(filterSessionsByTab(FIXTURES, 'commander').map((s) => s.name)).toEqual([
      'commander-alpha',
    ])
  })

  it('worker filter excludes non-worker categories and keeps worker sessions', () => {
    expect(filterSessionsByTab(FIXTURES, 'worker').map((s) => s.name)).toEqual([
      'worker-1710000000000',
      'session-plain',
      'commander',
    ])
  })

  it('other filter includes cron and sentinel categories', () => {
    expect(filterSessionsByTab(FIXTURES, 'other').map((s) => s.name)).toEqual([
      'command-room-gamma',
      'sentinel-delta',
    ])
  })

  it('all filter returns all sessions', () => {
    expect(filterSessionsByTab(FIXTURES, 'all')).toEqual(FIXTURES)
  })
})
