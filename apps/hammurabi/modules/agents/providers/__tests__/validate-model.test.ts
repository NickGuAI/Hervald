import { describe, expect, it } from 'vitest'
import { getProvider } from '../registry.js'
import { validateModelForAgentType } from '../validate-model.js'

describe('validateModelForAgentType', () => {
  it('accepts empty model selections', () => {
    expect(validateModelForAgentType('claude', null)).toEqual({ ok: true })
    expect(validateModelForAgentType('claude', '')).toEqual({ ok: true })
    expect(validateModelForAgentType('claude', '   ')).toEqual({ ok: true })
  })

  it('accepts provider-local model ids', () => {
    expect(validateModelForAgentType('codex', 'gpt-5.4')).toEqual({ ok: true })
  })

  it('marks gpt-5.5 as the Codex default model', () => {
    const defaultCodexModels = getProvider('codex')?.availableModels
      .filter((option) => option.default)
      .map((option) => option.id)

    expect(defaultCodexModels).toEqual(['gpt-5.5'])
  })

  it('publishes current Claude Fable and Opus model ids', () => {
    const claudeModelIds = getProvider('claude')?.availableModels.map((option) => option.id)

    expect(claudeModelIds).toEqual(expect.arrayContaining([
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ]))
    expect(validateModelForAgentType('claude', 'claude-fable-5')).toEqual({ ok: true })
    expect(validateModelForAgentType('claude', 'claude-opus-4-8')).toEqual({ ok: true })
  })

  it('rejects cross-provider model ids and returns validIds', () => {
    expect(validateModelForAgentType('codex', 'claude-opus-4-6')).toEqual({
      ok: false,
      error: 'Model "claude-opus-4-6" is not valid for provider "codex"',
      validIds: [
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
      ],
    })
  })
})
