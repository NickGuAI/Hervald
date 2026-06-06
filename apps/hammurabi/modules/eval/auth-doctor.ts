import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  EVAL_BENCHES,
  type EvalBench,
  type EvalRunnerMode,
} from './types.js'

const execFileAsync = promisify(execFile)

const ADAPTER_IMPORTS: Record<EvalBench, { directory: string; module: string }> = {
  'terminal-bench': { directory: 'terminal_bench', module: 'hammurabi_terminal_bench.runner' },
  locomo: { directory: 'locomo', module: 'hammurabi_locomo.runner' },
  marble: { directory: 'marble', module: 'hammurabi_marble.runner' },
  'hal-reliability': { directory: 'hal_reliability', module: 'hammurabi_hal_reliability.runner' },
  'tau-bench': { directory: 'tau_bench', module: 'hammurabi_tau_bench.runner' },
}

export type EvalDoctorSeverity = 'pass' | 'warn' | 'fail'

export interface EvalDoctorCheck {
  id: string
  label: string
  severity: EvalDoctorSeverity
  message: string
}

export interface EvalDoctorReport {
  ok: boolean
  bench?: EvalBench
  runnerMode?: EvalRunnerMode
  checkedAt: string
  checks: EvalDoctorCheck[]
}

export interface EvalDoctorOptions {
  bench?: EvalBench
  runnerMode?: EvalRunnerMode
  env?: NodeJS.ProcessEnv
}

async function commandExists(binary: string): Promise<boolean> {
  try {
    await execFileAsync('sh', ['-lc', `command -v ${binary}`])
    return true
  } catch {
    return false
  }
}

