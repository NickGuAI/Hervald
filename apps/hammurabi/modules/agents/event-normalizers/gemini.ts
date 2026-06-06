import type { HammurabiEvent, HammurabiEventSource, HammurabiUsage } from '../../../src/types/hammurabi-events.js'
import type { TranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import { bridgeLegacyEventToTranscriptEnvelopes } from '../transcript-legacy-bridge.js'
import { createTranscriptId } from '../transcript-id.js'

const GEMINI_EVENT_SOURCE: HammurabiEventSource = {
  provider: 'gemini',
  backend: 'acp',
}

type GeminiBlockType = 'text' | 'thinking'

export interface GeminiTurnState {
  nextBlockIndex: number
  openBlock: null | {
    index: number
    type: GeminiBlockType
  }
  lastPlanText?: string
}

function withGeminiSource<T extends HammurabiEvent>(event: T): T {
  return {
    ...event,
    source: GEMINI_EVENT_SOURCE,
  } as T
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return undefined
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function closeOpenBlock(state: GeminiTurnState): HammurabiEvent[] {
  if (!state.openBlock) {
    return []
  }
  const { index } = state.openBlock
  state.openBlock = null
  return [withGeminiSource({ type: 'content_block_stop', index })]
}

function openBlock(state: GeminiTurnState, type: GeminiBlockType): HammurabiEvent[] {
  if (state.openBlock?.type === type) {
    return []
  }

  const events = closeOpenBlock(state)
  const index = state.nextBlockIndex
  state.nextBlockIndex += 1
  state.openBlock = { index, type }
  events.push(withGeminiSource({
    type: 'content_block_start',
    index,
    content_block: type === 'text'
      ? { type: 'text' }
      : { type: 'thinking' },
  }))
  return events
}

function extractChunkText(update: Record<string, unknown>): string | null {
  const content = asObject(update.content)
  if (!content || content.type !== 'text') {
    return null
  }
  return typeof content.text === 'string' && content.text.length > 0
    ? content.text
    : null
}

function deriveToolName(update: Record<string, unknown>): string {
  const kind = readTrimmedString(update.kind)
  if (kind === 'execute') return 'Bash'
  if (kind === 'edit') return 'Edit'
  if (kind === 'search') return 'Grep'
  if (kind === 'fetch') return 'WebFetch'
  if (kind === 'think') return 'Think'
  if (kind === 'switch_mode') return 'SwitchMode'
  return readTrimmedString(update.title) ?? 'Tool'
}

function extractToolOutput(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const parts = value
    .map((entry) => {
      const item = asObject(entry)
      if (!item) {
        return stringifyUnknown(entry)
      }
      if (item.type === 'content') {
        const wrapped = asObject(item.content)
        if (wrapped?.type === 'text' && typeof wrapped.text === 'string') {
          return wrapped.text
        }
      }
      return stringifyUnknown(item)
    })
    .filter((entry): entry is string => Boolean(entry))

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function extractPromptUsage(result: Record<string, unknown>): HammurabiUsage | undefined {
  const directUsage = asObject(result.usage)
  const quota = asObject(asObject(result._meta)?.quota)
  const tokenCount = asObject(quota?.token_count)

  const inputTokens = typeof directUsage?.inputTokens === 'number'
    ? directUsage.inputTokens
    : (typeof tokenCount?.input_tokens === 'number' ? tokenCount.input_tokens : undefined)
  const outputTokens = typeof directUsage?.outputTokens === 'number'
    ? directUsage.outputTokens
    : (typeof tokenCount?.output_tokens === 'number' ? tokenCount.output_tokens : undefined)
  const cacheReadInputTokens = typeof directUsage?.cachedReadTokens === 'number'
    ? directUsage.cachedReadTokens
    : undefined
  const cacheCreationInputTokens = typeof directUsage?.cachedWriteTokens === 'number'
    ? directUsage.cachedWriteTokens
    : undefined

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined
  ) {
    return undefined
  }

  return {
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cache_read_input_tokens: cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cache_creation_input_tokens: cacheCreationInputTokens } : {}),
  }
}

