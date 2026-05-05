/**
 * Stream I/O helpers.
 *
 * Extracted from `createAgentsRouter()` in `routes.ts` in issue/921 Phase
 * P6d. Five related leaf helpers that share the stream-session I/O surface:
 *
 *   broadcastStreamEvent  — fan out a StreamJsonEvent to WS clients + the
 *                           per-session handler Set.
 *   writeToStdin          — backpressure-aware stdin write; broadcasts a
 *                           drop-notice system event when the pipe is busy.
 *   resetActiveTurnState  — clear turn-completion flags + codex pending
 *                           approvals before starting a new turn.
 * Bundled together because writeToStdin also calls broadcastStreamEvent, so
 * keeping them in the same module means broadcast can stay closure-scoped to
 * sessionEventHandlers without forcing a context-passed callback.
 *
 * Only closure dep: `sessionEventHandlers` (the per-session handler map).
 * Everything else (codex approval clears) is module-level imports.
 */
import { WebSocket } from 'ws'

import {
  clearCodexPendingApprovals,
  markCodexTurnHealthy,
} from './adapters/codex/helpers.js'
import type {
  ExternalSession,
  StreamJsonEvent,
  StreamSession,
} from './types.js'

export interface StreamIoHelpers {
  broadcastStreamEvent: (
    session: StreamSession | ExternalSession,
    event: StreamJsonEvent,
  ) => void
  writeToStdin: (session: StreamSession, data: string) => boolean
  resetActiveTurnState: (session: StreamSession) => void
}

export interface StreamIoContext {
  /** Per-session handler subscriptions — `broadcastStreamEvent` fans events to these. */
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
}

export function createStreamIoHelpers(ctx: StreamIoContext): StreamIoHelpers {
  const { sessionEventHandlers } = ctx

  function broadcastStreamEvent(
    session: StreamSession | ExternalSession,
    event: StreamJsonEvent,
  ): void {
    const payload = JSON.stringify(event)
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload)
      }
    }

    const handlers = sessionEventHandlers.get(session.name)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch {
          // Ignore handler failures to avoid interrupting stream delivery.
        }
      }
    }
  }

  /**
   * Write to a stream session's stdin with backpressure awareness. If the
   * previous write has not drained yet, this write is dropped and a system
   * event is broadcast so the client knows the message was not delivered.
   * Returns true if the write was accepted.
   */
  function writeToStdin(session: StreamSession, data: string): boolean {
    const stdin = session.process.stdin
    if (!stdin?.writable) return false
    if (session.stdinDraining) {
      const dropEvent: StreamJsonEvent = {
        type: 'system',
        text: 'Input dropped — process stdin is busy. Try again shortly.',
      }
      broadcastStreamEvent(session, dropEvent)
      return false
    }
    try {
      const ok = stdin.write(data)
      if (!ok) {
        session.stdinDraining = true
        stdin.once('drain', () => {
          session.stdinDraining = false
        })
      }
      return true
    } catch {
      // stdin closed — the process 'error'/'exit' handler will notify clients.
      return false
    }
  }

  function resetActiveTurnState(session: StreamSession): void {
    if (session.lastTurnCompleted && session.sessionType !== 'cron' && session.sessionType !== 'automation') {
      session.lastTurnCompleted = false
      session.completedTurnAt = undefined
      session.finalResultEvent = undefined
    }
    if (session.agentType === 'codex') {
      clearCodexPendingApprovals(session)
      markCodexTurnHealthy(session)
      session.codexUnclassifiedIncomingCount = 0
      session.codexLastIncomingMethod = undefined
      session.codexLastIncomingAt = undefined
    }
  }

  return {
    broadcastStreamEvent,
    writeToStdin,
    resetActiveTurnState,
  }
}
