import type { ClaudeAdaptiveThinkingMode } from '../modules/claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../modules/claude-effort.js'
import {
  isClaudeAdaptiveThinkingMode,
} from '../modules/claude-adaptive-thinking.js'
import {
  isClaudeEffortLevel,
} from '../modules/claude-effort.js'
import {
  getProvider,
  listProviders,
  parseProviderId,
} from '../modules/agents/providers/registry.js'
import type { ProviderSessionContext } from '../modules/agents/providers/provider-session-context.js'

const LEGACY_PROVIDER_CONTEXT_KEYS = [
  'claudeSessionId',
  'codexThreadId',
  'geminiSessionId',
] as const

export type ProviderContext = ProviderSessionContext

type ProviderContextParseOptions = {
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
}

type ProviderContextMigrationInput = {
  providerContext?: ProviderContext
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  [k: string]: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readClaudeEffort(
  value: unknown,
  fallback?: ClaudeEffortLevel,
): ClaudeEffortLevel | undefined {
  if (isClaudeEffortLevel(value)) {
    return value
  }
  return fallback
}

function readClaudeAdaptiveThinking(
  value: unknown,
  fallback?: ClaudeAdaptiveThinkingMode,
): ClaudeAdaptiveThinkingMode | undefined {
  if (isClaudeAdaptiveThinkingMode(value)) {
    return value
  }
  return fallback
}

function sanitizeSerializableValue(value: unknown): unknown | undefined {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return asOptionalString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    const next = value
      .map((entry) => sanitizeSerializableValue(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    return next.length > 0 ? next : undefined
  }

  if (!isPlainObject(value)) {
    return undefined
  }

  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeSerializableValue(entry)
    if (sanitized !== undefined) {
      next[key] = sanitized
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function buildCanonicalProviderContext(
  providerId: string,
  raw: Record<string, unknown>,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  const provider = getProvider(providerId)
  if (!provider) {
    return null
  }

  const next: Record<string, unknown> = { providerId }
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'providerId' || key === 'effort' || key === 'adaptiveThinking') {
      continue
    }
    const sanitized = sanitizeSerializableValue(value)
    if (sanitized !== undefined) {
      next[key] = sanitized
    }
  }

  if (provider.uiCapabilities.supportsEffort) {
    const effort = readClaudeEffort(raw.effort, options.effort)
    if (effort) {
      next.effort = effort
    }
  }

  if (provider.uiCapabilities.supportsAdaptiveThinking) {
    const adaptiveThinking = readClaudeAdaptiveThinking(
      raw.adaptiveThinking,
      options.adaptiveThinking,
    )
    if (adaptiveThinking) {
      next.adaptiveThinking = adaptiveThinking
    }
  }

  return next as unknown as ProviderContext
}

function migrateLegacyProviderContext(
  input: ProviderContextMigrationInput,
): ProviderContext | null {
  for (const provider of listProviders()) {
    const migrated = provider.migrateLegacyContext?.(input)
    if (!migrated) {
      continue
    }

    return sanitizeProviderContextForPersistence(migrated, {
      effort: input.effort,
      adaptiveThinking: input.adaptiveThinking,
    }) ?? migrated
  }

  return null
}

export function sanitizeProviderContextForPersistence(
  providerContext: ProviderContext | null | undefined,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  if (!isObject(providerContext)) {
    return null
  }

  const providerId = parseProviderId(providerContext.providerId)
  if (!providerId) {
    return null
  }

  return buildCanonicalProviderContext(providerId, providerContext, options)
}

export function parseCanonicalProviderContext(
  value: unknown,
  options: ProviderContextParseOptions = {},
): ProviderContext | null {
  if (!isObject(value)) {
    return null
  }

  const providerId = parseProviderId(value.providerId)
  if (!providerId) {
    return null
  }

  return buildCanonicalProviderContext(providerId, value, options)
}

export function hasLegacyProviderContextFields(
  input: Record<string, unknown>,
): boolean {
  return LEGACY_PROVIDER_CONTEXT_KEYS.some((key) => input[key] !== undefined)
}

export function migrateProviderContext(
  input: ProviderContextMigrationInput,
): {
  providerContext: ProviderContext | null
  cleaned: Record<string, unknown>
} {
  const cleaned: Record<string, unknown> = { ...input }
  for (const key of LEGACY_PROVIDER_CONTEXT_KEYS) {
    delete cleaned[key]
  }

  const providerContext = parseCanonicalProviderContext(input.providerContext, {
    effort: input.effort,
    adaptiveThinking: input.adaptiveThinking,
  }) ?? migrateLegacyProviderContext(input)

  if (providerContext) {
    cleaned.providerContext = providerContext
  } else {
    delete cleaned.providerContext
  }

  return { providerContext, cleaned }
}

export function migratedProviderContextChanged(
  input: Record<string, unknown>,
  cleaned: Record<string, unknown>,
): boolean {
  return JSON.stringify(input) !== JSON.stringify(cleaned)
}
