import type { StreamJsonEvent } from '../types.js'
import { normalizeClaudeEvent } from '../event-normalizers/claude.js'
import { isTranscriptEnvelope } from '../../../src/types/transcript-envelope.js'
import type { MsgItem } from './model.js'
import {
  createStreamProcessorState,
  processStreamEvent,
  type StreamEventProcessorContext,
} from './stream-event-machine.js'

function normalizeProjectionEvent(event: StreamJsonEvent): StreamJsonEvent[] {
  if (isTranscriptEnvelope(event)) {
    return [event]
  }
  if (event.source?.provider !== 'claude') {
    return [event]
  }
  const normalized = normalizeClaudeEvent(event) as StreamJsonEvent | StreamJsonEvent[] | null
  if (!normalized) {
    return []
  }
  return Array.isArray(normalized) ? normalized : [normalized]
}

export function mapStreamEventsToMessages(events: readonly StreamJsonEvent[]): MsgItem[] {
  let idCounter = 0
  let messages: MsgItem[] = []
  const state = createStreamProcessorState()

  const context: StreamEventProcessorContext = {
    state,
    nextId: () => `msg-${++idCounter}`,
    setMessages: (updater) => {
      messages = updater(messages)
    },
    setIsStreaming: () => {},
    // Server-side paged history must not clip; the client renderer applies UI bounds separately.
    capMessages: (msgs) => msgs,
  }

  for (const event of events) {
    for (const normalizedEvent of normalizeProjectionEvent(event)) {
      processStreamEvent(context, normalizedEvent, true)
    }
  }

  return messages
}
