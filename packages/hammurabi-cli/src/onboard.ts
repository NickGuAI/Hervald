import { platform as readPlatform } from 'node:os'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  createHammurabiConfig,
  defaultConfigPath,
  type HammurabiAgent,
  writeHammurabiConfig,
} from './config.js'
import {
  ensureCommanderRuntimeConfig,
  resolveHammurabiDataDir,
} from './commander-runtime-config-node.js'
import { applyManagedAgentTelemetryConfig } from './agent-telemetry.js'
import { listMachineAuthProviders, loadProviderRegistry, type ProviderRegistryEntry } from './providers.js'
import {
  closePromptResources,
  promptConfirm,
  promptMultiSelect,
  promptSecret,
  promptText,
} from './prompts.js'
import { validateTelemetryWriteKey } from './validate.js'

const DEFAULT_ENDPOINT = 'https://hervald.gehirn.ai'
const DEFAULT_AGENTS: readonly HammurabiAgent[] = [
  'claude-code',
  'codex',
  'terminal-cri',
]

interface AgentInstruction {
  id: HammurabiAgent
  label: string
  lines: readonly string[]
}

interface CommandRunResult {
  stdout: string
  stderr: string
  code: number
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => Promise<CommandRunResult>

type InteractiveCommandRunner = (
  command: string,
  args: string[],
) => Promise<number>

export interface OnboardCliDependencies {
  fetchImpl?: typeof fetch
  platform?: NodeJS.Platform
  runCommand?: CommandRunner
  runInteractiveCommand?: InteractiveCommandRunner
}

type TailscalePlatform = 'macos' | 'linux' | 'unsupported'

const AGENT_INSTRUCTIONS: readonly AgentInstruction[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    lines: [
      'Set standard OTEL env vars in ~/.claude/settings.json under env:',
      '  CLAUDE_CODE_ENABLE_TELEMETRY=1',
      '  OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint>',
      '  OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
      '  OTEL_EXPORTER_OTLP_HEADERS=x-hammurabi-api-key=<KEY>',
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    lines: [
      'Set [otel] exporter in ~/.codex/config.toml:',
      '  [otel]',
      '  log_user_prompt = true',
      '  exporter = { otlp-http = { endpoint = "<endpoint>/v1/logs", protocol = "json", headers = { "x-hammurabi-api-key" = "<KEY>" } } }',
    ],
  },
  {
    id: 'terminal-cri',
    label: 'Terminal CRI',
    lines: ['Already integrated. Hammurabi agents read ~/.hammurabi.json directly; no extra setup is required.'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    lines: [
      'Set OTEL env vars in Cursor User settings.json under terminal.integrated.env:',
      '  OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint>',
      '  OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
      '  OTEL_EXPORTER_OTLP_HEADERS=x-hammurabi-api-key=<KEY>',
    ],
  },
  {
    id: 'anti-gravity',
    label: 'Anti-Gravity',
    lines: [
      'Export standard OTEL env vars in your shell profile or Anti-Gravity config:',
      '  OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint>',
      '  OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
      '  OTEL_EXPORTER_OTLP_HEADERS=x-hammurabi-api-key=<KEY>',
    ],
  },
]

function printUsage(): void {
  process.stdout.write('Usage: hammurabi onboard\n')
}

function normalizeTailscaleHostname(value: string): string {
  return value.trim().replace(/\.+$/u, '')
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

export function detectTailscalePlatform(platform: NodeJS.Platform): TailscalePlatform {
  if (platform === 'darwin') {
    return 'macos'
  }
  if (platform === 'linux') {
    return 'linux'
  }
  return 'unsupported'
}

export function buildTailscaleInstallCommand(
  platform: TailscalePlatform,
): { command: string; args: string[]; display: string } | null {
  if (platform === 'macos') {
    return {
      command: 'brew',
      args: ['install', 'tailscale'],
      display: 'brew install tailscale',
    }
  }
  if (platform === 'linux') {
    return {
      command: 'sudo',
      args: ['sh', '-lc', 'curl -fsSL https://tailscale.com/install.sh | sh'],
      display: 'curl -fsSL https://tailscale.com/install.sh | sh',
    }
  }
  return null
}

export function extractTailscaleDnsName(statusJson: string): string | null {
  let payload: unknown
  try {
    payload = JSON.parse(statusJson) as unknown
  } catch {
    return null
  }

  const self = typeof payload === 'object' && payload !== null
    ? (payload as { Self?: unknown }).Self
    : null
  if (typeof self !== 'object' || self === null) {
    return null
  }

  const dnsName = (self as { DNSName?: unknown }).DNSName
  if (typeof dnsName !== 'string') {
    return null
  }

  const normalized = normalizeTailscaleHostname(dnsName)
  return normalized.length > 0 ? normalized : null
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: CommandRunResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      resolve(result)
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      finish({
        stdout,
        stderr,
        code: code ?? 1,
      })
    })

    const timer = options.timeoutMs
      ? setTimeout(() => {
        proc.kill('SIGTERM')
      }, options.timeoutMs)
      : null
  })
}

