import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'
import { listAutomationProviderIds, loadProviderRegistry } from './providers.js'

interface Writable {
  write(chunk: string): boolean
}

interface CommandContext {
  config: HammurabiConfig
}

type AutomationTrigger = 'schedule' | 'quest' | 'manual'
type AutomationStatus = 'active' | 'paused' | 'completed' | 'cancelled'

interface QuestTrigger {
  event: string
  commanderId?: string
}

interface AutomationSummary {
  id: string
  name: string
  trigger?: AutomationTrigger
  status?: string
  schedule?: string
  timezone?: string
  enabled?: boolean
  parentCommanderId?: string
  agentType?: string
  sessionType?: string
  model?: string
  maxRuns?: number
  totalRuns?: number
  totalCostUsd?: number
  lastRunAt?: string
  instruction?: string
}

interface AutomationDetail extends AutomationSummary {
  description?: string
  machine?: string
  workDir?: string
  permissionMode?: string
  createdAt?: string
  updatedAt?: string
  nextScheduledAt?: string
  questTrigger?: QuestTrigger
  skills?: string[]
  seedMemory?: string
}

interface AutomationHistoryEntry {
  timestamp: string
  status: string
  costUsd: number
  duration: string
  sessionId: string
  detail: string
}

interface ListOptions {
  commanderId?: string
  trigger?: AutomationTrigger
}

export interface AutomationCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  stdout?: Writable
  stderr?: Writable
}

const LIST_FLAGS = ['--commander', '--trigger'] as const
const MUTATION_FLAGS = [
  '--trigger',
  '--name',
  '--description',
  '--schedule',
  '--timezone',
  '--instruction',
  '--model',
  '--agent',
  '--work-dir',
  '--machine',
  '--permission-mode',
  '--session-type',
  '--enabled',
  '--commander',
  '--skills',
  '--seed-memory',
  '--max-runs',
  '--quest-event',
  '--quest-commander',
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNonEmpty(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
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
  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return items.length > 0 ? items : undefined
}

function parseBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return null
}

function parseOptionalPositiveInt(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function normalizeTrigger(value: unknown): AutomationTrigger | null {
  if (value === 'schedule' || value === 'quest' || value === 'manual') {
    return value
  }
  return null
}

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseScheduleValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return parseOptionalString(value)
  }
  if (isObject(value) && typeof value.cron === 'string') {
    return parseOptionalString(value.cron)
  }
  return undefined
}

function parseQuestTrigger(value: unknown): QuestTrigger | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const event = parseOptionalString(value.event)
  if (!event) {
    return undefined
  }
  const commanderId = parseOptionalString(value.commanderId)
  return commanderId ? { event, commanderId } : { event }
}

function parseFlagValues(
  args: readonly string[],
  allowedFlags: readonly string[],
): Map<string, string> | null {
  if (args.length % 2 !== 0) {
    return null
  }

  const allowed = new Set(allowedFlags)
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = parseNonEmpty(args[index + 1])
    if (!flag || !allowed.has(flag) || !value || values.has(flag)) {
      return null
    }
    values.set(flag, value)
  }

  return values
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

function renderRequestFailure(status: number, detail: string | null): string {
  if (detail) {
    return `Request failed (${status}): ${detail}\n`
  }
  return `Request failed (${status}).\n`
}

