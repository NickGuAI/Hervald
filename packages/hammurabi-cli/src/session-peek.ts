export interface SessionMessagePeekEntry {
  ts: string
  type: string
  kind?: string
  tool?: string
  preview: string
}

export interface SessionMessagePeekResponse {
  session: string
  total: number
  returned: number
  messages: SessionMessagePeekEntry[]
}

export interface SessionPeekCommandOptions {
  sessionName: string
  tail: number
  json: boolean
}

export const DEFAULT_JSON_PEEK_LAST = 5

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNonNegativeInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }

  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parsePeekEntry(value: unknown): SessionMessagePeekEntry | null {
  if (!isObject(value)) {
    return null
  }

  const ts = parseOptionalString(value.ts)
  const type = parseOptionalString(value.type)
  const preview = parseOptionalString(value.preview)
  if (!ts || !type || !preview) {
    return null
  }

  return {
    ts,
    type,
    kind: parseOptionalString(value.kind),
    tool: parseOptionalString(value.tool),
    preview,
  }
}

function stripToolPrefix(preview: string, tool: string | undefined): string {
  if (!tool) {
    return preview
  }
  const prefix = `${tool}:`
  return preview.startsWith(prefix)
    ? preview.slice(prefix.length).trimStart()
    : preview
}

function quotePreview(preview: string): string {
  return JSON.stringify(preview)
}

function formatRelativeSeconds(timestamp: string, nowMs: number): string {
  const eventMs = Date.parse(timestamp)
  if (!Number.isFinite(eventMs)) {
    return '[?s]'.padEnd(8)
  }
  const ageSeconds = Math.max(0, Math.round((nowMs - eventMs) / 1000))
  return `[-${ageSeconds}s]`.padEnd(8)
}

function formatPreview(entry: SessionMessagePeekEntry): string {
  if (entry.kind === 'tool_use') {
    const preview = stripToolPrefix(entry.preview, entry.tool)
    if (entry.tool && preview.length > 0) {
      return `${entry.tool}  ${preview}`
    }
    return entry.tool ?? preview
  }

  const renderedPreview = quotePreview(entry.preview)
  if (entry.kind === 'tool_result' && entry.tool) {
    return `${entry.tool}  ${renderedPreview}`
  }

  return renderedPreview
}

export function buildSessionMessagesApiPath(sessionName: string, last: number): string {
  return `/api/agents/sessions/${encodeURIComponent(sessionName)}/messages?last=${last}&includeToolUse=true`
}

export function parseSessionPeekCommandArgs(args: readonly string[]): SessionPeekCommandOptions | null {
  const sessionName = args[0]?.trim() ?? ''
  if (sessionName.length === 0) {
    return null
  }

  let tail = 0
  let json = false

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]

    if (flag === '--json') {
      json = true
      continue
    }

    if (flag !== '--tail') {
      return null
    }

    const rawValue = args[index + 1]?.trim() ?? ''
    const value = parseNonNegativeInteger(rawValue)
    if (value === null) {
      return null
    }

    tail = value
    index += 1
  }

  return { sessionName, tail, json }
}

export function parseSessionMessagePeekResponse(payload: unknown): SessionMessagePeekResponse | null {
  if (!isObject(payload)) {
    return null
  }

  const session = parseOptionalString(payload.session)
  if (!session) {
    return null
  }

  const total = typeof payload.total === 'number' && Number.isFinite(payload.total)
    ? payload.total
    : null
  const returned = typeof payload.returned === 'number' && Number.isFinite(payload.returned)
    ? payload.returned
    : null
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : null
  if (total === null || returned === null || rawMessages === null) {
    return null
  }

  const messages = rawMessages
    .map((entry) => parsePeekEntry(entry))
    .filter((entry): entry is SessionMessagePeekEntry => entry !== null)

  return {
    session,
    total,
    returned,
    messages,
  }
}

export function renderSessionPeekEntries(
  messages: readonly SessionMessagePeekEntry[],
  nowMs = Date.now(),
): string {
  let output = ''
  for (const entry of messages) {
    const typeKind = entry.kind ? `${entry.type}/${entry.kind}` : entry.type
    output += `  ${formatRelativeSeconds(entry.ts, nowMs)}${typeKind.padEnd(20)}${formatPreview(entry)}\n`
  }
  return output
}
