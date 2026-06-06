import type {
  HammurabiEvent,
} from '../../src/types/hammurabi-events.js'
import type { TranscriptEnvelope } from '../../src/types/transcript-envelope.js'
import { createTranscriptId } from './transcript-id.js'

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

function readTimestamp(event: HammurabiEvent): string {
  const value = event.timestamp
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : new Date().toISOString()
}

function readLegacySessionId(event: HammurabiEvent): string | undefined {
  const record = event as Record<string, unknown>
  const message = asObject(record.message)
  const metadata = asObject(message?.metadata)
  return readTrimmedString(record.session_id)
    ?? readTrimmedString(record.sessionId)
    ?? readTrimmedString(metadata?.session_id)
    ?? readTrimmedString(metadata?.sessionId)
}

function readLegacyRawEventId(event: HammurabiEvent): string | undefined {
  const record = event as Record<string, unknown>
  const message = asObject(record.message)
  const contentBlock = asObject(record.content_block)
  return readTrimmedString(record.id)
    ?? readTrimmedString(record.toolId)
    ?? readTrimmedString(record.tool_use_id)
    ?? readTrimmedString(message?.id)
    ?? readTrimmedString(contentBlock?.id)
}

function readLegacyToolId(event: HammurabiEvent): string | undefined {
  const record = event as Record<string, unknown>
  const message = asObject(record.message)
  const contentBlock = asObject(record.content_block)
  return readTrimmedString(record.toolId)
    ?? readTrimmedString(record.tool_use_id)
    ?? readTrimmedString(record.id)
    ?? readTrimmedString(contentBlock?.id)
    ?? readTrimmedString(message?.id)
}

const CLAUDE_TASK_SYSTEM_SUBTYPES = new Set([
  'task_progress',
  'task_started',
  'task_notification',
])

function isClaudeEvent(event: HammurabiEvent): boolean {
  return event.source?.provider === 'claude'
}

function readClaudeParentToolUseId(event: HammurabiEvent): string | undefined {
  if (!isClaudeEvent(event)) {
    return undefined
  }
  const record = event as Record<string, unknown>
  return readTrimmedString(record.parent_tool_use_id)
}

function readClaudeTaskToolUseId(event: HammurabiEvent): string | undefined {
  if (!isClaudeEvent(event) || event.type !== 'system') {
    return undefined
  }
  const record = event as Record<string, unknown>
  const subtype = readTrimmedString(record.subtype)
  if (!subtype || !CLAUDE_TASK_SYSTEM_SUBTYPES.has(subtype)) {
    return undefined
  }
  return readTrimmedString(record.tool_use_id)
}

function readClaudeSubagentId(event: HammurabiEvent): string | undefined {
  return readClaudeParentToolUseId(event) ?? readClaudeTaskToolUseId(event)
}

function withClaudeAgentSubagentId<T extends Record<string, unknown>>(
  event: HammurabiEvent,
  toolName: string,
  toolCallId: string,
  overrides: T,
): T & { subagentId?: string } {
  return isClaudeEvent(event) && toolName === 'Agent'
    ? { ...overrides, subagentId: toolCallId }
    : overrides
}

function readLegacyContentBlockItemId(event: HammurabiEvent): string | undefined {
  const record = event as Record<string, unknown>
  const contentBlock = asObject(record.content_block)
  const contentBlockId = readTrimmedString(contentBlock?.id)
  if (contentBlockId) {
    return contentBlockId
  }
  return typeof record.index === 'number' && Number.isFinite(record.index)
    ? `content-block-${record.index}`
    : undefined
}

function envelope(
  event: HammurabiEvent,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionId = readLegacySessionId(event)
  const rawEventId = readLegacyRawEventId(event)
  const subagentId = overrides.subagentId ?? readClaudeSubagentId(event)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: readTimestamp(event),
    source: {
      provider: event.source?.provider ?? 'legacy',
      backend: event.source?.backend ?? 'cli',
      ...(sessionId ? { sessionId } : {}),
      rawEventType: event.type,
      ...(rawEventId ? { rawEventId } : {}),
    },
    ...(subagentId ? { subagentId } : {}),
    ev,
    ...overrides,
  }
}

