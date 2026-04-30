import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'
import {
  fetchRemoteMemoryExport,
} from './commander.js'

interface Writable {
  write(chunk: string): boolean
}

export interface MemoryCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  stdout?: Writable
  stderr?: Writable
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi memory save --commander <id> "<fact>" [--fact "<another>"]\n')
  stdout.write('  hammurabi memory export --commander <id>\n')
  stdout.write('  hammurabi memory --type=working_memory append --commander <id> "<text>"\n')
  stdout.write('  hammurabi memory --type=working_memory read --commander <id>\n')
  stdout.write('  hammurabi memory --type=working_memory clear --commander <id>\n')
}

function parseNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function buildApiUrl(endpoint: string, apiPath: string): string {
  return new URL(apiPath, `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildAuthHeaders(config: HammurabiConfig, includeJsonContentType: boolean): HeadersInit {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
  }

  if (includeJsonContentType) {
    headers['content-type'] = 'application/json'
  }

  return headers
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const response = await fetchImpl(url, init)
  if (!response.ok) {
    return { ok: false, response }
  }

  if (response.status === 204) {
    return { ok: true, data: null }
  }

  try {
    return { ok: true, data: (await response.json()) as unknown }
  } catch {
    return { ok: true, data: null }
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

async function writeRequestFailure(
  stderr: Writable,
  response: Response,
  config: HammurabiConfig,
): Promise<void> {
  if (response.status === 401) {
    stderr.write(`${formatStoredApiKeyUnauthorizedMessage({ endpoint: config.endpoint })}\n`)
    return
  }

  const detail = await readErrorDetail(response)
  stderr.write(
    detail
      ? `Request failed (${response.status}): ${detail}\n`
      : `Request failed (${response.status}).\n`,
  )
}

interface SaveOptions {
  commanderId: string
  facts: string[]
}

interface ExportOptions {
  commanderId: string
}

type WorkingMemoryAction = 'append' | 'read' | 'clear'

interface WorkingMemoryOptions {
  commanderId: string
  action: WorkingMemoryAction
  content?: string
}

function parseSaveOptions(args: readonly string[]): SaveOptions | null {
  let commanderId: string | undefined
  const facts: string[] = []

  let index = 0
  while (index < args.length) {
    const flag = args[index]
    if (flag === '--commander') {
      commanderId = parseNonEmpty(args[index + 1]) ?? undefined
      if (!commanderId) return null
      index += 2
      continue
    }

    if (flag === '--fact') {
      const fact = parseNonEmpty(args[index + 1])
      if (!fact) return null
      facts.push(fact)
      index += 2
      continue
    }

    // positional argument = first fact
    if (!flag?.startsWith('--')) {
      const fact = parseNonEmpty(flag)
      if (fact) {
        facts.push(fact)
      }
      index += 1
      continue
    }

    return null
  }

  if (!commanderId || facts.length === 0) {
    return null
  }

  return { commanderId, facts }
}

function parseExportOptions(args: readonly string[]): ExportOptions | null {
  if (args.length !== 2 || args[0] !== '--commander') {
    return null
  }

  const commanderId = parseNonEmpty(args[1])
  if (!commanderId) {
    return null
  }

  return { commanderId }
}

function parseWorkingMemoryOptions(args: readonly string[]): WorkingMemoryOptions | null {
  if (args.length < 3) {
    return null
  }

  let normalizedArgs = [...args]
  if (normalizedArgs[0] === '--type' && normalizedArgs[1] === 'working_memory') {
    normalizedArgs = ['--type=working_memory', ...normalizedArgs.slice(2)]
  }

  if (normalizedArgs[0] !== '--type=working_memory') {
    return null
  }

  const action = normalizedArgs[1]
  if (action !== 'append' && action !== 'read' && action !== 'clear') {
    return null
  }

  if (action === 'append') {
    if (normalizedArgs.length !== 5 || normalizedArgs[2] !== '--commander') {
      return null
    }

    const commanderId = parseNonEmpty(normalizedArgs[3])
    const content = parseNonEmpty(normalizedArgs[4])
    if (!commanderId || !content) {
      return null
    }

    return { commanderId, action, content }
  }

  if (normalizedArgs.length !== 4 || normalizedArgs[2] !== '--commander') {
    return null
  }

  const commanderId = parseNonEmpty(normalizedArgs[3])
  if (!commanderId) {
    return null
  }

  return { commanderId, action }
}

async function runSave(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: SaveOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/memory/facts`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ facts: options.facts }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const data = isObject(result.data) ? result.data : {}
  const factsAdded = typeof data.factsAdded === 'number' ? data.factsAdded : 0
  const lineCount = typeof data.lineCount === 'number' ? data.lineCount : 0

  stdout.write(`Saved ${factsAdded} facts to MEMORY.md (${lineCount} total lines).\n`)
  return 0
}

async function runExport(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: ExportOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  try {
    const payload = await fetchRemoteMemoryExport(
      fetchImpl,
      config.endpoint,
      options.commanderId,
      config.apiKey,
    )
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

async function runWorkingMemory(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: WorkingMemoryOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/memory/working-memory`,
  )

  if (options.action === 'read') {
    const result = await fetchJson(fetchImpl, url, {
      method: 'GET',
      headers: buildAuthHeaders(config, false),
    })

    if (!result.ok) {
      await writeRequestFailure(stderr, result.response, config)
      return 1
    }

    const data = isObject(result.data) ? result.data : {}
    const content = typeof data.content === 'string' ? data.content : ''
    if (content.length > 0) {
      stdout.write(`${content}\n`)
    }
    return 0
  }

  if (options.action === 'clear') {
    const response = await fetchImpl(url, {
      method: 'DELETE',
      headers: buildAuthHeaders(config, false),
    })

    if (!response.ok) {
      await writeRequestFailure(stderr, response, config)
      return 1
    }

    stdout.write(`Working memory cleared for ${options.commanderId}.\n`)
    return 0
  }

  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ content: options.content }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  stdout.write(`Working memory updated for ${options.commanderId}.\n`)
  return 0
}

export async function runMemoryCli(
  args: readonly string[],
  dependencies: MemoryCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const readConfig = dependencies.readConfig ?? readHammurabiConfig
  const workingMemoryOptions = parseWorkingMemoryOptions(args)

  if (workingMemoryOptions) {
    const config = await readConfig()
    if (!config) {
      stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
      return 1
    }

    return runWorkingMemory(config, fetchImpl, workingMemoryOptions, stdout, stderr)
  }

  const command = args[0]
  if (
    !command ||
    (command !== 'save' &&
      command !== 'export')
  ) {
    printUsage(stdout)
    return 1
  }

  const config = await readConfig()
  if (!config) {
    stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
    return 1
  }

  if (command === 'export') {
    const exportOptions = parseExportOptions(args.slice(1))
    if (!exportOptions) {
      printUsage(stdout)
      return 1
    }
    return runExport(config, fetchImpl, exportOptions, stdout, stderr)
  }

  const saveOptions = parseSaveOptions(args.slice(1))
  if (!saveOptions) {
    printUsage(stdout)
    return 1
  }
  return runSave(config, fetchImpl, saveOptions, stdout, stderr)
}
