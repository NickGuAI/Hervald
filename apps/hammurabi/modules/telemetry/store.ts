import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { resolveModuleDataDir } from '../data-dir.js'
import {
  appendFileDurably,
  fsyncDirectory,
  withFileMutationLock,
} from '../durable-file.js'
import type { NormalizedCall, TelemetryMetadata } from './normalizer.js'

export interface TelemetryIngestRecord {
  id: string
  sessionId: string
  agentName: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
  currentTask: string
  timestamp: string
  metadata?: TelemetryMetadata
}

export interface TelemetryHeartbeatRecord {
  sessionId: string
  agentName?: string
  model?: string
  currentTask?: string
  completed: boolean
  timestamp: string
}

export interface OtelLogPayload {
  signal: 'logs'
  resource: Record<string, string | number | boolean>
  eventName: string
  attributes: Record<string, string | number | boolean>
  normalized: NormalizedCall
}

export interface OtelMetricPayload {
  signal: 'metrics'
  resource: Record<string, string | number | boolean>
  metricName: string
  attributes: Record<string, string | number | boolean>
  value: number
  normalized: NormalizedCall
}

export type TelemetryStoreEntry =
  | {
      type: 'ingest'
      recordedAt: string
      payload: TelemetryIngestRecord
    }
  | {
      type: 'heartbeat'
      recordedAt: string
      payload: TelemetryHeartbeatRecord
    }
  | {
      type: 'otel_log'
      recordedAt: string
      payload: OtelLogPayload
    }
  | {
      type: 'otel_metric'
      recordedAt: string
      payload: OtelMetricPayload
    }

interface LocalIngestRollup {
  recordedAt: string
  payload: TelemetryIngestRecord
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTelemetryIngestRecord(value: unknown): value is TelemetryIngestRecord {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.agentName === 'string' &&
    typeof value.model === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.inputTokens === 'number' &&
    typeof value.outputTokens === 'number' &&
    typeof value.cost === 'number' &&
    typeof value.durationMs === 'number' &&
    typeof value.currentTask === 'string' &&
    typeof value.timestamp === 'string' &&
    (value.metadata === undefined || isObject(value.metadata))
  )
}

function isTelemetryHeartbeatRecord(value: unknown): value is TelemetryHeartbeatRecord {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.sessionId === 'string' &&
    typeof value.completed === 'boolean' &&
    typeof value.timestamp === 'string' &&
    (value.agentName === undefined || typeof value.agentName === 'string') &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.currentTask === undefined || typeof value.currentTask === 'string')
  )
}

function isNormalizedCall(value: unknown): value is NormalizedCall {
  if (!isObject(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.agentName === 'string' &&
    typeof value.model === 'string' &&
    typeof value.signal === 'string'
  )
}

function isOtelLogPayload(value: unknown): value is OtelLogPayload {
  if (!isObject(value)) return false
  return (
    value.signal === 'logs' &&
    typeof value.eventName === 'string' &&
    isObject(value.resource) &&
    isObject(value.attributes) &&
    isNormalizedCall(value.normalized)
  )
}

function isOtelMetricPayload(value: unknown): value is OtelMetricPayload {
  if (!isObject(value)) return false
  return (
    value.signal === 'metrics' &&
    typeof value.metricName === 'string' &&
    typeof value.value === 'number' &&
    isObject(value.resource) &&
    isObject(value.attributes) &&
    isNormalizedCall(value.normalized)
  )
}

function parseEntry(line: string): TelemetryStoreEntry | null {
  if (!line.trim()) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    return null
  }

  if (!isObject(parsed) || typeof parsed.type !== 'string' || !('payload' in parsed)) {
    return null
  }

  const recordedAt =
    typeof parsed.recordedAt === 'string' ? parsed.recordedAt : new Date(0).toISOString()

  if (parsed.type === 'ingest' && isTelemetryIngestRecord(parsed.payload)) {
    return {
      type: 'ingest',
      recordedAt,
      payload: parsed.payload,
    }
  }

  if (parsed.type === 'heartbeat' && isTelemetryHeartbeatRecord(parsed.payload)) {
    return {
      type: 'heartbeat',
      recordedAt,
      payload: parsed.payload,
    }
  }

  if (parsed.type === 'otel_log' && isOtelLogPayload(parsed.payload)) {
    return {
      type: 'otel_log',
      recordedAt,
      payload: parsed.payload,
    }
  }

  if (parsed.type === 'otel_metric' && isOtelMetricPayload(parsed.payload)) {
    return {
      type: 'otel_metric',
      recordedAt,
      payload: parsed.payload,
    }
  }

  return null
}

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isLocalIngestRecord(record: TelemetryIngestRecord): boolean {
  const agentName = record.agentName.trim().toLowerCase()
  return agentName === 'claude-local' || agentName === 'codex-local'
}