function formatClaudeTaskSystemTitle(event: Extract<HammurabiEvent, { type: 'system' }>): string | undefined {
  if (!isClaudeEvent(event) || !event.subtype || !CLAUDE_TASK_SYSTEM_SUBTYPES.has(event.subtype)) {
    return undefined
  }
  const record = event as Record<string, unknown>
  const description = readTrimmedString(record.description)
  const summary = readTrimmedString(record.summary)
  const status = readTrimmedString(record.status)
  if (event.subtype === 'task_progress') {
    const tool = readTrimmedString(record.last_tool_name)
    const parts = [description, tool ? `[${tool}]` : undefined].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : undefined
  }
  if (event.subtype === 'task_started') {
    return description ? `Sub-agent: ${description}` : undefined
  }
  return summary ?? description ?? (status ? `Sub-agent ${status}` : undefined)
}

function normalizeTurnStatus(
  subtype: string | undefined,
  isError: boolean | undefined,
): Extract<TranscriptEnvelope['ev'], { type: 'turn.end' }>['status'] {
  if (isError) {
    return 'error'
  }
  const normalized = subtype?.trim().toLowerCase()
  switch (normalized) {
    case 'failed':
    case 'error':
      return 'error'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'completed':
      return 'completed'
    case 'success':
    case 'ok':
      return 'ok'
    default:
      return 'ok'
  }
}

function assistantBlocksToEnvelopes(
  event: Extract<HammurabiEvent, { type: 'assistant' }>,
): TranscriptEnvelope[] {
  const result: TranscriptEnvelope[] = []
  const itemId = event.message.id
  let startedMessage = false
  const ensureMessageStarted = () => {
    if (!startedMessage) {
      result.push(envelope(event, { type: 'message.start', role: 'assistant' }, { itemId }))
      startedMessage = true
    }
  }
  for (const block of event.message.content) {
    if (block.type === 'text') {
      ensureMessageStarted()
      if (block.text) {
        result.push(envelope(event, { type: 'message.delta', text: block.text, channel: 'final' }, { itemId }))
      }
      continue
    }
    if (block.type === 'image') {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.image', image: block, role: 'assistant' }, { itemId }))
      continue
    }
    if (block.type === 'thinking') {
      const text = typeof block.thinking === 'string' ? block.thinking : block.text
      if (text) {
        result.push(envelope(event, { type: 'thinking.delta', text }, { itemId }))
      }
      continue
    }
    if (block.type === 'tool_use') {
      const toolCallId = block.id ?? createTranscriptId()
      const toolName = block.name ?? 'Tool'
      result.push(envelope(event, {
        type: 'tool.start',
        toolCallId,
        name: toolName,
        input: block.input,
      }, withClaudeAgentSubagentId(event, toolName, toolCallId, {
        itemId: toolCallId,
        parentId: itemId,
      })))
    }
  }
  if (startedMessage) {
    result.push(envelope(event, { type: 'message.end' }, { itemId }))
  }
  return result
}

function userBlocksToEnvelopes(
  event: Extract<HammurabiEvent, { type: 'user' }>,
): TranscriptEnvelope[] {
  const result: TranscriptEnvelope[] = []
  const content = event.message.content
  if (typeof content === 'string') {
    result.push(envelope(event, { type: 'message.start', role: 'user' }))
    if (content) {
      result.push(envelope(event, { type: 'message.delta', text: content, channel: 'final' }))
    }
    result.push(envelope(event, { type: 'message.end' }))
    return result
  }

  const blocks = Array.isArray(content) ? content : []
  let startedMessage = false
  const ensureMessageStarted = () => {
    if (!startedMessage) {
      result.push(envelope(event, { type: 'message.start', role: 'user' }))
      startedMessage = true
    }
  }
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.delta', text: block.text, channel: 'final' }))
      continue
    }
    if (block.type === 'image') {
      ensureMessageStarted()
      result.push(envelope(event, { type: 'message.image', image: block, role: 'user' }))
      continue
    }
    if (block.type === 'tool_result') {
      result.push(envelope(event, {
        type: 'tool.end',
        toolCallId: block.tool_use_id ?? createTranscriptId(),
        status: block.is_error ? 'error' : 'ok',
        result: block.content,
      }))
    }
  }
  if (startedMessage) {
    result.push(envelope(event, { type: 'message.end' }))
  }
  return result
}

