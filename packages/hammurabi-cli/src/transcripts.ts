import { formatStoredApiKeyUnauthorizedMessage } from './api-key-recovery.js'
import { type HammurabiConfig, normalizeEndpoint, readHammurabiConfig } from './config.js'

const DEFAULT_TRANSCRIPT_SEARCH_TOP_K = 8

interface Writable {
  write(chunk: string): boolean
}

export interface TranscriptSearchHit {
  score: number
  text: string
  sourceFile: string
  transcriptId: string
  timestamp: string | null
  role: 'user' | 'assistant'
  turnNumber: number
  messageIndex: number
}

export interface TranscriptsCliDependencies {
  fetchImpl?: typeof fetch
  readConfig?: () => Promise<HammurabiConfig | null>
  stdout?: Writable
  stderr?: Writable
}

interface SearchOptions {
  commanderId: string
  query: string
  topK: number
}

function printUsage(stdout: Writable): void {
  stdout.write('Usage:\n')
  stdout.write('  hammurabi commander transcripts search --commander <id> "<query>" [--top-k <count>]\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveInteger(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? ''
  if (!/^\d+$/.test(trimmed)) {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }

  return parsed
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

function parseTranscriptSearchHit(payload: unknown): TranscriptSearchHit | null {
  if (!isObject(payload)) {
    return null
  }

  const score = typeof payload.score === 'number' ? payload.score : null
  const text = typeof payload.text === 'string' ? payload.text : null
  const sourceFile = typeof payload.sourceFile === 'string' ? payload.sourceFile : null
  const transcriptId = typeof payload.transcriptId === 'string' ? payload.transcriptId : null
  const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : null
  const role = payload.role === 'user' || payload.role === 'assistant' ? payload.role : null
  const turnNumber = typeof payload.turnNumber === 'number' ? payload.turnNumber : null
  const messageIndex = typeof payload.messageIndex === 'number' ? payload.messageIndex : 1

  if (
    score === null ||
    text === null ||
    sourceFile === null ||
    transcriptId === null ||
    role === null ||
    turnNumber === null
  ) {
    return null
  }

  return {
    score,
    text,
    sourceFile,
    transcriptId,
    timestamp,
    role,
    turnNumber,
    messageIndex,
  }
}

function parseTranscriptSearchResponse(payload: unknown): TranscriptSearchHit[] | null {
  if (!isObject(payload) || !Array.isArray(payload.hits)) {
    return null
  }

  return payload.hits.flatMap((entry) => {
    const hit = parseTranscriptSearchHit(entry)
    return hit ? [hit] : []
  })
}

function parseSearchOptions(args: readonly string[]): SearchOptions | null {
  let commanderId: string | undefined
  let query: string | undefined
  let topK = DEFAULT_TRANSCRIPT_SEARCH_TOP_K
  const positionalQuery: string[] = []

  let index = 0
  while (index < args.length) {
    const flag = args[index]
    if (flag === '--commander') {
      commanderId = parseNonEmpty(args[index + 1]) ?? undefined
      if (!commanderId) {
        return null
      }
      index += 2
      continue
    }

    if (flag === '--top-k') {
      const parsedTopK = parsePositiveInteger(args[index + 1])
      if (parsedTopK === null) {
        return null
      }
      topK = parsedTopK
      index += 2
      continue
    }

    if (flag === '--query') {
      query = parseNonEmpty(args[index + 1]) ?? undefined
      if (!query) {
        return null
      }
      index += 2
      continue
    }

    if (!flag?.startsWith('--')) {
      positionalQuery.push(flag)
      index += 1
      continue
    }

    return null
  }

  if (!query) {
    query = parseNonEmpty(positionalQuery.join(' ')) ?? undefined
  }

  if (!commanderId || !query) {
    return null
  }

  return {
    commanderId,
    query,
    topK,
  }
}

function formatTranscriptHit(hit: TranscriptSearchHit): string {
  const headerParts = [
    `[${hit.score.toFixed(4)}]`,
    hit.transcriptId,
    `${hit.role} turn ${hit.turnNumber}`,
  ]

  if (hit.timestamp) {
    headerParts.push(`@ ${hit.timestamp}`)
  }

  return [
    headerParts.join(' '),
    hit.text.trim(),
    `Source: ${hit.sourceFile}`,
  ].join('\n')
}

async function runSearch(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
  options: SearchOptions,
  stdout: Writable,
  stderr: Writable,
): Promise<number> {
  const url = buildApiUrl(
    config.endpoint,
    `/api/commanders/${encodeURIComponent(options.commanderId)}/transcripts/search`,
  )
  const result = await fetchJson(fetchImpl, url, {
    method: 'POST',
    headers: buildAuthHeaders(config, true),
    body: JSON.stringify({
      query: options.query,
      topK: options.topK,
    }),
  })

  if (!result.ok) {
    await writeRequestFailure(stderr, result.response, config)
    return 1
  }

  const hits = parseTranscriptSearchResponse(result.data)
  if (hits === null) {
    stderr.write('Transcript search returned an unexpected payload.\n')
    return 1
  }

  if (hits.length === 0) {
    stdout.write(`No transcript hits found for ${options.commanderId}.\n`)
    return 0
  }

  stdout.write(`Found ${hits.length} transcript hit${hits.length === 1 ? '' : 's'} for ${options.commanderId}.\n\n`)
  stdout.write(`${hits.map((hit) => formatTranscriptHit(hit)).join('\n\n')}\n`)
  return 0
}

export async function runTranscriptsCli(
  args: readonly string[],
  dependencies: TranscriptsCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const readConfig = dependencies.readConfig ?? readHammurabiConfig

  const command = args[0]
  if (!command || command !== 'search') {
    printUsage(stdout)
    return 1
  }

  const config = await readConfig()
  if (!config) {
    stderr.write('Hammurabi config not found. Run `hammurabi onboard` first.\n')
    return 1
  }

  const options = parseSearchOptions(args.slice(1))
  if (!options) {
    printUsage(stdout)
    return 1
  }

  return runSearch(config, fetchImpl, options, stdout, stderr)
}
