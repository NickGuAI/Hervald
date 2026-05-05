import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import {
  TelemetryJsonlStore,
  defaultTelemetryStorePath,
} from './store.js'
import { TelemetryHub } from './hub.js'
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
  if (localScanner && configuredIntervalMs > 0) {
    setInterval(() => {
      void localScanner.scan().catch((error) => {
        console.warn('[telemetry] local scan interval failed', error)
      })
    }, configuredIntervalMs)
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

  router.get('/sessions', requireReadAccess, async (_req, res) => {
    try {
      await hub.ensureReady()
      res.json(hub.getSessions())
    } catch {
      res.status(500).json({ error: 'Failed to read telemetry sessions' })
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

  return { router, hub, store }
}
