import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'
import {
  type ConversationStatus,
  type ConversationSurface,
} from './session-contract.js'

interface Writable {
  write(chunk: string): boolean
}

interface ConversationSummary {
  id: string
  commanderId: string
  surface: ConversationSurface
  status: ConversationStatus
  liveSession: Record<string, unknown> | null
}

interface ListOptions {
  commanderId: string
}

interface CreateOptions {
  commanderId: string
  surface: 'ui' | 'cli' | 'api'
}

export interface ConversationsCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  stdout?: Writable
  stderr?: Writable
}

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi conversations list --commander <id>\n')
  stdout.write('  hammurabi conversations create --commander <id> --surface <ui|cli|api>\n')
  stdout.write('  hammurabi conversations attach <conversation-id>\n')
  stdout.write('  hammurabi conversations archive <conversation-id>\n')
}

function parseNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function parseConversationId(value: string | undefined): string | null {
  const trimmed = parseNonEmpty(value)
  if (!trimmed || !CONVERSATION_ID_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function parseListOptions(args: readonly string[]): ListOptions | null {
  if (args.length !== 2 || args[0] !== '--commander') {
    return null
  }

  const commanderId = parseNonEmpty(args[1])
  if (!commanderId) {
    return null
  }

  return { commanderId }
}

function parseCreateSurface(value: string | undefined): CreateOptions['surface'] | null {
  return value === 'ui' || value === 'cli' || value === 'api' ? value : null
}

function parseCreateOptions(args: readonly string[]): CreateOptions | null {
  let commanderId: string | null = null
  let surface: CreateOptions['surface'] | null = null

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]

    if (flag === '--commander') {
      commanderId = parseNonEmpty(value)
      continue
    }

    if (flag === '--surface') {
      surface = parseCreateSurface(parseNonEmpty(value) ?? undefined)
      continue
    }

    return null
  }

  if (!commanderId || !surface || args.length !== 4) {
    return null
  }

  return { commanderId, surface }
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

function parseConversationSurface(value: unknown): ConversationSurface | null {
  return value === 'discord' ||
    value === 'telegram' ||
    value === 'whatsapp' ||
    value === 'ui' ||
    value === 'cli' ||
    value === 'api'
    ? value
    : null
}

function parseConversationStatus(value: unknown): ConversationStatus | null {
  return value === 'active' || value === 'idle' || value === 'archived' ? value : null
}

function parseConversation(payload: unknown): ConversationSummary | null {
  if (!isObject(payload)) {
    return null
  }

  const id = parseNonEmpty(typeof payload.id === 'string' ? payload.id : undefined)
  const commanderId = parseNonEmpty(
    typeof payload.commanderId === 'string' ? payload.commanderId : undefined,
  )
  const surface = parseConversationSurface(payload.surface)
  const status = parseConversationStatus(payload.status)

  if (!id || !commanderId || !surface || !status) {
    return null
  }

  const liveSession = isObject(payload.liveSession) ? payload.liveSession : null
  return {
    id,
    commanderId,
    surface,
    status,
    liveSession,
  }
}

function parseConversationList(payload: unknown): ConversationSummary[] {
  const raw = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.conversations) ? payload.conversations : [])

  const conversations: ConversationSummary[] = []
  for (const entry of raw) {
    const parsed = parseConversation(entry)
    if (parsed) {
      conversations.push(parsed)
    }
  }

  return conversations
}

async function resolveConfig(
  dependencies: ConversationsCliDependencies,
  stderr: Writable,
): Promise<HammurabiConfig | null> {
  const readConfig = dependencies.readConfig ?? readHammurabiConfig
  const config = await readConfig()
  if (!config) {
    stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
    return null
  }

  return config
}

async function runList(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: ListOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/conversations`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversations = parseConversationList(result.data)
  if (conversations.length === 0) {
    stdout.write('No conversations.\n')
    return 0
  }

  stdout.write('Conversations:\n')
  for (const conversation of conversations) {
    const live = conversation.liveSession ? 'yes' : 'no'
    stdout.write(
      `- ${conversation.id} surface=${conversation.surface} status=${conversation.status} live=${live}\n`,
    )
  }

  return 0
}

async function runCreate(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: CreateOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/conversations`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ surface: options.surface }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`${conversation.id}\n`)
  return 0
}

async function runAttach(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  conversationId: string,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/conversations/${encodeURIComponent(conversationId)}/resume`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`Conversation ${conversation.id} attached.\n`)
  return 0
}

async function runArchive(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  conversationId: string,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/conversations/${encodeURIComponent(conversationId)}/archive`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const conversation = parseConversation(result.data)
  if (!conversation) {
    stderr.write('Request succeeded but response was malformed.\n')
    return 1
  }

  stdout.write(`Conversation ${conversation.id} archived.\n`)
  return 0
}

export async function runConversationsCli(
  args: readonly string[],
  dependencies: ConversationsCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch

  const command = args[0]
  if (
    !command ||
    (command !== 'list' &&
      command !== 'create' &&
      command !== 'attach' &&
      command !== 'archive')
  ) {
    printUsage(stdout)
    return 1
  }

  const config = await resolveConfig(dependencies, stderr)
  if (!config) {
    return 1
  }

  if (command === 'list') {
    const options = parseListOptions(args.slice(1))
    if (!options) {
      printUsage(stdout)
      return 1
    }
    return runList(config, fetchImpl, options, stdout, stderr)
  }

  if (command === 'create') {
    const options = parseCreateOptions(args.slice(1))
    if (!options) {
      printUsage(stdout)
      return 1
    }
    return runCreate(config, fetchImpl, options, stdout, stderr)
  }

  const conversationId = parseConversationId(args[1])
  if (!conversationId || args.length !== 2) {
    printUsage(stdout)
    return 1
  }

  if (command === 'attach') {
    return runAttach(config, fetchImpl, conversationId, stdout, stderr)
  }

  return runArchive(config, fetchImpl, conversationId, stdout, stderr)
}