function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => {
        const value = row[columnIndex] ?? ''
        return value.length
      }),
    ),
  )

  const separator = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+\n`
  const formatRow = (values: readonly string[]) =>
    `| ${values.map((value, columnIndex) => value.padEnd(widths[columnIndex] ?? value.length)).join(' | ')} |\n`

  let output = ''
  output += separator
  output += formatRow(headers)
  output += separator
  for (const row of rows) {
    output += formatRow(row)
  }
  output += separator
  return output
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi automation list [--commander <id>] [--trigger schedule|quest|manual]\n')
  stdout.write(
    '  hammurabi automation create --trigger schedule|quest|manual --name <name> --instruction "<text>" [--commander <id>] [--schedule "<expr>"] [--quest-event completed] [--quest-commander <id>] [--description "<text>"] [--skills "a,b"] [--seed-memory "<text>"] [--max-runs <n>] [--timezone <tz>] [--model <model>] [--agent <provider>] [--work-dir <path>] [--machine <id>] [--permission-mode <mode>] [--session-type stream|pty] [--enabled true|false]\n',
  )
  stdout.write(
    '  hammurabi automation update <automation-id> [--trigger schedule|quest|manual] [--name <name>] [--instruction "<text>"] [--commander <id>] [--schedule "<expr>"] [--quest-event completed] [--quest-commander <id>] [--description "<text>"] [--skills "a,b"] [--seed-memory "<text>"] [--max-runs <n>] [--timezone <tz>] [--model <model>] [--agent <provider>] [--work-dir <path>] [--machine <id>] [--permission-mode <mode>] [--session-type stream|pty] [--enabled true|false]\n',
  )
  stdout.write('  hammurabi automation show <automation-id>\n')
  stdout.write('  hammurabi automation history <automation-id> [--limit <n>]\n')
  stdout.write('  hammurabi automation trigger <automation-id>\n')
  stdout.write('  hammurabi automation pause <automation-id>\n')
  stdout.write('  hammurabi automation resume <automation-id>\n')
  stdout.write('  hammurabi automation complete <automation-id>\n')
  stdout.write('  hammurabi automation cancel <automation-id>\n')
  stdout.write('  hammurabi automation delete <automation-id>\n')
}

async function resolveContext(
  dependencies: AutomationCliDependencies,
  stderr: Writable,
): Promise<CommandContext | null> {
  const readConfig = dependencies.readConfig ?? readHammurabiConfig
  const config = await readConfig()
  if (!config) {
    stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
    return null
  }

  return { config }
}

function parseListArgs(args: readonly string[]): ListOptions | null {
  const values = parseFlagValues(args, LIST_FLAGS)
  if (!values) {
    return null
  }

  const rawTrigger = values.get('--trigger')
  const trigger = rawTrigger ? normalizeTrigger(rawTrigger) : null
  if (rawTrigger && !trigger) {
    return null
  }

  return {
    commanderId: values.get('--commander'),
    trigger: trigger ?? undefined,
  }
}

function parseMutationPayload(
  values: Map<string, string>,
  mode: 'create' | 'update',
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const body: Record<string, unknown> = {}

  const rawTrigger = values.get('--trigger')
  const trigger = rawTrigger ? normalizeTrigger(rawTrigger) : null
  if (rawTrigger && !trigger) {
    return { ok: false, error: '--trigger must be schedule, quest, or manual' }
  }
  if (mode === 'create' && !trigger) {
    return { ok: false, error: 'create requires --trigger' }
  }
  if (trigger) {
    body.trigger = trigger
  }

  const name = values.get('--name')
  if (name) {
    body.name = name
  } else if (mode === 'create') {
    return { ok: false, error: 'create requires --name' }
  }

  const instruction = values.get('--instruction')
  if (instruction) {
    body.instruction = instruction
  } else if (mode === 'create') {
    return { ok: false, error: 'create requires --instruction' }
  }

  const commanderId = values.get('--commander')
  if (commanderId) {
    body.parentCommanderId = commanderId
  }

  const description = values.get('--description')
  if (description) {
    body.description = description
  }

  const schedule = values.get('--schedule')
  if (schedule) {
    body.schedule = schedule
  }

  const timezone = values.get('--timezone')
  if (timezone) {
    body.timezone = timezone
  }

  const model = values.get('--model')
  if (model) {
    body.model = model
  }

  const agent = values.get('--agent')
  if (agent) {
    body.agentType = agent
  }

  const workDir = values.get('--work-dir')
  if (workDir) {
    body.workDir = workDir
  }

  const machine = values.get('--machine')
  if (machine) {
    body.machine = machine
  }

  const permissionMode = values.get('--permission-mode')
  if (permissionMode) {
    body.permissionMode = permissionMode
  }

  const sessionType = values.get('--session-type')
  if (sessionType) {
    if (sessionType !== 'stream' && sessionType !== 'pty') {
      return { ok: false, error: '--session-type must be stream or pty' }
    }
    body.sessionType = sessionType
  }

  const enabledRaw = values.get('--enabled')
  if (enabledRaw !== undefined) {
    const enabled = parseBoolean(enabledRaw)
    if (enabled === null) {
      return { ok: false, error: '--enabled must be true or false' }
    }
    body.enabled = enabled
  } else if (mode === 'create') {
    body.enabled = true
  }

  const skillsValue = values.get('--skills')
  if (skillsValue) {
    const skills = skillsValue
      .split(',')
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0)
    if (skills.length === 0) {
      return { ok: false, error: '--skills must contain at least one skill name' }
    }
    body.skills = skills
  }

  const seedMemory = values.get('--seed-memory')
  if (seedMemory) {
    body.seedMemory = seedMemory
  }

  const maxRuns = parseOptionalPositiveInt(values.get('--max-runs'))
  if (maxRuns === null) {
    return { ok: false, error: '--max-runs must be a positive integer' }
  }
  if (maxRuns !== undefined) {
    body.maxRuns = maxRuns
  }

  const questEvent = values.get('--quest-event')
  const questCommander = values.get('--quest-commander')
  if (questEvent && questEvent !== 'completed') {
    return { ok: false, error: '--quest-event must be completed' }
  }

  if (trigger === 'schedule') {
    if (!schedule) {
      return { ok: false, error: 'schedule automations require --schedule' }
    }
    if (questEvent || questCommander) {
      return { ok: false, error: 'schedule automations do not accept quest trigger flags' }
    }
  }

  if (trigger === 'quest') {
    body.questTrigger = questCommander
      ? { event: questEvent ?? 'completed', commanderId: questCommander }
      : { event: questEvent ?? 'completed' }
    if (schedule) {
      return { ok: false, error: 'quest automations do not accept --schedule' }
    }
  }

  if (trigger === 'manual') {
    if (schedule) {
      return { ok: false, error: 'manual automations do not accept --schedule' }
    }
    if (questEvent || questCommander) {
      return { ok: false, error: 'manual automations do not accept quest trigger flags' }
    }
  }

  if (!trigger && (questEvent || questCommander)) {
    body.questTrigger = questCommander
      ? { event: questEvent ?? 'completed', commanderId: questCommander }
      : { event: questEvent ?? 'completed' }
  }

  if (mode === 'update' && Object.keys(body).length === 0) {
    return { ok: false, error: 'update requires at least one field to change' }
  }

  return { ok: true, body }
}

function parseAutomationSummary(entry: unknown): AutomationSummary | null {
  if (!isObject(entry)) {
    return null
  }

  const id = parseOptionalString(entry.id)
  const name = parseOptionalString(entry.name)
  if (!id || !name) {
    return null
  }

  const schedule = parseScheduleValue(entry.schedule)
  const questTrigger = parseQuestTrigger(entry.questTrigger)
  const trigger = normalizeTrigger(entry.trigger)
    ?? (questTrigger ? 'quest' : (schedule ? 'schedule' : null))

  return {
    id,
    name,
    trigger: trigger ?? undefined,
    status: normalizeStatus(entry.status),
    schedule,
    timezone: parseOptionalString(entry.timezone),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
    parentCommanderId: parseOptionalString(entry.parentCommanderId)
      ?? parseOptionalString(entry.commanderId),
    agentType: parseOptionalString(entry.agentType),
    sessionType: parseOptionalString(entry.sessionType),
    model: parseOptionalString(entry.model),
    maxRuns: typeof entry.maxRuns === 'number' && Number.isFinite(entry.maxRuns)
      ? entry.maxRuns
      : undefined,
    totalRuns: typeof entry.totalRuns === 'number' && Number.isFinite(entry.totalRuns)
      ? entry.totalRuns
      : undefined,
    totalCostUsd: typeof entry.totalCostUsd === 'number' && Number.isFinite(entry.totalCostUsd)
      ? entry.totalCostUsd
      : undefined,
    lastRunAt: parseOptionalString(entry.lastRunAt) ?? parseOptionalString(entry.lastRun),
    instruction: parseOptionalString(entry.instruction),
  }
}

function parseAutomationListPayload(payload: unknown): AutomationSummary[] {
  const rawAutomations = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.automations)
      ? payload.automations
      : []

  const automations: AutomationSummary[] = []
  for (const entry of rawAutomations) {
    const automation = parseAutomationSummary(entry)
    if (automation) {
      automations.push(automation)
    }
  }
  return automations
}

function parseAutomationDetail(payload: unknown): AutomationDetail | null {
  const base = parseAutomationSummary(payload)
  if (!base || !isObject(payload)) {
    return null
  }

  return {
    ...base,
    description: parseOptionalString(payload.description),
    machine: parseOptionalString(payload.machine),
    workDir: parseOptionalString(payload.workDir),
    permissionMode: parseOptionalString(payload.permissionMode),
    createdAt: parseOptionalString(payload.createdAt),
    updatedAt: parseOptionalString(payload.updatedAt),
    nextScheduledAt: parseOptionalString(payload.nextScheduledAt),
    questTrigger: parseQuestTrigger(payload.questTrigger),
    skills: parseOptionalStringArray(payload.skills),
    seedMemory: parseOptionalString(payload.seedMemory),
  }
}

function formatDurationSeconds(value: number): string {
  const rounded = Math.max(0, Math.round(value))
  return `${rounded}s`
}

function computeDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt || !completedAt) {
    return '-'
  }
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return '-'
  }
  return formatDurationSeconds((completed - started) / 1000)
}

function parseAutomationHistoryPayload(payload: unknown): AutomationHistoryEntry[] {
  const rawEntries = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.entries)
      ? payload.entries
      : isObject(payload) && Array.isArray(payload.runs)
        ? payload.runs
        : []

  const entries: AutomationHistoryEntry[] = []
  for (const item of rawEntries) {
    if (!isObject(item)) {
      continue
    }

    const timestamp = parseOptionalString(item.timestamp) ?? parseOptionalString(item.startedAt)
    if (!timestamp) {
      continue
    }

    const status = parseOptionalString(item.status)
      ?? parseOptionalString(item.result)
      ?? parseOptionalString(item.action)
      ?? 'unknown'
    const costUsd = typeof item.costUsd === 'number' && Number.isFinite(item.costUsd) ? item.costUsd : 0
    const duration = typeof item.durationSec === 'number' && Number.isFinite(item.durationSec)
      ? formatDurationSeconds(item.durationSec)
      : computeDuration(parseOptionalString(item.startedAt), parseOptionalString(item.completedAt))
    const sessionId = parseOptionalString(item.sessionId) ?? '-'
    const detail = parseOptionalString(item.action)
      ?? parseOptionalString(item.report)
      ?? parseOptionalString(item.source)
      ?? parseOptionalString(item.id)
      ?? '-'

    entries.push({
      timestamp,
      status,
      costUsd,
      duration,
      sessionId,
      detail,
    })
  }

  return entries
}

async function runList(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  options: ListOptions,
): Promise<number> {
  const params = new URLSearchParams()
  if (options.commanderId) {
    params.set('parentCommanderId', options.commanderId)
  }
  if (options.trigger) {
    params.set('trigger', options.trigger)
  }

  const suffix = params.toString() ? `?${params.toString()}` : ''
  const url = buildApiUrl(context.config.endpoint, `/api/automations${suffix}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(context.config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  const automations = parseAutomationListPayload(result.data)
  if (automations.length === 0) {
    stdout.write('No automations found.\n')
    return 0
  }

  const headers = ['ID', 'NAME', 'TRIGGER', 'STATUS', 'SCHEDULE', 'ENABLED', 'COMMANDER']
  const rows = automations.map((automation) => [
    automation.id,
    automation.name,
    automation.trigger ?? '-',
    automation.status ?? '-',
    automation.schedule ?? '-',
    automation.enabled === undefined ? '-' : (automation.enabled ? 'true' : 'false'),
    automation.parentCommanderId ?? 'global',
  ])
  stdout.write(formatTable(headers, rows))
  return 0
}

