import { describe, expect, it } from 'vitest'
import {
  buildVoiceTranscriptionContext,
  DEFAULT_TRANSCRIPTION_MODEL,
  MAX_TRANSCRIPTION_PROMPT_LENGTH,
  normalizeTranscriptionTerms,
} from '../transcription-context'

describe('voice transcription context', () => {
  it('normalizes defaults and merges configured terms without duplicates', () => {
    const terms = normalizeTranscriptionTerms([
      ' Hammurabi ',
      'Gehirn',
      'Claude Code',
      'OpenCode',
      'PMAI',
      'Kubernetes',
      'gRPC',
      'gRPC-style',
      'kubernetes',
    ])

    expect(terms).toEqual([
      'Hammurabi',
      'Gehirn',
      'Claude Code',
      'OpenCode',
      'PMAI',
      'Kubernetes',
      'gRPC',
      'gRPC-style',
      'Auth0',
      'Supabase',
      'OpenAI',
      'Codex',
    ])
  })

  it('builds a VoiceFlow-style prompt with instructions, examples, and preserved terms', () => {
    const context = buildVoiceTranscriptionContext({
      model: ' gpt-4o-mini-transcribe ',
      language: 'xx-invalid',
      prompt: 'Preserve issue numbers and all-caps acronyms.',
      terms: ['PMAI', 'Kubernetes', 'gRPC-style'],
    })

    expect(context.model).toBe('gpt-4o-mini-transcribe')
    expect(context.language).toBe('en')
    expect(context.terms).toContain('Hammurabi')
    expect(context.terms).toContain('gRPC-style')
    expect(context.prompt).toContain('Preserve proper nouns')
    expect(context.prompt).toContain('Operator context: Preserve issue numbers')
    expect(context.prompt).toContain('Preserve these terms verbatim')
    expect(context.prompt).toContain('gRPC-style Kubernetes issue')

    const defaultContext = buildVoiceTranscriptionContext()
    expect(defaultContext.model).toBe(DEFAULT_TRANSCRIPTION_MODEL)
  })

  it('caps generated prompts at the provider transcription prompt limit', () => {
    const context = buildVoiceTranscriptionContext({
      prompt: 'Preserve every issue title, commander note, and operator correction. '.repeat(20),
      terms: Array.from({ length: 200 }, (_value, index) => `term-${index.toString().padStart(3, '0')}`),
    })

    expect(context.prompt.length).toBeLessThanOrEqual(MAX_TRANSCRIPTION_PROMPT_LENGTH)
    expect(context.prompt).toContain('Transcribe the speaker for Hammurabi')
    expect(context.prompt).toContain('Operator context:')
    expect(context.prompt).toContain('Preserve these terms verbatim')
    expect(context.prompt).toContain('Hammurabi')
    expect(context.prompt).toContain('term-000')
  })
})
