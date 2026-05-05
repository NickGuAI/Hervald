import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { resolveHammurabiDataDir } from '../data-dir.js'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  getClaudeDisableAdaptiveThinkingEnvValue,
  type ClaudeAdaptiveThinkingMode,
} from '../claude-adaptive-thinking.js'
import type { WorkspaceCommandRunner } from '../workspace/index.js'
import { WORKSPACE_EXEC_MAX_BUFFER_BYTES } from './constants.js'
import {
  migrateMachineEnvFiles,
  prepareMachineLaunchEnvironment,
} from './machine-credentials.js'
import { listMachineProviders } from './providers/machine-provider-adapter.js'
import type {
  CapturedCommandResult,
  ClaudePermissionMode,
  MachineConfig,
  MachineHealthReport,
  MachineToolKey,
  MachineToolStatus,
} from './types.js'

const execFileAsync = promisify(execFile)
const SSH_CONTROL_DIR = path.join(resolveHammurabiDataDir(), 'ssh-control')
const SSH_CONTROL_PATH_TEMPLATE = path.join(SSH_CONTROL_DIR, '%C')

export { prepareMachineLaunchEnvironment } from './machine-credentials.js'

export const ANTHROPIC_MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
] as const

export function scrubEnvironmentVariables(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...env }
  for (const key of keys) {
    scrubbed[key] = undefined
  }
  return scrubbed
}

export function buildUnsetEnvironmentCommand(keys: readonly string[]): string {
  return `unset ${keys.join(' ')}`
}

export interface MachineRegistryStore {
  readMachineRegistry(): Promise<MachineConfig[]>
  writeMachineRegistry(machines: readonly MachineConfig[]): Promise<MachineConfig[]>
  withWriteLock<T>(operation: () => Promise<T>): Promise<T>
  invalidateMachineRegistryCache(): void
}

export interface TailscaleVerificationResult {
  tailscaleHostname: string
  resolvedHost: string
  raw: string
}

export function normalizeTailscaleHostname(value: string): string {
  return value.trim().replace(/\.+$/u, '')
}

export function buildTailscalePingArgs(hostname: string): string[] {
  return ['ping', '--c', '1', '--timeout', '5s', normalizeTailscaleHostname(hostname)]
}

export function parseTailscalePingOutput(output: string): string | null {
  for (const match of output.matchAll(/\(([0-9a-fA-F:.]+)\)/g)) {
    const candidate = match[1]?.trim()
    if (candidate && isIP(candidate)) {
      return candidate
    }
  }

  const tokens = output
    .split(/\s+/u)
    .map((token) => token.trim().replace(/^[([{<]+/u, '').replace(/[)\]}>.,:;]+$/u, ''))

  for (const token of tokens) {
    if (token && isIP(token)) {
      return token
    }
  }

  return null
}

export function validateMachineConfig(
  value: unknown,
  options: { requireHost?: boolean } = {},
): MachineConfig {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
  if (!record) {
    throw new Error('Invalid machines config: machine must be an object')
  }

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) {
    throw new Error('Invalid machines config: machine id must be string')
  }
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  if (!label) {
    throw new Error(`Invalid machines config: machine "${id}" label must be string`)
  }

  const requireHost = options.requireHost === true
  const rawHost = record.host
  let host: string | null = null
  if (rawHost !== null && rawHost !== undefined) {
    if (typeof rawHost !== 'string' || rawHost.trim().length === 0) {
      throw new Error(`Invalid machines config: machine "${id}" host must be string`)
    }
    host = rawHost.trim()
  }

  const rawTailscaleHostname = record.tailscaleHostname
  const tailscaleHostname = rawTailscaleHostname === undefined || rawTailscaleHostname === null
    ? undefined
    : (typeof rawTailscaleHostname === 'string' && rawTailscaleHostname.trim().length > 0
      ? normalizeTailscaleHostname(rawTailscaleHostname)
      : null)
  if (tailscaleHostname === null) {
    throw new Error(`Invalid machines config: machine "${id}" tailscaleHostname must be string`)
  }

  if (requireHost && !host && !tailscaleHostname) {
    throw new Error(`Invalid machines config: machine "${id}" host must be string`)
  }

  const user = typeof record.user === 'string' && record.user.trim().length > 0
    ? record.user.trim()
    : undefined
  const port = typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0
    ? record.port
    : undefined
  const cwd = typeof record.cwd === 'string' && record.cwd.trim().length > 0
    ? record.cwd.trim()
    : undefined
  const envFile = typeof record.envFile === 'string' && record.envFile.trim().length > 0
    ? record.envFile.trim()
    : undefined

  return { id, label, host, tailscaleHostname, user, port, cwd, envFile }
}

