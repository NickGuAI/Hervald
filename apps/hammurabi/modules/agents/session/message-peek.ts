import type { StreamJsonEvent } from '../types.js'

export type SessionMessagePeekRoleFilter = 'assistant' | 'user' | 'all'

export interface SessionMessagePeekEntry {
  ts: string
  type: 'assistant' | 'user' | 'system' | 'message_start' | 'content_block_start' | string
  kind?: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'warning'
  tool?: string
  preview: string
}

export interface SessionMessagePeekResponse {
  session: string
  total: number
  returned: number
  messages: SessionMessagePeekEntry[]
}

interface ExtractSessionMessagePeekOptions {
  last: number
  role: SessionMessagePeekRoleFilter
  includeToolUse: boolean
  fallbackTimestamp: string
}

interface ToolUseLike {
  id?: string
  name?: string
  input?: unknown
}

interface ToolResultLike {
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || !Number.isFinite(Date.parse(trimmed))) {
    return null
  }
  return trimmed
}

function collapsePreviewWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncatePreview(value: string, maxLength = 120): string {
  const collapsed = collapsePreviewWhitespace(value)
  if (collapsed.length <= maxLength) {
    return collapsed
  }
  if (maxLength <= 3) {
    return '.'.repeat(maxLength)
  }
  return `${collapsed.slice(0, maxLength - 3)}...`
}

function stringifyPreview(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function extractFirstScalar(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  ) {
    return String(value)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const preview = extractFirstScalar(item)
      if (preview.length > 0) {
        return preview
      }
    }
    return ''
  }

  const obj = asObject(value)
  if (!obj) {
    return ''
  }

  for (const nestedValue of Object.values(obj)) {
    const preview = extractFirstScalar(nestedValue)
    if (preview.length > 0) {
      return preview
    }
  }

  return ''
}

function shouldIncludeEntry(
  entry: SessionMessagePeekEntry,
  role: SessionMessagePeekRoleFilter,
  includeToolUse: boolean,
): boolean {
  if (role !== 'all' && entry.type !== role) {
    return false
  }

  if (!includeToolUse) {
    return (entry.type === 'assistant' || entry.type === 'user') && entry.kind === 'text'
  }

  return true
}

function pushEntry(
  entries: SessionMessagePeekEntry[],
  entry: SessionMessagePeekEntry | null,
  role: SessionMessagePeekRoleFilter,
  includeToolUse: boolean,
): void {
  if (!entry || entry.preview.length === 0) {
    return
  }
  if (!shouldIncludeEntry(entry, role, includeToolUse)) {
    return
  }
  entries.push(entry)
}

function resolveEventTimestamp(event: StreamJsonEvent, fallbackTimestamp: string): string {
  const directTimestamp = normalizeIsoTimestamp(event.timestamp)
  if (directTimestamp) {
    return directTimestamp
  }

  const source = asObject(event.source)
  const normalizedAt = normalizeIsoTimestamp(source?.normalizedAt)
  if (normalizedAt) {
    return normalizedAt
  }

  return fallbackTimestamp
}

function buildToolUseEntry(
  rawBlock: ToolUseLike,
  type: SessionMessagePeekEntry['type'],
  ts: string,
): SessionMessagePeekEntry | null {
  const toolName = typeof rawBlock.name === 'string' ? rawBlock.name.trim() : ''
  if (toolName.length === 0) {
    return null
  }

  const inputPreview = extractFirstScalar(rawBlock.input)
  const preview = inputPreview.length > 0
    ? `${toolName}: ${inputPreview}`
    : toolName

  return {
    ts,
    type,
    kind: 'tool_use',
    tool: toolName,
    preview: truncatePreview(preview),
  }
}

function buildToolResultEntry(
  rawBlock: ToolResultLike,
  type: SessionMessagePeekEntry['type'],
  ts: string,
  toolNamesById: Map<string, string>,
  fallbackResult?: unknown,
): SessionMessagePeekEntry | null {
  const toolUseId = typeof rawBlock.tool_use_id === 'string' ? rawBlock.tool_use_id.trim() : ''
  const previewSource = rawBlock.content ?? fallbackResult
  const preview = truncatePreview(stringifyPreview(previewSource))

  if (preview.length === 0 && toolUseId.length === 0) {
    return null
  }

  return {
    ts,
    type,
    kind: 'tool_result',
    tool: toolUseId.length > 0 ? toolNamesById.get(toolUseId) : undefined,
    preview,
  }
}

function extractContentBlockStartEntry(
  event: Extract<StreamJsonEvent, { type: 'content_block_start' }>,
  ts: string,
): SessionMessagePeekEntry | null {
  const block = event.content_block
  if (block.type === 'tool_use') {
    return buildToolUseEntry(block, 'content_block_start', ts)
  }

  if (block.type === 'thinking') {
    const preview = truncatePreview(
      typeof block.thinking === 'string' && block.thinking.trim().length > 0
        ? block.thinking
        : (typeof block.text === 'string' && block.text.trim().length > 0 ? block.text : 'thinking'),
    )
    return {
      ts,
      type: 'content_block_start',
      kind: 'thinking',
      preview,
    }
  }

  const preview = truncatePreview(typeof block.text === 'string' && block.text.trim().length > 0 ? block.text : 'text')
  return {
    ts,
    type: 'content_block_start',
    kind: 'text',
    preview,
  }
}

