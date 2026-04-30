import type { RequestHandler, Router } from 'express'
import path from 'node:path'
import { CommanderSessionStore } from '../../commanders/store.js'
import {
  buildMachineProbeScript,
  buildLoginShellCommand,
  isRemoteMachine,
  prepareMachineLaunchEnvironment,
  parseMachineHealthOutput,
  runCapturedCommand,
} from '../machines.js'
import {
  ensureCodexFileCredentialStore,
  readMachineTextFile,
  resolveMachineHomeDirectory,
  runMachineAuthStatus,
  upsertExportedEnvVars,
  writeMachineTextFile,
  type MachineAuthMode,
  type MachineAuthProvider,
} from '../machine-auth.js'
import { updateMachineEnvEntries } from '../machine-credentials.js'
import { parseSessionName } from '../session/input.js'
import { toCommanderWorldAgent, toWorldAgent } from '../session/state.js'
import type {
  AnySession,
  MachineConfig,
  MachineHealthReport,
  WorldAgent,
} from '../types.js'

interface MachineWorldRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  commanderSessionStorePath?: string
  sessions: Map<string, AnySession>
  buildSshArgs(
    machine: MachineConfig & { host: string },
    remoteCommand: string,
    interactive: boolean,
    approvalBridge?: { port: number | string; internalToken?: string },
    sendEnvKeys?: readonly string[],
  ): string[]
  isRemoteMachine(machine: MachineConfig | undefined): machine is MachineConfig & { host: string }
  parseSessionName: typeof parseSessionName
  pruneStaleCronSessions(): number
  pruneStaleNonHumanSessions(): Promise<number>
  readMachineRegistry(): Promise<MachineConfig[]>
  resolveTailscaleHostname(hostname: string): Promise<{
    tailscaleHostname: string
    resolvedHost: string
  }>
  validateMachineConfig(value: unknown, options?: { requireHost?: boolean }): MachineConfig
  withMachineRegistryWriteLock<T>(operation: () => Promise<T>): Promise<T>
  writeMachineRegistry(machines: readonly MachineConfig[]): Promise<MachineConfig[]>
}

