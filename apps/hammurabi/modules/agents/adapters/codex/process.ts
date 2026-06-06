import { spawn, type ChildProcess } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveModuleDataDir } from '../../../data-dir.js'
import {
  HAMMURABI_CODEX_AUTH_JSON_B64,
  mergeProviderSpawnAuthIntoLaunch,
  type ProviderSpawnAuth,
} from '../../provider-auth.js'
import {
  buildCodexAppServerInvocation,
  buildCodexRuntimeEnv,
  buildLoginShellCommand,
  prepareDaemonMachineLaunchEnvironment,
  prepareMachineLaunchEnvironment,
  buildSshArgs,
} from '../../machines.js'
import type { MachineDaemonRegistry } from '../../daemon/registry.js'
import type { MachineConfig } from '../../types.js'

const localCodexRuntimeProcesses = new WeakSet<ChildProcess>()
const CODEX_CONFIG_FILE_NAME = 'config.toml'
const CODEX_AUTH_FILE_NAME = 'auth.json'
const CODEX_RUNTIME_HOME_PREFIX = 'codex-runtime-home-'

function markLocalCodexRuntimeProcess(process: ChildProcess): ChildProcess {
  localCodexRuntimeProcesses.add(process)
  return process
}

export function killCodexRuntimeProcess(
  processToKill: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  options: { killProcess?: typeof globalThis.process.kill } = {},
): boolean {
  const pid = processToKill.pid
  const spawnfile = (processToKill as { spawnfile?: unknown }).spawnfile
  if (localCodexRuntimeProcesses.has(processToKill) && typeof pid === 'number' && pid > 0 && typeof spawnfile === 'string') {
    try {
      return (options.killProcess ?? globalThis.process.kill)(-pid, signal)
    } catch {
      // Fall back to the direct child PID. Some platforms or test doubles do
      // not expose a live process group even when the runtime was detached.
    }
  }

  try {
    return processToKill.kill(signal)
  } catch {
    return false
  }
}

export async function reserveLocalCodexRuntimePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
    const serverEmitter = srv as unknown as NodeJS.EventEmitter
    serverEmitter.on('error', reject)
  })
}

export function stripCodexTelemetryConfig(configToml: string): string {
  const output: string[] = []
  let dropSection = false

  for (const line of configToml.split(/\r?\n/u)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/u)
    if (sectionMatch) {
      const sectionName = sectionMatch[1]?.trim() ?? ''
      dropSection = sectionName === 'otel' || sectionName.startsWith('otel.')
    }
    if (!dropSection) {
      output.push(line)
    }
  }

  return output.join('\n')
}

async function ensureRuntimeHomeSymlink(targetPath: string, linkPath: string, type: 'dir' | 'file'): Promise<void> {
  try {
    const currentTarget = await readlink(linkPath)
    if (currentTarget === targetPath) {
      return
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'EINVAL') {
      throw error
    }
  }

  await rm(linkPath, { recursive: true, force: true })
  await symlink(targetPath, linkPath, type)
}

async function readCodexHomeEntries(sourceHome: string) {
  try {
    return await readdir(sourceHome, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function prepareCodexRuntimeHome(env: NodeJS.ProcessEnv = globalThis.process.env): Promise<string> {
  const configuredHome = env.CODEX_HOME?.trim()
  const sourceHome = path.resolve(configuredHome && configuredHome.length > 0
    ? configuredHome
    : path.join(homedir(), '.codex'))
  const runtimeParent = resolveModuleDataDir('agents', env)
  await mkdir(runtimeParent, { recursive: true, mode: 0o700 })
  const runtimeHome = await mkdtemp(path.join(runtimeParent, CODEX_RUNTIME_HOME_PREFIX))

  const entries = await readCodexHomeEntries(sourceHome)
  await Promise.all(entries.map(async (entry) => {
    if (entry.name === CODEX_CONFIG_FILE_NAME || entry.name === CODEX_AUTH_FILE_NAME) {
      return
    }

    const targetPath = path.join(sourceHome, entry.name)
    const linkPath = path.join(runtimeHome, entry.name)
    await ensureRuntimeHomeSymlink(targetPath, linkPath, entry.isDirectory() ? 'dir' : 'file')
  }))

  let configToml = ''
  try {
    configToml = await readFile(path.join(sourceHome, CODEX_CONFIG_FILE_NAME), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      throw error
    }
  }

  await writeFile(
    path.join(runtimeHome, CODEX_CONFIG_FILE_NAME),
    stripCodexTelemetryConfig(configToml),
    { mode: 0o600 },
  )

  const managedAuthPayload = env[HAMMURABI_CODEX_AUTH_JSON_B64]?.trim()
  if (managedAuthPayload) {
    await writeFile(
      path.join(runtimeHome, CODEX_AUTH_FILE_NAME),
      Buffer.from(managedAuthPayload, 'base64').toString('utf8'),
      { mode: 0o600 },
    )
  }

  return runtimeHome
}

function cleanupCodexRuntimeHomeOnExit(processToWatch: ChildProcess, runtimeHome: string): void {
  const cleanup = () => {
    void rm(runtimeHome, { recursive: true, force: true })
  }
  const emitter = processToWatch as unknown as NodeJS.EventEmitter
  emitter.once('exit', cleanup)
  emitter.once('error', cleanup)
}

export async function spawnLocalCodexRuntime(
  spawnImpl: typeof spawn = spawn,
  env: NodeJS.ProcessEnv = globalThis.process.env,
): Promise<{ port: number; process: ChildProcess }> {
  const port = await reserveLocalCodexRuntimePort()
  const runtimeHome = await prepareCodexRuntimeHome(env)
  const process = spawnImpl('codex', ['app-server', '--listen', `ws://127.0.0.1:${port}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    env: {
      ...buildCodexRuntimeEnv(env),
      CODEX_HOME: runtimeHome,
      [HAMMURABI_CODEX_AUTH_JSON_B64]: undefined,
    },
  })
  cleanupCodexRuntimeHomeOnExit(process, runtimeHome)
  return { port, process: markLocalCodexRuntimeProcess(process) }
}

export function spawnRemoteCodexRuntime(
  machine: MachineConfig & { host: string },
  spawnImpl: typeof spawn = spawn,
  providerAuth?: ProviderSpawnAuth,
): ChildProcess {
  const preparedLaunch = mergeProviderSpawnAuthIntoLaunch(
    prepareMachineLaunchEnvironment(
      machine,
      buildCodexRuntimeEnv(globalThis.process.env),
    ),
    providerAuth,
    machine,
  )
  const remoteCommand = buildLoginShellCommand(
    buildCodexAppServerInvocation(),
    undefined,
    preparedLaunch.sourcedEnvFile,
  )
  return spawnImpl('ssh', buildSshArgs(machine, remoteCommand, false, undefined, preparedLaunch.sshSendEnvKeys), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: preparedLaunch.env,
  })
}

export function spawnDaemonCodexRuntime(
  machine: MachineConfig & { transport: 'daemon' },
  daemonRegistry: Pick<MachineDaemonRegistry, 'spawnProcess'>,
  providerAuth?: ProviderSpawnAuth,
): ChildProcess {
  const preparedLaunch = mergeProviderSpawnAuthIntoLaunch(
    prepareDaemonMachineLaunchEnvironment(machine),
    providerAuth,
    machine,
  )
  return daemonRegistry.spawnProcess(machine.id, {
    command: 'sh',
    args: ['-lc', buildLoginShellCommand(
      buildCodexAppServerInvocation(),
      undefined,
      preparedLaunch.sourcedEnvFile,
    )],
    env: preparedLaunch.env,
  })
}
