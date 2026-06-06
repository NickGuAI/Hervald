import type {
  HammurabiEventBackend,
  HammurabiEventProvider,
  HammurabiImageBlock,
  HammurabiUsage,
} from './hammurabi-events.js'

export type TranscriptMessageRole = 'user' | 'assistant' | 'system'
export type TranscriptMessageChannel = 'final' | 'analysis' | 'reasoning' | 'system'

export interface TranscriptEnvelopeSource {
  provider: HammurabiEventProvider
  backend: HammurabiEventBackend | string
  sessionId?: string
  rawEventId?: string
  rawEventType?: string
}

export type TranscriptEnvelopeEvent =
  | { type: 'turn.start'; role?: TranscriptMessageRole }
  | {
      type: 'turn.end'
      status?: 'ok' | 'completed' | 'error' | 'failed' | 'cancelled' | string
      usage?: HammurabiUsage
      result?: unknown
      error?: unknown
    }
  | { type: 'message.start'; role: TranscriptMessageRole }
  | { type: 'message.delta'; text: string; channel?: TranscriptMessageChannel }
  | { type: 'message.image'; image: HammurabiImageBlock; role?: TranscriptMessageRole }
  | { type: 'message.end' }
  | { type: 'thinking.delta'; text: string }
  | { type: 'tool.start'; toolCallId: string; name: string; input?: unknown; title?: string }
  | {
      type: 'tool.delta'
      toolCallId: string
      output?: string
      patch?: unknown
      status?: string
      data?: unknown
    }
  | {
      type: 'tool.end'
      toolCallId: string
      status?: 'ok' | 'completed' | 'error' | 'failed' | 'cancelled' | string
      result?: unknown
      error?: unknown
    }
  | { type: 'subagent.start'; name?: string; title?: string; role?: string }
  | { type: 'subagent.end'; status?: 'ok' | 'completed' | 'error' | 'failed' | 'cancelled' | string }
  | {
      type: 'approval.request'
      toolCallId?: string
      interactionKind?: 'ask_user_question' | 'plan_approval' | string
      prompt?: string
      request?: unknown
      questions?: unknown
      expiresAt?: string
      autoResolveAfterMs?: number
      defaultDecision?: 'approve' | 'reject' | string
    }
  | { type: 'approval.resolved'; toolCallId?: string; approved?: boolean; result?: unknown }
  | { type: 'plan.update'; plan: unknown; status?: string; toolCallId?: string }
  | { type: 'file.change'; path: string; action?: string; data?: unknown }
  | { type: 'provider.activity'; title?: string; detail?: string; data?: unknown }
  | { type: 'provider.raw'; method?: string; payload: unknown }

export interface TranscriptEnvelope {
  /**
   * Legacy stream events are discriminated by `type`. V2 envelopes deliberately
   * keep the provider-neutral event name under `ev.type`, but this impossible
   * field lets TypeScript narrow `StreamJsonEvent` unions correctly.
   */
  type?: never
  timestamp?: never
  schemaVersion: 2
  id: string
  time: string
  source: TranscriptEnvelopeSource
  turnId?: string
  itemId?: string
  parentId?: string
  subagentId?: string
  seq?: number
  ev: TranscriptEnvelopeEvent
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function isTranscriptEnvelope(value: unknown): value is TranscriptEnvelope {
  const candidate = asObject(value)
  if (!candidate) {
    return false
  }

  const source = asObject(candidate.source)
  const ev = asObject(candidate.ev)
  return candidate.schemaVersion === 2
    && typeof candidate.id === 'string'
    && typeof candidate.time === 'string'
    && typeof source?.provider === 'string'
    && typeof source?.backend === 'string'
    && typeof ev?.type === 'string'
}