export function parseMachineRegistry(raw: unknown): MachineConfig[] {
  const payload = typeof raw === 'object' && raw !== null
    ? raw as Record<string, unknown>
    : null
  if (!payload || !Array.isArray(payload.machines)) {
    throw new Error('Invalid machines config: expected "machines" array')
  }
  return payload.machines.map((entry) => validateMachineConfig(entry))
}

export function createMachineRegistryStore(machinesFilePath: string): MachineRegistryStore {
  let cachedMachines: MachineConfig[] | null = null
  let cachedMachinesMtimeMs = -1
  let machineRegistryWriteQueue = Promise.resolve()

  async function readMachineRegistry(): Promise<MachineConfig[]> {
    let machinesStats: Awaited<ReturnType<typeof stat>>
    try {
      machinesStats = await stat(machinesFilePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        cachedMachines = []
        cachedMachinesMtimeMs = -1
        return []
      }
      throw error
    }

    if (cachedMachines && cachedMachinesMtimeMs === machinesStats.mtimeMs) {
      return cachedMachines
    }

    const contents = await readFile(machinesFilePath, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    let machines = parseMachineRegistry(parsed)
    const migrated = await migrateMachineEnvFiles(machines)
    if (migrated.changed) {
      await writeMachineRegistry(migrated.machines)
      machines = migrated.machines
      machinesStats = await stat(machinesFilePath)
    }
    cachedMachines = machines
    cachedMachinesMtimeMs = machinesStats.mtimeMs
    return machines
  }

  function invalidateMachineRegistryCache(): void {
    cachedMachines = null
    cachedMachinesMtimeMs = -1
  }

  async function writeMachineRegistry(machines: readonly MachineConfig[]): Promise<MachineConfig[]> {
    let validated = parseMachineRegistry({ machines })
    const migrated = await migrateMachineEnvFiles(validated)
    validated = migrated.machines
    await mkdir(path.dirname(machinesFilePath), { recursive: true })
    await writeFile(
      machinesFilePath,
      `${JSON.stringify({ machines: validated }, null, 2)}\n`,
      'utf8',
    )
    invalidateMachineRegistryCache()
    return validated
  }

  async function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = machineRegistryWriteQueue.then(operation, operation)
    machineRegistryWriteQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    readMachineRegistry,
    writeMachineRegistry,
    withWriteLock,
    invalidateMachineRegistryCache,
  }
}

export function isRemoteMachine(
  machine: MachineConfig | undefined,
): machine is MachineConfig & { host: string } {
  return Boolean(machine?.host)
}

export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, '\'\\\'\'')}'`
}

export function buildLoginShellBootstrap(envFile?: string): string {
  const commands = [
    '. "$HOME/.bashrc" >/dev/null 2>&1 || true',
    '. "$HOME/.zshrc" >/dev/null 2>&1 || true',
    'for __hm_env_key in $(env | awk -F= \'/^HAMMURABI_MACHINE_ENV_[0-9]+=/{print $1}\' | sort); do __hm_env_entry=$(printenv "$__hm_env_key" || true); [ -n "$__hm_env_entry" ] || continue; __hm_env_name=${__hm_env_entry%%=*}; __hm_env_value=${__hm_env_entry#*=}; export "$__hm_env_name=$__hm_env_value"; unset "$__hm_env_key"; done',
  ]
  if (envFile) {
    commands.push(`. ${shellEscape(envFile)} >/dev/null 2>&1 || true`)
  }
  return commands.join('; ')
}

export function buildRemoteLoginShellExec(flags: '-l' | '-lc', script?: string, envFile?: string): string {
  const bootstrap = buildLoginShellBootstrap(envFile)
  if (script && script.trim().length > 0) {
    return `exec "\${SHELL:-/bin/bash}" ${flags} ${shellEscape(`${bootstrap}; ${script}`)}`
  }
  if (flags === '-l') {
    return `exec "\${SHELL:-/bin/bash}" -lic ${shellEscape(`${bootstrap}; exec "\${SHELL:-/bin/bash}" -l`)}`
  }
  return `exec "\${SHELL:-/bin/bash}" ${flags} ${shellEscape(bootstrap)}`
}

export function buildLoginShellCommand(script: string, cwd?: string, envFile?: string): string {
  const normalizedScript = cwd
    ? `cd ${shellEscape(cwd)} && ${script}`
    : script
  return buildRemoteLoginShellExec('-lc', normalizedScript, envFile)
}

