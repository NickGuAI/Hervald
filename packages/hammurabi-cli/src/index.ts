import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'
import { runCli as runOnboardCli } from './onboard.js'
import { runMachinesCli } from './machines.js'
import { runQuestsCli } from './quests.js'
import { runWorkersCli } from './workers.js'
import { runCommanderCli } from './commander.js'
import { runAutomationCli } from './automation.js'
import { runMemoryCli } from './memory.js'
import { runSessionCli } from './session.js'
import { runConversationsCli } from './conversations.js'
import { listWorkerDispatchProviderIds, loadProviderRegistry } from './providers.js'
import {
  buildCommanderSessionName,
  isOwnedByCommander,
  workerLifecycle,
} from './session-contract.js'
import { runUpCli } from './up.js'

interface Writable {
  write(chunk: string): boolean
}

interface CommanderWorkerDispatchOptions {
  commanderId: string
  host: string
  agentType: string
  task?: string
  cwd?: string
  sessionName: string
  skipValidation: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildAuthHeaders(config: HammurabiConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }
}

async function readErrorDetail(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.toLowerCase().includes('application/json')

  if (isJson) {
    try {
      const payload = (await response.json()) as unknown
      if (!isObject(payload)) {
        return null
      }

      const message = payload.message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim()
      }

      const error = payload.error
      if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim()
      }
    } catch {
      return null
    }
    return null
  }

  try {
    const text = (await response.text()).trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

function printRootUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi onboard\n')
  stdout.write('  hammurabi machine <command>\n')
  stdout.write('  hammurabi quests <command>\n')
  stdout.write('  hammurabi workers <command>\n')
  stdout.write('  hammurabi conversations <command>\n')
  stdout.write('  hammurabi automation <command>\n')
  stdout.write('  hammurabi commander <command>\n')
  stdout.write('  hammurabi commander transcripts <command>\n')
  stdout.write(
    '  hammurabi commanders workers dispatch --commander <id> --host <machine-id> --agent <provider> [--task <text>] [--cwd <path>] [--name <session-name>] [--skip-validation]\n',
  )
  stdout.write('  hammurabi memory <command>\n')
  stdout.write('  hammurabi session <command>\n')
  stdout.write('  hammurabi sessions <command>\n')
  stdout.write('  hammurabi up [--dev] [--port <port>]\n')
}

function printCommandersUsage(stdout: Writable): void {
  stdout.write(
    'Usage: hammurabi commanders workers dispatch --commander <id> --host <machine-id> --agent <provider> [--task <text>] [--cwd <path>] [--name <session-name>] [--skip-validation]\n',
  )
}

function parseCommandersWorkerDispatchOptions(
  args: readonly string[],
): CommanderWorkerDispatchOptions | null {
  if (args.length < 2 || args[0] !== 'workers' || args[1] !== 'dispatch') {
    return null
  }

  let commanderId: string | undefined
  let host: string | undefined
  let agentType: string | undefined
  let task: string | undefined
  let cwd: string | undefined
  let sessionName: string | undefined
  let skipValidation = false

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--skip-validation') {
      skipValidation = true
      continue
    }
    const value = args[index + 1]?.trim()

    if (
      flag !== '--commander' &&
      flag !== '--host' &&
      flag !== '--agent' &&
      flag !== '--task' &&
      flag !== '--cwd' &&
      flag !== '--name'
    ) {
      return null
    }
    if (!value) {
      return null
    }

    if (flag === '--commander') {
      commanderId = value
    } else if (flag === '--host') {
      host = value
    } else if (flag === '--agent') {
      agentType = value
    } else if (flag === '--task') {
      task = value
    } else if (flag === '--cwd') {
      if (!value.startsWith('/')) {
        return null
      }
      cwd = value
    } else if (flag === '--name') {
      sessionName = value
    }

    index += 1
  }

  if (!commanderId || !host || !agentType) {
    return null
  }

  return {
    commanderId,
    host,
    agentType,
    task,
    cwd,
    sessionName: sessionName ?? `worker-${Date.now()}`,
    skipValidation,
  }
}

