import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'
import {
  buildSessionMessagesApiPath,
  DEFAULT_JSON_PEEK_LAST,
  parseSessionMessagePeekResponse,
  parseSessionPeekCommandArgs,
  renderSessionPeekEntries,
  type SessionMessagePeekResponse,
} from './session-peek.js'
import {
  normalizeSessionCreator,
  normalizeSessionType,
  type SessionCreator,
  type SessionType,
} from './session-contract.js'

interface Writable {
  write(chunk: string): boolean
}

type SessionListFilter = SessionType | 'all'

interface AgentSessionSummary {
  name: string
  sessionType?: SessionType
  transportType?: string
  creator?: SessionCreator
  status?: string
  cwd?: string
  host?: string
}

interface AgentSessionDetail extends AgentSessionSummary {
  created?: string
  lastActivityAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
}

export interface SessionCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  stdout?: Writable
  stderr?: Writable
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

      const error = payload.error
      if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim()
      }

      const message = payload.message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim()
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

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi sessions list [--type commander|worker|automation|all]\n')
  stdout.write('  hammurabi sessions info <name> [--tail <N>] [--json]\n')
  stdout.write('  hammurabi session register --name <name> --machine <machine> [--cwd <path>] [--agent <provider>] [--task <text>]\n')
  stdout.write('  hammurabi session heartbeat --name <name>\n')
  stdout.write('  hammurabi session events --name <name> --events \'[{"type":"..."}]\'\n')
  stdout.write('  hammurabi session unregister --name <name>\n')
}

function parseFlag(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

function parseListFilter(args: readonly string[]): SessionListFilter | null {
  if (args.length === 0) {
    return 'all'
  }
  const first = args[0]
  const direct = first?.startsWith('--type=') ? first.slice('--type='.length).trim() : null
  const flagValue = first === '--type' ? args[1]?.trim() : undefined
  const rawType = direct ?? flagValue
  if (!rawType) {
    return null
  }
  if (args.length !== (direct ? 1 : 2)) {
    return null
  }
  if (rawType === 'all') {
    return rawType
  }
  if (
    rawType === 'commander' ||
    rawType === 'worker' ||
    rawType === 'automation'
  ) {
    return rawType
  }
  return null
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const parsed = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return parsed.length > 0 ? parsed : undefined
}

function parseSessionDetail(payload: unknown): AgentSessionDetail | null {
  if (!isObject(payload)) {
    return null
  }

  const name = parseOptionalString(payload.name)
  if (!name) {
    return null
  }

  const resultPayload = isObject(payload.result) ? payload.result : null
  const completedAt = parseOptionalString(resultPayload?.completedAt)
  const lastActivityAt = parseOptionalString(payload.lastActivityAt)
    ?? parseOptionalString(payload.lastEventAt)
    ?? completedAt

  return {
    name,
    sessionType: normalizeSessionType(payload.sessionType) ?? undefined,
    transportType: parseOptionalString(payload.transportType),
    creator: normalizeSessionCreator(payload.creator) ?? undefined,
    status: parseOptionalString(payload.status),
    cwd: parseOptionalString(payload.cwd),
    host: parseOptionalString(payload.host),
    created: parseOptionalString(payload.created) ?? parseOptionalString(payload.createdAt),
    lastActivityAt,
    spawnedBy: parseOptionalString(payload.spawnedBy),
    spawnedWorkers: parseOptionalStringArray(payload.spawnedWorkers),
  }
}

function isExitedStatus(status: string | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'exited'
}

function parseSessions(payload: unknown): AgentSessionSummary[] {
  const raw = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.sessions) ? payload.sessions : [])

  const sessions: AgentSessionSummary[] = []
  for (const entry of raw) {
    if (!isObject(entry)) {
      continue
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) {
      continue
    }
    const sessionType = normalizeSessionType(entry.sessionType) ?? undefined
    const transportType = typeof entry.transportType === 'string' ? entry.transportType.trim() : undefined
    const status = typeof entry.status === 'string' ? entry.status.trim() : undefined
    const cwd = typeof entry.cwd === 'string' ? entry.cwd.trim() : undefined
    const host = typeof entry.host === 'string' ? entry.host.trim() : undefined
    sessions.push({
      name,
      sessionType,
      transportType: transportType && transportType.length > 0 ? transportType : undefined,
      creator: normalizeSessionCreator(entry.creator) ?? undefined,
      status: status && status.length > 0 ? status : undefined,
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      host: host && host.length > 0 ? host : undefined,
    })
  }

  return sessions
}