function collectAssistantEntries(
  event: Extract<StreamJsonEvent, { type: 'assistant' }>,
  ts: string,
  entries: SessionMessagePeekEntry[],
  role: SessionMessagePeekRoleFilter,
  includeToolUse: boolean,
  toolNamesById: Map<string, string>,
): void {
  for (const block of event.message.content) {
    if (block.type === 'text') {
      pushEntry(entries, {
        ts,
        type: 'assistant',
        kind: 'text',
        preview: truncatePreview(block.text ?? ''),
      }, role, includeToolUse)
      continue
    }

    if (block.type === 'thinking') {
      pushEntry(entries, {
        ts,
        type: 'assistant',
        kind: 'thinking',
        preview: truncatePreview(block.thinking ?? block.text ?? ''),
      }, role, includeToolUse)
      continue
    }

    if (block.type === 'tool_use') {
      const toolId = typeof block.id === 'string' ? block.id.trim() : ''
      const toolName = typeof block.name === 'string' ? block.name.trim() : ''
      if (toolId.length > 0 && toolName.length > 0) {
        toolNamesById.set(toolId, toolName)
      }
      pushEntry(entries, buildToolUseEntry(block, 'assistant', ts), role, includeToolUse)
    }
  }
}

function collectUserEntries(
  event: Extract<StreamJsonEvent, { type: 'user' }>,
  ts: string,
  entries: SessionMessagePeekEntry[],
  role: SessionMessagePeekRoleFilter,
  includeToolUse: boolean,
  toolNamesById: Map<string, string>,
): void {
  const content = event.message.content
  if (typeof content === 'string') {
    pushEntry(entries, {
      ts,
      type: 'user',
      kind: 'text',
      preview: truncatePreview(content),
    }, role, includeToolUse)
    return
  }

  for (const block of content) {
    if (block.type === 'text') {
      pushEntry(entries, {
        ts,
        type: 'user',
        kind: 'text',
        preview: truncatePreview(block.text ?? ''),
      }, role, includeToolUse)
      continue
    }

    if (block.type === 'tool_result') {
      pushEntry(
        entries,
        buildToolResultEntry(block, 'user', ts, toolNamesById, event.tool_use_result),
        role,
        includeToolUse,
      )
    }
  }
}

export function extractSessionMessagePeek(
  events: StreamJsonEvent[],
  options: ExtractSessionMessagePeekOptions,
): SessionMessagePeekEntry[] {
  const entries: SessionMessagePeekEntry[] = []
  const toolNamesById = new Map<string, string>()
  let lastTimestamp = options.fallbackTimestamp

  for (const event of events) {
    const ts = resolveEventTimestamp(event, lastTimestamp)
    lastTimestamp = ts

    if (event.type === 'assistant') {
      collectAssistantEntries(event, ts, entries, options.role, options.includeToolUse, toolNamesById)
      continue
    }

    if (event.type === 'user') {
      collectUserEntries(event, ts, entries, options.role, options.includeToolUse, toolNamesById)
      continue
    }

    if (event.type === 'system') {
      const preview = truncatePreview(event.text ?? '')
      const kind = typeof event.subtype === 'string'
        && ['warning', 'warn', 'error'].includes(event.subtype.trim().toLowerCase())
        ? 'warning'
        : 'text'
      pushEntry(entries, { ts, type: 'system', kind, preview }, options.role, options.includeToolUse)
      continue
    }

    if (event.type === 'message_start') {
      const preview = truncatePreview(event.message.role)
      pushEntry(entries, { ts, type: 'message_start', preview }, options.role, options.includeToolUse)
      continue
    }

    if (event.type === 'content_block_start') {
      pushEntry(entries, extractContentBlockStartEntry(event, ts), options.role, options.includeToolUse)
      continue
    }

    if (event.type === 'tool_use') {
      const toolId = typeof event.id === 'string' ? event.id.trim() : ''
      const toolName = typeof event.name === 'string' ? event.name.trim() : ''
      if (toolId.length > 0 && toolName.length > 0) {
        toolNamesById.set(toolId, toolName)
      }
      pushEntry(entries, buildToolUseEntry(event, event.type, ts), options.role, options.includeToolUse)
      continue
    }

    if (event.type === 'tool_result') {
      pushEntry(
        entries,
        buildToolResultEntry(event, event.type, ts, toolNamesById),
        options.role,
        options.includeToolUse,
      )
    }
  }

  if (entries.length <= options.last) {
    return entries
  }

  return entries.slice(-options.last)
}
