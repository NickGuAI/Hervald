import type {
  HammurabiEvent,
  HammurabiUsage,
} from '../../src/types/hammurabi-events.js'
import {
  isTranscriptEnvelope,
  type TranscriptEnvelope,
} from '../../src/types/transcript-envelope.js'
import type { StreamJsonEvent } from './types.js'

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function isLegacyStreamEvent(value: StreamJsonEvent): value is HammurabiEvent {
  return !isTranscriptEnvelope(value)
}

export function isTranscriptTurnStartRecord(record: StreamJsonEvent): boolean {
  if (isTranscriptEnvelope(record)) {
    return record.ev.type === 'turn.start'
  }
  return record.type === 'message_start'
}

export function isTranscriptTurnEndRecord(record: StreamJsonEvent): boolean {
  if (isTranscriptEnvelope(record)) {
    return record.ev.type === 'turn.end'
  }
  return record.type === 'result'
}

export function isTranscriptExitRecord(record: StreamJsonEvent): boolean {
  if (isTranscriptEnvelope(record)) {
    return false
  }
  return record.type === 'exit'
}

export function readTranscriptEnvelopeSessionId(record: StreamJsonEvent): string | undefined {
  if (!isTranscriptEnvelope(record)) {
    return undefined
  }
  return typeof record.source.sessionId === 'string' && record.source.sessionId.trim().length > 0
    ? record.source.sessionId.trim()
    : undefined
}

function readUsageFromUnknown(value: unknown): HammurabiUsage | undefined {
  const usage = asObject(value)
  if (!usage) {
    return undefined
  }

  const inputTokens = typeof usage.input_tokens === 'number'
    ? usage.input_tokens
    : (typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined)
  const outputTokens = typeof usage.output_tokens === 'number'
    ? usage.output_tokens
    : (typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined)
  const cacheReadInputTokens = typeof usage.cache_read_input_tokens === 'number'
    ? usage.cache_read_input_tokens
    : undefined
  const cacheCreationInputTokens = typeof usage.cache_creation_input_tokens === 'number'
    ? usage.cache_creation_input_tokens
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

export interface TranscriptUsageUpdate {
  usage?: HammurabiUsage
  usageIsTotal?: boolean
  totalCostUsd?: number
  costUsd?: number
}

export function extractTranscriptUsageUpdate(record: StreamJsonEvent): TranscriptUsageUpdate | null {
  if (isTranscriptEnvelope(record)) {
    if (record.ev.type === 'turn.end') {
      const usage = readUsageFromUnknown(record.ev.usage)
      return usage ? { usage, usageIsTotal: true } : null
    }

    if (record.ev.type === 'provider.activity') {
      const data = asObject(record.ev.data)
      const usage = readUsageFromUnknown(data?.usage ?? data?.tokenUsage)
      const totalCostUsd = typeof data?.total_cost_usd === 'number'
        ? data.total_cost_usd
        : (typeof data?.totalCostUsd === 'number' ? data.totalCostUsd : undefined)
      const costUsd = typeof data?.cost_usd === 'number'
        ? data.cost_usd
        : (typeof data?.costUsd === 'number' ? data.costUsd : undefined)
      if (!usage && totalCostUsd === undefined && costUsd === undefined) {
        return null
      }
      const usageIsTotal = data?.usage_is_total === true || data?.usageIsTotal === true
      return {
        ...(usage ? { usage } : {}),
        ...(usageIsTotal ? { usageIsTotal: true } : {}),
        ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      }
    }

    return null
  }

  if (record.type !== 'message_delta' && record.type !== 'result') {
    return null
  }

  return {
    ...(record.usage ? { usage: record.usage } : {}),
    ...(
      record.type === 'result' || ('usage_is_total' in record && record.usage_is_total === true)
        ? { usageIsTotal: true }
        : {}
    ),
    ...('total_cost_usd' in record && typeof record.total_cost_usd === 'number'
      ? { totalCostUsd: record.total_cost_usd }
      : {}),
    ...('cost_usd' in record && typeof record.cost_usd === 'number'
      ? { costUsd: record.cost_usd }
      : {}),
  }
}

export function getTranscriptEnvelopeSource(
  record: StreamJsonEvent,
): TranscriptEnvelope['source'] | undefined {
  return isTranscriptEnvelope(record) ? record.source : record.source
}