async function fetchSessionPeek(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  sessionName: string,
  last: number,
): Promise<{ ok: true; data: SessionMessagePeekResponse } | { ok: false; error: string }> {
  const url = buildApiUrl(config.endpoint, buildSessionMessagesApiPath(sessionName, last))

  try {
    const result = await fetchJson(fetchImpl, url, {
      method: 'GET',
      headers: buildAuthHeaders(config, false),
    })
    if (!result.ok) {
      const detail = await readErrorDetail(result.response)
      return {
        ok: false,
        error: detail
          ? `Request failed (${result.response.status}): ${detail}`
          : `Request failed (${result.response.status}).`,
      }
    }

    const payload = parseSessionMessagePeekResponse(result.data)
    if (!payload) {
      return { ok: false, error: 'response was malformed' }
    }

    return { ok: true, data: payload }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

async function runList(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const filter = parseListFilter(args)
  if (!filter) {
    printUsage(stderr)
    return 1
  }

  const url = buildApiUrl(config.endpoint, '/api/agents/sessions')
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })
  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `List failed (${result.response.status}): ${detail}\n`
        : `List failed (${result.response.status}).\n`,
    )
    return 1
  }

  const sessions = parseSessions(result.data)
    .filter((session) => !isExitedStatus(session.status))
    .filter((session) => {
      if (filter === 'all') {
        return true
      }
      return session.sessionType === filter
    })

  if (sessions.length === 0) {
    stdout.write('No active sessions.\n')
    return 0
  }

  stdout.write('Active sessions:\n')
  for (const session of sessions) {
    const sessionType = session.sessionType ?? 'worker'
    const transport = session.transportType ? ` transport=${session.transportType}` : ''
    const status = session.status ? ` status=${session.status}` : ''
    const host = session.host ? ` host=${session.host}` : ''
    const cwd = session.cwd ? ` cwd=${session.cwd}` : ''
    const creatorLabel = session.creator
      ? ` creator=${session.creator.kind}${session.creator.id ? `/${session.creator.id}` : ''}`
      : ''
    stdout.write(`- ${session.name} type=${sessionType}${creatorLabel}${transport}${status}${host}${cwd}\n`)
  }
  return 0
}

async function runInfo(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const infoOptions = parseSessionPeekCommandArgs(args)
  if (!infoOptions) {
    printUsage(stderr)
    return 1
  }

  const url = buildApiUrl(
    config.endpoint,
    `/api/agents/sessions/${encodeURIComponent(infoOptions.sessionName)}`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(config, false),
  })
  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `Info failed (${result.response.status}): ${detail}\n`
        : `Info failed (${result.response.status}).\n`,
    )
    return 1
  }

  const session = parseSessionDetail(result.data)
  if (!session) {
    stderr.write('Info failed: malformed response payload.\n')
    return 1
  }

  const sessionType = session.sessionType ?? 'worker'
  if (infoOptions.json) {
    const peek = await fetchSessionPeek(
      config,
      fetchImpl,
      infoOptions.sessionName,
      infoOptions.tail > 0 ? infoOptions.tail : DEFAULT_JSON_PEEK_LAST,
    )
    if (!peek.ok) {
      stderr.write(`Could not fetch messages: ${peek.error}\n`)
      return 1
    }

    stdout.write(`${JSON.stringify({
      session: session.name,
      sessionType,
      creator: session.creator ?? null,
      created: session.created ?? null,
      lastActivityAt: session.lastActivityAt ?? null,
      transport: session.transportType ?? null,
      status: session.status ?? null,
      spawnedBy: session.spawnedBy ?? null,
      spawnedWorkers: session.spawnedWorkers ?? [],
      host: session.host ?? null,
      cwd: session.cwd ?? null,
      events: {
        total: peek.data.total,
        returned: peek.data.returned,
      },
      messages: peek.data.messages,
    }, null, 2)}\n`)
    return 0
  }

  stdout.write(`Session: ${session.name}\n`)
  stdout.write(`Type: ${sessionType}\n`)
  if (session.creator) {
    stdout.write(`Creator: ${session.creator.kind}${session.creator.id ? ` (${session.creator.id})` : ''}\n`)
  }
  stdout.write(`Created: ${session.created ?? 'unknown'}\n`)
  stdout.write(`Last activity: ${session.lastActivityAt ?? 'unknown'}\n`)
  if (session.transportType) {
    stdout.write(`Transport: ${session.transportType}\n`)
  }
  if (session.status) {
    stdout.write(`Status: ${session.status}\n`)
  }
  if (session.spawnedBy) {
    stdout.write(`Spawned by: ${session.spawnedBy}\n`)
  }
  if (session.spawnedWorkers && session.spawnedWorkers.length > 0) {
    stdout.write(`Spawned workers: ${session.spawnedWorkers.join(', ')}\n`)
  }
  if (session.host) {
    stdout.write(`Host: ${session.host}\n`)
  }
  if (session.cwd) {
    stdout.write(`Cwd: ${session.cwd}\n`)
  }

  if (infoOptions.tail > 0) {
    const peek = await fetchSessionPeek(config, fetchImpl, infoOptions.sessionName, infoOptions.tail)
    if (!peek.ok) {
      stdout.write(`warning: could not fetch messages: ${peek.error}\n`)
      return 0
    }

    stdout.write(`last ${infoOptions.tail}:\n`)
    stdout.write(renderSessionPeekEntries(peek.data.messages))
  }

  return 0
}

