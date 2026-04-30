import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildLoginShellBootstrap,
  buildLoginShellCommand,
  buildSshArgs,
  isRemoteMachine,
  prepareMachineLaunchEnvironment,
  runCapturedCommand,
  shellEscape,
} from './machines.js'
import type { CapturedCommandResult, MachineConfig } from './types.js'

export const MACHINE_AUTH_PROVIDERS = ['claude', 'codex', 'gemini'] as const

export type MachineAuthProvider = (typeof MACHINE_AUTH_PROVIDERS)[number]
export type MachineAuthMode = 'setup-token' | 'api-key' | 'device-auth'
export type MachineAuthMethod = MachineAuthMode | 'login' | 'missing'

export interface MachineProviderAuthStatus {
  provider: MachineAuthProvider
  label: string
  installed: boolean
  version: string | null
  envConfigured: boolean
  envSourceKey: string | null
  loginConfigured: boolean
  configured: boolean
  currentMethod: MachineAuthMethod
  verificationCommand: string
}

export interface MachineAuthStatusReport {
  machineId: string
  envFile: string | null
  checkedAt: string
  providers: Record<MachineAuthProvider, MachineProviderAuthStatus>
}

const MACHINE_AUTH_LABELS: Record<MachineAuthProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
}

const MACHINE_AUTH_VERSION_COMMANDS: Record<MachineAuthProvider, string> = {
  claude: 'claude --version',
  codex: 'codex --version',
  gemini: 'gemini --version',
}

const MACHINE_AUTH_LOGIN_COMMANDS: Partial<Record<MachineAuthProvider, string>> = {
  claude: 'claude auth status',
  codex: 'codex login status',
}

const MACHINE_AUTH_VERIFICATION_COMMANDS: Record<MachineAuthProvider, string> = {
  claude: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
  codex: 'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
  gemini: 'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
}

function buildProviderEnvSourceCommand(provider: MachineAuthProvider): string {
  switch (provider) {
    case 'claude':
      return [
        'if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then echo CLAUDE_CODE_OAUTH_TOKEN',
        'elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then echo ANTHROPIC_API_KEY',
        'elif [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then echo ANTHROPIC_AUTH_TOKEN',
        'else echo missing',
        'fi',
      ].join('; ')
    case 'codex':
      return 'if [ -n "${OPENAI_API_KEY:-}" ]; then echo OPENAI_API_KEY; else echo missing; fi'
    case 'gemini':
      return [
        'if [ -n "${GEMINI_API_KEY:-}" ]; then echo GEMINI_API_KEY',
        'elif [ -n "${GOOGLE_API_KEY:-}" ]; then echo GOOGLE_API_KEY',
        'else echo missing',
        'fi',
      ].join('; ')
  }
}

export function buildProviderVersionCommand(provider: MachineAuthProvider): string {
  return MACHINE_AUTH_VERSION_COMMANDS[provider]
}

export function buildProviderLoginStatusCommand(provider: MachineAuthProvider): string | null {
  return MACHINE_AUTH_LOGIN_COMMANDS[provider] ?? null
}

export function buildProviderVerificationCommand(provider: MachineAuthProvider): string {
  return MACHINE_AUTH_VERIFICATION_COMMANDS[provider]
}

export function buildMachineAuthProbeScript(): string {
  const lines = ['set +e']
  for (const provider of MACHINE_AUTH_PROVIDERS) {
    const versionCommand = buildProviderVersionCommand(provider)
    lines.push(
      `printf 'version:${provider}:'; if command -v ${provider} >/dev/null 2>&1; then ${versionCommand} | head -n 1; else echo missing; fi`,
      `printf 'env:${provider}:'; ${buildProviderEnvSourceCommand(provider)}`,
    )
    const loginStatusCommand = buildProviderLoginStatusCommand(provider)
    if (loginStatusCommand) {
      lines.push(
        `printf 'login:${provider}:'; if command -v ${provider} >/dev/null 2>&1; then ${loginStatusCommand} >/dev/null 2>&1; echo $?; else echo missing; fi`,
      )
    } else {
      lines.push(`printf 'login:${provider}:'; echo n/a`)
    }
  }
  return lines.join('\n')
}

