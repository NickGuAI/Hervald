import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveHammurabiDataDir } from '../data-dir.js'

export const DEFAULT_CHANNEL_MESSAGE_IDEMPOTENCY_RETENTION_DAYS = 30

const PRUNE_INTERVAL_MS = 60 * 60 * 1000

export interface ChannelMessageIdempotencyClaimInput {
  provider: string
  accountId: string
  rawSourceId: string
  now?: Date
}

export type ChannelMessageIdempotencyClaimResult =
  | {
    firstSeen: true
    key: string
    firstSeenAt: string
    expiresAt: string
  }
  | {
    firstSeen: false
    key: string
    firstSeenAt?: string
    expiresAt?: string
  }

interface PersistedChannelMessageIdempotencyEntry {
  key: string
  provider: string
  accountId: string
  rawSourceId: string
  firstSeenAt: string
  expiresAt: string
}

interface NormalizedChannelMessageIdempotencyInput {
  key: string
  provider: string
  accountId: string
  rawSourceId: string
}

export function channelMessageIdempotencyLedgerPathForDataRoot(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), 'channels', 'idempotency')
}

function retentionMsFromDays(days: number): number {
  return Math.max(1, Math.trunc(days)) * 24 * 60 * 60 * 1000
}

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

function entryKey(input: Pick<NormalizedChannelMessageIdempotencyInput, 'provider' | 'accountId' | 'rawSourceId'>): string {
  return createHash('sha256')
    .update(JSON.stringify([input.provider, input.accountId, input.rawSourceId]))
    .digest('hex')
}

function normalizeInput(input: ChannelMessageIdempotencyClaimInput): NormalizedChannelMessageIdempotencyInput {
  const provider = normalizeNonEmpty(input.provider, 'provider').toLowerCase()
  const accountId = normalizeNonEmpty(input.accountId, 'accountId')
  const rawSourceId = normalizeNonEmpty(input.rawSourceId, 'rawSourceId')
  return {
    provider,
    accountId,
    rawSourceId,
    key: entryKey({ provider, accountId, rawSourceId }),
  }
}

function parsePersistedEntry(raw: unknown): PersistedChannelMessageIdempotencyEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const accountId = typeof record.accountId === 'string' ? record.accountId.trim() : ''
  const rawSourceId = typeof record.rawSourceId === 'string' ? record.rawSourceId.trim() : ''
  const firstSeenAt = typeof record.firstSeenAt === 'string' ? record.firstSeenAt.trim() : ''
  const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt.trim() : ''
  if (!key || !provider || !accountId || !rawSourceId || !firstSeenAt || !expiresAt) {
    return null
  }
  return {
    key,
    provider,
    accountId,
    rawSourceId,
    firstSeenAt,
    expiresAt,
  }
}

function isExpired(entry: PersistedChannelMessageIdempotencyEntry | null, nowMs: number): boolean {
  if (!entry) {
    return false
  }
  const expiresAtMs = Date.parse(entry.expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

export class ChannelMessageIdempotencyLedger {
  private readonly rootDir: string
  private readonly retentionMs: number
  private lastPrunedAtMs = 0
  private prunePromise: Promise<void> | null = null

  constructor(options: {
    rootDir?: string
    retentionDays?: number
  } = {}) {
    this.rootDir = path.resolve(
      options.rootDir ?? channelMessageIdempotencyLedgerPathForDataRoot(resolveHammurabiDataDir()),
    )
    this.retentionMs = retentionMsFromDays(
      options.retentionDays ?? DEFAULT_CHANNEL_MESSAGE_IDEMPOTENCY_RETENTION_DAYS,
    )
  }

  async claim(input: ChannelMessageIdempotencyClaimInput): Promise<ChannelMessageIdempotencyClaimResult> {
    const normalized = normalizeInput(input)
    const now = input.now ?? new Date()
    await this.pruneIfDue(now)
    return this.claimNormalized(normalized, now, true)
  }

  async has(input: ChannelMessageIdempotencyClaimInput): Promise<boolean> {
    const normalized = normalizeInput(input)
    const now = input.now ?? new Date()
    await this.pruneIfDue(now)
    const filePath = this.entryPath(normalized.key)
    const existing = await this.readEntry(filePath)
    if (!existing) {
      return false
    }
    if (isExpired(existing, now.getTime())) {
      await rm(filePath, { force: true })
      return false
    }
    return true
  }

  private async claimNormalized(
    input: NormalizedChannelMessageIdempotencyInput,
    now: Date,
    allowExpiredRetry: boolean,
  ): Promise<ChannelMessageIdempotencyClaimResult> {
    const firstSeenAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + this.retentionMs).toISOString()
    const filePath = this.entryPath(input.key)
    const entry: PersistedChannelMessageIdempotencyEntry = {
      ...input,
      firstSeenAt,
      expiresAt,
    }

    await mkdir(path.dirname(filePath), { recursive: true })
    try {
      await writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      return {
        firstSeen: true,
        key: entry.key,
        firstSeenAt,
        expiresAt,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }

    const existing = await this.readEntry(filePath)
    if (allowExpiredRetry && isExpired(existing, now.getTime())) {
      await rm(filePath, { force: true })
      return this.claimNormalized(input, now, false)
    }

    return {
      firstSeen: false,
      key: input.key,
      ...(existing?.firstSeenAt ? { firstSeenAt: existing.firstSeenAt } : {}),
      ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}),
    }
  }

  private entryPath(key: string): string {
    return path.join(this.rootDir, key.slice(0, 2), `${key}.json`)
  }

  private async readEntry(filePath: string): Promise<PersistedChannelMessageIdempotencyEntry | null> {
    try {
      return parsePersistedEntry(JSON.parse(await readFile(filePath, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      return null
    }
  }

  private async pruneIfDue(now: Date): Promise<void> {
    const nowMs = now.getTime()
    if (nowMs - this.lastPrunedAtMs < PRUNE_INTERVAL_MS) {
      return
    }
    if (this.prunePromise) {
      await this.prunePromise
      return
    }

    this.prunePromise = this.pruneExpiredEntries(this.rootDir, nowMs)
    try {
      await this.prunePromise
      this.lastPrunedAtMs = nowMs
    } finally {
      this.prunePromise = null
    }
  }

  private async pruneExpiredEntries(directory: string, nowMs: number): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }

    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await this.pruneExpiredEntries(entryPath, nowMs)
        return
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        return
      }
      const persisted = await this.readEntry(entryPath)
      if (isExpired(persisted, nowMs)) {
        await rm(entryPath, { force: true })
      }
    }))
  }
}
