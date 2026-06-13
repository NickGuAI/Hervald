import { describe, expect, it } from 'vitest'
import { InMemoryTransportAuthTicketStore } from '../transport-tickets'

describe('InMemoryTransportAuthTicketStore', () => {
  it('issues short-lived one-time tickets bound to purpose and subject', () => {
    let now = new Date('2026-06-10T00:00:00.000Z')
    const store = new InMemoryTransportAuthTicketStore({
      ttlMs: 1000,
      now: () => now,
    })

    const issued = store.issue('workspace.raw', { subject: 'wt-1\0README.md' })

    expect(issued.ticket.startsWith('hmrt_')).toBe(true)
    expect(issued.expiresAt).toBe('2026-06-10T00:00:01.000Z')
    expect(store.consume(issued.ticket, 'workspace.raw', { subject: 'wt-1\0other.md' })).toBe(false)
    expect(store.consume(issued.ticket, 'workspace.raw', { subject: 'wt-1\0README.md' })).toBe(false)

    const expiring = store.issue('approvals.pending-stream')
    now = new Date('2026-06-10T00:00:01.000Z')
    expect(store.consume(expiring.ticket, 'approvals.pending-stream')).toBe(false)

    now = new Date('2026-06-10T00:00:01.001Z')
    const usable = store.issue('agents.session-stream')
    expect(store.consume(usable.ticket, 'agents.session-stream')).toBe(true)
    expect(store.consume(usable.ticket, 'agents.session-stream')).toBe(false)
  })
})
