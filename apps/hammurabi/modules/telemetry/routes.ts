import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import {
  TelemetryJsonlStore,
  defaultTelemetryStorePath,
} from './store.js'
import { TelemetryHub } from './hub.js'
import type { TelemetryMetadataFilters } from './hub.js'
import {
  LocalTelemetryScanner,
  type LocalScannerLike,
} from './local-scanner.js'

export { TelemetryHub }

export interface LocalScanOptions {
  enabled?: boolean
  claudeProjectsDir?: string
  codexSessionsDir?: string
  stateFilePath?: string
  summaryCachePath?: string
  intervalMs?: number
}

export interface TelemetryRouterOptions {
  dataFilePath?: string
  now?: () => Date
  store?: TelemetryJsonlStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  localScan?: LocalScanOptions
  localScanner?: LocalScannerLike
  /** Days to retain JSONL entries (passed to TelemetryHub). Default: 90. */
  retentionDays?: number
}

// Raised from 14d to support 30/90-day historical queries.
const DEFAULT_RETENTION_DAYS = 90

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return value as Record<string, unknown>
}
// ---------------------------------------------------------------------------
// Router factories
// ---------------------------------------------------------------------------

export interface TelemetryRouterResult {
  router: Router
  hub: TelemetryHub
  store: TelemetryJsonlStore
  shutdown: () => void
}

function parseIntervalMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.round(value) : 0
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return 0
}

interface SummaryPeriodRange {
  period: string
  startKey: string
  endKey: string
}

function firstQueryString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const parsed = firstQueryString(candidate)
      if (parsed) {
        return parsed
      }
    }
  }
  return null
}

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function parseSummaryPeriod(
  rawPeriod: string | null,
  now: Date,
): { ok: true; value: SummaryPeriodRange } | { ok: false; error: string } {
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const period = rawPeriod ?? `month:${currentMonth}`

  if (period === '30d' || period === '90d') {
    const days = period === '30d' ? 30 : 90
    const end = startOfUtcDay(now)
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60_000)
    return {
      ok: true,
      value: {
        period,
        startKey: toUtcDayKey(start),
        endKey: toUtcDayKey(end),
      },
    }
  }

  const monthMatch = /^month:(\d{4})-(\d{2})$/.exec(period)
  if (monthMatch) {
    const year = Number.parseInt(monthMatch[1], 10)
    const month = Number.parseInt(monthMatch[2], 10)
    if (month < 1 || month > 12) {
      return { ok: false, error: 'Month must be in YYYY-MM format' }
    }
    const start = new Date(Date.UTC(year, month - 1, 1))
    const end = new Date(Date.UTC(year, month, 0))
    return {
      ok: true,
      value: {
        period,
        startKey: toUtcDayKey(start),
        endKey: toUtcDayKey(end),
      },
    }
  }

  return {
    ok: false,
    error: 'Invalid period. Use 30d, 90d, or month:YYYY-MM',
  }
}

