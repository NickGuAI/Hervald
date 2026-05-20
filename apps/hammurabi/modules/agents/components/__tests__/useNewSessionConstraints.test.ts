import { describe, expect, it } from 'vitest'
import {
  getFallbackAgent,
  getForcedTransportType,
  getNormalizedAdaptiveThinking,
  getNormalizedEffort,
  getNormalizedMaxThinkingTokens,
} from '../new-session-form/useNewSessionConstraints'

const providers = [
  {
    id: 'claude',
    label: 'Claude',
    eventProvider: 'claude',
    uiCapabilities: {
      supportsEffort: true,
      supportsAdaptiveThinking: true,
      supportsMaxThinkingTokens: true,
      supportsSkills: true,
      supportsLoginMode: true,
      permissionModes: [{ value: 'default', label: 'default', description: 'claude' }],
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    eventProvider: 'codex',
    uiCapabilities: {
      supportsEffort: false,
      supportsAdaptiveThinking: false,
      supportsMaxThinkingTokens: false,
      supportsSkills: false,
      supportsLoginMode: true,
      permissionModes: [{ value: 'default', label: 'default', description: 'codex' }],
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    eventProvider: 'gemini',
    uiCapabilities: {
      supportsEffort: false,
      supportsAdaptiveThinking: false,
      supportsMaxThinkingTokens: false,
      supportsSkills: false,
      supportsLoginMode: false,
      forcedTransport: 'stream' as const,
      permissionModes: [{ value: 'default', label: 'default', description: 'gemini' }],
    },
  },
]

describe('useNewSessionConstraints helpers', () => {
  it('falls back to the first allowed agent when the current selection is invalid', () => {
    expect(getFallbackAgent(providers, 'invalid' as unknown as 'claude')).toBe('claude')
    expect(getFallbackAgent(providers, 'codex')).toBeNull()
  })

  it('normalizes gemini-linked fields without forcing codex default mode', () => {
    expect(getForcedTransportType(providers, 'gemini', 'pty')).toBe('stream')
    expect(getForcedTransportType(providers, 'claude', 'pty')).toBeNull()

    expect(getNormalizedEffort(providers, 'gemini', 'medium')).toBe('high')
    expect(getNormalizedEffort(providers, 'claude', 'high')).toBeNull()

    expect(getNormalizedAdaptiveThinking(providers, 'codex', 'enabled')).toBe('disabled')
    expect(getNormalizedAdaptiveThinking(providers, 'claude', 'disabled')).toBeNull()

    expect(getNormalizedMaxThinkingTokens(providers, 'codex', 64000)).toBe(128000)
    expect(getNormalizedMaxThinkingTokens(providers, 'claude', 64000)).toBeNull()
  })
})