async function runCommandersWorkersDispatch(
  config: HammurabiConfig,
  options: CommanderWorkerDispatchOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  let response: Response
  try {
    response = await fetch(
      buildApiUrl(
        config.endpoint,
        `/api/commanders/${encodeURIComponent(options.commanderId)}/workers`,
      ),
      {
        method: 'POST',
        headers: buildAuthHeaders(config),
        body: JSON.stringify({
          name: options.sessionName,
          host: options.host,
          agentType: options.agentType,
          ...(options.task ? { task: options.task } : {}),
          ...(options.cwd ? { cwd: options.cwd } : {}),
        }),
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    stderr.write(`Dispatch request failed: ${message}\n`)
    return 1
  }

  if (!response.ok) {
    if (response.status === 401) {
      stderr.write(`${formatStoredApiKeyUnauthorizedMessage({ endpoint: config.endpoint })}\n`)
      return 1
    }

    const detail = await readErrorDetail(response)
    stderr.write(
      detail
        ? `Request failed (${response.status}): ${detail}\n`
        : `Request failed (${response.status}).\n`,
    )
    return 1
  }

  let payload: unknown = {}
  try {
    payload = (await response.json()) as unknown
  } catch {
    payload = {}
  }

  const data = isObject(payload) ? payload : {}
  const sessionName = typeof data.sessionName === 'string' ? data.sessionName : options.sessionName
  const routedHost = typeof data.host === 'string' && data.host.trim().length > 0
    ? data.host.trim()
    : null

  stdout.write(`Worker dispatched: ${sessionName}\n`)
  stdout.write(`Host: ${routedHost ?? 'null'}\n`)

  if (!routedHost) {
    stderr.write('warning: machine routing was dropped (server reported host: null); check field names\n')
    return 1
  }

  return 0
}

async function runCommandersCli(args: readonly string[]): Promise<number> {
  const stdout = process.stdout
  const stderr = process.stderr
  const options = parseCommandersWorkerDispatchOptions(args)
  if (!options) {
    printCommandersUsage(stdout)
    return 1
  }

  const config = await readHammurabiConfig()
  if (!config) {
    stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
    return 1
  }

  if (!options.skipValidation) {
    try {
      const { providers } = await loadProviderRegistry(config)
      const validAgentTypes = new Set(listWorkerDispatchProviderIds(providers))
      if (!validAgentTypes.has(options.agentType)) {
        stderr.write(
          `Invalid --agent "${options.agentType}". Expected one of: ${[...validAgentTypes].join(', ')}.\n`,
        )
        return 1
      }
    } catch {
      stderr.write('Cannot validate --agent without a running Hammurabi server. Start the server first or pass --skip-validation.\n')
      return 1
    }
  }

  return runCommandersWorkersDispatch(config, options, stdout, stderr)
}

export async function runCli(args: readonly string[]): Promise<number> {
  const command = args[0]

  if (!command || command === 'onboard') {
    return runOnboardCli(command ? args : [])
  }
  if (command === 'machine') {
    return runMachinesCli(args.slice(1))
  }
  if (command === 'quests') {
    return runQuestsCli(args.slice(1))
  }
  if (command === 'workers') {
    return runWorkersCli(args.slice(1))
  }
  if (command === 'conversations') {
    return runConversationsCli(args.slice(1))
  }
  if (command === 'automation') {
    return runAutomationCli(args.slice(1))
  }
  if (command === 'commander') {
    return runCommanderCli(args.slice(1))
  }
  if (command === 'commanders') {
    return runCommandersCli(args.slice(1))
  }
  if (command === 'memory') {
    return runMemoryCli(args.slice(1))
  }
  if (command === 'session' || command === 'sessions') {
    return runSessionCli(args.slice(1))
  }
  if (command === 'up') {
    return runUpCli(args.slice(1))
  }

  printRootUsage(process.stdout)
  return 1
}

export { runUpCli } from './up.js'
export { runMachinesCli } from './machines.js'
export { runQuestsCli } from './quests.js'
export { runWorkersCli } from './workers.js'
export { runConversationsCli } from './conversations.js'
export { runCommanderCli } from './commander.js'
export { runAutomationCli } from './automation.js'
export { runMemoryCli } from './memory.js'
export { runSessionCli } from './session.js'
export { runTranscriptsCli } from './transcripts.js'
export { buildCommanderSessionName, isOwnedByCommander, workerLifecycle }
