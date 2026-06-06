export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'en'
export const MAX_TRANSCRIPTION_PROMPT_LENGTH = 1024
const MAX_OPERATOR_CONTEXT_LENGTH = 320
const PROMPT_SECTION_SEPARATOR = '\n\n'

export const DEFAULT_TRANSCRIPTION_TERMS = [
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
] as const

export interface VoiceTranscriptionContextInput {
  model?: string
  language?: string
  prompt?: string
  terms?: readonly string[]
}

export interface VoiceTranscriptionContext {
  model: string
  language: string
  prompt: string
  terms: string[]
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isLikelyLanguageCode(value: string): boolean {
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)
}

function truncatePromptText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength)
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function getAvailableSectionLength(sections: readonly string[]): number {
  const separatorLength = sections.length > 0 ? PROMPT_SECTION_SEPARATOR.length : 0
  return MAX_TRANSCRIPTION_PROMPT_LENGTH - sections.join(PROMPT_SECTION_SEPARATOR).length - separatorLength
}

function appendPromptSection(sections: string[], section: string): void {
  const availableLength = getAvailableSectionLength(sections)
  if (availableLength <= 0) {
    return
  }
  sections.push(truncatePromptText(section, availableLength))
}

function buildTermsPromptSection(terms: readonly string[], maxLength: number): string | null {
  const prefix = 'Preserve these terms verbatim when heard: '
  const suffix = '.'
  const outputTerms: string[] = []

  for (const term of terms) {
    const candidateTerms = [...outputTerms, term]
    const candidate = `${prefix}${candidateTerms.join(', ')}${suffix}`
    if (candidate.length > maxLength) {
      continue
    }
    outputTerms.push(term)
  }

  if (outputTerms.length === 0 || `${prefix}${outputTerms.join(', ')}${suffix}`.length > maxLength) {
    return null
  }

  return `${prefix}${outputTerms.join(', ')}${suffix}`
}

export function normalizeTranscriptionTerms(
  terms: readonly string[] = [],
  defaults: readonly string[] = DEFAULT_TRANSCRIPTION_TERMS,
): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const term of [...defaults, ...terms]) {
    const normalized = asNonEmptyString(term)
    if (!normalized) {
      continue
    }
    const key = normalized.toLocaleLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push(normalized)
  }

  return output
}

export function buildVoiceTranscriptionPrompt(input: {
  prompt?: string
  terms?: readonly string[]
} = {}): string {
  const customPrompt = asNonEmptyString(input.prompt)
  const terms = normalizeTranscriptionTerms(input.terms)
  const sections = [[
    'Transcribe the speaker for Hammurabi agent command input.',
    'Preserve proper nouns, product names, acronyms, and technical vocabulary exactly as spoken.',
    'Apply light polish only: punctuation, capitalization, and obvious filler cleanup.',
    'Do not add facts, explanations, labels, or extra words.',
  ].join(' ')]

  if (customPrompt) {
    appendPromptSection(
      sections,
      `Operator context: ${truncatePromptText(customPrompt, MAX_OPERATOR_CONTEXT_LENGTH)}`,
    )
  }

  if (terms.length > 0) {
    const termsSection = buildTermsPromptSection(terms, getAvailableSectionLength(sections))
    if (termsSection) {
      sections.push(termsSection)
    }
  }

  appendPromptSection(sections, [
    'Examples:',
    'If the speaker says "Claude Code in Hammurabi", output "Claude Code in Hammurabi".',
    'If the speaker says "gRPC-style Kubernetes issue", output "gRPC-style Kubernetes issue".',
  ].join(' '))

  return sections.join(PROMPT_SECTION_SEPARATOR)
}

export function buildVoiceTranscriptionContext(
  input: VoiceTranscriptionContextInput = {},
): VoiceTranscriptionContext {
  const model = asNonEmptyString(input.model) ?? DEFAULT_TRANSCRIPTION_MODEL
  const rawLanguage = asNonEmptyString(input.language) ?? DEFAULT_TRANSCRIPTION_LANGUAGE
  const language = isLikelyLanguageCode(rawLanguage) ? rawLanguage : DEFAULT_TRANSCRIPTION_LANGUAGE
  const terms = normalizeTranscriptionTerms(input.terms)

  return {
    model,
    language,
    terms,
    prompt: buildVoiceTranscriptionPrompt({
      prompt: input.prompt,
      terms,
    }),
  }
}