export function buildRemoteCommand(command: string, args: string[], cwd?: string, envFile?: string): string {
  const escapedArgs = [command, ...args.map((arg) => shellEscape(arg))].join(' ')
  const normalizedScript = cwd
    ? `cd ${shellEscape(cwd)} && ${escapedArgs}`
    : escapedArgs
  return buildRemoteLoginShellExec('-lc', normalizedScript, envFile)
}

export function buildClaudeSpawnEnv(
  env: NodeJS.ProcessEnv,
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): NodeJS.ProcessEnv {
  return {
    ...scrubEnvironmentVariables(env, ['CLAUDECODE', ...ANTHROPIC_MODEL_ENV_KEYS]),
    CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: getClaudeDisableAdaptiveThinkingEnvValue(adaptiveThinking),
  }
}

export function buildClaudeShellInvocation(
  args: string[],
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): string {
  const envPrefix = `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=${getClaudeDisableAdaptiveThinkingEnvValue(adaptiveThinking)}; ${buildUnsetEnvironmentCommand(['CLAUDECODE', ...ANTHROPIC_MODEL_ENV_KEYS])};`
  return `${envPrefix} claude ${args.map((arg) => shellEscape(arg)).join(' ')}`
}

export function buildCodexAppServerInvocation(listenUrl = 'stdio://'): string {
  return `${buildUnsetEnvironmentCommand(ANTHROPIC_MODEL_ENV_KEYS)} && codex app-server --listen ${shellEscape(listenUrl)}`
}

export function buildGeminiAcpInvocation(): string {
  return 'gemini --acp'
}

export function mapGeminiMode(mode: ClaudePermissionMode): 'default' | 'autoEdit' | 'yolo' {
  return 'default'
}

export function buildGeminiSystemPrompt(systemPrompt?: string, maxTurns?: number): string | undefined {
  const parts: string[] = []
  if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
    parts.push(systemPrompt.trim())
  }
  if (typeof maxTurns === 'number' && Number.isFinite(maxTurns) && maxTurns > 0) {
    parts.push(`You must stop after at most ${maxTurns} assistant turns.`)
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export function buildGeminiPromptText(
  session: { geminiPendingSystemPrompt?: string },
  text: string,
): string {
  const pendingSystemPrompt = session.geminiPendingSystemPrompt
  if (pendingSystemPrompt) {
    session.geminiPendingSystemPrompt = undefined
    return `${pendingSystemPrompt}\n\n${text}`
  }
  return text
}

export function buildSshDestination(machine: MachineConfig & { host: string }): string {
  const connectHost = machine.tailscaleHostname?.trim() || machine.host
  if (machine.user && machine.user.trim().length > 0) {
    return `${machine.user.trim()}@${connectHost}`
  }
  return connectHost
}

/**
 * Reverse-tunnels the EC2 approval daemon back to the remote machine and
 * propagates the internal token without exposing it on the command line or
 * leaking it via shell history.
 *
 * When provided to `buildSshArgs`, the resulting SSH command gains:
 *
 *   -R 127.0.0.1:<port>:127.0.0.1:<port>
 *      Reverse port-forward — remote 127.0.0.1:<port> reaches the EC2
 *      Hammurabi daemon. Binds remote loopback only; the daemon is not
 *      exposed on any other interface.
 *
 *   -o SendEnv=HAMMURABI_INTERNAL_TOKEN
 *      Propagates the token over SSH's environment channel. The token value
 *      stays in the client process env, not in argv or the bootstrap script.
 *
 * The hook script's `127.0.0.1:<port>` default already works once the
 * tunnel is in place — no hook code changes needed. See
 * `apps/hammurabi/modules/agents/adapters/claude/helpers.ts:166-178`.
 */
export interface ApprovalBridge {
  port: number | string
  internalToken?: string
}

function buildApprovalBridgeOptions(bridge: ApprovalBridge): string[] {
  const portStr = String(bridge.port).trim()
  const args = [
    '-R',
    `127.0.0.1:${portStr}:127.0.0.1:${portStr}`,
  ]
  const token = bridge.internalToken?.trim()
  if (token) {
    args.push('-o', 'SendEnv=HAMMURABI_INTERNAL_TOKEN')
  }
  return args
}

function buildSshControlOptions(): string[] {
  return [
    '-o',
    'ControlMaster=auto',
    '-o',
    'ControlPersist=600',
    '-o',
    `ControlPath=${SSH_CONTROL_PATH_TEMPLATE}`,
  ]
}

function buildSendEnvOptions(sendEnvKeys: readonly string[]): string[] {
  return sendEnvKeys.flatMap((key) => ['-o', `SendEnv=${key}`])
}

export function buildSshArgs(
  machine: MachineConfig & { host: string },
  remoteCommand: string,
  interactive: boolean,
  approvalBridge?: ApprovalBridge,
  sendEnvKeys: readonly string[] = [],
): string[] {
  return [
    ...(interactive ? ['-tt'] : []),
    ...buildSshControlOptions(),
    ...(machine.port ? ['-p', String(machine.port)] : []),
    ...(approvalBridge ? buildApprovalBridgeOptions(approvalBridge) : []),
    ...buildSendEnvOptions(sendEnvKeys),
    buildSshDestination(machine),
    remoteCommand,
  ]
}

export async function ensureSshControlDir(): Promise<void> {
  await mkdir(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 })
}

