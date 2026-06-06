import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { runEvalDoctor } from './auth-doctor.js'
import {
  EvalRunStore,
  defaultEvalRoot,
  normalizeEvalBench,
  normalizeEvalRunId,
  normalizeEvalRunnerMode,
} from './store.js'
import {
  EVAL_PROFILES,
  type EvalProfile,
  type EvalRunConfig,
  type EvalRunManifestFilters,
  type EvalRunResult,
  type EvalTaskResult,
} from './types.js'

interface EvalRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  rootPath?: string
  now?: () => Date
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseProfile(value: unknown): EvalProfile | null {
  return typeof value === 'string' && EVAL_PROFILES.includes(value as EvalProfile)
    ? value as EvalProfile
    : null
}

function parseFilters(query: Record<string, unknown>): EvalRunManifestFilters | null {
  const benchRaw = firstQueryString(query.bench)
  const runnerRaw = firstQueryString(query.runner_mode) ?? firstQueryString(query.runnerMode)
  let bench: EvalRunManifestFilters['bench']
  let runnerMode: EvalRunManifestFilters['runnerMode']
  if (benchRaw) {
    const normalizedBench = normalizeEvalBench(benchRaw)
    if (!normalizedBench) {
      return null
    }
    bench = normalizedBench
  }
  if (runnerRaw) {
    const normalizedRunnerMode = normalizeEvalRunnerMode(runnerRaw)
    if (!normalizedRunnerMode) {
      return null
    }
    runnerMode = normalizedRunnerMode
  }
  return {
    source: firstQueryString(query.source) ?? undefined,
    bench,
    runnerMode,
  }
}

function authModeForRunnerMode(runnerMode: EvalRunConfig['runnerMode']): EvalRunConfig['authMode'] {
  if (runnerMode === 'api-key') {
    return 'api-key'
  }
  if (runnerMode === 'proxy-experimental') {
    return 'proxy-experimental'
  }
  return 'subscription'
}

function parseTaskStatus(value: unknown): EvalTaskResult['status'] | null {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'skipped'
    ? value
    : null
}

function parseTaskResults(value: unknown): EvalTaskResult[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isObject(entry)) {
      return []
    }
    const taskId = asString(entry.taskId) ?? asString(entry.task_id)
    const status = parseTaskStatus(entry.status)
    if (!taskId || !status) {
      return []
    }
    return [{
      taskId,
      status,
      score: asNumber(entry.score),
      runtimeMs: asNumber(entry.runtimeMs ?? entry.runtime_ms),
      failure: asString(entry.failure),
    }]
  })
}

function parseRunWriteBody(
  body: unknown,
  now: Date,
): { ok: true; config: EvalRunConfig; result: EvalRunResult; summaryMarkdown: string } | { ok: false; error: string } {
  if (!isObject(body)) {
    return { ok: false, error: 'JSON body is required' }
  }
  const bench = normalizeEvalBench(body.bench)
  const runnerMode = normalizeEvalRunnerMode(body.runnerMode ?? body.runner_mode)
  const profile = parseProfile(body.profile)
  const rawRunId = asString(body.runId) ?? `eval-${now.getTime()}`
  const runId = normalizeEvalRunId(rawRunId)
  if (!bench) {
    return { ok: false, error: 'bench must be one of: terminal-bench, locomo, marble, hal-reliability, tau-bench' }
  }
  if (!runId) {
    return { ok: false, error: 'runId must be a safe slug using letters, numbers, dot, underscore, or dash' }
  }
  if (!runnerMode) {
    return { ok: false, error: 'runnerMode must be subscription-host-cli, subscription-sbx, api-key, or proxy-experimental' }
  }
  if (!profile) {
    return { ok: false, error: 'profile must be smoke, full, or release-gate' }
  }

  const resultBody = isObject(body.result) ? body.result : {}
  const failures = Array.isArray(resultBody.failures)
    ? resultBody.failures.filter((entry): entry is string => typeof entry === 'string')
    : []
  const status = resultBody.status === 'running' || resultBody.status === 'completed'
    || resultBody.status === 'failed' || resultBody.status === 'blocked'
    || resultBody.status === 'submitted' || resultBody.status === 'queued'
    ? resultBody.status
    : 'queued'
  const result: EvalRunResult = {
    runId,
    bench,
    status,
    score: asNumber(resultBody.score),
    passRate: asNumber(resultBody.passRate),
    costUsd: asNumber(resultBody.costUsd),
    subscriptionLimitUsage: asString(resultBody.subscriptionLimitUsage),
    runtimeMs: asNumber(resultBody.runtimeMs),
    failures,
    tasks: parseTaskResults(resultBody.tasks),
    completedAt: asString(resultBody.completedAt),
  }
  const config: EvalRunConfig = {
    runId,
    bench,
    source: asString(body.source) ?? bench,
    profile,
    runnerMode,
    authMode: authModeForRunnerMode(runnerMode),
    commanderId: asString(body.commanderId),
    model: asString(body.model),
    provider: asString(body.provider),
    host: asString(body.host),
    gitSha: asString(body.gitSha),
    datasetVersion: asString(body.datasetVersion),
    adapterVersion: asString(body.adapterVersion),
    environmentHash: asString(body.environmentHash),
    createdAt: asString(body.createdAt) ?? now.toISOString(),
  }

  return {
    ok: true,
    config,
    result,
    summaryMarkdown: asString(body.summaryMarkdown) ?? `# ${bench} ${profile} run\n\nStatus: ${status}\n`,
  }
}

