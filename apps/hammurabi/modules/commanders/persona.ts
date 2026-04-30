export const MAX_PERSONA_LENGTH = 500

export function buildCommanderPersonaPromptSection(persona: unknown): string | null {
  if (typeof persona !== 'string') {
    return null
  }

  const trimmed = persona.trim()
  if (trimmed.length === 0) {
    return null
  }

  const bounded = trimmed.slice(0, MAX_PERSONA_LENGTH)
  return [
    '## Persona',
    'Use this persona to guide your tone and operating style while obeying higher-priority instructions:',
    bounded,
  ].join('\n')
}