export function registerMachineWorldRoutes(deps: MachineWorldRouteDeps): void {
  const { router, requireReadAccess, requireWriteAccess } = deps

  async function pruneSessions(): Promise<void> {
    deps.pruneStaleCronSessions()
    await deps.pruneStaleNonHumanSessions()
  }

  router.get('/machines', requireReadAccess, async (_req, res) => {
    try {
      const machines = await deps.readMachineRegistry()
      res.json(machines)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines', requireWriteAccess, async (req, res) => {
    let machine: MachineConfig
    try {
      machine = deps.validateMachineConfig(req.body, { requireHost: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid machine payload'
      res.status(400).json({ error: message })
      return
    }

    if (machine.tailscaleHostname) {
      try {
        const verified = await deps.resolveTailscaleHostname(machine.tailscaleHostname)
        machine = {
          ...machine,
          host: verified.resolvedHost,
          tailscaleHostname: verified.tailscaleHostname,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to verify Tailscale hostname'
        res.status(502).json({ error: message })
        return
      }
    }

    try {
      const created = await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        if (current.some((entry) => entry.id === machine.id)) {
          throw new Error(`Machine "${machine.id}" already exists`)
        }

        const next = await deps.writeMachineRegistry([...current, machine])
        return next.find((entry) => entry.id === machine.id) ?? machine
      })
      res.status(201).json(created)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update machines registry'
      if (message.includes('already exists')) {
        res.status(409).json({ error: message })
        return
      }
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines/verify-tailscale', requireWriteAccess, async (req, res) => {
    const rawHostname = typeof req.body?.hostname === 'string'
      ? req.body.hostname
      : (typeof req.body?.tailscaleHostname === 'string' ? req.body.tailscaleHostname : '')
    const hostname = rawHostname.trim()
    if (!hostname) {
      res.status(400).json({ error: 'tailscale hostname is required' })
      return
    }

    try {
      const result = await deps.resolveTailscaleHostname(hostname)
      res.json({
        tailscaleHostname: result.tailscaleHostname,
        resolvedHost: result.resolvedHost,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify Tailscale hostname'
      res.status(502).json({ error: message })
    }
  })

  router.delete('/machines/:id', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    try {
      await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        const target = current.find((entry) => entry.id === machineId)
        if (!target) {
          throw new Error(`Machine "${machineId}" not found`)
        }
        if (target.host === null) {
          throw new Error(`Machine "${machineId}" is the local machine and cannot be removed`)
        }

        await deps.writeMachineRegistry(current.filter((entry) => entry.id !== machineId))
      })
      res.status(204).end()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update machines registry'
      if (message.includes('cannot be removed')) {
        res.status(400).json({ error: message })
        return
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
        return
      }
      res.status(500).json({ error: message })
    }
  })

  router.get('/machines/:id/health', requireReadAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    const probeScript = buildMachineProbeScript()

    try {
      const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
      const result = deps.isRemoteMachine(machine)
        ? await runCapturedCommand(
          'ssh',
          [
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            ...deps.buildSshArgs(
              machine,
              buildLoginShellCommand(probeScript, machine.cwd, preparedLaunch.sourcedEnvFile),
              false,
              undefined,
              preparedLaunch.sshSendEnvKeys,
            ),
          ],
          { env: preparedLaunch.env, timeoutMs: 12_000 },
        )
        : await runCapturedCommand(
          '/bin/bash',
          ['-lc', buildLoginShellCommand(probeScript, machine.cwd, preparedLaunch.sourcedEnvFile)],
          { cwd: machine.cwd, env: preparedLaunch.env, timeoutMs: 12_000 },
        )

      if (result.code !== 0) {
        const detail = result.stderr.trim() || (result.timedOut ? 'Command timed out' : '')
        res.status(502).json({
          error: deps.isRemoteMachine(machine)
            ? `Machine "${machine.id}" health check failed over SSH`
            : `Machine "${machine.id}" local health check failed`,
          detail: detail || undefined,
          exitCode: result.code,
          signal: result.signal ?? undefined,
        })
        return
      }

      res.json(parseMachineHealthOutput(machine, result.stdout) as MachineHealthReport)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Health check failed'
      res.status(502).json({
        error: deps.isRemoteMachine(machine)
          ? `Machine "${machine.id}" health check failed over SSH`
          : `Machine "${machine.id}" local health check failed`,
        detail: message,
      })
    }
  })

  router.get('/machines/:id/auth-status', requireReadAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    try {
      res.json(await runMachineAuthStatus(machine))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider auth status probe failed'
      res.status(502).json({ error: message })
    }
  })

  router.post('/machines/:id/auth-setup', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    const setup = parseMachineAuthSetupRequest(req.body)
    if (!setup.ok) {
      res.status(400).json({ error: setup.error })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    try {
      const homeDir = await resolveMachineHomeDirectory(machine)
      const envFilePath = machine.envFile ?? path.posix.join(homeDir, '.hammurabi-env')
      const targetMachine = machine.envFile === envFilePath
        ? machine
        : await persistMachineEnvFile(deps, machine.id, envFilePath)

      // Side effects (e.g. codex device-auth needs ~/.codex/config.toml configured for file-store).
      await applyMachineAuthSetupSideEffects(targetMachine, homeDir, setup.value)

      const updates = computeMachineAuthSetupUpdates(setup.value)

      // Encrypted local env files MUST go through the canonical encrypted-aware
      // writer or the ciphertext record gets clobbered with shell text and
      // future launches fail to decrypt. See codex-review on PR #1269.
      // Plaintext (local) and remote (always plaintext-on-remote) keep using
      // the text-based readMachineTextFile + upsertExportedEnvVars path.
      if (envFilePath.endsWith('.enc') && !isRemoteMachine(targetMachine)) {
        await updateMachineEnvEntries(targetMachine, envFilePath, updates)
      } else {
        const existingEnvContents = await readMachineTextFile(targetMachine, envFilePath)
        const nextEnvContents = upsertExportedEnvVars(existingEnvContents, updates)
        if (nextEnvContents !== existingEnvContents) {
          await writeMachineTextFile(targetMachine, envFilePath, nextEnvContents)
        }
      }

      res.json(await runMachineAuthStatus(targetMachine))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider auth setup failed'
      res.status(502).json({ error: message })
    }
  })

  router.get('/world', requireReadAccess, async (_req, res) => {
    await pruneSessions()

    const nowMs = Date.now()
    const worldAgentsById = new Map<string, WorldAgent>()
    for (const session of deps.sessions.values()) {
      const worldAgent = toWorldAgent(session, nowMs)
      worldAgentsById.set(worldAgent.id, worldAgent)
    }

    try {
      const commanderStore = deps.commanderSessionStorePath !== undefined
        ? new CommanderSessionStore(deps.commanderSessionStorePath)
        : new CommanderSessionStore()
      const commanderSessions = await commanderStore.list()
      for (const commanderSession of commanderSessions) {
        if (commanderSession.state === 'stopped') {
          continue
        }
        const worldAgent = toCommanderWorldAgent(commanderSession)
        if (!worldAgentsById.has(worldAgent.id)) {
          worldAgentsById.set(worldAgent.id, worldAgent)
        }
      }
    } catch {
      // Ignore commander store failures and fall back to live sessions.
    }

    res.json([...worldAgentsById.values()])
  })
}

