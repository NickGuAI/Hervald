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
import {
  listMachineProviders,
  type MachineAuthMethod,
  type MachineAuthMode,
  type MachineProviderAdapter,
} from './providers/machine-provider-adapter.js'
import type { CapturedCommandResult, MachineConfig } from './types.js'

export type MachineAuthProvider = string

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
  providers: Record<string, MachineProviderAuthStatus>
}

function getMachineProviderOrThrow(providerId: string): MachineProviderAdapter {
  const provider = listMachineProviders().find((entry) => entry.id === providerId)
  if (!provider) {
    throw new Error(`Unknown machine auth provider "${providerId}"`)
  }
  return provider
}

function buildProviderEnvSourceCommand(provider: MachineProviderAdapter): string {
  if (provider.authEnvKeys.length === 0) {
    return 'echo missing'
  }

  const checks = provider.authEnvKeys.map((key, index) => {
    const prefix = index === 0 ? 'if' : 'elif'
    return `${prefix} [ -n "\${${key}:-}" ]; then echo ${key}`
  })
  return [...checks, 'else echo missing', 'fi'].join('; ')
}

export function buildProviderVersionCommand(provider: MachineAuthProvider): string {
  const resolvedProvider = getMachineProviderOrThrow(provider)
  return `${resolvedProvider.cliBinaryName} --version`
}

export function buildProviderLoginStatusCommand(provider: MachineAuthProvider): string | null {
  return getMachineProviderOrThrow(provider).loginStatusCommand
}

export function buildProviderVerificationCommand(provider: MachineAuthProvider): string {
  const resolvedProvider = getMachineProviderOrThrow(provider)
  const envChecks = resolvedProvider.authEnvKeys
    .map((key) => `test -n "$${key}"`)
    .join(' || ')
  const authClause = resolvedProvider.loginStatusCommand
    ? `${envChecks ? `${envChecks} || ` : ''}${resolvedProvider.loginStatusCommand}`
    : (envChecks || 'true')
  return `${resolvedProvider.cliBinaryName} --version && (${authClause})`
}

export function buildMachineAuthProbeScript(): string {
  const lines = ['set +e']
  for (const provider of listMachineProviders()) {
    const versionCommand = buildProviderVersionCommand(provider.id)
    lines.push(
      `printf 'version:${provider.id}:'; if command -v ${provider.cliBinaryName} >/dev/null 2>&1; then ${versionCommand} | head -n 1; else echo missing; fi`,
      `printf 'env:${provider.id}:'; ${buildProviderEnvSourceCommand(provider)}`,
    )
    const loginStatusCommand = buildProviderLoginStatusCommand(provider.id)
    if (loginStatusCommand) {
      lines.push(
        `printf 'login:${provider.id}:'; if command -v ${provider.cliBinaryName} >/dev/null 2>&1; then ${loginStatusCommand} >/dev/null 2>&1; echo $?; else echo missing; fi`,
      )
    } else {
      lines.push(`printf 'login:${provider.id}:'; echo n/a`)
    }
  }
  return lines.join('\n')
}

export function parseMachineAuthProbeOutput(args: {
  machineId: string
  envFile: string | null
  output: string
}): MachineAuthStatusReport {
  const registeredProviders = listMachineProviders()
  const providerIds = registeredProviders.map((provider) => provider.id)
  const versions = new Map<string, string>()
  const envSources = new Map<string, string>()
  const logins = new Map<string, string>()
  const categoryPattern = new RegExp(`^(version|env|login):(${providerIds.join('|')}):(.*)$`)

  for (const rawLine of args.output.split(/\r?\n/g)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const match = categoryPattern.exec(line)
    if (!match) {
      continue
    }

    const [, category, providerValue, payloadValue] = match
    const provider = providerValue.trim()
    const payload = payloadValue.trim()
    if (category === 'version') {
      versions.set(provider, payload)
    } else if (category === 'env') {
      envSources.set(provider, payload)
    } else {
      logins.set(provider, payload)
    }
  }

  const providerStatuses = Object.fromEntries(
    registeredProviders.map((provider) => {
      const versionRaw = versions.get(provider.id) ?? 'missing'
      const installed = versionRaw !== 'missing'
      const version = installed ? versionRaw : null
      const envSourceRaw = envSources.get(provider.id) ?? 'missing'
      const envSourceKey = envSourceRaw !== 'missing' ? envSourceRaw : null
      const envConfigured = envSourceKey !== null
      const loginRaw = logins.get(provider.id) ?? 'n/a'
      const loginConfigured = loginRaw === '0'
      const currentMethod = provider.classifyAuthMethod({ envSourceKey, loginConfigured })

      return [
        provider.id,
        {
          provider: provider.id,
          label: provider.label,
          installed,
          version,
          envConfigured,
          envSourceKey,
          loginConfigured,
          configured: installed && (envConfigured || loginConfigured),
          currentMethod,
          verificationCommand: buildProviderVerificationCommand(provider.id),
        } satisfies MachineProviderAuthStatus,
      ]
    }),
  ) as Record<string, MachineProviderAuthStatus>

  return {
    machineId: args.machineId,
    envFile: args.envFile,
    checkedAt: new Date().toISOString(),
    providers: providerStatuses,
  }
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
  //   - Plaintext (or absent) envFiles keep the existing `. <file> || true`
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

  // Plaintext or absent envFile path — preserve the existing shell-source semantics
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
