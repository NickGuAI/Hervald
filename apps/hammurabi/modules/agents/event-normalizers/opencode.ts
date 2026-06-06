import type { HammurabiEvent, HammurabiEventSource, HammurabiUsage } from '../../../src/types/hammurabi-events.js'
import type { TranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import { bridgeLegacyEventToTranscriptEnvelopes } from '../transcript-legacy-bridge.js'
import { createTranscriptId } from '../transcript-id.js'

const OPENCODE_EVENT_SOURCE: HammurabiEventSource = {
  provider: 'opencode',
  backend: 'acp',
}

type OpenCodeBlockType = 'text' | 'thinking'

export interface OpenCodeTurnState {
  nextBlockIndex: number
  openBlock: null | {
    index: number
    type: OpenCodeBlockType
  }
  lastCompletedBlock?: {
    index: number
    type: OpenCodeBlockType
  }
  lastPlanText?: string
  lastPlanApprovalToolId?: string
}

function withOpenCodeSource<T extends HammurabiEvent>(event: T): T {
  return {
    ...event,
    source: OPENCODE_EVENT_SOURCE,
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

function readTrimmedId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return readTrimmedString(value)
}

function readProviderRequestId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return readTrimmedString(value)
}

function readLowerString(value: unknown): string | undefined {
  return readTrimmedString(value)?.toLowerCase()
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

function closeOpenBlock(
  state: OpenCodeTurnState,
  options: { reusableForLateDelta?: boolean } = {},
): HammurabiEvent[] {
  if (!state.openBlock) {
    return []
  }
  const { index, type } = state.openBlock
  state.lastCompletedBlock = options.reusableForLateDelta
    ? { index, type }
    : undefined
  state.openBlock = null
  return [withOpenCodeSource({ type: 'content_block_stop', index })]
}

function openBlock(state: OpenCodeTurnState, type: OpenCodeBlockType): HammurabiEvent[] {
  if (state.openBlock?.type === type) {
    return []
  }

  const events = closeOpenBlock(state)
  if (!state.openBlock && state.lastCompletedBlock?.type === type) {
    state.openBlock = state.lastCompletedBlock
    state.lastCompletedBlock = undefined
    return events
  }

  const index = state.nextBlockIndex
  state.nextBlockIndex += 1
  state.openBlock = { index, type }
  state.lastCompletedBlock = undefined
  events.push(withOpenCodeSource({
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
  const directPlan =
    readTrimmedString(update.plan) ??
    readTrimmedString(update.markdown) ??
    readTrimmedString(update.text)
  if (directPlan) {
    return directPlan
  }

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

function readPlanDefaultDecision(update: Record<string, unknown>): 'approve' | 'reject' | undefined {
  const value = readLowerString(update.defaultDecision)
  if (!value) {
    return undefined
  }
  if (['approve', 'approved', 'yes', 'true'].includes(value)) {
    return 'approve'
  }
  if (['reject', 'rejected', 'no', 'false'].includes(value)) {
    return 'reject'
  }
  return undefined
}

function readPlanAutoResolveAfterMs(update: Record<string, unknown>): number | undefined {
  const value = update.autoResolveAfterMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readPlanToolId(update: Record<string, unknown>): string | undefined {
  return readTrimmedId(update.toolCallId) ??
    readTrimmedId(update.toolUseId) ??
    readTrimmedId(update.toolId) ??
    readTrimmedId(update.requestId) ??
    readTrimmedId(update.id)
}

function isWaitingPlanUpdate(update: Record<string, unknown>): boolean {
  if (
    update.awaitingApproval === true ||
    update.requiresApproval === true ||
    update.needsApproval === true ||
    update.waitingForDecision === true ||
    update.blocking === true
  ) {
    return true
  }

  const waitingValues = new Set([
    'awaiting_approval',
    'awaiting approval',
    'blocked',
    'pending_approval',
    'requires_approval',
    'requires approval',
    'waiting',
    'waiting_for_approval',
    'waiting for approval',
    'waiting_for_decision',
    'waiting for decision',
  ])
  return [
    readLowerString(update.status),
    readLowerString(update.state),
    readLowerString(update.phase),
    readLowerString(update.decisionState),
  ].some((value) => Boolean(value && waitingValues.has(value)))
}

function buildPlanApprovalEvent(update: Record<string, unknown>, plan: string): HammurabiEvent | null {
  if (!isWaitingPlanUpdate(update)) {
    return null
  }
  const toolId = readPlanToolId(update)
  if (!toolId) {
    return null
  }
  const toolName = readTrimmedString(update.toolName) ?? 'PlanApproval'
  const expiresAt = readTrimmedString(update.expiresAt)
  const autoResolveAfterMs = readPlanAutoResolveAfterMs(update)
  const defaultDecision = readPlanDefaultDecision(update)
  return withOpenCodeSource({
    type: 'plan_approval',
    interactionKind: 'plan_approval',
    toolId,
    toolName,
    plan,
    approveLabel: readTrimmedString(update.approveLabel) ?? 'Approve',
    rejectLabel: readTrimmedString(update.rejectLabel) ?? 'Reject',
    customResponseLabel: readTrimmedString(update.customResponseLabel) ?? 'Response',
    ...(expiresAt ? { expiresAt } : {}),
    ...(autoResolveAfterMs !== undefined ? { autoResolveAfterMs } : {}),
    ...(defaultDecision ? { defaultDecision } : {}),
    providerContext: {
      provider: 'opencode',
      backend: 'acp',
      toolUseId: toolId,
      toolName,
      ...(update.requestId !== undefined ? { requestId: readProviderRequestId(update.requestId) ?? String(update.requestId) } : {}),
      answerFormat: 'opencode.plan_decision',
    },
  })
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

function createOpenCodeEnvelope(
  update: Record<string, unknown>,
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  const itemId = overrides.itemId
    ?? readTrimmedId(update.id)
    ?? readTrimmedId(update.toolCallId)
  const turnId = overrides.turnId
    ?? readTrimmedId(update.turnId)
    ?? readTrimmedId(update.sessionId)
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'opencode',
      backend: 'acp',
      ...(readTrimmedString(update.sessionId) ? { sessionId: readTrimmedString(update.sessionId) } : {}),
      ...(sessionUpdate ? { rawEventType: sessionUpdate } : {}),
      ...(itemId ? { rawEventId: itemId } : {}),
    },
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(overrides.parentId ? { parentId: overrides.parentId } : {}),
    ...(overrides.subagentId ? { subagentId: overrides.subagentId } : {}),
    ev,
  }
}

function createOpenCodeRawEnvelope(update: Record<string, unknown>): TranscriptEnvelope {
  return createOpenCodeEnvelope(update, {
    type: 'provider.raw',
    method: readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type),
    payload: update,
  })
}

function createOpenCodeRawPayloadEnvelope(payload: unknown): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: createTranscriptId(),
    time: new Date().toISOString(),
    source: {
      provider: 'opencode',
      backend: 'acp',
    },
    ev: {
      type: 'provider.raw',
      payload,
    },
  }
}

function readOpenCodeParentId(part: Record<string, unknown>): string | undefined {
  return readTrimmedId(part.parentId)
    ?? readTrimmedId(part.parentPartId)
    ?? readTrimmedId(part.parentToolCallId)
    ?? readTrimmedId(asObject(part.parent)?.id)
}

function mapOpenCodePart(update: Record<string, unknown>, rawPart: unknown): TranscriptEnvelope[] {
  const part = asObject(rawPart)
  if (!part) {
    return [createOpenCodeEnvelope(update, {
      type: 'provider.raw',
      method: `${readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type) ?? 'message'}/part`,
      payload: rawPart,
    })]
  }
  const partType = readTrimmedString(part.type)
  const partId = readTrimmedId(part.id) ?? readTrimmedId(part.toolCallId) ?? createTranscriptId()
  const subagentId = readTrimmedId(part.subagentId) ?? readTrimmedId(part.agentId)
  const parentId = readOpenCodeParentId(part)
  const identity = {
    itemId: partId,
    ...(subagentId ? { subagentId } : {}),
    ...(parentId ? { parentId } : {}),
  }
  switch (partType) {
    case 'text':
      return typeof part.text === 'string' && part.text.length > 0
        ? [createOpenCodeEnvelope(update, { type: 'message.delta', text: part.text, channel: 'final' }, identity)]
        : []
    case 'reasoning':
      return typeof part.text === 'string' && part.text.length > 0
        ? [createOpenCodeEnvelope(update, { type: 'thinking.delta', text: part.text }, identity)]
        : []
    case 'file':
    case 'patch':
      return [createOpenCodeEnvelope(update, {
        type: 'file.change',
        path: readTrimmedString(part.path) ?? readTrimmedString(part.file) ?? '',
        action: partType,
        data: part,
      }, identity)]
    case 'tool':
    case 'task':
    case 'subtask':
    case 'agent':
    case 'read':
    case 'glob':
    case 'mcp':
    case 'todowrite':
    case 'todo': {
      const status = readTrimmedString(part.status)
      if (status === 'completed' || status === 'failed') {
        return [createOpenCodeEnvelope(update, {
          type: 'tool.end',
          toolCallId: partId,
          status,
          result: part.output ?? part.result ?? part,
        }, identity)]
      }
      return [createOpenCodeEnvelope(update, {
        type: 'tool.start',
        toolCallId: partId,
        name: readTrimmedString(part.name) ?? readTrimmedString(part.title) ?? partType,
        input: part.input ?? part.args ?? part,
      }, identity)]
    }
    case 'step-start':
    case 'step-finish':
    case 'snapshot':
    case 'retry':
    case 'compaction':
      return [createOpenCodeEnvelope(update, {
        type: 'provider.activity',
        title: partType,
        data: part,
      }, identity)]
    default:
      return [createOpenCodeEnvelope(update, {
        type: 'provider.raw',
        method: `${readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type) ?? 'message'}/part:${partType ?? 'unknown'}`,
        payload: part,
      }, identity)]
  }
}

export function mapOpenCodeToTranscriptEnvelopes(
  rawUpdate: unknown,
  state: OpenCodeTurnState,
): TranscriptEnvelope[] {
  const update = asObject(rawUpdate)
  if (!update) {
    return [createOpenCodeRawPayloadEnvelope(rawUpdate)]
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
  if (!sessionUpdate) {
    return [createOpenCodeRawEnvelope(update)]
  }

  if (sessionUpdate === 'tool_call_update') {
    const status = readTrimmedString(update.status)
    if (status && status !== 'completed' && status !== 'failed') {
      const toolCallId = readTrimmedString(update.toolCallId) ?? createTranscriptId()
      return [createOpenCodeEnvelope(update, {
        type: 'tool.delta',
        toolCallId,
        status,
        output: extractToolOutput(update.content) ?? stringifyUnknown(update.rawOutput),
        data: update,
      }, { itemId: toolCallId })]
    }
  }

  const normalized = normalizeOpenCodeSessionUpdate(update, state)
  if (normalized) {
    const events = Array.isArray(normalized) ? normalized : [normalized]
    return events.flatMap((event) => bridgeLegacyEventToTranscriptEnvelopes(event))
  }

  const parts = Array.isArray(update.parts)
    ? update.parts
    : (Array.isArray(asObject(update.message)?.parts) ? asObject(update.message)?.parts as unknown[] : [])
  const partEvents = parts.flatMap((part) => mapOpenCodePart(update, part))
  if (partEvents.length > 0) {
    return partEvents
  }

  if (
    sessionUpdate.includes('permission') ||
    sessionUpdate.includes('question') ||
    sessionUpdate.includes('todo') ||
    sessionUpdate.includes('status') ||
    sessionUpdate.startsWith('session') ||
    sessionUpdate.startsWith('message')
  ) {
    return [createOpenCodeEnvelope(update, {
      type: 'provider.activity',
      title: sessionUpdate,
      data: update,
    })]
  }

  return [createOpenCodeRawEnvelope(update)]
}

export function mapOpenCodePromptResponseToTranscriptEnvelopes(
  rawResult: unknown,
  state: OpenCodeTurnState,
): TranscriptEnvelope[] {
  const bridged = normalizeOpenCodePromptResponse(rawResult, state)
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

export function createOpenCodeTurnState(): OpenCodeTurnState {
  return {
    nextBlockIndex: 0,
    openBlock: null,
  }
}

export function normalizeOpenCodeSessionUpdate(
  rawUpdate: unknown,
  state: OpenCodeTurnState,
): HammurabiEvent | HammurabiEvent[] | null {
  const update = asObject(rawUpdate)
  if (!update) {
    return null
  }

  const sessionUpdate = readTrimmedString(update.sessionUpdate) ?? readTrimmedString(update.type)
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
        withOpenCodeSource({
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
        withOpenCodeSource({
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
        withOpenCodeSource({
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
      return withOpenCodeSource({
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
      if (!plan) {
        return null
      }
      const planApproval = buildPlanApprovalEvent(update, plan)
      if (planApproval?.type === 'plan_approval') {
        if (plan === state.lastPlanText && planApproval.toolId === state.lastPlanApprovalToolId) {
          return null
        }
        state.lastPlanText = plan
        state.lastPlanApprovalToolId = planApproval.toolId
        return planApproval
      }
      if (plan === state.lastPlanText) {
        return null
      }
      state.lastPlanText = plan
      state.lastPlanApprovalToolId = undefined
      return withOpenCodeSource({
        type: 'planning',
        action: 'proposed',
        plan,
      })
    }
    default:
      return null
  }
}

export function normalizeOpenCodePromptResponse(
  rawResult: unknown,
  state: OpenCodeTurnState,
): HammurabiEvent[] {
  const result = asObject(rawResult) ?? {}
  const stopReason = readTrimmedString(result.stopReason)
  const usage = extractPromptUsage(result)
  const finalResult = describeStopReason(stopReason)

  return [
    ...closeOpenBlock(state, { reusableForLateDelta: true }),
    withOpenCodeSource({
      type: 'message_delta',
      delta: stopReason ? { stop_reason: stopReason } : undefined,
      ...(usage ? { usage } : {}),
    }),
    withOpenCodeSource({ type: 'message_stop' }),
    withOpenCodeSource({
      type: 'result',
      result: finalResult.result,
      ...(finalResult.isError ? { is_error: true } : {}),
      ...(finalResult.subtype ? { subtype: finalResult.subtype } : {}),
    }),
  ]
}