export function createEvalRouter(options: EvalRouterOptions = {}): Router {
  const router = Router()
  const now = options.now ?? (() => new Date())
  const store = new EvalRunStore(options.rootPath ?? defaultEvalRoot())
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['telemetry:read'],
    unconfiguredApiKeyMessage: 'Eval API key is not configured',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    now,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['telemetry:write'],
    unconfiguredApiKeyMessage: 'Eval API key is not configured',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    now,
  })

  router.get('/doctor', requireReadAccess, async (req, res) => {
    const rawBench = firstQueryString(req.query.bench)
    const rawRunner = firstQueryString(req.query.runner)
      ?? firstQueryString(req.query.runner_mode)
      ?? firstQueryString(req.query.runnerMode)
    let bench: EvalRunConfig['bench'] | undefined
    let runnerMode: EvalRunConfig['runnerMode'] | undefined
    if (rawBench) {
      const normalizedBench = normalizeEvalBench(rawBench)
      if (!normalizedBench) {
        res.status(400).json({ error: 'Invalid bench' })
        return
      }
      bench = normalizedBench
    }
    if (rawRunner) {
      const normalizedRunnerMode = normalizeEvalRunnerMode(rawRunner)
      if (!normalizedRunnerMode) {
        res.status(400).json({ error: 'Invalid runner mode' })
        return
      }
      runnerMode = normalizedRunnerMode
    }

    res.json(await runEvalDoctor({ bench, runnerMode }))
  })

  router.get('/runs', requireReadAccess, async (req, res) => {
    const filters = parseFilters(req.query)
    if (!filters) {
      res.status(400).json({ error: 'Invalid eval run filters' })
      return
    }
    const runs = await store.list(filters)
    res.json({
      runs,
      filters: {
        sources: [...new Set(runs.map((run) => run.source))].sort(),
        benches: [...new Set(runs.map((run) => run.bench))].sort(),
        runnerModes: [...new Set(runs.map((run) => run.runnerMode))].sort(),
      },
    })
  })

  router.get('/list', requireReadAccess, async (req, res) => {
    const filters = parseFilters(req.query)
    if (!filters) {
      res.status(400).json({ error: 'Invalid eval run filters' })
      return
    }
    res.json(await store.list(filters))
  })

  router.post('/runs', requireWriteAccess, async (req, res) => {
    const parsed = parseRunWriteBody(req.body, now())
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }
    const manifest = await store.writeRunArtifacts(parsed)
    res.status(201).json(manifest)
  })

  router.get('/runs/:runId', requireReadAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.get(runId)
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    res.json(manifest)
  })

  router.get('/status/:runId', requireReadAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.get(runId)
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    res.json({
      runId: manifest.runId,
      bench: manifest.bench,
      status: manifest.status,
      score: manifest.score,
      passRate: manifest.passRate,
      updatedAt: manifest.updatedAt,
      failures: manifest.failures,
    })
  })

  router.get('/runs/:runId/status', requireReadAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.get(runId)
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    res.json({
      runId: manifest.runId,
      bench: manifest.bench,
      status: manifest.status,
      score: manifest.score,
      passRate: manifest.passRate,
      updatedAt: manifest.updatedAt,
      failures: manifest.failures,
    })
  })

  router.get('/report/:runId', requireReadAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.get(runId)
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    const format = firstQueryString(req.query.format)
    if (format === 'markdown') {
      res.type('text/markdown').send(manifest.summaryMarkdown ?? '')
      return
    }
    res.json({
      runId: manifest.runId,
      summaryMarkdown: manifest.summaryMarkdown ?? '',
      manifest,
    })
  })

  router.get('/runs/:runId/report', requireReadAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.get(runId)
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    const format = firstQueryString(req.query.format)
    if (format === 'markdown') {
      res.type('text/markdown').send(manifest.summaryMarkdown ?? '')
      return
    }
    res.json({
      runId: manifest.runId,
      summaryMarkdown: manifest.summaryMarkdown ?? '',
      manifest,
    })
  })

  router.post('/submit/:runId', requireWriteAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.markSubmissionBlocked(
      runId,
      'Public leaderboard submission requires a prior human-owned auth step.',
    )
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    res.status(409).json(manifest.leaderboard)
  })

  router.post('/runs/:runId/submit', requireWriteAccess, async (req, res) => {
    const runId = normalizeEvalRunId(firstQueryString(req.params.runId))
    if (!runId) {
      res.status(400).json({ error: 'Invalid run id' })
      return
    }
    const manifest = await store.markSubmissionBlocked(
      runId,
      'Public leaderboard submission requires a prior human-owned auth step.',
    )
    if (!manifest) {
      res.status(404).json({ error: 'Eval run not found' })
      return
    }
    res.status(409).json(manifest.leaderboard)
  })

  return router
}