export function bridgeLegacyEventToTranscriptEnvelopes(event: HammurabiEvent): TranscriptEnvelope[] {
  switch (event.type) {
    case 'assistant':
      return assistantBlocksToEnvelopes(event)
    case 'user':
      return userBlocksToEnvelopes(event)
    case 'planning':
      {
        const records: TranscriptEnvelope[] = [envelope(event, {
          type: 'plan.update',
          plan: {
            action: event.action,
            ...(event.plan ? { plan: event.plan } : {}),
            ...(event.approved !== undefined ? { approved: event.approved } : {}),
            ...(event.message ? { message: event.message } : {}),
          },
          ...(event.toolId ? { toolCallId: event.toolId } : {}),
        }, event.toolId ? { itemId: event.toolId } : undefined)]
        if (event.action === 'decision' && event.toolId) {
          records.push(envelope(event, {
            type: 'approval.resolved',
            toolCallId: event.toolId,
            ...(typeof event.approved === 'boolean' ? { approved: event.approved } : {}),
            result: event.message,
          }, { itemId: event.toolId }))
        }
        return records
      }
    case 'plan_approval':
      return [
        envelope(event, { type: 'plan.update', plan: event.plan }, { itemId: event.toolId }),
        envelope(event, {
          type: 'approval.request',
          toolCallId: event.toolId,
          interactionKind: 'plan_approval',
          prompt: event.plan,
          ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
          ...(event.autoResolveAfterMs !== undefined ? { autoResolveAfterMs: event.autoResolveAfterMs } : {}),
          ...(event.defaultDecision ? { defaultDecision: event.defaultDecision } : {}),
          request: {
            toolName: event.toolName,
            approveLabel: event.approveLabel,
            rejectLabel: event.rejectLabel,
            customResponseLabel: event.customResponseLabel,
            interactionKind: event.interactionKind,
            ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
            ...(event.autoResolveAfterMs !== undefined ? { autoResolveAfterMs: event.autoResolveAfterMs } : {}),
            ...(event.defaultDecision ? { defaultDecision: event.defaultDecision } : {}),
            providerContext: event.providerContext,
          },
        }, { itemId: event.toolId }),
      ]
    case 'message_start':
      {
        const message = asObject((event as unknown as Record<string, unknown>).message)
        const itemId = readTrimmedString(message?.id)
        const role = message?.role === 'user' || message?.role === 'system'
          ? message.role
          : 'assistant'
        return [
          envelope(event, { type: 'turn.start', role }, { ...(itemId ? { itemId } : {}) }),
          envelope(event, { type: 'message.start', role }, { ...(itemId ? { itemId } : {}) }),
        ]
      }
    case 'content_block_start':
      if (event.content_block.type === 'text') {
        const itemId = readLegacyContentBlockItemId(event)
        return [envelope(event, { type: 'message.start', role: 'assistant' }, itemId ? { itemId } : {})]
      }
      if (event.content_block.type === 'thinking') {
        return []
      }
      if (event.content_block.type === 'image') {
        const itemId = readLegacyContentBlockItemId(event)
        return [envelope(
          event,
          { type: 'message.image', image: event.content_block, role: 'assistant' },
          itemId ? { itemId } : {},
        )]
      }
      if (event.content_block.type === 'tool_use') {
        const toolCallId = event.content_block.id ?? createTranscriptId()
        const toolName = event.content_block.name ?? 'Tool'
        return [envelope(event, {
          type: 'tool.start',
          toolCallId,
          name: toolName,
          input: event.content_block.input,
        }, withClaudeAgentSubagentId(event, toolName, toolCallId, { itemId: toolCallId }))]
      }
      return []
    case 'content_block_delta':
      {
        const itemId = readLegacyContentBlockItemId(event)
        const identity = itemId ? { itemId } : {}
        if (event.delta.type === 'text_delta') {
          return [envelope(event, { type: 'message.delta', text: event.delta.text, channel: 'final' }, identity)]
        }
        if (event.delta.type === 'thinking_delta') {
          return [envelope(event, { type: 'thinking.delta', text: event.delta.thinking }, identity)]
        }
        if (event.delta.type === 'input_json_delta') {
          return [envelope(event, {
            type: 'provider.activity',
            title: 'Tool input updated',
            data: { partial_json: event.delta.partial_json },
          }, identity)]
        }
        return []
      }
    case 'content_block_stop':
      {
        const itemId = readLegacyContentBlockItemId(event)
        return [envelope(event, { type: 'message.end' }, itemId ? { itemId } : {})]
      }
    case 'message_delta':
      return event.usage
        ? [envelope(event, {
            type: 'provider.activity',
            title: 'Usage updated',
            data: {
              usage: event.usage,
              usage_is_total: event.usage_is_total,
              total_cost_usd: event.total_cost_usd,
              cost_usd: event.cost_usd,
            },
          })]
        : []
    case 'message_stop':
      return [envelope(event, { type: 'message.end' })]
    case 'result':
      return [
        ...(event.usage || typeof event.total_cost_usd === 'number' || typeof event.cost_usd === 'number'
          ? [envelope(event, {
              type: 'provider.activity',
              title: 'Usage updated',
              data: {
                usage: event.usage,
                usage_is_total: true,
                total_cost_usd: event.total_cost_usd,
                cost_usd: event.cost_usd,
              },
            })]
          : []),
        envelope(event, {
          type: 'turn.end',
          status: normalizeTurnStatus(event.subtype, event.is_error),
          result: event.result,
          error: event.is_error ? event.result : undefined,
          usage: event.usage,
        }),
      ]
    case 'system':
      {
        if (event.text) {
          return [
            envelope(event, { type: 'message.start', role: 'system' }),
            envelope(event, { type: 'message.delta', text: event.text, channel: 'system' }),
            envelope(event, { type: 'message.end' }),
          ]
        }
        return [envelope(event, {
          type: 'provider.activity',
          title: formatClaudeTaskSystemTitle(event) ?? `System ${event.subtype ?? 'event'}`,
          data: event,
        })]
      }
    case 'agent':
      return typeof event.text === 'string'
        ? [
            envelope(event, { type: 'message.start', role: 'assistant' }),
            envelope(event, { type: 'message.delta', text: event.text, channel: 'final' }),
            envelope(event, { type: 'message.end' }),
          ]
        : []
    case 'tool_use':
      {
        const toolCallId = event.id ?? createTranscriptId()
        const toolName = event.name ?? 'Tool'
        return [envelope(event, {
          type: 'tool.start',
          toolCallId,
          name: toolName,
          input: event.input,
        }, withClaudeAgentSubagentId(event, toolName, toolCallId, { itemId: toolCallId }))]
      }
    case 'tool_result':
      {
        const toolCallId = event.tool_use_id ?? createTranscriptId()
        return [envelope(event, {
          type: 'tool.end',
          toolCallId,
          status: event.is_error ? 'error' : 'ok',
          result: event.content,
        }, { itemId: toolCallId, parentId: readLegacyToolId(event) })]
      }
    default:
      return [envelope(event, {
        type: 'provider.activity',
        title: `Legacy ${event.type}`,
        data: event,
      })]
  }
}
