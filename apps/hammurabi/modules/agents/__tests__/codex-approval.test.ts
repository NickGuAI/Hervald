import { describe, expect, it } from 'vitest'

import {
  getCodexApprovalActionId,
  getCodexApprovalActionLabel,
  parseCodexApprovalId,
  serializeCodexApprovalId,
} from '../codex-approval'

describe('serializeCodexApprovalId + parseCodexApprovalId round-trip', () => {
  it('serialize + parse recovers the original (sessionName, requestId)', () => {
    for (const sessionName of ['session-alpha', 'commander-123', 'factory-abc']) {
      for (const requestId of [0, 1, 42, 12345]) {
        const id = serializeCodexApprovalId(sessionName, requestId)
        const parsed = parseCodexApprovalId(id)
        expect(parsed).toEqual({ sessionName, requestId })
      }
    }
  })
})

describe('parseCodexApprovalId rejection cases', () => {
  it('rejects a non-codex prefix', () => {
    expect(parseCodexApprovalId('claude:session-x:1')).toBeNull()
    expect(parseCodexApprovalId('session-x:1')).toBeNull()
    expect(parseCodexApprovalId('')).toBeNull()
  })

  it('rejects wrong part counts', () => {
    expect(parseCodexApprovalId('codex:session-x')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x:1:extra')).toBeNull()
    expect(parseCodexApprovalId('codex::1')).toBeNull()
  })

  it('rejects non-numeric requestId (protects against injection via the id slot)', () => {
    expect(parseCodexApprovalId('codex:session-x:abc')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x:1.5')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x:-1')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x: 1')).toBeNull()
    expect(parseCodexApprovalId('codex:session-x:0x10')).toBeNull()
  })

  it('rejects invalid sessionName shapes', () => {
    // SESSION_NAME_PATTERN disallows colons, slashes, spaces, etc.
    expect(parseCodexApprovalId('codex:bad/name:1')).toBeNull()
    expect(parseCodexApprovalId('codex:has space:1')).toBeNull()
  })

  it('accepts a requestId of 0 (first approval from a fresh sidecar)', () => {
    expect(parseCodexApprovalId('codex:session-x:0')).toEqual({
      sessionName: 'session-x',
      requestId: 0,
    })
  })
})

describe('getCodexApprovalActionId', () => {
  it('returns the stable command-execution id', () => {
    expect(getCodexApprovalActionId('item/commandExecution/requestApproval')).toBe(
      'codex-command-execution',
    )
  })

  it('returns the stable file-change id for any other method', () => {
    expect(getCodexApprovalActionId('item/fileChange/requestApproval')).toBe(
      'codex-file-change',
    )
  })
})

describe('getCodexApprovalActionLabel', () => {
  it('labels command-execution as "Command Execution"', () => {
    expect(getCodexApprovalActionLabel('item/commandExecution/requestApproval')).toBe(
      'Command Execution',
    )
  })

  it('labels file-change as "File Change"', () => {
    expect(getCodexApprovalActionLabel('item/fileChange/requestApproval')).toBe(
      'File Change',
    )
  })
})

describe('action-id ↔ action-label pairing (guard against drift)', () => {
  it('both helpers classify each method consistently', () => {
    // If a new CodexApprovalMethod variant is added, both switches above
    // must be extended together. This pairing test catches single-sided
    // updates at review time rather than at runtime.
    const methods = [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
    ] as const

    const byId = new Map<string, string>()
    for (const m of methods) {
      const id = getCodexApprovalActionId(m)
      const label = getCodexApprovalActionLabel(m)
      expect(id).toBeTruthy()
      expect(label).toBeTruthy()
      expect(byId.get(id)).toBeUndefined() // no two methods share an id
      byId.set(id, label)
    }
    expect(byId.size).toBe(methods.length)
  })
})