async function runCreate(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  body: Record<string, unknown>,
): Promise<number> {
  const url = buildApiUrl(context.config.endpoint, '/api/automations')
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(context.config, true),
    body: JSON.stringify(body),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  const payload = isObject(result.data) ? result.data : {}
  const automationId = typeof payload.id === 'string' ? payload.id : '(unknown)'
  stdout.write(`Created automation ID: ${automationId}\n`)
  return 0
}

async function validateAutomationProviderArg(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stderr: Writable,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const agentType = typeof payload.agentType === 'string' ? payload.agentType : null
  if (!agentType) {
    return true
  }

  try {
    const { providers } = await loadProviderRegistry(context.config, { fetchImpl })
    const validAgentTypes = new Set(listAutomationProviderIds(providers))
    if (validAgentTypes.has(agentType)) {
      return true
    }

    stderr.write(`Invalid --agent "${agentType}". Expected one of: ${[...validAgentTypes].join(', ')}.\n`)
    return false
  } catch {
    // Allow the request path itself to validate when the registry is unreachable
    // and no cached provider list is available yet.
    return true
  }
}

async function runUpdate(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
  patch: Record<string, unknown>,
): Promise<number> {
  const url = buildApiUrl(context.config.endpoint, `/api/automations/${encodeURIComponent(automationId)}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'PATCH',
    headers: buildAuthHeaders(context.config, true),
    body: JSON.stringify(patch),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  stdout.write(`Updated automation ${automationId}.\n`)
  return 0
}

async function runShow(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
): Promise<number> {
  const url = buildApiUrl(context.config.endpoint, `/api/automations/${encodeURIComponent(automationId)}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(context.config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  const automation = parseAutomationDetail(result.data)
  if (!automation) {
    stderr.write('Automation response was malformed.\n')
    return 1
  }

  stdout.write(`ID: ${automation.id}\n`)
  stdout.write(`Name: ${automation.name}\n`)
  stdout.write(`Trigger: ${automation.trigger ?? 'unknown'}\n`)
  if (automation.questTrigger) {
    stdout.write(`Quest Event: ${automation.questTrigger.event}\n`)
    if (automation.questTrigger.commanderId) {
      stdout.write(`Quest Commander: ${automation.questTrigger.commanderId}\n`)
    }
  }
  if (automation.schedule) {
    stdout.write(`Schedule: ${automation.schedule}\n`)
  }
  if (automation.timezone) {
    stdout.write(`Timezone: ${automation.timezone}\n`)
  }
  if (automation.status) {
    stdout.write(`Status: ${automation.status}\n`)
  }
  if (automation.enabled !== undefined) {
    stdout.write(`Enabled: ${automation.enabled ? 'true' : 'false'}\n`)
  }
  if (automation.parentCommanderId) {
    stdout.write(`Commander: ${automation.parentCommanderId}\n`)
  }
  if (automation.agentType) {
    stdout.write(`Agent: ${automation.agentType}\n`)
  }
  if (automation.sessionType) {
    stdout.write(`Session Type: ${automation.sessionType}\n`)
  }
  if (automation.model) {
    stdout.write(`Model: ${automation.model}\n`)
  }
  if (automation.machine) {
    stdout.write(`Machine: ${automation.machine}\n`)
  }
  if (automation.workDir) {
    stdout.write(`Work Dir: ${automation.workDir}\n`)
  }
  if (automation.permissionMode) {
    stdout.write(`Permission Mode: ${automation.permissionMode}\n`)
  }
  if (automation.maxRuns !== undefined) {
    stdout.write(`Max Runs: ${automation.maxRuns}\n`)
  }
  if (automation.totalRuns !== undefined) {
    stdout.write(`Total Runs: ${automation.totalRuns}\n`)
  }
  if (automation.totalCostUsd !== undefined) {
    stdout.write(`Total Cost: $${automation.totalCostUsd.toFixed(2)}\n`)
  }
  if (automation.lastRunAt) {
    stdout.write(`Last Run: ${automation.lastRunAt}\n`)
  }
  if (automation.nextScheduledAt) {
    stdout.write(`Next Scheduled: ${automation.nextScheduledAt}\n`)
  }
  if (automation.skills?.length) {
    stdout.write(`Skills: ${automation.skills.join(', ')}\n`)
  }
  if (automation.seedMemory) {
    stdout.write(`Seed Memory: ${automation.seedMemory}\n`)
  }
  if (automation.description) {
    stdout.write(`Description: ${automation.description}\n`)
  }
  if (automation.instruction) {
    stdout.write(`Instruction: ${automation.instruction}\n`)
  }
  if (automation.createdAt) {
    stdout.write(`Created At: ${automation.createdAt}\n`)
  }
  if (automation.updatedAt) {
    stdout.write(`Updated At: ${automation.updatedAt}\n`)
  }
  return 0
}

async function runHistory(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
  args: readonly string[],
): Promise<number> {
  let limit = 10
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--limit') {
      printUsage(stderr)
      return 1
    }

    const parsedLimit = parseOptionalPositiveInt(args[1])
    if (!parsedLimit) {
      stderr.write('--limit must be a positive integer\n')
      return 1
    }
    limit = parsedLimit
  }

  const url = buildApiUrl(
    context.config.endpoint,
    `/api/automations/${encodeURIComponent(automationId)}/history?limit=${limit}`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'GET',
    headers: buildAuthHeaders(context.config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  const entries = parseAutomationHistoryPayload(result.data)
  if (entries.length === 0) {
    stdout.write('No automation history found.\n')
    return 0
  }

  const headers = ['TIMESTAMP', 'STATUS', 'COST', 'DURATION', 'SESSION', 'DETAIL']
  const rows = entries.map((entry) => [
    entry.timestamp,
    entry.status,
    `$${entry.costUsd.toFixed(2)}`,
    entry.duration,
    entry.sessionId,
    entry.detail,
  ])
  stdout.write(formatTable(headers, rows))
  return 0
}

async function runTrigger(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
): Promise<number> {
  const url = buildApiUrl(
    context.config.endpoint,
    `/api/automations/${encodeURIComponent(automationId)}/run`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(context.config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  const payload = isObject(result.data) ? result.data : {}
  const runId = typeof payload.id === 'string' ? payload.id : null
  stdout.write(
    runId
      ? `Triggered automation ${automationId} (run ${runId}).\n`
      : `Triggered automation ${automationId}.\n`,
  )
  return 0
}

async function runStatusUpdate(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
  status: AutomationStatus,
  label: string,
): Promise<number> {
  const url = buildApiUrl(context.config.endpoint, `/api/automations/${encodeURIComponent(automationId)}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'PATCH',
    headers: buildAuthHeaders(context.config, true),
    body: JSON.stringify({ status }),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  stdout.write(`${label} automation: ${automationId}\n`)
  return 0
}

async function runDelete(
  context: CommandContext,
  fetchImpl: typeof fetch,
  stdout: Writable,
  stderr: Writable,
  automationId: string,
): Promise<number> {
  const url = buildApiUrl(context.config.endpoint, `/api/automations/${encodeURIComponent(automationId)}`)
  const result = await fetchJson(fetchImpl, url, {
    method: 'DELETE',
    headers: buildAuthHeaders(context.config, false),
  })

  if (!result.ok) {
    const detail = await readErrorDetail(result.response)
    stderr.write(renderRequestFailure(result.response.status, detail))
    return 1
  }

  stdout.write(`Deleted automation ${automationId}.\n`)
  return 0
}

export async function runAutomationCli(
  args: readonly string[],
  dependencies: AutomationCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch

  const command = args[0]
  if (!command) {
    printUsage(stdout)
    return 1
  }

  const context = await resolveContext(dependencies, stderr)
  if (!context) {
    return 1
  }

  if (command === 'list') {
    const options = parseListArgs(args.slice(1))
    if (!options) {
      printUsage(stderr)
      return 1
    }
    return runList(context, fetchImpl, stdout, stderr, options)
  }

  if (command === 'create') {
    const values = parseFlagValues(args.slice(1), MUTATION_FLAGS)
    if (!values) {
      printUsage(stderr)
      return 1
    }

    const parsed = parseMutationPayload(values, 'create')
    if (!parsed.ok) {
      stderr.write(`${parsed.error}\n`)
      return 1
    }

    if (!await validateAutomationProviderArg(context, fetchImpl, stderr, parsed.body)) {
      return 1
    }

    return runCreate(context, fetchImpl, stdout, stderr, parsed.body)
  }

  if (command === 'update') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId) {
      printUsage(stderr)
      return 1
    }

    const values = parseFlagValues(args.slice(2), MUTATION_FLAGS)
    if (!values) {
      printUsage(stderr)
      return 1
    }

    const parsed = parseMutationPayload(values, 'update')
    if (!parsed.ok) {
      stderr.write(`${parsed.error}\n`)
      return 1
    }

    if (!await validateAutomationProviderArg(context, fetchImpl, stderr, parsed.body)) {
      return 1
    }

    return runUpdate(context, fetchImpl, stdout, stderr, automationId, parsed.body)
  }

  if (command === 'show') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runShow(context, fetchImpl, stdout, stderr, automationId)
  }

  if (command === 'history') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId) {
      printUsage(stderr)
      return 1
    }
    return runHistory(context, fetchImpl, stdout, stderr, automationId, args.slice(2))
  }

  if (command === 'trigger') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runTrigger(context, fetchImpl, stdout, stderr, automationId)
  }

  if (command === 'pause') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runStatusUpdate(context, fetchImpl, stdout, stderr, automationId, 'paused', 'Paused')
  }

  if (command === 'resume') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runStatusUpdate(context, fetchImpl, stdout, stderr, automationId, 'active', 'Resumed')
  }

  if (command === 'complete') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runStatusUpdate(context, fetchImpl, stdout, stderr, automationId, 'completed', 'Completed')
  }

  if (command === 'cancel') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runStatusUpdate(context, fetchImpl, stdout, stderr, automationId, 'cancelled', 'Cancelled')
  }

  if (command === 'delete') {
    const automationId = parseNonEmpty(args[1])
    if (!automationId || args.length !== 2) {
      printUsage(stderr)
      return 1
    }
    return runDelete(context, fetchImpl, stdout, stderr, automationId)
  }

  printUsage(stderr)
  return 1
}
