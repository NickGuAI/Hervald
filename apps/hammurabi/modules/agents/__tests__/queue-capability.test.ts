import { describe, expect, it } from 'vitest'
import { supportsQueuedDrafts } from '../queue-capability'

describe('supportsQueuedDrafts', () => {
  it('allows queued drafts for supported Hammurabi agent sessions', () => {
    expect(supportsQueuedDrafts('claude')).toBe(true)
    expect(supportsQueuedDrafts('codex')).toBe(true)
    expect(supportsQueuedDrafts('gemini')).toBe(true)
    expect(supportsQueuedDrafts()).toBe(true)
  })
})