function formatPlan(update: Record<string, unknown>): string | undefined {
  const entries = Array.isArray(update.entries) ? update.entries : []
  const lines = entries
    .map((entry) => {
      const item = asObject(entry)
      if (!item) {
        return null
      }
      const content = readTrimmedString(item.content)
      if (!content) {
        return null
      }
      const status = readTrimmedString(item.status)
      const marker = status === 'completed'
        ? '[x]'
        : (status === 'in_progress' ? '[>]' : '[ ]')
      return `${marker} ${content}`
    })
    .filter((entry): entry is string => Boolean(entry))

  return lines.length > 0 ? lines.join('\n') : undefined
}

function describeStopReason(stopReason: string | undefined): { result: string; isError?: boolean; subtype?: string } {
  switch (stopReason) {
    case 'cancelled':
      return { result: 'Turn cancelled', subtype: 'interrupted' }
    case 'refusal':
      return { result: 'Model refused the request', isError: true, subtype: 'refusal' }
    case 'max_tokens':
      return { result: 'Turn ended after reaching max tokens', subtype: 'max_tokens' }
    case 'max_turn_requests':
      return { result: 'Turn ended after reaching max turn requests', subtype: 'max_turn_requests' }
    default:
      return { result: 'Turn completed' }
  }
}

function createGeminiEnvelope(
  update: Record<string, unknown>,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  const itemId = overrides.itemId
    ?? readTrimmedString(update.id)
    ?? readTrimmedString(update.toolCallId)
  const turnId = overrides.turnId
    ?? readTrimmedString(update.turnId)
    ?? readTrimmedString(update.sessionId)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'gemini',
      backend: 'acp',
      ...(readTrimmedString(update.sessionId) ? { sessionId: readTrimmedString(update.sessionId) } : {}),
      ...(sessionUpdate ? { rawEventType: sessionUpdate } : {}),
      ...(itemId ? { rawEventId: itemId } : {}),
    },
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    ev,
  }
}

function createGeminiRawEnvelope(update: Record<string, unknown>): TranscriptEnvelope {
  return createGeminiEnvelope(update, {
    type: 'provider.raw',
    method: readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type),
    payload: update,
  })
}

function createGeminiRawPayloadEnvelope(payload: unknown): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'gemini',
      backend: 'acp',
    },
    ev: {
      type: 'provider.raw',
      payload,
    },
  }
}

export function mapGeminiToTranscriptEnvelopes(
  rawUpdate: unknown,
  state: GeminiTurnState,
): TranscriptEnvelope[] {
  const update = asObject(rawUpdate)
  if (!update) {
    return [createGeminiRawPayloadEnvelope(rawUpdate)]
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate)
  if (!sessionUpdate) {
    return [createGeminiRawEnvelope(update)]
  }

  if (sessionUpdate === 'tool_call_update') {
    const status = readTrimmedString(update.status)
    if (status && status !== 'completed' && status !== 'failed') {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [createGeminiEnvelope(update, {
        type: 'tool.delta',
        toolCallId,
        status,
        output: extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput),
        data: update,
      }, { itemId: toolCallId })]
    }
  }

  const normalized = normalizeGeminiSessionUpdate(update, state)
  if (normalized) {
    const events = Array.isArray(normalized) ? normalized : [normalized]
    return events.flatMap((event) => bridgeLegacyEventToTranscriptEnvelopes(event))
  }

  if (sessionUpdate.includes('sessionUpdate') || sessionUpdate.includes('status') || sessionUpdate.includes('error')) {
    return [createGeminiEnvelope(update, {
      type: 'provider.activity',
      title: sessionUpdate,
      data: update,
    })]
  }

  return [createGeminiRawEnvelope(update)]
}