async function runRegister(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const name = parseFlag(args, '--name')
  const machine = parseFlag(args, '--machine')
  const cwd = parseFlag(args, '--cwd')
  const agentType = parseFlag(args, '--agent')
  const task = parseFlag(args, '--task')

  if (!name) {
    stderr.write('--name is required\n')
    return 1
  }
  if (!machine) {
    stderr.write('--machine is required\n')
    return 1
  }

  const url = buildApiUrl(config.endpoint, '/api/agents/sessions/register')
  const body: Record<string, unknown> = { name, machine }
  if (cwd) body.cwd = cwd
  if (agentType) body.agentType = agentType
  if (task) body.task = task

  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify(body),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `Register failed (${result.response.status}): ${detail}\n`
        : `Register failed (${result.response.status}).\n`,
    )
    return 1
  }

  const data = result.data
  if (isObject(data)) {
    stdout.write(`Registered session "${data.name}" from ${data.machine}\n`)
  } else {
    stdout.write('Session registered.\n')
  }
  return 0
}

async function runHeartbeat(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const name = parseFlag(args, '--name')
  if (!name) {
    stderr.write('--name is required\n')
    return 1
  }

  const url = buildApiUrl(config.endpoint, `/api/agents/sessions/${encodeURIComponent(name)}/heartbeat`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({}),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `Heartbeat failed (${result.response.status}): ${detail}\n`
        : `Heartbeat failed (${result.response.status}).\n`,
    )
    return 1
  }

  stdout.write(`Heartbeat sent for "${name}".\n`)
  return 0
}

async function runEvents(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const name = parseFlag(args, '--name')
  const eventsStr = parseFlag(args, '--events')

  if (!name) {
    stderr.write('--name is required\n')
    return 1
  }
  if (!eventsStr) {
    stderr.write('--events is required (JSON array)\n')
    return 1
  }

  let events: unknown[]
  try {
    const parsed = JSON.parse(eventsStr) as unknown
    if (!Array.isArray(parsed)) {
      stderr.write('--events must be a JSON array\n')
      return 1
    }
    events = parsed
  } catch {
    stderr.write('--events must be valid JSON\n')
    return 1
  }

  const url = buildApiUrl(config.endpoint, `/api/agents/sessions/${encodeURIComponent(name)}/events`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({ events }),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `Events push failed (${result.response.status}): ${detail}\n`
        : `Events push failed (${result.response.status}).\n`,
    )
    return 1
  }

  const data = result.data
  const accepted = isObject(data) && typeof data.accepted === 'number' ? data.accepted : 0
  stdout.write(`Pushed ${accepted} event(s) to "${name}".\n`)
  return 0
}

async function runUnregister(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  args: readonly string[],
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const name = parseFlag(args, '--name')
  if (!name) {
    stderr.write('--name is required\n')
    return 1
  }

  const url = buildApiUrl(config.endpoint, `/api/agents/sessions/${encodeURIComponent(name)}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'DELETE',
    headers: buildAuthHeaders(config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(
      detail
        ? `Unregister failed (${result.response.status}): ${detail}\n`
        : `Unregister failed (${result.response.status}).\n`,
    )
    return 1
  }

  stdout.write(`Session "${name}" unregistered.\n`)
  return 0
}

export async function runSessionCli(
  args: readonly string[],
  deps: SessionCliDependencies = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const fetchImpl = deps.fetchImpl ?? fetch
  const readConfig = deps.readConfig ?? readHammurabiConfig

  const subcommand = args[0]

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printUsage(stdout)
    return subcommand ? 0 : 1
  }

  const config = await readConfig()
  if (!config) {
    stderr.write('Not configured. Run: hammurabi onboard\n')
    return 1
  }

  switch (subcommand) {
    case 'list':
      return runList(config, fetchImpl, args.slice(1), stdout, stderr)
    case 'info':
      return runInfo(config, fetchImpl, args.slice(1), stdout, stderr)
    case 'register':
      return runRegister(config, fetchImpl, args.slice(1), stdout, stderr)
    case 'heartbeat':
      return runHeartbeat(config, fetchImpl, args.slice(1), stdout, stderr)
    case 'events':
      return runEvents(config, fetchImpl, args.slice(1), stdout, stderr)
    case 'unregister':
      return runUnregister(config, fetchImpl, args.slice(1), stdout, stderr)
    default:
      stderr.write(`Unknown session subcommand: ${subcommand}\n`)
      printUsage(stderr)
      return 1
  }
}
