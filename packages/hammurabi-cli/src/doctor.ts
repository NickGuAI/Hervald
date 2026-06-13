import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  defaultConfigPath,
  normalizeEndpoint,
  readHammurabiConfig,
  type HammurabiConfig,
} from './config.js'
import {
  APP_PATH_FILE,
  BOOTSTRAP_KEY_FILE,
  resolveAppDir,
} from './up.js'
import {
  formatStatusLine,
  printHervaldBrand,
} from './terminal-style.js'

export type DoctorState = 'pass' | 'warn' | 'fail'

export interface DoctorCheck {
  label: string
  state: DoctorState
  detail: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  onboardingUrl: string | null
  config: HammurabiConfig | null
}

export interface DoctorOptions {
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  configPath?: string
}

function stateLabel(state: DoctorState): string {
  return state === 'pass' ? 'ready' : state === 'warn' ? 'needs attention' : 'missing'
}

function localMachineEnvFile(env: NodeJS.ProcessEnv): string {
  return env.HAMMURABI_LOCAL_MACHINE_ENV_FILE?.trim() || path.join(homedir(), '.hammurabi-env')
}

function readAppPathFile(): string | null {
  try {
    return readFileSync(APP_PATH_FILE, 'utf8').trim() || null
  } catch {
    return null
  }
}

function buildAuthHeaders(config: HammurabiConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.apiKey}`,
  }
}

async function fetchOnboardingStatus(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; summary: string }> {
  const url = new URL('/api/onboarding/status', `${normalizeEndpoint(config.endpoint)}/`).toString()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(config),
    })
    if (!response.ok) {
      return { ok: false, summary: `server returned ${response.status}` }
    }
    const raw = await response.text()
    if (raw.trim().length === 0) {
      return {
        ok: false,
        summary: `empty response from ${url}; run hammurabi up --dev after configuring App path`,
      }
    }
    const payload = JSON.parse(raw) as {
      currentStepId?: unknown
      providers?: Array<{ label?: unknown; state?: unknown }>
      machines?: Array<{ id?: unknown; state?: unknown }>
    }
    const readyProviders = Array.isArray(payload.providers)
      ? payload.providers.filter((provider) => provider.state === 'ready').length
      : 0
    const readyMachines = Array.isArray(payload.machines)
      ? payload.machines.filter((machine) => machine.state === 'ready').length
      : 0
    return {
      ok: true,
      summary: `step=${String(payload.currentStepId ?? 'unknown')} · providers=${readyProviders} ready · machines=${readyMachines} ready`,
    }
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error
        ? `${error.message}; run hammurabi up --dev after configuring App path`
        : 'server unreachable; run hammurabi up --dev after configuring App path',
    }
  }
}

export async function buildDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env
  const configPath = options.configPath ?? defaultConfigPath()
  const fetchImpl = options.fetchImpl ?? fetch
  const checks: DoctorCheck[] = []
  const config = await readHammurabiConfig(configPath)
  const appDir = resolveAppDir(env)
  const appPathFileValue = readAppPathFile()
  const dataDir = env.HAMMURABI_DATA_DIR?.trim() || path.join(homedir(), '.hammurabi')
  const envFile = localMachineEnvFile(env)

  checks.push({
    label: 'CLI config',
    state: config ? 'pass' : 'warn',
    detail: config ? configPath : `not configured at ${configPath}; run hammurabi onboard if this CLI should call a remote server`,
  })

  checks.push({
    label: 'App path',
    state: appDir && existsSync(path.join(appDir, 'package.json')) ? 'pass' : 'fail',
    detail: appDir ?? appPathFileValue ?? `missing ${APP_PATH_FILE}; set HAMMURABI_APP_DIR or run apps/hammurabi/install.sh`,
  })

  checks.push({
    label: 'Data directory',
    state: existsSync(dataDir) ? 'pass' : 'warn',
    detail: dataDir,
  })

  checks.push({
    label: 'Bootstrap key',
    state: existsSync(BOOTSTRAP_KEY_FILE) ? 'pass' : 'warn',
    detail: BOOTSTRAP_KEY_FILE,
  })

  checks.push({
    label: 'Local machine env',
    state: existsSync(envFile) ? 'pass' : 'warn',
    detail: existsSync(envFile) ? envFile : `${envFile}; run apps/hammurabi/install.sh or set HAMMURABI_LOCAL_MACHINE_ENV_FILE`,
  })

  if (config) {
    const serverStatus = await fetchOnboardingStatus(config, fetchImpl)
    checks.push({
      label: 'Browser onboarding API',
      state: serverStatus.ok ? 'pass' : 'warn',
      detail: serverStatus.summary,
    })
  }

  return {
    checks,
    onboardingUrl: config ? `${normalizeEndpoint(config.endpoint)}/welcome` : null,
    config,
  }
}

export function printDoctorReport(
  report: DoctorReport,
  write: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
): void {
  printHervaldBrand('Hervald Doctor', write)

  for (const check of report.checks) {
    write(`${formatStatusLine(check.state, check.label, stateLabel(check.state), check.detail)}\n`)
  }

  write('\n')
  write('Next\n')
  if (report.onboardingUrl) {
    write(`  1. Open ${report.onboardingUrl}\n`)
    write('  2. Complete the browser onboarding guide\n')
  } else {
    write('  1. Run hammurabi onboard if this CLI should connect to a server\n')
    write('  2. Start the local app with hammurabi up\n')
  }
  write('  3. Re-run hammurabi doctor after provider authentication\n')
}

export async function runDoctorCli(args: readonly string[] = []): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: hammurabi doctor\n')
    process.stdout.write('\n')
    process.stdout.write('  Print terminal readiness for Hervald first-run onboarding.\n')
    return 0
  }

  const report = await buildDoctorReport()
  printDoctorReport(report)
  return report.checks.some((check) => check.state === 'fail') ? 1 : 0
}