export function createWorkspaceSshCommandRunner(
  machine: MachineConfig & { host: string },
): WorkspaceCommandRunner {
  return {
    async exec(command: string, args: string[], options?: { cwd?: string }) {
      const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
      const remoteCommand = buildRemoteCommand(
        command,
        args,
        options?.cwd ?? machine.cwd,
        preparedLaunch.sourcedEnvFile,
      )
      const result = await execFileAsync(
        'ssh',
        buildSshArgs(machine, remoteCommand, false, undefined, preparedLaunch.sshSendEnvKeys),
        {
          maxBuffer: WORKSPACE_EXEC_MAX_BUFFER_BYTES,
          encoding: 'utf8',
          env: preparedLaunch.env,
        },
      )
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      }
    },
  }
}

export function createMissingToolStatus(): MachineToolStatus {
  return { ok: false, version: null, raw: 'missing' }
}

function listMachineToolKeys(): MachineToolKey[] {
  return [
    ...new Set([
      ...listMachineProviders().map((provider) => provider.cliBinaryName),
      'git',
      'node',
    ]),
  ]
}

export function buildMachineProbeScript(): string {
  const toolCommands = listMachineToolKeys().map((tool) => (
    `printf '${tool}:'; command -v ${tool} >/dev/null 2>&1 && ${tool} --version | head -n 1 || echo missing`
  ))
  return [
    'set -e',
    'echo ssh:ok',
    ...toolCommands,
  ].join('\n')
}

export function parseMachineHealthOutput(
  machine: MachineConfig,
  output: string,
): MachineHealthReport {
  const toolKeys = listMachineToolKeys()
  const tools = Object.fromEntries(
    toolKeys.map((key) => [key, createMissingToolStatus()]),
  ) as Record<MachineToolKey, MachineToolStatus>

  const lines = output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  let sshOk = false
  for (const line of lines) {
    if (line === 'ssh:ok') {
      sshOk = true
      continue
    }
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      continue
    }
    const key = line.slice(0, colonIndex) as MachineToolKey
    const raw = line.slice(colonIndex + 1).trim()
    if (!toolKeys.includes(key)) {
      continue
    }
    tools[key] = raw === 'missing'
      ? createMissingToolStatus()
      : { ok: true, version: raw || null, raw }
  }

  return {
    machineId: machine.id,
    mode: isRemoteMachine(machine) ? 'ssh' : 'local',
    ssh: {
      ok: sshOk || !isRemoteMachine(machine),
      ...(isRemoteMachine(machine) ? { destination: buildSshDestination(machine) } : {}),
    },
    tools,
  }
}

export async function runCapturedCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    spawnImpl?: typeof spawn
  } = {},
): Promise<CapturedCommandResult> {
  return await new Promise<CapturedCommandResult>((resolve, reject) => {
    const spawnImpl = options.spawnImpl ?? spawn
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
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

    const childEmitter = child as unknown as NodeJS.EventEmitter
    childEmitter.once('error', reject)
    childEmitter.once('close', (code: number | null, signal: string | null) => {
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

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, options.timeoutMs)
    }
  })
}

export async function resolveTailscaleHostname(
  hostname: string,
): Promise<TailscaleVerificationResult> {
  const normalizedHostname = normalizeTailscaleHostname(hostname)
  if (!normalizedHostname) {
    throw new Error('Tailscale hostname is required')
  }

  let result: CapturedCommandResult
  try {
    result = await runCapturedCommand('tailscale', buildTailscalePingArgs(normalizedHostname), {
      timeoutMs: 7_000,
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error('Tailscale CLI is not installed on this Hammurabi host')
    }
    throw new Error(error instanceof Error ? error.message : 'Failed to run tailscale ping')
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'tailscale ping failed'
    throw new Error(`Tailscale reachability check failed for "${normalizedHostname}": ${detail}`)
  }

  return {
    tailscaleHostname: normalizedHostname,
    resolvedHost: parseTailscalePingOutput(result.stdout) ?? normalizedHostname,
    raw: result.stdout.trim(),
  }
}