function localIngestRollupKey(record: TelemetryIngestRecord): string {
  return [
    toUtcDayKey(new Date(record.timestamp)),
    record.sessionId,
    record.agentName,
    record.model,
    record.provider,
  ].join('\u0000')
}

function buildLocalRollupId(record: TelemetryIngestRecord): string {
  return `local-rollup:${toUtcDayKey(new Date(record.timestamp))}:${record.sessionId}:${record.agentName}:${record.model}:${record.provider}`
}

function addLocalIngestRollup(
  rollups: Map<string, LocalIngestRollup>,
  entry: Extract<TelemetryStoreEntry, { type: 'ingest' }>,
): void {
  const key = localIngestRollupKey(entry.payload)
  const existing = rollups.get(key)
  if (!existing) {
    rollups.set(key, {
      recordedAt: entry.recordedAt,
      payload: {
        ...entry.payload,
        id: buildLocalRollupId(entry.payload),
      },
    })
    return
  }

  const existingTimestamp = new Date(existing.payload.timestamp).getTime()
  const nextTimestamp = new Date(entry.payload.timestamp).getTime()
  if (nextTimestamp >= existingTimestamp) {
    existing.recordedAt = entry.recordedAt
    existing.payload.timestamp = entry.payload.timestamp
    existing.payload.currentTask = entry.payload.currentTask || existing.payload.currentTask
  }

  existing.payload.inputTokens += entry.payload.inputTokens
  existing.payload.outputTokens += entry.payload.outputTokens
  existing.payload.cost += entry.payload.cost
  existing.payload.durationMs += entry.payload.durationMs
  existing.payload.metadata = entry.payload.metadata ?? existing.payload.metadata
}

function normalizedHasUsage(normalized: NormalizedCall): boolean {
  return normalized.cost > 0 || normalized.inputTokens > 0 || normalized.outputTokens > 0
}

export class TelemetryJsonlStore {
  constructor(private readonly filePath: string) {}

