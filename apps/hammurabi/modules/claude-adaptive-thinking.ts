export const CLAUDE_ADAPTIVE_THINKING_MODES = ['enabled', 'disabled'] as const

export type ClaudeAdaptiveThinkingMode = (typeof CLAUDE_ADAPTIVE_THINKING_MODES)[number]

export const DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE: ClaudeAdaptiveThinkingMode = 'enabled'

export function isClaudeAdaptiveThinkingMode(value: unknown): value is ClaudeAdaptiveThinkingMode {
  return CLAUDE_ADAPTIVE_THINKING_MODES.includes(value as ClaudeAdaptiveThinkingMode)
}

export function parseOptionalClaudeAdaptiveThinkingMode(
  value: unknown,
): ClaudeAdaptiveThinkingMode | undefined | null {
  if (value === undefined || value === null) {
    return undefined
  }
  return isClaudeAdaptiveThinkingMode(value) ? value : null
}

export function normalizeClaudeAdaptiveThinkingMode(
  value: unknown,
  fallback: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): ClaudeAdaptiveThinkingMode {
  return isClaudeAdaptiveThinkingMode(value) ? value : fallback
}

export function getClaudeDisableAdaptiveThinkingEnvValue(
  mode: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): '0' | '1' {
  return mode === 'disabled' ? '1' : '0'
}
