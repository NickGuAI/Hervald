import { describe, expect, it } from 'vitest'
import { parseCodexApprovalId } from '../routes'

describe('parseCodexApprovalId', () => {
  it('accepts a fresh-sidecar requestId of 0', () => {
    const parsed = parseCodexApprovalId('codex:session-x:0')
    expect(parsed).toEqual({ sessionName: 'session-x', requestId: 0 })
  })

  it('accepts positive requestIds', () => {
    const parsed = parseCodexApprovalId('codex:commander-atlas:17')
    expect(parsed).toEqual({ sessionName: 'commander-atlas', requestId: 17 })
  })

  it('rejects negative requestIds', () => {
    expect(parseCodexApprovalId('codex:session-x:-1')).toBeNull()
  })

  it('rejects ids with the wrong prefix', () => {
    expect(parseCodexApprovalId('claude:session-x:0')).toBeNull()
  })

  it('rejects ids with a malformed session name', () => {
    expect(parseCodexApprovalId('codex:not valid:0')).toBeNull()
  })

  it('rejects ids with an extra segment', () => {
    expect(parseCodexApprovalId('codex:session-x:0:extra')).toBeNull()
  })

  it('rejects ids with a non-numeric requestId', () => {
    expect(parseCodexApprovalId('codex:session-x:abc')).toBeNull()
  })

  it('rejects ids with a numeric-prefixed but non-numeric requestId', () => {
    expect(parseCodexApprovalId('codex:session-x:0abc')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x:12x')).toBeNull()
  })

  it('rejects ids with whitespace in the requestId', () => {
    expect(parseCodexApprovalId('codex:session-x: 1')).toBeNull()
  })
})
