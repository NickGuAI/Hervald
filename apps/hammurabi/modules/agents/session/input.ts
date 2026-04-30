import * as path from 'node:path'
import {
  parseOptionalClaudeAdaptiveThinkingMode,
  type ClaudeAdaptiveThinkingMode,
} from '../../claude-adaptive-thinking.js'
import {
  parseOptionalClaudeEffort,
  type ClaudeEffortLevel,
} from '../../claude-effort.js'
import {
  DEFAULT_AUTO_ROTATE_ENTRY_THRESHOLD,
  DEFAULT_CODEX_TURN_WATCHDOG_TIMEOUT_MS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_TASK_DELAY_MS,
  DEFAULT_WS_KEEPALIVE_INTERVAL_MS,
  SESSION_NAME_PATTERN,
} from '../constants.js'
import type {
  ActiveSkillInvocation,
  AgentType,
  ClaudePermissionMode,
  CodexApprovalDecision,
  SessionCreator,
  SessionType,
  SessionTransportType,
} from '../types.js'

export function parseAgentType(raw: unknown): AgentType {
  if (raw === 'codex') return 'codex'
  if (raw === 'gemini') return 'gemini'
  return 'claude'
}

export function parseSessionName(rawSessionName: unknown): string | null {
  if (typeof rawSessionName !== 'string') {
    return null
  }

  const sessionName = rawSessionName.trim()
  if (!SESSION_NAME_PATTERN.test(sessionName)) {
    return null
  }

  return sessionName
}

export function parseOptionalSessionName(rawSessionName: unknown): string | null | undefined {
  if (rawSessionName === undefined || rawSessionName === null || rawSessionName === '') {
    return undefined
  }

  return parseSessionName(rawSessionName)
}

export function parseClaudePermissionMode(rawMode: unknown): ClaudePermissionMode | null {
  const parsedMode = parseOptionalClaudePermissionMode(rawMode)
  return parsedMode === undefined ? 'default' : parsedMode
}

/**
 * Deprecated string literals that older on-disk JSON stores (cron tasks,
 * sentinels, quests) carry from before commit f84b6cac collapsed
 * `ClaudePermissionMode` to `'default'`. None of these are valid
 * permission-mode values anymore — they all map to `'default'` post-#1186.
 *
 * Used by `migrateLegacyPermissionMode` so on-disk validators can normalize
 * legacy entries instead of silently dropping them.
 */
export const LEGACY_PERMISSION_MODE_ALIASES: ReadonlySet<string> = new Set([
  'dangerouslySkipPermissions',
  'bypassPermissions',
  'acceptEdits',
])

/**
 * Migration result for an on-disk validator. `changed` is `true` when the
 * caller should treat the entry as upgraded (and persist the upgraded form to
 * disk + warn once); `value` is the canonical mode after migration.
 */
export interface LegacyPermissionModeMigration {
  changed: boolean
  value: ClaudePermissionMode | null | undefined
  legacyLiteral?: string
}

/**
 * On-disk JSON loader companion to `parseOptionalClaudePermissionMode`. When
 * an entry holds a deprecated alias, return `{ changed: true, value: 'default',
 * legacyLiteral }` so the caller can rewrite the on-disk literal once and emit
 * a structured warn. Otherwise this is a thin pass-through to the strict
 * parser. Use this at the parse boundary of every validator that checks
 * `permissionMode`; never silently drop a row whose only fault is a
 * deprecated literal.
 */
export function migrateLegacyPermissionMode(
  value: unknown,
): LegacyPermissionModeMigration {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (LEGACY_PERMISSION_MODE_ALIASES.has(trimmed)) {
      return {
        changed: true,
        value: 'default',
        legacyLiteral: trimmed,
      }
    }
  }
  return {
    changed: false,
    value: parseOptionalClaudePermissionMode(value),
  }
}

export function parseOptionalClaudePermissionMode(
  rawMode: unknown,
): ClaudePermissionMode | null | undefined {
  if (rawMode === undefined || rawMode === null || rawMode === '') {
    return undefined
  }

  if (typeof rawMode !== 'string') {
    return null
  }

  const normalized = rawMode.trim()
  if (normalized.length === 0) {
    return undefined
  }

  if (normalized === 'default') {
    return 'default'
  }

  return null
}

export function parseCodexApprovalDecision(rawDecision: unknown): CodexApprovalDecision | null {
  if (rawDecision === 'accept' || rawDecision === 'decline') {
    return rawDecision
  }
  return null
}

export function parseClaudeEffort(rawEffort: unknown): ClaudeEffortLevel | null | undefined {
  return parseOptionalClaudeEffort(rawEffort)
}

export function parseClaudeAdaptiveThinking(
  rawAdaptiveThinking: unknown,
): ClaudeAdaptiveThinkingMode | null | undefined {
  return parseOptionalClaudeAdaptiveThinkingMode(rawAdaptiveThinking)
}

