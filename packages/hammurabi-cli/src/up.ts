import { execSync as nodeExecSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { syncManagedAgentTelemetryFromSavedConfig } from './agent-telemetry.js'

export interface UpOptions {
  appDir: string
  port?: number
  dev?: boolean
  env?: NodeJS.ProcessEnv
}

export const APP_PATH_FILE = path.join(homedir(), '.hammurabi', 'app-path')
export const BOOTSTRAP_KEY_FILE = path.join(homedir(), '.hammurabi', 'bootstrap-key.txt')
export const TMUX_SESSION = 'hammurabi-dev'
export const DEFAULT_PORT = 20001

export function resolveAppDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.HAMMURABI_APP_DIR?.trim()
  if (override) {
    return override
  }

  try {
    if (existsSync(APP_PATH_FILE)) {
      const raw = readFileSync(APP_PATH_FILE, 'utf8').trim()
      if (raw) return raw
    }
  } catch {
    // fall through
  }

  return null
}

export function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function loadDotenv(appDir: string): Record<string, string> {
  const envFile = path.join(appDir, '.env')
  if (!existsSync(envFile)) return {}
  try {
    return parseDotenv(readFileSync(envFile, 'utf8'))
  } catch {
    return {}
  }
}

export interface ParsedArgs {
  port?: number
  dev: boolean
  help: boolean
  error?: string
}

export function parseUpArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { dev: false, help: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (arg === '--dev') {
      parsed.dev = true
      continue
    }
    if (arg === '--port') {
      const next = args[i + 1]
      if (!next) {
        parsed.error = '--port requires a value'
        return parsed
      }
      const n = Number(next)
      if (!Number.isInteger(n) || n <= 0) {
        parsed.error = `invalid port: ${next}`
        return parsed
      }
      parsed.port = n
      i += 1
      continue
    }
    if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length)
      const n = Number(value)
      if (!Number.isInteger(n) || n <= 0) {
        parsed.error = `invalid port: ${value}`
        return parsed
      }
      parsed.port = n
      continue
    }
    parsed.error = `unknown argument: ${arg}`
    return parsed
  }
  return parsed
}

function printUpUsage(write: (chunk: string) => void): void {
  write('Usage: hammurabi up [--dev] [--port <port>]\n')
  write('\n')
  write('  Start the Hammurabi server locally.\n')
  write('\n')
  write('Options:\n')
  write('  --dev          Run in managed tmux session with hot reload\n')
  write('  --port <port>  Override server port (default 20001)\n')
  write('  -h, --help     Show this help\n')
  write('\n')
  write('The app directory is resolved in this order:\n')
  write('  1. $HAMMURABI_APP_DIR\n')
  write(`  2. ${APP_PATH_FILE}\n`)
  write('\n')
  write('Run apps/hammurabi/install.sh once to initialize both.\n')
}

// ---------------------------------------------------------------------------
// Launch planning (pure, testable)
// ---------------------------------------------------------------------------

export interface LaunchPlan {
  mode: 'tmux' | 'foreground'
  appDir: string
  port: number
  script: string
  env: Record<string, string>
  session: string | null
}

export function planLaunch(
  parsed: ParsedArgs,
  appDir: string,
  dotenv: Record<string, string>,
): LaunchPlan {
  const port = parsed.port ?? (Number(dotenv.PORT) || DEFAULT_PORT)
  const script = parsed.dev ? 'dev' : 'start'
  const nodeEnv = parsed.dev ? 'development' : 'production'

  return {
    mode: parsed.dev ? 'tmux' : 'foreground',
    appDir,
    port,
    script,
    env: { ...dotenv, PORT: String(port), NODE_ENV: nodeEnv },
    session: parsed.dev ? TMUX_SESSION : null,
  }
}

export function resolveLaunchScript(appDir: string): string {
  return path.resolve(appDir, '../../operations/scripts/launch_hammurabi.sh')
}

export interface ManagedLaunchInvocation {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export function buildManagedLaunchInvocation(plan: LaunchPlan): ManagedLaunchInvocation {
  const args = [resolveLaunchScript(plan.appDir), '--dev', '--port', String(plan.port)]
  if (plan.session) {
    args.push('--session-name', plan.session)
  }

