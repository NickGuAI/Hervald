import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  EVAL_BENCHES,
  EVAL_RUNNER_MODES,
  type EvalBench,
  type EvalLeaderboardState,
  type EvalRunConfig,
  type EvalRunManifest,
  type EvalRunManifestFilters,
  type EvalRunResult,
  type EvalTaskResult,
  type EvalRunnerMode,
} from './types.js'

const BENCH_ALIASES = new Map<string, EvalBench>([
  ['terminal_bench', 'terminal-bench'],
  ['terminal-bench', 'terminal-bench'],
  ['tbench', 'terminal-bench'],
  ['locomo', 'locomo'],
  ['marble', 'marble'],
  ['hal_reliability', 'hal-reliability'],
  ['hal-reliability', 'hal-reliability'],
  ['tau_bench', 'tau-bench'],
  ['tau-bench', 'tau-bench'],
])
const EVAL_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
    : []
}

function parseTaskStatus(value: unknown): EvalTaskResult['status'] | null {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'skipped'
    ? value
    : null
}

export function normalizeEvalBench(value: unknown): EvalBench | null {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) {
    return null
  }
  return BENCH_ALIASES.get(normalized) ?? null
}

export function normalizeEvalRunnerMode(value: unknown): EvalRunnerMode | null {
  const normalized = asString(value)
  return normalized && EVAL_RUNNER_MODES.includes(normalized as EvalRunnerMode)
    ? normalized as EvalRunnerMode
    : null
}

export function normalizeEvalRunId(value: unknown): string | null {
  const normalized = asString(value)
  return normalized && EVAL_RUN_ID_PATTERN.test(normalized) ? normalized : null
}

export function defaultEvalRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = asString(env.HAMMURABI_EVAL_ROOT)
  return configured ?? path.join(homedir(), '.hammurabi', 'eval')
}

function runDayKey(config: EvalRunConfig): string {
  return config.createdAt.slice(0, 10)
}

function benchPathSegment(bench: EvalBench): string {
  return bench
}

function parseConfig(value: unknown): EvalRunConfig | null {
  if (!isObject(value)) {
    return null
  }
  const runId = normalizeEvalRunId(value.runId)
  const bench = normalizeEvalBench(value.bench)
  const runnerMode = normalizeEvalRunnerMode(value.runnerMode)
  const profile = value.profile === 'smoke' || value.profile === 'full' || value.profile === 'release-gate'
    ? value.profile
    : null
  const authMode = value.authMode === 'subscription' || value.authMode === 'api-key' || value.authMode === 'proxy-experimental'
    ? value.authMode
    : null
  const createdAt = asString(value.createdAt)
  if (!runId || !bench || !runnerMode || !profile || !authMode || !createdAt) {
    return null
  }

  return {
    runId,
    bench,
    source: asString(value.source) ?? bench,
    profile,
    runnerMode,
    authMode,
    commanderId: asString(value.commanderId) ?? undefined,
    model: asString(value.model) ?? undefined,
    provider: asString(value.provider) ?? undefined,
    host: asString(value.host) ?? undefined,
    gitSha: asString(value.gitSha) ?? undefined,
    datasetVersion: asString(value.datasetVersion) ?? undefined,
    adapterVersion: asString(value.adapterVersion) ?? undefined,
    environmentHash: asString(value.environmentHash) ?? undefined,
    createdAt,
  }
}

function parseResult(value: unknown, config: EvalRunConfig): EvalRunResult {
  if (!isObject(value)) {
    return {
      runId: config.runId,
      bench: config.bench,
      status: 'queued',
      failures: [],
      tasks: [],
    }
  }

  const status = value.status === 'running' || value.status === 'completed' || value.status === 'failed'
    || value.status === 'blocked' || value.status === 'submitted' || value.status === 'queued'
    ? value.status
    : 'queued'
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.flatMap((entry) => {
        if (!isObject(entry)) {
          return []
        }
        const taskId = asString(entry.taskId)
        const taskStatus = parseTaskStatus(entry.status)
        if (!taskId || !taskStatus) {
          return []
        }
        return [{
          taskId,
          status: taskStatus,
          score: asNumber(entry.score),
          runtimeMs: asNumber(entry.runtimeMs),
          failure: asString(entry.failure) ?? undefined,
        }]
      })
    : []

  return {
    runId: asString(value.runId) ?? config.runId,
    bench: normalizeEvalBench(value.bench) ?? config.bench,
    status,
    score: asNumber(value.score),
    passRate: asNumber(value.passRate),
    costUsd: asNumber(value.costUsd),
    subscriptionLimitUsage: asString(value.subscriptionLimitUsage) ?? undefined,
    runtimeMs: asNumber(value.runtimeMs),
    failures: asStringArray(value.failures),
    tasks,
    completedAt: asString(value.completedAt) ?? undefined,
  }
}