export function parseMachineAuthProbeOutput(args: {
  machineId: string
  envFile: string | null
  output: string
}): MachineAuthStatusReport {
  const versions = new Map<MachineAuthProvider, string>()
  const envSources = new Map<MachineAuthProvider, string>()
  const logins = new Map<MachineAuthProvider, string>()

  for (const rawLine of args.output.split(/\r?\n/g)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const match = /^(version|env|login):(claude|codex|gemini):(.*)$/.exec(line)
    if (!match) {
      continue
    }

    const [, category, providerValue, payloadValue] = match
    const provider = providerValue as MachineAuthProvider
    const payload = payloadValue.trim()
    if (category === 'version') {
      versions.set(provider, payload)
    } else if (category === 'env') {
      envSources.set(provider, payload)
    } else {
      logins.set(provider, payload)
    }
  }

  const providers = Object.fromEntries(
    MACHINE_AUTH_PROVIDERS.map((provider) => {
      const versionRaw = versions.get(provider) ?? 'missing'
      const installed = versionRaw !== 'missing'
      const version = installed ? versionRaw : null
      const envSourceRaw = envSources.get(provider) ?? 'missing'
      const envSourceKey = envSourceRaw !== 'missing' ? envSourceRaw : null
      const envConfigured = envSourceKey !== null
      const loginRaw = logins.get(provider) ?? 'n/a'
      const loginConfigured = loginRaw === '0'
      const currentMethod = resolveCurrentMethod(provider, envSourceKey, loginConfigured)

      return [
        provider,
        {
          provider,
          label: MACHINE_AUTH_LABELS[provider],
          installed,
          version,
          envConfigured,
          envSourceKey,
          loginConfigured,
          configured: installed && (envConfigured || loginConfigured),
          currentMethod,
          verificationCommand: buildProviderVerificationCommand(provider),
        } satisfies MachineProviderAuthStatus,
      ]
    }),
  ) as Record<MachineAuthProvider, MachineProviderAuthStatus>

  return {
    machineId: args.machineId,
    envFile: args.envFile,
    checkedAt: new Date().toISOString(),
    providers,
  }
}

function resolveCurrentMethod(
  provider: MachineAuthProvider,
  envSourceKey: string | null,
  loginConfigured: boolean,
): MachineAuthMethod {
  if (provider === 'claude') {
    if (envSourceKey === 'CLAUDE_CODE_OAUTH_TOKEN') {
      return 'setup-token'
    }
    if (envSourceKey === 'ANTHROPIC_API_KEY' || envSourceKey === 'ANTHROPIC_AUTH_TOKEN') {
      return 'api-key'
    }
    return loginConfigured ? 'login' : 'missing'
  }

  if (provider === 'codex') {
    if (envSourceKey === 'OPENAI_API_KEY') {
      return 'api-key'
    }
    return loginConfigured ? 'device-auth' : 'missing'
  }

  if (envSourceKey === 'GEMINI_API_KEY' || envSourceKey === 'GOOGLE_API_KEY') {
    return 'api-key'
  }
  return 'missing'
}

export async function runMachineAuthStatus(machine: MachineConfig): Promise<MachineAuthStatusReport> {
  const probeScript = buildMachineAuthProbeScript()
  const result = await runMachineShellScript(machine, probeScript, { timeoutMs: 20_000 })
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `Probe exited with code ${result.code}`
    throw new Error(detail)
  }

  return parseMachineAuthProbeOutput({
    machineId: machine.id,
    envFile: machine.envFile ?? null,
    output: result.stdout,
  })
}

