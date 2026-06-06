import type { StreamJsonEvent } from '../types.js'
import { mapStreamEventsToMessages } from './history.js'
import type { MsgItem } from './model.js'
import { isTranscriptEnvelope, type TranscriptEnvelope } from '../../../src/types/transcript-envelope.js'

export interface SessionProjectionUsageDTO {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface SessionProjectionReplayCursorDTO {
  totalEvents: number
  returnedEvents: number
  more: boolean
}

export interface SessionProjectionDTO {
  schemaVersion: 1 | 2
  messages: MsgItem[]
  replayCursor: SessionProjectionReplayCursorDTO
  envelopes?: TranscriptEnvelope[]
  usage?: SessionProjectionUsageDTO
  queue?: Extract<StreamJsonEvent, { type: 'queue_update' }>['queue']
}

export function projectSessionReplay(input: {
  events: readonly StreamJsonEvent[]
  totalEvents: number
  more: boolean
  usage?: SessionProjectionUsageDTO
  queue?: Extract<StreamJsonEvent, { type: 'queue_update' }>['queue']
}): SessionProjectionDTO {
  const envelopes = input.events.filter(isTranscriptEnvelope)
  return {
    schemaVersion: envelopes.length > 0 ? 2 : 1,
    messages: mapStreamEventsToMessages(input.events),
    ...(envelopes.length > 0 ? { envelopes } : {}),
    replayCursor: {
      totalEvents: input.totalEvents,
      returnedEvents: input.events.length,
      more: input.more,
    },
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.queue ? { queue: input.queue } : {}),
  }
}