  return {
    command: 'bash',
    args,
    cwd: plan.appDir,
    env: {
      ...process.env,
      ...plan.env,
      HAMMURABI_APP_DIR: plan.appDir,
    } as Record<string, string>,
  }
}

// ---------------------------------------------------------------------------
// Port cleanup — kills the real listener, not just session metadata
// ---------------------------------------------------------------------------

export function findPortListeners(
  port: number,
  exec: (cmd: string) => string = (cmd) => nodeExecSync(cmd, { encoding: 'utf8' }),
): number[] {
  try {
    const output = exec(`lsof -ti :${port}`).trim()
    if (!output) return []
    return output
      .split('\n')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
  } catch {
    // lsof exits non-zero when no process matches — port is free
    return []
  }
}

export function killPortListeners(
  port: number,
  deps: {
    findListeners?: typeof findPortListeners
    kill?: (pid: number, signal: NodeJS.Signals) => void
  } = {},
): number {
  const find = deps.findListeners ?? findPortListeners
  const kill =
    deps.kill ?? ((pid: number, sig: NodeJS.Signals) => process.kill(pid, sig))

  const pids = find(port)
  if (pids.length === 0) return 0

  // Graceful shutdown first
  for (const pid of pids) {
    try {
      kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }

  // Brief pause, then force-kill survivors
  spawnSync('sleep', ['0.5'])

  const survivors = find(port)
  for (const pid of survivors) {
    try {
      kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }

  return pids.length
}

function runManagedLaunch(plan: LaunchPlan): number {
  const invocation = buildManagedLaunchInvocation(plan)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: 'inherit',
  })

  if (result.error) {
    process.stderr.write(
      `hammurabi up --dev: failed to launch managed starter: ${result.error.message}\n`,
    )
    return 1
  }

  return typeof result.status === 'number' ? result.status : 1
}

function runForegroundLaunch(plan: LaunchPlan): Promise<number> {
  process.stdout.write(`Starting Hammurabi (${plan.script}) on port ${plan.port}\n`)
  process.stdout.write(`  app: ${plan.appDir}\n`)
  process.stdout.write('  press Ctrl+C to stop\n\n')

  const child = spawn('pnpm', ['run', plan.script], {
    cwd: plan.appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...plan.env,
    },
  })

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  return new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        process.stdout.write(`\nHammurabi stopped (${signal}).\n`)
        resolve(0)
        return
      }
      resolve(code ?? 0)
    })
    child.on('error', (err) => {
      process.stderr.write(
        `hammurabi up: failed to start pnpm: ${err.message}\n`,
      )
      resolve(1)
    })
  })
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function runUpCli(args: readonly string[]): Promise<number> {
  const parsed = parseUpArgs(args)
  if (parsed.help) {
    printUpUsage((chunk) => process.stdout.write(chunk))
    return 0
  }
  if (parsed.error) {
    process.stderr.write(`hammurabi up: ${parsed.error}\n`)
    printUpUsage((chunk) => process.stderr.write(chunk))
    return 1
  }

  const appDir = resolveAppDir()
  if (!appDir) {
    process.stderr.write(
      'hammurabi up: app directory not set. Run apps/hammurabi/install.sh or export HAMMURABI_APP_DIR.\n',
    )
    return 1
  }
  if (!existsSync(path.join(appDir, 'package.json'))) {
    process.stderr.write(
      `hammurabi up: app directory ${appDir} is not a Hammurabi install (missing package.json).\n`,
    )
    return 1
  }

  const dotenv = loadDotenv(appDir)
  const plan = planLaunch(parsed, appDir, dotenv)
  const telemetrySync = await syncManagedAgentTelemetryFromSavedConfig()

  if (telemetrySync.config && telemetrySync.configured.length > 0) {
    process.stdout.write(
      `Synced agent telemetry to ${telemetrySync.config.endpoint} for ${telemetrySync.configured.join(', ')}\n`,
    )
  }
  for (const failure of telemetrySync.failed) {
    process.stderr.write(
      `hammurabi up: warning: failed to sync ${failure.agent} telemetry: ${failure.error.message}\n`,
    )
  }

  if (existsSync(BOOTSTRAP_KEY_FILE)) {
    process.stdout.write(`Bootstrap API key file: ${BOOTSTRAP_KEY_FILE}\n`)
  }
  process.stdout.write(
    `  Open http://localhost:${plan.port} to sign in.\n`,
  )

  if (plan.mode === 'tmux') {
    return runManagedLaunch(plan)
  }

  // Foreground launches still clean the live listener directly.
  const killed = killPortListeners(plan.port)
  if (killed > 0) {
    process.stdout.write(
      `Cleaned up ${killed} existing process(es) on port ${plan.port}\n`,
    )
  }

  return runForegroundLaunch(plan)
}
