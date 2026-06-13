import { describe, expect, it } from 'vitest'
import {
  createApprovalBridgeToken,
  verifyApprovalBridgeToken,
} from '../approval-bridge-token'

describe('approval bridge token', () => {
  it('round-trips a session-scoped expiring token', () => {
    const token = createApprovalBridgeToken({
      internalToken: 'server-internal-secret',
      sessionName: 'stream-worker-01',
      ttlMs: 60_000,
      now: 1_000,
    })

    expect(verifyApprovalBridgeToken(token, {
      internalToken: 'server-internal-secret',
      now: 30_000,
    })).toEqual({
      ok: true,
      sessionName: 'stream-worker-01',
      expiresAtMs: 61_000,
    })
  })

  it('rejects expired and tampered tokens', () => {
    const token = createApprovalBridgeToken({
      internalToken: 'server-internal-secret',
      sessionName: 'stream-worker-01',
      ttlMs: 60_000,
      now: 1_000,
    })

    expect(verifyApprovalBridgeToken(token, {
      internalToken: 'server-internal-secret',
      now: 61_001,
    })).toEqual({ ok: false, reason: 'expired' })

    expect(verifyApprovalBridgeToken(`${token}x`, {
      internalToken: 'server-internal-secret',
      now: 30_000,
    })).toEqual({ ok: false, reason: 'invalid' })
  })
})
