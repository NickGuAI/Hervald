import { readFile } from 'node:fs/promises'
import { buildDefaultCommanderConversationId } from '../commanders/store.js'
import type {
  PersistedSessionsState,
  PersistedStreamSession,
  SessionCreator,
  SessionType,
} from './types.js'

function asMigrationRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

interface ParsedLegacyCommanderSessionName {
  commanderId: string
  conversationId?: string
}

function parseLegacyCommanderSessionName(
  sessionName: string | null | undefined,
): ParsedLegacyCommanderSessionName | null {
  const normalized = sessionName?.trim() ?? ''
  if (!normalized.startsWith('commander-')) {
    return null
  }

  const suffix = normalized.slice('commander-'.length).trim()
  if (!suffix) {
    return null
  }

  const conversationMarker = '-conversation-'
  const markerIndex = suffix.lastIndexOf(conversationMarker)
  if (markerIndex < 0) {
    return { commanderId: suffix }
  }

  const commanderId = suffix.slice(0, markerIndex).trim()
  const conversationId = suffix.slice(markerIndex + conversationMarker.length).trim()
  if (!commanderId) {
    return null
  }

  return conversationId
    ? { commanderId, conversationId }
    : { commanderId }
}

function commanderIdFromSessionName(sessionName: string | null | undefined): string | null {
  return parseLegacyCommanderSessionName(sessionName)?.commanderId ?? null
}

function inferLegacyPersistedSessionSource(
  sessionName: string,
  rawEntry?: Record<string, unknown>,
): { creator: SessionCreator; sessionType: SessionType; spawnedBy?: string; conversationId?: string } {
  const parentSession = parseOptionalTrimmedString(rawEntry?.parentSession)
    ?? parseOptionalTrimmedString(rawEntry?.spawnedBy)
  if (sessionName.startsWith('command-room-')) {
    return {
      creator: { kind: 'cron', id: '<unknown-cron-task>' },
      sessionType: 'cron',
    }
  }
  if (sessionName.startsWith('automation-')) {
    return {
      creator: { kind: 'automation', id: '<unknown-automation>' },
      sessionType: 'automation',
    }
  }
  if (sessionName.startsWith('sentinel-')) {
    return {
      creator: { kind: 'sentinel', id: '<unknown-sentinel>' },
      sessionType: 'sentinel',
    }
  }
  if (sessionName.startsWith('worker-') || parentSession) {
    return {
      creator: {
        kind: 'commander',
        id: parentSession ? commanderIdFromSessionName(parentSession) ?? 'unknown' : 'unknown',
      },
      sessionType: 'worker',
      ...(parentSession ? { spawnedBy: parentSession } : {}),
    }
  }
  if (sessionName.startsWith('commander-')) {
    const parsedCommanderSession = parseLegacyCommanderSessionName(sessionName)
    return {
      creator: {
        kind: 'commander',
        id: parsedCommanderSession?.commanderId ?? sessionName,
      },
      sessionType: 'commander',
      ...(parsedCommanderSession?.conversationId ? { conversationId: parsedCommanderSession.conversationId } : {}),
    }
  }

  return {
    creator: { kind: 'human', id: '<unknown-user>' },
    sessionType: 'worker',
  }
}

function migratePersistedSessionEntry(
  entry: PersistedStreamSession,
  rawEntry?: Record<string, unknown>,
): PersistedStreamSession {
  const inferred = inferLegacyPersistedSessionSource(entry.name, rawEntry)
  const next: PersistedStreamSession = { ...entry }
  const changedFields: string[] = []

  if (!next.sessionType) {
    next.sessionType = inferred.sessionType
    changedFields.push('sessionType')
  }

  if (!next.creator) {
    next.creator = inferred.creator
    changedFields.push('creator')
  }

  if (!next.spawnedBy && inferred.spawnedBy) {
    next.spawnedBy = inferred.spawnedBy
    changedFields.push('spawnedBy')
  }

  if (!next.conversationId && inferred.conversationId) {
    next.conversationId = inferred.conversationId
    changedFields.push('conversationId')
  } else if (
    !next.conversationId &&
    next.sessionType === 'commander' &&
    next.creator?.kind === 'commander' &&
    typeof next.creator.id === 'string' &&
    next.creator.id.trim().length > 0
  ) {
    next.conversationId = buildDefaultCommanderConversationId(next.creator.id.trim())
    changedFields.push('conversationId')
  }

  if (changedFields.length > 0) {
    console.info(
      `[agents][migration] Backfilled persisted session "${entry.name}": ${changedFields.join(', ')}`,
    )
  }

  return next
}

async function readStoredSessionMigrationEntries(
  sessionStorePath: string,
): Promise<Map<string, Record<string, unknown>>> {
  let raw: string
  try {
    raw = await readFile(sessionStorePath, 'utf8')
  } catch {
    return new Map()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return new Map()
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { sessions?: unknown[] }).sessions)) {
    return new Map()
  }

  const entriesByName = new Map<string, Record<string, unknown>>()
  for (const rawEntry of (parsed as { sessions: unknown[] }).sessions) {
    const entry = asMigrationRecord(rawEntry)
    if (!entry) {
      continue
    }

    const name = parseOptionalTrimmedString(entry.name)
    if (!name) {
      continue
    }

    entriesByName.set(name, entry)
  }

  return entriesByName
}

export async function migrateLegacyPersistedSessionSources(
  sessionStorePath: string,
  persisted: PersistedSessionsState,
): Promise<{ state: PersistedSessionsState; changed: boolean }> {
  const migrationSourceEntries = await readStoredSessionMigrationEntries(sessionStorePath)
  const migratedSessions = persisted.sessions.map((entry) =>
    migratePersistedSessionEntry(entry, migrationSourceEntries.get(entry.name)),
  )
  const state = { sessions: migratedSessions }
  return {
    state,
    changed: JSON.stringify(state) !== JSON.stringify(persisted),
  }
}