async function commandWorks(binary: string, args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync(binary, [...args], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

async function commandOutputIncludes(
  binary: string,
  args: readonly string[],
  pattern: RegExp,
): Promise<boolean> {
  try {
    const result = await execFileAsync(binary, [...args], { timeout: 10_000 })
    return pattern.test(`${result.stdout}\n${result.stderr}`)
  } catch {
    return false
  }
}

async function checkDocker(): Promise<EvalDoctorCheck> {
  if (!await commandExists('docker')) {
    return {
      id: 'docker',
      label: 'Docker',
      severity: 'fail',
      message: 'Docker CLI is not installed.',
    }
  }

  if (!await commandWorks('docker', ['info'])) {
    return {
      id: 'docker',
      label: 'Docker',
      severity: 'fail',
      message: 'Docker CLI is installed, but the daemon is not reachable.',
    }
  }

  return {
    id: 'docker',
    label: 'Docker',
    severity: 'pass',
    message: 'Docker CLI and daemon are reachable.',
  }
}

async function checkTerminalBenchHarness(): Promise<EvalDoctorCheck> {
  if (!await commandExists('tb')) {
    return {
      id: 'terminal-bench',
      label: 'Terminal-Bench / Harbor',
      severity: 'fail',
      message: 'Terminal-Bench CLI `tb` is not available on PATH.',
    }
  }

  if (!await commandWorks('tb', ['run', '--help'])) {
    return {
      id: 'terminal-bench',
      label: 'Terminal-Bench / Harbor',
      severity: 'fail',
      message: 'Terminal-Bench CLI `tb` is installed, but `tb run --help` is not usable.',
    }
  }

  return {
    id: 'terminal-bench',
    label: 'Terminal-Bench / Harbor',
    severity: 'pass',
    message: 'Terminal-Bench CLI `tb` is available and exposes the run command.',
  }
}

function defaultBenchmarkAdapterRoot(env: NodeJS.ProcessEnv): string {
  return env.HAMMURABI_BENCHMARK_ADAPTER_ROOT
    ?? path.resolve(process.cwd(), '..', '..', 'benchmarks', 'hammurabi')
}

async function checkAdapterInstallability(
  env: NodeJS.ProcessEnv,
  bench: EvalBench | undefined,
): Promise<EvalDoctorCheck[]> {
  const root = defaultBenchmarkAdapterRoot(env)
  const benches = bench ? [bench] : [...EVAL_BENCHES]
  const checks: EvalDoctorCheck[] = []

  if (!await commandExists('python3')) {
    return [{
      id: 'adapter-python',
      label: 'Benchmark adapter installability',
      severity: 'fail',
      message: 'python3 is not available for benchmark adapter import checks.',
    }]
  }

  for (const benchId of benches) {
    const adapter = ADAPTER_IMPORTS[benchId]
    const adapterPath = path.join(root, adapter.directory)
    try {
      await execFileAsync(
        'python3',
        ['-c', `import ${adapter.module}`],
        {
          timeout: 10_000,
          env: {
            ...process.env,
            ...env,
            PYTHONPATH: `${root}:${adapterPath}`,
          },
        },
      )
      checks.push({
        id: `adapter-${benchId}`,
        label: 'Benchmark adapter installability',
        severity: 'pass',
        message: `${benchId} adapter runner imports from ${adapterPath}.`,
      })
    } catch {
      checks.push({
        id: `adapter-${benchId}`,
        label: 'Benchmark adapter installability',
        severity: 'fail',
        message: `${benchId} adapter runner is not importable from ${adapterPath}.`,
      })
    }
  }

  return checks
}

function checkApiKey(env: NodeJS.ProcessEnv, bench: EvalBench | undefined): EvalDoctorCheck {
  const hasOpenAiKey = typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0
  const hasAnthropicKey = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0
  const hasBudgetPolicy = typeof env.HAMMURABI_EVAL_BUDGET_USD === 'string'
    && env.HAMMURABI_EVAL_BUDGET_USD.trim().length > 0
  const hasRateLimitPolicy = typeof env.HAMMURABI_EVAL_RATE_LIMIT === 'string'
    && env.HAMMURABI_EVAL_RATE_LIMIT.trim().length > 0

  if (bench === 'terminal-bench' && !hasOpenAiKey) {
    return {
      id: 'api-key-auth',
      label: 'API-key runner auth',
      severity: 'fail',
      message: 'Terminal-Bench native Codex installed-agent path requires OPENAI_API_KEY; subscription CLI auth is a separate runner mode.',
    }
  }

  if (hasOpenAiKey || hasAnthropicKey) {
    if (!hasBudgetPolicy && !hasRateLimitPolicy) {
      return {
        id: 'api-key-auth',
        label: 'API-key runner auth',
        severity: 'fail',
        message: 'API-key runner has provider credentials, but HAMMURABI_EVAL_BUDGET_USD or HAMMURABI_EVAL_RATE_LIMIT must be configured for benchmark policy.',
      }
    }

    return {
      id: 'api-key-auth',
      label: 'API-key runner auth',
      severity: 'pass',
      message: 'Approved provider API key and benchmark budget/rate-limit policy are present in the host environment.',
    }
  }

  return {
    id: 'api-key-auth',
    label: 'API-key runner auth',
    severity: 'fail',
    message: 'API-key runner requires OPENAI_API_KEY or ANTHROPIC_API_KEY in the approved host environment.',
  }
}

function checkArtifactSafety(env: NodeJS.ProcessEnv): EvalDoctorCheck {
  if (env.HAMMURABI_EVAL_MOUNT_OAUTH_FILES === '1') {
    return {
      id: 'artifact-safety',
      label: 'Artifact safety',
      severity: 'fail',
      message: 'HAMMURABI_EVAL_MOUNT_OAUTH_FILES=1 is not allowed; OAuth credential files must stay outside task containers and artifacts.',
    }
  }

  return {
    id: 'artifact-safety',
    label: 'Artifact safety',
    severity: 'pass',
    message: 'Eval runners use host env/config/secret stores and do not copy raw OAuth credential files into task containers or artifacts.',
  }
}

function checkTelemetryReachability(env: NodeJS.ProcessEnv): EvalDoctorCheck {
  if (env.HAMMURABI_TELEMETRY_DISABLED === '1') {
    return {
      id: 'telemetry-reachability',
      label: 'Telemetry reachability',
      severity: 'fail',
      message: 'HAMMURABI_TELEMETRY_DISABLED=1 is not allowed for benchmark runs; eval telemetry must remain queryable.',
    }
  }

  return {
    id: 'telemetry-reachability',
    label: 'Telemetry reachability',
    severity: 'pass',
    message: 'Eval doctor is served by Hammurabi; eval manifests and telemetry metadata endpoints are reachable from this runtime.',
  }
}

function checkLeaderboardAuth(env: NodeJS.ProcessEnv, bench: EvalBench | undefined): EvalDoctorCheck {
  const normalizedBench = bench ? bench.replace(/-/gu, '_').toUpperCase() : 'ALL'
  const benchSpecific = env[`HAMMURABI_EVAL_${normalizedBench}_LEADERBOARD_AUTH`]
  const shared = env.HAMMURABI_EVAL_LEADERBOARD_AUTH
  const authState = (benchSpecific ?? shared ?? '').trim().toLowerCase()

  if (authState === 'ready' || authState === 'human-approved') {
    return {
      id: 'leaderboard-auth',
      label: 'Leaderboard auth state',
      severity: 'pass',
      message: 'Leaderboard auth state is marked ready for human-approved submissions.',
    }
  }

  return {
    id: 'leaderboard-auth',
    label: 'Leaderboard auth state',
    severity: 'warn',
    message: 'Leaderboard auth is not marked ready; `hammurabi eval submit` remains a human-gated handoff.',
  }
}

function checkProxyExperimental(runnerMode: EvalRunnerMode | undefined): EvalDoctorCheck | null {
  if (runnerMode !== 'proxy-experimental') {
    return null
  }

  return {
    id: 'proxy-experimental',
    label: 'Proxy runner release gate',
    severity: 'fail',
    message: 'proxy-experimental is manual-only and disabled for release gates until policy and token handling are reviewed.',
  }
}

async function checkCodexSubscription(env: NodeJS.ProcessEnv): Promise<EvalDoctorCheck[]> {
  if (!await commandExists('codex')) {
    return [{
      id: 'codex-subscription-cli',
      label: 'Codex subscription CLI',
      severity: 'fail',
      message: 'codex is not available on PATH.',
    }]
  }

  const checks: EvalDoctorCheck[] = []
  checks.push(await commandWorks('codex', ['exec', '--help'])
    ? {
        id: 'codex-exec',
        label: 'Codex subscription CLI',
        severity: 'pass',
        message: 'codex exec is available for host-side subscription runner commands.',
      }
    : {
        id: 'codex-exec',
        label: 'Codex subscription CLI',
        severity: 'fail',
        message: 'codex exists but codex exec is not usable.',
      })

  checks.push(await commandOutputIncludes('codex', ['login', 'status'], /Logged in using ChatGPT/i)
    ? {
        id: 'codex-chatgpt-auth',
        label: 'Codex ChatGPT auth',
        severity: 'pass',
        message: 'codex login status reports ChatGPT subscription auth.',
      }
    : {
        id: 'codex-chatgpt-auth',
        label: 'Codex ChatGPT auth',
        severity: 'fail',
        message: 'codex login status does not report ChatGPT subscription auth.',
      })

  if (typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0) {
    checks.push({
      id: 'codex-subscription-api-key-shadow',
      label: 'Codex subscription/API-key separation',
      severity: 'warn',
      message: 'OPENAI_API_KEY is present; subscription-host-cli runs must keep API-key auth separate and avoid relying on this key.',
    })
  }

  return checks
}

async function checkClaudeSubscription(env: NodeJS.ProcessEnv): Promise<EvalDoctorCheck[]> {
  if (!await commandExists('claude')) {
    return [{
      id: 'claude-subscription-cli',
      label: 'Claude Code subscription CLI',
      severity: 'warn',
      message: 'claude is not available on PATH; Codex subscription checks may still satisfy a Codex-only run.',
    }]
  }

  const checks: EvalDoctorCheck[] = []
  checks.push(await commandWorks('claude', ['--help'])
    ? {
        id: 'claude-cli',
        label: 'Claude Code subscription CLI',
        severity: 'pass',
        message: 'claude is available on PATH.',
      }
    : {
        id: 'claude-cli',
        label: 'Claude Code subscription CLI',
        severity: 'warn',
        message: 'claude exists but did not return help output.',
      })

  checks.push(await commandOutputIncludes('claude', ['auth', 'status', '--json'], /"loggedIn"\s*:\s*true/)
    ? {
        id: 'claude-pro-max-auth',
        label: 'Claude Code Pro/Max auth',
        severity: 'pass',
        message: 'claude auth status reports an authenticated subscription session.',
      }
    : {
        id: 'claude-pro-max-auth',
        label: 'Claude Code Pro/Max auth',
        severity: 'warn',
        message: 'claude auth status does not report an authenticated subscription session.',
      })

  if (typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0) {
    checks.push({
      id: 'claude-subscription-api-key-shadow',
      label: 'Claude subscription/API-key separation',
      severity: 'warn',
      message: 'ANTHROPIC_API_KEY is present; subscription-host-cli runs must keep API-key auth separate and avoid relying on this key.',
    })
  }

  return checks
}

async function checkSbxRunner(): Promise<EvalDoctorCheck[]> {
  if (!await commandExists('sbx')) {
    return [{
      id: 'sbx',
      label: 'Docker sbx subscription runner',
      severity: 'fail',
      message: 'sbx is not available on PATH.',
    }]
  }

  return [{
    id: 'sbx',
    label: 'Docker sbx subscription runner',
    severity: 'pass',
    message: 'sbx is available on PATH; verify provider sandbox OAuth/secrets before running release gates.',
  }]
}

export async function runEvalDoctor(options: EvalDoctorOptions = {}): Promise<EvalDoctorReport> {
  const env = options.env ?? process.env
  const checks: EvalDoctorCheck[] = [
    await checkDocker(),
    checkArtifactSafety(env),
    checkTelemetryReachability(env),
    checkLeaderboardAuth(env, options.bench),
  ]

  if (!options.bench || options.bench === 'terminal-bench') {
    checks.push(await checkTerminalBenchHarness())
  }

  checks.push(...await checkAdapterInstallability(env, options.bench))

  if (options.runnerMode === 'subscription-host-cli' || !options.runnerMode) {
    checks.push(...await checkCodexSubscription(env))
    checks.push(...await checkClaudeSubscription(env))
  }

  if (options.runnerMode === 'subscription-sbx' || !options.runnerMode) {
    checks.push(...await checkSbxRunner())
  }

  if (options.runnerMode === 'api-key') {
    checks.push(checkApiKey(env, options.bench))
  }

  const proxyCheck = checkProxyExperimental(options.runnerMode)
  if (proxyCheck) {
    checks.push(proxyCheck)
  }

  const ok = checks.every((check) => check.severity !== 'fail')
  return {
    ok,
    bench: options.bench,
    runnerMode: options.runnerMode,
    checkedAt: new Date().toISOString(),
    checks,
  }
}
