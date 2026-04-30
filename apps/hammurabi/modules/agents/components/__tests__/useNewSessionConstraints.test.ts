import { describe, expect, it } from 'vitest'
import {
  getFallbackAgent,
  getForcedTransportType,
  getNormalizedAdaptiveThinking,
  getNormalizedEffort,
} from '../new-session-form/useNewSessionConstraints'

describe('useNewSessionConstraints helpers', () => {
  it('falls back to the first allowed agent when the current selection is invalid', () => {
    expect(getFallbackAgent(['claude', 'codex'], 'invalid' as unknown as 'claude')).toBe('claude')
    expect(getFallbackAgent(['claude', 'codex'], 'codex')).toBeNull()
  })

  it('normalizes gemini-linked fields without forcing codex default mode', () => {
    expect(getForcedTransportType('gemini', 'pty')).toBe('stream')
    expect(getForcedTransportType('claude', 'pty')).toBeNull()

    expect(getNormalizedEffort('gemini', 'high')).toBe('max')
    expect(getNormalizedEffort('claude', 'high')).toBeNull()

    expect(getNormalizedAdaptiveThinking('codex', 'disabled')).toBe('enabled')
    expect(getNormalizedAdaptiveThinking('claude', 'disabled')).toBeNull()
  })
})
