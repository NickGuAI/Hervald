import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { createInterface } from 'node:readline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NormalizedMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  toolUse?: boolean
}

export interface SessionMessagesResponse {
  session: string
  messages: NormalizedMessage[]
  source: 'live' | 'transcript'
  totalEvents: number
}

export type MessageRoleFilter = 'user' | 'assistant' | 'all'

// Re-export the shape expected from routes.ts events
interface StreamJsonEvent {
  type: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Message extraction from in-memory events
// ---------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const parts: string[] = []
  for (const block of content) {
    const obj = asObject(block)
    if (!obj) continue

    if (obj.type === 'text' && typeof obj.text === 'string') {
      parts.push(obj.text)
    }
  }
  return parts.join('\n')
}

function hasToolUseContent(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false
  }
  return content.some((block) => {
    const obj = asObject(block)
    return obj?.type === 'tool_use'
  })
}

/**
 * Extract normalized messages from an array of StreamJsonEvents.
 *
 * Handles Claude stream-json envelope events (`type: "user"` / `type: "assistant"`)
 * and Codex event_msg payloads.
 */
export function extractMessages(
  events: StreamJsonEvent[],
  roleFilter: MessageRoleFilter = 'all',
  last?: number,
): NormalizedMessage[] {
  const messages: NormalizedMessage[] = []

  // Track in-progress assistant message assembled from content_block_* streams
  let pendingText = ''
  let pendingTimestamp: string | undefined

  function flushPending(): void {
    const text = pendingText.trim()
    if (text) {
      messages.push({
        role: 'assistant',
        content: text,
        timestamp: pendingTimestamp,
      })
    }
    pendingText = ''
    pendingTimestamp = undefined
  }

  for (const event of events) {
    const evtType = event.type as string

    // Claude envelope events: type === "user" | "assistant"
    if (evtType === 'user' || evtType === 'assistant') {
      flushPending()

      const message = asObject(event.message)
      if (!message) continue

      const role = (message.role as string) || evtType
      if (role !== 'user' && role !== 'assistant') continue

      const content = extractTextContent(message.content)
      const toolUse = role === 'assistant' && hasToolUseContent(message.content)

      // Skip messages with no text AND no tool use — but keep tool-only
      // assistant envelopes so watchers can see blocking tool invocations
      // (e.g. AskUserQuestion, commandExecution).
      if (!content && !toolUse) continue

      const normalized: NormalizedMessage = {
        role: role as 'user' | 'assistant',
        content,
      }

      if (typeof event.timestamp === 'string') {
        normalized.timestamp = event.timestamp
      }

      if (toolUse) {
        normalized.toolUse = true
      }

      messages.push(normalized)
      continue
    }

    // Claude system event
    if (evtType === 'system' && event.message) {
      flushPending()

      const message = asObject(event.message)
      if (!message) continue

      const content = extractTextContent(message.content)
      if (!content) continue

      messages.push({
        role: 'system',
        content,
        timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
      })
      continue
    }

    // message_start: new turn — flush any accumulated blocks from the prior turn
    if (evtType === 'message_start') {
      flushPending()
      if (typeof event.timestamp === 'string') {
        pendingTimestamp = event.timestamp
      }
      continue
    }

    // content_block_start: begin a new content block
    if (evtType === 'content_block_start') {
      if (typeof event.timestamp === 'string' && !pendingTimestamp) {
        pendingTimestamp = event.timestamp
      }
      continue
    }

    // content_block_delta: accumulate text deltas
    if (evtType === 'content_block_delta') {
      const delta = asObject(event.delta)
      if (delta && typeof delta.text === 'string') {
        pendingText += delta.text
      }
      if (typeof event.timestamp === 'string' && !pendingTimestamp) {
        pendingTimestamp = event.timestamp
      }
      continue
    }

    // content_block_stop: block complete (don't flush yet — more blocks may follow in same turn)
    if (evtType === 'content_block_stop') {
      continue
    }
  }

  // Flush any remaining accumulated text
  flushPending()

  // Apply role filter
  let filtered = messages
  if (roleFilter !== 'all') {
    filtered = messages.filter((m) => m.role === roleFilter)
  }

  // Apply last-N limit
  if (last !== undefined && last > 0 && filtered.length > last) {
    return filtered.slice(-last)
  }

  return filtered
}

// ---------------------------------------------------------------------------
// Commander JSONL tail reader
// ---------------------------------------------------------------------------

const COMMANDER_PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/

/**
 * Validate a commander ID + transcript ID to prevent path traversal,
 * resolve the transcript JSONL path, and read its events.
 */
export async function readCommanderTranscript(
  commanderId: string,
  transcriptId: string,
  dataDir: string,
): Promise<StreamJsonEvent[] | null> {
  // Validate path segments
  if (!COMMANDER_PATH_SEGMENT_PATTERN.test(commanderId)) {
    return null
  }
  if (!COMMANDER_PATH_SEGMENT_PATTERN.test(transcriptId)) {
    return null
  }

  const transcriptPath = path.resolve(
    dataDir,
    commanderId,
    'sessions',
    `${transcriptId}.jsonl`,
  )

  // Path traversal guard: resolved path must stay within dataDir
  const normalizedDataDir = path.resolve(dataDir)
  if (!transcriptPath.startsWith(normalizedDataDir + path.sep) && transcriptPath !== normalizedDataDir) {
    return null
  }

  // Check file exists and is reasonable size
  let fileStat
  try {
    fileStat = await stat(transcriptPath)
  } catch {
    return null
  }

  if (!fileStat.isFile()) {
    return null
  }

  // For small files (<10MB), read all at once
  const MAX_INLINE_SIZE = 10 * 1024 * 1024
  if (fileStat.size <= MAX_INLINE_SIZE) {
    try {
      const raw = await readFile(transcriptPath, 'utf8')
      return parseJsonlLines(raw)
    } catch {
      return null
    }
  }

  // For larger files, stream line-by-line
  return streamJsonlFile(transcriptPath)
}

function parseJsonlLines(raw: string): StreamJsonEvent[] {
  const events: StreamJsonEvent[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && 'type' in (parsed as Record<string, unknown>)) {
        events.push(parsed as StreamJsonEvent)
      }
    } catch {
      // Skip malformed lines
    }
  }
  return events
}

async function streamJsonlFile(filePath: string): Promise<StreamJsonEvent[]> {
  const events: StreamJsonEvent[] = []
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && 'type' in (parsed as Record<string, unknown>)) {
        events.push(parsed as StreamJsonEvent)
      }
    } catch {
      // Skip malformed lines
    }
  }

  return events
}

// ---------------------------------------------------------------------------
// Exported helpers for finding commander transcript files
// ---------------------------------------------------------------------------

/**
 * List available transcript JSONL files for a commander.
 * Returns transcript IDs (filenames without .jsonl extension).
 */
export function resolveCommanderTranscriptPath(
  commanderId: string,
  transcriptId: string,
  dataDir: string,
): string | null {
  if (!COMMANDER_PATH_SEGMENT_PATTERN.test(commanderId)) {
    return null
  }
  if (!COMMANDER_PATH_SEGMENT_PATTERN.test(transcriptId)) {
    return null
  }

  const transcriptPath = path.resolve(
    dataDir,
    commanderId,
    'sessions',
    `${transcriptId}.jsonl`,
  )

  const normalizedDataDir = path.resolve(dataDir)
  if (!transcriptPath.startsWith(normalizedDataDir + path.sep) && transcriptPath !== normalizedDataDir) {
    return null
  }

  return transcriptPath
}