export function mapGeminiPromptResponseToTranscriptEnvelopes(
  rawResult: unknown,
  state: GeminiTurnState,
): TranscriptEnvelope[] {
  const bridged = normalizeGeminiPromptResponse(rawResult, state)
    .flatMap((event) => bridgeLegacyEventToTranscriptEnvelopes(event))
  const usageEnvelope = bridged.find((event) =>
    event.ev.type === 'provider.activity'
    && typeof event.ev.data === 'object'
    && event.ev.data !== null
    && 'usage' in event.ev.data,
  )
  const usage = usageEnvelope?.ev.type === 'provider.activity'
    ? (usageEnvelope.ev.data as { usage?: unknown }).usage
    : undefined
  return bridged.map((event) => (
    event.ev.type === 'turn.end' && usage
      ? {
          ...event,
          ev: {
            ...event.ev,
            usage,
          },
        }
      : event
  ))
}

export function createGeminiTurnState(): GeminiTurnState {
  return {
    nextBlockIndex: 0,
    openBlock: null,
  }
}

export function normalizeGeminiSessionUpdate(
  rawUpdate: unknown,
  state: GeminiTurnState,
): HammurabiEvent | HammurabiEvent[] | null {
  const update = asObject(rawUpdate)
  if (!update) {
    return null
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate)
  if (!sessionUpdate) {
    return null
  }

  switch (sessionUpdate) {
    case 'agent_message_chunk': {
      const text = extractChunkText(update)
      if (!text) {
        return null
      }
      return [
        ...openBlock(state, 'text'),
        withGeminiSource({
          type: 'content_block_delta',
          index: state.openBlock?.index,
          delta: { type: 'text_delta', text },
        }),
      ]
    }
    case 'agent_thought_chunk': {
      const thinking = extractChunkText(update)
      if (!thinking) {
        return null
      }
      return [
        ...openBlock(state, 'thinking'),
        withGeminiSource({
          type: 'content_block_delta',
          index: state.openBlock?.index,
          delta: { type: 'thinking_delta', thinking },
        }),
      ]
    }
    case 'tool_call': {
      const toolCallId = readTrimmedString(update.toolCallId)
      return [
        ...closeOpenBlock(state),
        withGeminiSource({
          type: 'assistant',
          message: {
            id: toolCallId ?? '',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              ...(toolCallId ? { id: toolCallId } : {}),
              name: deriveToolName(update),
              input: asObject(update.rawInput) ?? {},
            }],
          },
        }),
      ]
    }
    case 'tool_call_update': {
      const status = readTrimmedString(update.status)
      if (status !== 'completed' && status !== 'failed') {
        return null
      }
      const toolCallId = readTrimmedString(update.toolCallId)
      if (!toolCallId) {
        return null
      }
      const content = extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput) ?? ''
      return withGeminiSource({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolCallId,
            content,
            is_error: status === 'failed',
          }],
        },
      })
    }
    case 'plan': {
      const plan = formatPlan(update)
      if (!plan || plan === state.lastPlanText) {
        return null
      }
      state.lastPlanText = plan
      return withGeminiSource({
        type: 'planning',
        action: 'proposed',
        plan,
      })
    }
    default:
      return null
  }
}

export function normalizeGeminiPromptResponse(
  rawResult: unknown,
  state: GeminiTurnState,
): HammurabiEvent[] {
  const result = asObject(rawResult) ?? {}
  const stopReason = readTrimmedString(result.stopReason)
  const usage = extractPromptUsage(result)
  const finalResult = describeStopReason(stopReason)

  return [
    ...closeOpenBlock(state),
    withGeminiSource({
      type: 'message_delta',
      delta: stopReason ? { stop_reason: stopReason } : undefined,
      ...(usage ? { usage } : {}),
    }),
    withGeminiSource({ type: 'message_stop' }),
    withGeminiSource({
      type: 'result',
      result: finalResult.result,
      ...(finalResult.isError ? { is_error: true } : {}),
      ...(finalResult.subtype ? { subtype: finalResult.subtype } : {}),
    }),
  ]
}