async function defaultRunInteractiveCommand(
  command: string,
  args: string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve(code ?? 1)
    })
  })
}

async function resolveGitUserName(runCommand: CommandRunner): Promise<string | undefined> {
  try {
    const result = await runCommand('git', ['config', 'user.name'], {
      timeoutMs: 5_000,
    })
    const userName = result.stdout.trim()
    return result.code === 0 && userName.length > 0 ? userName : undefined
  } catch {
    return undefined
  }
}

function defaultOperatorsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHammurabiDataDir(env), 'operators.json')
}

function createFounderOperator(input: {
  displayName: string
  email: string
  createdAt?: Date
}) {
  return {
    id: randomUUID(),
    kind: 'founder',
    displayName: input.displayName.trim(),
    email: input.email.trim(),
    avatarUrl: null,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  }
}

async function ensureFounderOperator(
  dependencies: OnboardCliDependencies,
): Promise<{ filePath: string; created: boolean }> {
  const filePath = defaultOperatorsPath()

  try {
    await access(filePath)
    return {
      filePath,
      created: false,
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const runCommand = dependencies.runCommand ?? defaultRunCommand
  const defaultDisplayName = await resolveGitUserName(runCommand)
  const displayName = await promptText('Founder display name', {
    defaultValue: defaultDisplayName,
    required: true,
  })
  const email = await promptText('Founder email', { required: true })
  const founder = createFounderOperator({
    displayName,
    email,
  })

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(founder, null, 2)}\n`, 'utf8')

  return {
    filePath,
    created: true,
  }
}

async function runTailscaleSetup(
  dependencies: OnboardCliDependencies,
): Promise<string | null> {
  const runCommand = dependencies.runCommand ?? defaultRunCommand
  const runInteractiveCommand = dependencies.runInteractiveCommand ?? defaultRunInteractiveCommand
  const tailscalePlatform = detectTailscalePlatform(dependencies.platform ?? readPlatform())

  const shouldConfigure = await promptConfirm(
    'Pair this machine with Tailscale now so Hervald can reach it behind NAT?',
    { defaultValue: true },
  )
  if (!shouldConfigure) {
    process.stdout.write('\nSkipped Tailscale pairing.\n')
    return null
  }

  process.stdout.write('\nTailscale pairing\n')
  if (tailscalePlatform === 'unsupported') {
    process.stdout.write('Automatic install is not supported on this OS.\n')
    process.stdout.write('Install Tailscale manually: https://tailscale.com/docs/install\n')
    return null
  }

  const installedCheck = await runCommand('which', ['tailscale'])
  const tailscaleInstalled = installedCheck.code === 0

  if (!tailscaleInstalled) {
    const installCommand = buildTailscaleInstallCommand(tailscalePlatform)
    if (!installCommand) {
      process.stdout.write('Install Tailscale manually: https://tailscale.com/docs/install\n')
      return null
    }

    process.stdout.write(`Install command: ${installCommand.display}\n`)
    const shouldInstall = await promptConfirm('Run the install command now?', {
      defaultValue: true,
    })
    if (!shouldInstall) {
      process.stdout.write('Install skipped. Finish Tailscale manually, then run `sudo tailscale up`.\n')
      return null
    }

    const installResult = await runCommand(
      installCommand.command,
      installCommand.args,
      { timeoutMs: 300_000 },
    )
    if (installResult.code !== 0) {
      process.stderr.write(installResult.stderr.trim() || installResult.stdout.trim() || 'Tailscale install failed.\n')
      if (!installResult.stderr.endsWith('\n') && !installResult.stdout.endsWith('\n')) {
        process.stderr.write('\n')
      }
      return null
    }
  } else {
    process.stdout.write('Tailscale is already installed.\n')
  }

  process.stdout.write('Next command: sudo tailscale up\n')
  const shouldRunUp = await promptConfirm('Run `sudo tailscale up` now?', {
    defaultValue: true,
  })
  if (!shouldRunUp) {
    process.stdout.write('Run `sudo tailscale up` when ready, then re-run `hammurabi onboard` to capture the hostname.\n')
    return null
  }

  const tailscaleUpCode = await runInteractiveCommand('sudo', ['tailscale', 'up'])
  if (tailscaleUpCode !== 0) {
    process.stderr.write(`tailscale up failed with exit code ${tailscaleUpCode}.\n`)
    return null
  }

  const statusResult = await runCommand('tailscale', ['status', '--json'], {
    timeoutMs: 15_000,
  })
  if (statusResult.code !== 0) {
    process.stderr.write(statusResult.stderr.trim() || 'Failed to read tailscale status.\n')
    if (!statusResult.stderr.endsWith('\n')) {
      process.stderr.write('\n')
    }
    return null
  }

  const dnsName = extractTailscaleDnsName(statusResult.stdout)
  if (!dnsName) {
    process.stderr.write('Tailscale connected, but no DNS name was found in `tailscale status --json`.\n')
    return null
  }

  process.stdout.write(`Tailscale hostname: ${dnsName}\n`)
  process.stdout.write('Use that hostname when you register this worker from Hervald or the CLI.\n')
  process.stdout.write(`Example: hammurabi machine add --id <id> --label <label> --tailscale-hostname ${dnsName}\n`)
  return dnsName
}

function printSelectedAgentInstructions(
  endpoint: string,
  apiKey: string,
  agents: readonly HammurabiAgent[],
  autoConfigured: ReadonlySet<HammurabiAgent>,
): void {
  process.stdout.write('\nAgent setup instructions:\n')

  let hasManualAgents = false

  for (const selectedAgent of agents) {
    const instruction = AGENT_INSTRUCTIONS.find((candidate) => candidate.id === selectedAgent)
    if (!instruction) {
      continue
    }

    process.stdout.write(`\n[${instruction.label}]\n`)
    if (autoConfigured.has(selectedAgent)) {
      process.stdout.write('- Auto-configured.\n')
    } else {
      hasManualAgents = true
      for (const line of instruction.lines) {
        const formatted = line
          .replace('<endpoint>', endpoint)
          .replace('<KEY>', apiKey.slice(0, 8) + '...')
        process.stdout.write(`- ${formatted}\n`)
      }
    }
  }

  if (hasManualAgents) {
    process.stdout.write('\nOTEL environment variables:\n')
    process.stdout.write(`OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}\n`)
    process.stdout.write('OTEL_EXPORTER_OTLP_PROTOCOL=http/json\n')
    process.stdout.write('OTEL_EXPORTER_OTLP_HEADERS=x-hammurabi-api-key=<your-api-key>\n')
  }
}

function printProviderRuntimeInstructions(providers: readonly ProviderRegistryEntry[]): void {
  const machineAuthProviders = listMachineAuthProviders(providers)
  if (machineAuthProviders.length === 0) {
    return
  }

  process.stdout.write('\nProvider runtime setup:\n')
  for (const provider of machineAuthProviders) {
    const machineAuth = provider.machineAuth
    if (!machineAuth) {
      continue
    }

    const installTarget = machineAuth.installPackageName ?? machineAuth.cliBinaryName
    const modes = machineAuth.supportedAuthModes.join(', ')
    process.stdout.write(`- ${provider.label}: install ${installTarget}, verify \`${machineAuth.cliBinaryName} --version\`, then authenticate with ${modes}.\n`)
  }
  process.stdout.write('- Detailed auth recipes live in the Hervald provider docs.\n')
}