export function parseOptionalTask(rawTask: unknown): string | null {
  if (rawTask === undefined || rawTask === null) {
    return ''
  }

  if (typeof rawTask !== 'string') {
    return null
  }

  return rawTask.trim()
}

export function parseOptionalModel(rawModel: unknown): string | null | undefined {
  if (rawModel === undefined || rawModel === null || rawModel === '') {
    return undefined
  }
  if (typeof rawModel !== 'string') {
    return null
  }

  const trimmed = rawModel.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseSessionType(rawSessionType: unknown): SessionType | null | undefined {
  if (rawSessionType === undefined || rawSessionType === null || rawSessionType === '') {
    return undefined
  }
  if (typeof rawSessionType !== 'string') {
    return null
  }
  const normalized = rawSessionType.trim()
  if (
    normalized === 'commander' ||
    normalized === 'worker' ||
    normalized === 'cron' ||
    normalized === 'sentinel'
  ) {
    return normalized
  }
  return null
}

export function parseSessionCreator(rawCreator: unknown): SessionCreator | null | undefined {
  if (rawCreator === undefined || rawCreator === null || rawCreator === '') {
    return undefined
  }
  if (typeof rawCreator !== 'object' || rawCreator === null || Array.isArray(rawCreator)) {
    return null
  }

  const kind = 'kind' in rawCreator ? rawCreator.kind : undefined
  if (
    kind !== 'human' &&
    kind !== 'commander' &&
    kind !== 'cron' &&
    kind !== 'sentinel'
  ) {
    return null
  }

  const rawId = 'id' in rawCreator ? rawCreator.id : undefined
  if (rawId !== undefined && rawId !== null && typeof rawId !== 'string') {
    return null
  }

  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined
  return {
    kind,
    ...(id ? { id } : {}),
  }
}

export function parseActiveSkillInvocation(
  rawInvocation: unknown,
): ActiveSkillInvocation | null | undefined {
  if (rawInvocation === undefined || rawInvocation === '') {
    return undefined
  }
  if (typeof rawInvocation !== 'object' || rawInvocation === null || Array.isArray(rawInvocation)) {
    return null
  }

  const skillId = 'skillId' in rawInvocation && typeof rawInvocation.skillId === 'string'
    ? rawInvocation.skillId.trim()
    : ''
  const displayName = 'displayName' in rawInvocation && typeof rawInvocation.displayName === 'string'
    ? rawInvocation.displayName.trim()
    : ''
  const startedAt = 'startedAt' in rawInvocation && typeof rawInvocation.startedAt === 'string'
    ? rawInvocation.startedAt.trim()
    : ''
  const rawToolUseId = 'toolUseId' in rawInvocation ? rawInvocation.toolUseId : undefined
  if (rawToolUseId !== undefined && rawToolUseId !== null && typeof rawToolUseId !== 'string') {
    return null
  }

  if (!skillId || !displayName || !startedAt) {
    return null
  }

  const toolUseId = typeof rawToolUseId === 'string' && rawToolUseId.trim().length > 0
    ? rawToolUseId.trim()
    : undefined

  return {
    skillId,
    displayName,
    startedAt,
    ...(toolUseId ? { toolUseId } : {}),
  }
}

export function parseCwd(rawCwd: unknown): string | null | undefined {
  if (rawCwd === undefined || rawCwd === null || rawCwd === '') {
    return undefined
  }

  if (typeof rawCwd !== 'string') {
    return null
  }

  const trimmed = rawCwd.trim()
  if (trimmed === '') {
    return undefined
  }

  if (!trimmed.startsWith('/')) {
    return null
  }

  return path.resolve(trimmed)
}

export function parseOptionalHost(rawHost: unknown): string | null | undefined {
  if (rawHost === undefined || rawHost === null || rawHost === '') {
    return undefined
  }

  if (typeof rawHost !== 'string') {
    return null
  }

  const trimmed = rawHost.trim()
  if (!SESSION_NAME_PATTERN.test(trimmed)) {
    return null
  }

  return trimmed
}

export function parseSessionTransportType(raw: unknown): Exclude<SessionTransportType, 'external'> {
  if (raw === 'stream') return 'stream'
  return 'pty'
}

export function parseMaxSessions(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SESSIONS
  }
  return parsed
}

export function parseTaskDelayMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TASK_DELAY_MS
  }
  return parsed
}

export function parseWsKeepAliveIntervalMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WS_KEEPALIVE_INTERVAL_MS
  }
  return parsed
}

export function parseAutoRotateEntryThreshold(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AUTO_ROTATE_ENTRY_THRESHOLD
  }
  return parsed
}

export function parseCodexTurnWatchdogTimeoutMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CODEX_TURN_WATCHDOG_TIMEOUT_MS
  }
  return parsed
}
