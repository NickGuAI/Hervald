import { describe, expect, it } from 'vitest'
import {
  getActiveStandingApprovalEmails,
  normalizeStandingApprovalEntries,
  reconcileStandingApprovalEntries,
} from '../email-standing-approval'

describe('email standing approval helpers', () => {
  it('normalizes legacy entries into structured schema with default expiry', () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    const [entry] = normalizeStandingApprovalEntries(
      ['ally@example.com'],
      {
        now,
        default_added_at: '2026-04-10T00:00:00.000Z',
        default_added_by: 'tester@example.com',
        default_reason: 'Migrated from legacy allowlist.',
      },
    )

    expect(entry).toEqual({
      email: 'ally@example.com',
      added_at: '2026-04-10T00:00:00.000Z',
      added_by: 'tester@example.com',
      reason: 'Migrated from legacy allowlist.',
      expires_at: '2026-05-10T00:00:00.000Z',
    })
  })

  it('filters expired entries from the active allowlist while keeping permanent entries', () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    const entries = normalizeStandingApprovalEntries(
      [
        {
          email: 'temporary@example.com',
          added_at: '2026-03-01T00:00:00.000Z',
          added_by: 'tester@example.com',
          reason: 'Temporary approval.',
          expires_at: '2026-03-31T00:00:00.000Z',
        },
        {
          email: 'nickgu@pioneeringminds.ai',
          added_at: '2026-03-01T00:00:00.000Z',
          added_by: 'tester@example.com',
          reason: 'Permanent standing approval: work inbox.',
          permanent: true,
        },
      ],
      { now },
    )

    expect(getActiveStandingApprovalEmails(entries, now)).toEqual([
      'nickgu@pioneeringminds.ai',
    ])
  })

  it('refreshes an expired entry when it is re-added', () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    const reconciled = reconcileStandingApprovalEntries({
      existing: [
        {
          email: 'outside@example.com',
          added_at: '2026-03-01T00:00:00.000Z',
          added_by: 'tester@example.com',
          reason: 'Temporary approval.',
          expires_at: '2026-03-31T00:00:00.000Z',
        },
      ],
      nextEmails: ['outside@example.com'],
      now,
      added_by: 'reviewer@example.com',
      reason: 'Re-approved after expiry.',
    })

    expect(reconciled).toEqual([
      {
        email: 'outside@example.com',
        added_at: '2026-04-20T12:00:00.000Z',
        added_by: 'reviewer@example.com',
        reason: 'Re-approved after expiry.',
        expires_at: '2026-05-20T12:00:00.000Z',
      },
    ])
  })
})