export async function resolveMachineHomeDirectory(machine: MachineConfig): Promise<string> {
  const result = await runMachineShellScript(machine, 'printf %s "$HOME"', { timeoutMs: 10_000 })
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `Could not resolve $HOME for machine "${machine.id}"`
    throw new Error(detail)
  }

  const homeDir = result.stdout.trim()
  if (!homeDir) {
    throw new Error(`Machine "${machine.id}" returned an empty $HOME path`)
  }
  return homeDir
}

export async function readMachineTextFile(
  machine: MachineConfig,
  filePath: string,
): Promise<string> {
  if (!filePath.trim()) {
    return ''
  }

  if (!isRemoteMachine(machine)) {
    try {
      return await readFile(filePath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return ''
      }
      throw error
    }
  }

  const result = await runMachineShellScript(
    machine,
    `if [ -f ${shellEscape(filePath)} ]; then cat ${shellEscape(filePath)}; fi`,
    { timeoutMs: 10_000 },
  )
  if (result.code !== 0) {
    const detail = result.stderr.trim() || `Failed to read ${filePath}`
    throw new Error(detail)
  }
  return result.stdout
}

export async function writeMachineTextFile(
  machine: MachineConfig,
  filePath: string,
  contents: string,
): Promise<void> {
  const normalizedContents = contents.endsWith('\n') ? contents : `${contents}\n`

  if (!isRemoteMachine(machine)) {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, normalizedContents, 'utf8')
    await chmod(filePath, 0o600)
    return
  }

  const remoteCommand = buildLoginShellCommand(
    `umask 077; mkdir -p ${shellEscape(path.dirname(filePath))}; cat > ${shellEscape(filePath)}`,
    machine.cwd,
    machine.envFile,
  )
  const result = await runCommandWithStdin(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      ...buildSshArgs(machine, remoteCommand, false),
    ],
    normalizedContents,
    { timeoutMs: 15_000 },
  )

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `Failed to write ${filePath}`
    throw new Error(detail)
  }
}

export function upsertExportedEnvVars(
  existingContents: string,
  updates: Record<string, string | null>,
): string {
  const pendingUpdates = new Map(Object.entries(updates))
  const nextLines: string[] = []

  for (const rawLine of existingContents.split(/\r?\n/g)) {
    const line = rawLine
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
    if (!match) {
      if (line.length > 0) {
        nextLines.push(line)
      }
      continue
    }

    const key = match[1]
    if (!pendingUpdates.has(key)) {
      nextLines.push(line)
      continue
    }

    const value = pendingUpdates.get(key)
    pendingUpdates.delete(key)
    if (typeof value === 'string') {
      nextLines.push(`export ${key}=${shellEscape(value)}`)
    }
  }

  for (const [key, value] of pendingUpdates.entries()) {
    if (value === null) {
      continue
    }
    nextLines.push(`export ${key}=${shellEscape(value)}`)
  }

  return nextLines.length > 0 ? `${nextLines.join('\n')}\n` : ''
}