export async function runCli(
  args: readonly string[],
  dependencies: OnboardCliDependencies = {},
): Promise<number> {
  try {
    const command = args[0]
    if (command && command !== 'onboard') {
      printUsage()
      return 1
    }

    process.stdout.write('Hammurabi onboard\n')
    process.stdout.write('Configure agents to send telemetry to your Hammurabi instance.\n\n')

    const endpoint = await promptText('Hammurabi endpoint', {
      defaultValue: DEFAULT_ENDPOINT,
      required: true,
    })
    const apiKey = await promptSecret('API key', { required: true })

    process.stdout.write('\nValidating API key via OTEL endpoint...\n')
    const validation = await validateTelemetryWriteKey({
      endpoint,
      apiKey,
    })

    if (!validation.ok) {
      process.stderr.write(`Validation failed: ${validation.message}\n`)
      if (validation.validationUrl) {
        process.stderr.write(`Validation URL: ${validation.validationUrl}\n`)
      }
      return 1
    }

    process.stdout.write('Validation successful.\n\n')

    const agents = await promptMultiSelect<HammurabiAgent>(
      'Select agents to connect:',
      AGENT_INSTRUCTIONS.map((instruction) => ({
        value: instruction.id,
        label: instruction.label,
      })),
      DEFAULT_AGENTS,
    )
    const config = createHammurabiConfig({
      endpoint,
      apiKey,
      agents,
    })

    await writeHammurabiConfig(config)
    const runtimeConfig = await ensureCommanderRuntimeConfig()
    const founderOperator = await ensureFounderOperator(dependencies)

    const autoConfigured = new Set<HammurabiAgent>()
    const telemetrySetup = await applyManagedAgentTelemetryConfig(config)
    for (const agent of telemetrySetup.configured) {
      autoConfigured.add(agent)
    }

    process.stdout.write(`\nSaved config: ${defaultConfigPath()}\n`)
    process.stdout.write(
      runtimeConfig.created
        ? `Saved runtime config: ${runtimeConfig.filePath}\n`
        : `Runtime config already present: ${runtimeConfig.filePath}\n`,
    )
    process.stdout.write(
      founderOperator.created
        ? `Saved founder operator: ${founderOperator.filePath}\n`
        : `Founder operator already present: ${founderOperator.filePath}\n`,
    )
    printSelectedAgentInstructions(config.endpoint, config.apiKey, config.agents, autoConfigured)
    try {
      const { providers } = await loadProviderRegistry(config, {
        fetchImpl: dependencies.fetchImpl ?? fetch,
      })
      printProviderRuntimeInstructions(providers)
    } catch {
      process.stdout.write('\nProvider runtime setup:\n')
      process.stdout.write('- Provider registry unavailable right now. Open Hervald docs after the server is reachable for provider-specific auth steps.\n')
    }
    await runTailscaleSetup(dependencies)
    process.stdout.write('\nOnboarding complete.\n')

    return 0
  } finally {
    closePromptResources()
  }
}