function parseLeaderboard(value: unknown): EvalLeaderboardState | null {
  if (!isObject(value)) {
    return null
  }
  const status = value.status === 'not-submitted' || value.status === 'blocked' || value.status === 'submitted'
    ? value.status
    : null
  const updatedAt = asString(value.updatedAt)
  if (!status || !updatedAt) {
    return null
  }
  return {
    status,
    publicUrl: asString(value.publicUrl) ?? undefined,
    blocker: asString(value.blocker) ?? undefined,
    updatedAt,
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

export class EvalRunStore {
  constructor(private readonly rootPath = defaultEvalRoot()) {}

  resolveRunDir(config: EvalRunConfig): string {
    const runId = normalizeEvalRunId(config.runId)
    if (!runId) {
      throw new Error('Eval run id must be a safe slug')
    }
    return path.join(
      this.rootPath,
      runDayKey(config),
      benchPathSegment(config.bench),
      runId,
    )
  }

  async writeRunArtifacts(input: {
    config: EvalRunConfig
    result: EvalRunResult
    summaryMarkdown: string
    leaderboard?: EvalLeaderboardState
  }): Promise<EvalRunManifest> {
    const runDir = this.resolveRunDir(input.config)
    await mkdir(path.join(runDir, 'trajectories'), { recursive: true })

    const now = new Date().toISOString()
    const leaderboard = input.leaderboard ?? {
      status: 'not-submitted' as const,
      updatedAt: now,
    }

    await writeFile(path.join(runDir, 'config.json'), `${JSON.stringify(input.config, null, 2)}\n`, 'utf8')
    await writeFile(path.join(runDir, 'result.json'), `${JSON.stringify(input.result, null, 2)}\n`, 'utf8')
    await writeFile(path.join(runDir, 'summary.md'), `${input.summaryMarkdown.trimEnd()}\n`, 'utf8')
    await writeFile(path.join(runDir, 'leaderboard.json'), `${JSON.stringify(leaderboard, null, 2)}\n`, 'utf8')

    const manifest = await this.readRunManifestFromDir(runDir)
    if (!manifest) {
      throw new Error(`Unable to read eval run manifest from ${runDir}`)
    }
    return manifest
  }

  async list(filters: EvalRunManifestFilters = {}): Promise<EvalRunManifest[]> {
    const manifests: EvalRunManifest[] = []
    let dayEntries: string[] = []
    try {
      dayEntries = await readdir(this.rootPath)
    } catch {
      return []
    }

    for (const day of dayEntries) {
      const dayPath = path.join(this.rootPath, day)
      let benchEntries: string[] = []
      try {
        benchEntries = await readdir(dayPath)
      } catch {
        continue
      }
      for (const bench of benchEntries) {
        const benchPath = path.join(dayPath, bench)
        let runEntries: string[] = []
        try {
          runEntries = await readdir(benchPath)
        } catch {
          continue
        }
        for (const runId of runEntries) {
          const manifest = await this.readRunManifestFromDir(path.join(benchPath, runId))
          if (manifest && this.matchesFilters(manifest, filters)) {
            manifests.push(manifest)
          }
        }
      }
    }

    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async get(runId: string): Promise<EvalRunManifest | null> {
    const safeRunId = normalizeEvalRunId(runId)
    if (!safeRunId) {
      return null
    }
    const manifests = await this.list()
    return manifests.find((manifest) => manifest.runId === safeRunId) ?? null
  }

  async markSubmissionBlocked(runId: string, blocker: string): Promise<EvalRunManifest | null> {
    const manifest = await this.get(runId)
    if (!manifest) {
      return null
    }
    const leaderboard: EvalLeaderboardState = {
      status: 'blocked',
      blocker,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(manifest.leaderboardPath, `${JSON.stringify(leaderboard, null, 2)}\n`, 'utf8')
    return this.get(runId)
  }

  private matchesFilters(manifest: EvalRunManifest, filters: EvalRunManifestFilters): boolean {
    if (filters.source && manifest.source !== filters.source) {
      return false
    }
    if (filters.bench && manifest.bench !== filters.bench) {
      return false
    }
    if (filters.runnerMode && manifest.runnerMode !== filters.runnerMode) {
      return false
    }
    return true
  }

  private async readRunManifestFromDir(runDir: string): Promise<EvalRunManifest | null> {
    const configPath = path.join(runDir, 'config.json')
    const resultPath = path.join(runDir, 'result.json')
    const summaryPath = path.join(runDir, 'summary.md')
    const leaderboardPath = path.join(runDir, 'leaderboard.json')
    const config = parseConfig(await readJsonFile(configPath))
    if (!config) {
      return null
    }
    const result = parseResult(await readJsonFile(resultPath), config)
    const leaderboard = parseLeaderboard(await readJsonFile(leaderboardPath)) ?? {
      status: 'not-submitted' as const,
      updatedAt: config.createdAt,
    }
    const updatedAt = result.completedAt ?? leaderboard.updatedAt ?? config.createdAt

    return {
      runId: config.runId,
      bench: config.bench,
      source: config.source,
      profile: config.profile,
      runnerMode: config.runnerMode,
      authMode: config.authMode,
      status: result.status,
      createdAt: config.createdAt,
      updatedAt,
      rootPath: runDir,
      configPath,
      resultPath,
      summaryPath,
      trajectoriesPath: path.join(runDir, 'trajectories'),
      leaderboardPath,
      score: result.score,
      passRate: result.passRate,
      costUsd: result.costUsd,
      subscriptionLimitUsage: result.subscriptionLimitUsage,
      runtimeMs: result.runtimeMs,
      failures: result.failures,
      tasks: result.tasks,
      telemetryMetadata: {
        source: config.source,
        run_id: config.runId,
        bench: config.bench,
        runner_mode: config.runnerMode,
      },
      leaderboard,
      summaryMarkdown: await readOptionalText(summaryPath),
    }
  }
}

export function listEvalBenchIds(): readonly EvalBench[] {
  return EVAL_BENCHES
}