function parseMetadataFilters(query: Record<string, unknown>): TelemetryMetadataFilters {
  return {
    source: firstQueryString(query.source) ?? firstQueryString(query['metadata.source']) ?? undefined,
    run_id: firstQueryString(query.run_id)
      ?? firstQueryString(query.runId)
      ?? firstQueryString(query['metadata.run_id'])
      ?? undefined,
    bench: firstQueryString(query.bench) ?? firstQueryString(query['metadata.bench']) ?? undefined,
    task_id: firstQueryString(query.task_id)
      ?? firstQueryString(query.taskId)
      ?? firstQueryString(query['metadata.task_id'])
      ?? undefined,
    runner_mode: firstQueryString(query.runner_mode)
      ?? firstQueryString(query.runnerMode)
      ?? firstQueryString(query['metadata.runner_mode'])
      ?? undefined,
  }
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function parseOptionalDate(value: unknown, fallback: Date): Date | null {
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parsePrimitiveMetadata(
  body: Record<string, unknown>,
): { ok: true; value: TelemetryMetadataFilters & { turn?: number } } | { ok: false; error: string } {
  const metadata = asObject(body.metadata) ?? {}
  const turn = parseOptionalNumber(metadata.turn ?? body.turn)
  if ((metadata.turn ?? body.turn) !== undefined && turn === undefined) {
    return { ok: false, error: 'metadata.turn must be a finite number when provided' }
  }

  return {
    ok: true,
    value: {
      source: firstQueryString(metadata.source) ?? firstQueryString(body.source) ?? undefined,
      run_id: firstQueryString(metadata.run_id)
        ?? firstQueryString(metadata.runId)
        ?? firstQueryString(body.run_id)
        ?? firstQueryString(body.runId)
        ?? undefined,
      bench: firstQueryString(metadata.bench) ?? firstQueryString(body.bench) ?? undefined,
      task_id: firstQueryString(metadata.task_id)
        ?? firstQueryString(metadata.taskId)
        ?? firstQueryString(body.task_id)
        ?? firstQueryString(body.taskId)
        ?? undefined,
      runner_mode: firstQueryString(metadata.runner_mode)
        ?? firstQueryString(metadata.runnerMode)
        ?? firstQueryString(body.runner_mode)
        ?? firstQueryString(body.runnerMode)
        ?? undefined,
      turn,
    },
  }
}

export function createTelemetryRouterWithHub(
  options: TelemetryRouterOptions = {},
): TelemetryRouterResult {
  const now = options.now ?? (() => new Date())
  const configuredRetentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
  const store =
    options.store ??
    new TelemetryJsonlStore(options.dataFilePath ?? defaultTelemetryStorePath())
  const hub = new TelemetryHub({ store, now, retentionDays: configuredRetentionDays })
  const localScanEnabled = options.localScan?.enabled ?? true
  const localScanner =
    options.localScanner ??
    (localScanEnabled
      ? new LocalTelemetryScanner({
          hub,
          now,
          claudeProjectsDir: options.localScan?.claudeProjectsDir,
          codexSessionsDir: options.localScan?.codexSessionsDir,
          stateFilePath: options.localScan?.stateFilePath,
          summaryCachePath: options.localScan?.summaryCachePath,
        })
      : null)

  if (localScanner) {
    // Run an initial scan on startup so local sessions appear immediately
    void localScanner.scan().catch((error) => {
      console.warn('[telemetry] initial local scan failed', error)
    })
  }

  const configuredIntervalMs =
    parseIntervalMs(options.localScan?.intervalMs) ||
    parseIntervalMs(process.env.HAMMURABI_TELEMETRY_SCAN_INTERVAL_MS)
  let localScanInterval: ReturnType<typeof setInterval> | null = null
  if (localScanner && configuredIntervalMs > 0) {
    localScanInterval = setInterval(() => {
      void localScanner.scan().catch((error) => {
        console.warn('[telemetry] local scan interval failed', error)
      })
    }, configuredIntervalMs)
  }

  const shutdown = (): void => {
    if (!localScanInterval) {
      return
    }
    clearInterval(localScanInterval)
    localScanInterval = null
  }

  const router = Router()
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['telemetry:write'],
    unconfiguredApiKeyMessage: 'Telemetry API key is not configured',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    now,
  })
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['telemetry:read'],
    unconfiguredApiKeyMessage: 'Telemetry API key is not configured',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    now,
  })

  router.post('/scan', requireWriteAccess, async (_req, res) => {
    if (!localScanner) {
      res.status(503).json({ error: 'Local telemetry scanner is disabled' })
      return
    }

    try {
      const result = await localScanner.scan()
      res.json({
        ok: true,
        scanned: result.scanned,
        ingested: result.ingested,
        skipped: result.skipped,
        durationMs: result.durationMs,
      })
    } catch {
      res.status(500).json({ error: 'Failed to scan local telemetry sessions' })
    }
  })

  router.post('/ingest', requireWriteAccess, async (req, res) => {
    const body = asObject(req.body)
    if (!body) {
      res.status(400).json({ error: 'JSON body is required' })
      return
    }

    const sessionId = firstQueryString(body.sessionId) ?? firstQueryString(body.session_id)
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' })
      return
    }

    const timestamp = parseOptionalDate(body.timestamp, now())
    if (!timestamp) {
      res.status(400).json({ error: 'timestamp must be an ISO timestamp when provided' })
      return
    }

    const metadata = parsePrimitiveMetadata(body)
    if (!metadata.ok) {
      res.status(400).json({ error: metadata.error })
      return
    }

    try {
      const record = await hub.ingest({
        sessionId,
        agentName: firstQueryString(body.agentName) ?? firstQueryString(body.agent_name) ?? 'benchmark-runner',
        model: firstQueryString(body.model) ?? 'unknown',
        provider: firstQueryString(body.provider) ?? 'unknown',
        inputTokens: parseOptionalNumber(body.inputTokens ?? body.input_tokens) ?? 0,
        outputTokens: parseOptionalNumber(body.outputTokens ?? body.output_tokens) ?? 0,
        cost: parseOptionalNumber(body.cost ?? body.costUsd ?? body.cost_usd) ?? 0,
        durationMs: parseOptionalNumber(body.durationMs ?? body.duration_ms) ?? 0,
        currentTask: firstQueryString(body.currentTask) ?? firstQueryString(body.current_task) ?? 'Benchmark evaluation',
        timestamp,
        metadata: metadata.value,
      })
      res.status(201).json(record)
    } catch {
      res.status(500).json({ error: 'Failed to ingest telemetry record' })
    }
  })

  router.get('/sessions', requireReadAccess, async (req, res) => {
    try {
      await hub.ensureReady()
      res.json(hub.getSessions(now(), parseMetadataFilters(req.query)))
    } catch {
      res.status(500).json({ error: 'Failed to read telemetry sessions' })
    }
  })

  router.get('/calls', requireReadAccess, async (req, res) => {
    try {
      await hub.ensureReady()
      res.json(hub.getCalls(parseMetadataFilters(req.query)))
    } catch {
      res.status(500).json({ error: 'Failed to read telemetry calls' })
    }
  })

  router.get('/sessions/:id', requireReadAccess, async (req, res) => {
    const sessionId = Array.isArray(req.params.id)
      ? req.params.id[0]?.trim()
      : req.params.id?.trim()
    if (!sessionId) {
      res.status(400).json({ error: 'Invalid session id' })
      return
    }

    try {
      await hub.ensureReady()
      const detail = hub.getSessionDetail(sessionId)
      if (!detail) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json(detail)
    } catch {
      res.status(500).json({ error: 'Failed to read telemetry session' })
    }
  })

  router.get('/summary', requireReadAccess, async (req, res) => {
    const parsedPeriod = parseSummaryPeriod(firstQueryString(req.query.period), now())
    if (!parsedPeriod.ok) {
      res.status(400).json({ error: parsedPeriod.error })
      return
    }

    try {
      res.json(
        await hub.getSummary({
          period: parsedPeriod.value.period,
          startKey: parsedPeriod.value.startKey,
          endKey: parsedPeriod.value.endKey,
          retentionDays: configuredRetentionDays,
        }),
      )
    } catch {
      res.status(500).json({ error: 'Failed to build telemetry summary' })
    }
  })

  router.post('/compact', requireWriteAccess, async (req, res) => {
    const body = asObject(req.body)
    const retentionDays =
      typeof body?.retentionDays === 'number' && Number.isFinite(body.retentionDays) && body.retentionDays > 0
        ? body.retentionDays
        : configuredRetentionDays
    try {
      await hub.ensureReady()
      await store.compact(retentionDays)
      res.json({ ok: true, retentionDays })
    } catch {
      res.status(500).json({ error: 'Compaction failed' })
    }
  })

  return { router, hub, store, shutdown }
}