  async append(entry: TelemetryStoreEntry): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await appendFileDurably(this.filePath, `${JSON.stringify(entry)}\n`)
  }

  /** Max file size to eagerly restore. V8 string limit ~512MB; use 100MB to avoid startup stalls. */
  static readonly MAX_LOAD_BYTES = 100 * 1024 * 1024

  async load(): Promise<TelemetryStoreEntry[]> {
    try {
      const st = await stat(this.filePath)
      if (st.size > TelemetryJsonlStore.MAX_LOAD_BYTES) {
        console.warn(
          `[TelemetryJsonlStore] Skipping load: ${this.filePath} is ${(st.size / 1024 / 1024).toFixed(1)}MB (max ${TelemetryJsonlStore.MAX_LOAD_BYTES / 1024 / 1024}MB). Consider rotating the file.`,
        )
        return []
      }
    } catch (err) {
      if (isObject(err) && 'code' in err && err.code === 'ENOENT') {
        return []
      }
      throw err
    }

    let contents: string
    try {
      contents = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
        return []
      }
      throw error
    }

    return contents
      .split('\n')
      .map((line) => parseEntry(line))
      .filter((entry): entry is TelemetryStoreEntry => entry !== null)
  }

  async *stream(options: { maxBytes?: number } = {}): AsyncGenerator<TelemetryStoreEntry> {
    try {
      const st = await stat(this.filePath)
      const maxBytes = options.maxBytes ?? TelemetryJsonlStore.MAX_LOAD_BYTES
      if (maxBytes > 0 && st.size > maxBytes) {
        console.warn(
          `[TelemetryJsonlStore] Skipping stream: ${this.filePath} is ${(st.size / 1024 / 1024).toFixed(1)}MB (max ${(maxBytes / 1024 / 1024).toFixed(1)}MB). Consider rotating the file.`,
        )
        return
      }
    } catch (err) {
      if (isObject(err) && 'code' in err && err.code === 'ENOENT') {
        return
      }
      throw err
    }

    const fileStream = createReadStream(this.filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity })
    try {
      for await (const line of rl) {
        const entry = parseEntry(line)
        if (entry) {
          yield entry
        }
      }
    } finally {
      rl.close()
      fileStream.destroy()
    }
  }

  /**
   * Remove all entries older than `retentionDays` days via an atomic tmp-file swap.
   * No-ops if the file does not exist.
   */
  async compact(retentionDays: number, options: { maxBytes?: number } = {}): Promise<void> {
    await withFileMutationLock(this.filePath, async () => {
      try {
        const st = await stat(this.filePath)
        if (options.maxBytes !== undefined && st.size > options.maxBytes) {
          console.warn(
            `[TelemetryJsonlStore] Skipping compact: ${this.filePath} is ${(st.size / 1024 / 1024).toFixed(1)}MB (max ${(options.maxBytes / 1024 / 1024).toFixed(1)}MB). Use manual rotation for oversized telemetry stores.`,
          )
          return
        }
      } catch (err) {
        if (isObject(err) && 'code' in err && err.code === 'ENOENT') return
        throw err
      }

      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)
      const cutoffISO = cutoff.toISOString()

      const tmpPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      const fileStream = createReadStream(this.filePath, { encoding: 'utf8' })
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity })
      const localRollups = new Map<string, LocalIngestRollup>()
      const tmpHandle = await open(tmpPath, 'w')
      let renamedTmp = false
      let inputClosed = false
      const closeInput = () => {
        if (inputClosed) return
        inputClosed = true
        rl.close()
        fileStream.destroy()
      }
      const writeEntry = async (entry: TelemetryStoreEntry) => {
        await tmpHandle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8')
      }

      try {
        try {
          for await (const line of rl) {
            if (!line.trim()) continue
            const entry = parseEntry(line)
            if (!entry) {
              continue
            }
            if (entry.recordedAt < cutoffISO) {
              continue
            }
            if (entry.type === 'ingest' && isLocalIngestRecord(entry.payload)) {
              addLocalIngestRollup(localRollups, entry)
              continue
            }
            if (
              (entry.type === 'otel_log' || entry.type === 'otel_metric') &&
              !normalizedHasUsage(entry.payload.normalized)
            ) {
              continue
            }
            await writeEntry(entry)
          }
        } finally {
          closeInput()
        }

        for (const rollup of localRollups.values()) {
          await writeEntry({
            type: 'ingest',
            recordedAt: rollup.recordedAt,
            payload: {
              ...rollup.payload,
              cost: Number(rollup.payload.cost.toFixed(12)),
            },
          })
        }

        await tmpHandle.sync()
        await tmpHandle.close()
        await rename(tmpPath, this.filePath)
        renamedTmp = true
        await fsyncDirectory(path.dirname(this.filePath))
      } catch (err) {
        if (!renamedTmp) {
          try {
            await tmpHandle.close()
          } catch {
            // Ignore close errors while cleaning up a failed compaction.
          }
        }
        await unlink(tmpPath).catch(() => undefined)
        throw err
      } finally {
        closeInput()
        if (!renamedTmp) {
          await tmpHandle.close().catch(() => undefined)
        }
      }
    })
  }
}

export function defaultTelemetryStorePath(): string {
  return path.join(resolveModuleDataDir('telemetry'), 'events.jsonl')
}