export function upsertTomlStringSetting(
  existingContents: string,
  key: string,
  value: string,
): string {
  const settingLine = `${key} = "${value.replace(/"/g, '\\"')}"`
  const lines = existingContents.split(/\r?\n/g)
  let replaced = false

  const nextLines = lines.map((line) => {
    if (/^\s*$/.test(line)) {
      return line
    }

    if (new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line)) {
      replaced = true
      return settingLine
    }

    return line
  })

  if (!replaced) {
    const compactLines = nextLines.filter((line) => line.length > 0)
    compactLines.push(settingLine)
    return `${compactLines.join('\n')}\n`
  }

  return `${nextLines.filter((line, index, array) => !(index === array.length - 1 && line.length === 0)).join('\n')}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function ensureCodexFileCredentialStore(
  machine: MachineConfig,
  homeDir: string,
): Promise<void> {
  const configPath = path.posix.join(homeDir, '.codex', 'config.toml')
  const existingContents = await readMachineTextFile(machine, configPath)
  const nextContents = upsertTomlStringSetting(
    existingContents,
    'cli_auth_credentials_store',
    'file',
  )

  if (nextContents !== existingContents) {
    await writeMachineTextFile(machine, configPath, nextContents)
  }
}

async function runMachineShellScript(
  machine: MachineConfig,
  script: string,
  options: { timeoutMs?: number } = {},
): Promise<CapturedCommandResult> {
  // The auth-status probe needs decrypted credentials in scope, but plaintext
  // env files may use shell expansion (e.g. `PATH=$PATH:/opt/bin`,
  // `HOME=${HOME}`) that only `. <file>` resolves correctly. So we branch on
  // envFile format:
  //
  //   - `.enc` files cannot be shell-sourced (ciphertext JSON) — use
  //     `prepareMachineLaunchEnvironment` to decrypt and inject entries via
  //     spawn `env` (local) or SSH SendEnv (remote). The `HAMMURABI_MACHINE_ENV_*`
  //     transport keys are decoded by the remote bootstrap. Stale-pointer /
  //     missing `.enc` is treated as empty entries by the helper, not as a
  //     hard failure (codex-review on PR #1270).
  //
  //   - Plaintext (or absent) envFiles keep the legacy `. <file> || true`
  //     shell-source pattern via `buildLoginShellBootstrap(envFile)` so shell
  //     expansions are evaluated correctly. This matches behavior before the
  //     `.enc` fix on PR #1269.
  //
  // See codex-review rounds on PR #1269 and PR #1270 for the bugs this guards.
  const envFile = machine.envFile?.trim()
  const isEncryptedEnvFile = envFile?.endsWith('.enc') ?? false

  if (isEncryptedEnvFile) {
    const prepared = prepareMachineLaunchEnvironment(machine, process.env)

    if (isRemoteMachine(machine)) {
      return await runCapturedCommand(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=10',
          ...buildSshArgs(
            machine,
            buildLoginShellCommand(script, machine.cwd, undefined),
            false,
            undefined,
            prepared.sshSendEnvKeys,
          ),
        ],
        { timeoutMs: options.timeoutMs, env: prepared.env },
      )
    }

    const encLocalScript = [
      buildLoginShellBootstrap(undefined),
      machine.cwd ? `cd ${shellEscape(machine.cwd)}` : null,
      script,
    ]
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .join('; ')

    return await runCapturedCommand('/bin/bash', ['-lc', encLocalScript], {
      cwd: machine.cwd,
      timeoutMs: options.timeoutMs,
      env: prepared.env,
    })
  }

  // Plaintext or absent envFile path — preserve legacy shell-source semantics
  // so shell expansions in the env file evaluate against the live shell env.
  if (isRemoteMachine(machine)) {
    return await runCapturedCommand(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        ...buildSshArgs(machine, buildLoginShellCommand(script, machine.cwd, machine.envFile), false),
      ],
      { timeoutMs: options.timeoutMs },
    )
  }

  const localScript = [
    buildLoginShellBootstrap(machine.envFile),
    machine.cwd ? `cd ${shellEscape(machine.cwd)}` : null,
    script,
  ]
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .join('; ')

  return await runCapturedCommand('/bin/bash', ['-lc', localScript], {
    cwd: machine.cwd,
    timeoutMs: options.timeoutMs,
  })
}

async function runCommandWithStdin(
  command: string,
  args: string[],
  stdinText: string,
  options: { timeoutMs?: number } = {},
): Promise<CapturedCommandResult> {
  return await new Promise<CapturedCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timer: NodeJS.Timeout | undefined

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code: number | null, signal: string | null) => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
        signal,
        timedOut,
      })
    })

    child.stdin?.end(stdinText)

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, options.timeoutMs)
    }
  })
}