interface ParsedMachineAuthSetup {
  provider: MachineAuthProvider
  mode: MachineAuthMode
  secret?: string
}

function parseMachineAuthSetupRequest(
  value: unknown,
): { ok: true; value: ParsedMachineAuthSetup } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
  if (!record) {
    return { ok: false, error: 'Invalid auth setup payload' }
  }

  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const mode = typeof record.mode === 'string' ? record.mode.trim() : ''
  const secret = typeof record.secret === 'string' ? record.secret.trim() : ''

  if (provider !== 'claude' && provider !== 'codex' && provider !== 'gemini') {
    return { ok: false, error: 'provider must be claude, codex, or gemini' }
  }

  if (provider === 'claude' && mode !== 'setup-token') {
    return { ok: false, error: 'Claude setup requires mode "setup-token"' }
  }

  if (provider === 'codex' && mode !== 'api-key' && mode !== 'device-auth') {
    return { ok: false, error: 'Codex setup requires mode "api-key" or "device-auth"' }
  }

  if (provider === 'gemini' && mode !== 'api-key') {
    return { ok: false, error: 'Gemini setup requires mode "api-key"' }
  }

  const requiresSecret = mode === 'setup-token' || mode === 'api-key'
  if (requiresSecret && secret.length < 12) {
    return { ok: false, error: 'A non-empty token or API key is required' }
  }

  const parsedMode = mode as MachineAuthMode

  return {
    ok: true,
    value: {
      provider,
      mode: parsedMode,
      ...(secret ? { secret } : {}),
    },
  }
}

async function persistMachineEnvFile(
  deps: Pick<MachineWorldRouteDeps, 'readMachineRegistry' | 'withMachineRegistryWriteLock' | 'writeMachineRegistry'>,
  machineId: string,
  envFilePath: string,
): Promise<MachineConfig> {
  return await deps.withMachineRegistryWriteLock(async () => {
    const current = await deps.readMachineRegistry()
    const target = current.find((entry) => entry.id === machineId)
    if (!target) {
      throw new Error(`Machine "${machineId}" not found`)
    }

    const updated = { ...target, envFile: envFilePath }
    const persisted = await deps.writeMachineRegistry(
      current.map((entry) => (entry.id === machineId ? updated : entry)),
    )
    return persisted.find((entry) => entry.id === machineId) ?? updated
  })
}

/**
 * Pure decision logic: what env-var updates are required for this auth setup?
 * Null value removes the key. Caller routes the resulting updates through the
 * appropriate writer (encrypted-aware for `.enc`, plaintext otherwise).
 */
function computeMachineAuthSetupUpdates(
  setup: ParsedMachineAuthSetup,
): Record<string, string | null> {
  if (setup.provider === 'claude') {
    return { CLAUDE_CODE_OAUTH_TOKEN: setup.secret ?? '' }
  }

  if (setup.provider === 'codex' && setup.mode === 'api-key') {
    return { OPENAI_API_KEY: setup.secret ?? '' }
  }

  if (setup.provider === 'codex' && setup.mode === 'device-auth') {
    return { OPENAI_API_KEY: null }
  }

  // Gemini api-key.
  return {
    GEMINI_API_KEY: setup.secret ?? '',
    GEMINI_FORCE_FILE_STORAGE: '1',
  }
}

/**
 * Side effects that must happen on top of env-file updates — currently only
 * codex device-auth, which requires `~/.codex/config.toml` to opt into the
 * file-based credential store.
 */
async function applyMachineAuthSetupSideEffects(
  machine: MachineConfig,
  homeDir: string,
  setup: ParsedMachineAuthSetup,
): Promise<void> {
  if (setup.provider === 'codex' && setup.mode === 'device-auth') {
    await ensureCodexFileCredentialStore(machine, homeDir)
  }
}
