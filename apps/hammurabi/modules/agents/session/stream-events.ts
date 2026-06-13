import {
  clearCodexTurnWatchdog,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import { getProvider } from '../providers/registry.js'
import {
  ensureClaudeProviderContext,
  readClaudeSessionId,
} from '../providers/provider-session-context.js'
import {
  appendCommanderTranscriptEvent,
  appendGenericTranscriptEvent,
} from './persistence.js'
import {
  applyStreamUsageEvent,
} from './helpers.js'
import {
  extractTranscriptUsageUpdate,
  isTranscriptExitRecord,
  isTranscriptTurnEndRecord,
  isTranscriptTurnStartRecord,
  readTranscriptEnvelopeSessionId,
} from '../transcript-records.js'
import {
  extractClaudeSessionId,
} from './state.js'
import { MAX_STREAM_EVENTS } from '../constants.js'
import type {
  CommanderTranscriptAppender,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

interface StreamEventQueueRuntime {
  broadcastQueueUpdate(session: StreamSession): void
  clearQueuedMessageRetry(session: StreamSession): void
  getQueuedBacklogCount(session: StreamSession): number
  resetQueuedMessageRetryDelay(session: StreamSession): void
  scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void
}

interface StreamEventAutoRotationRuntime {
  supportsAutoRotation(session: StreamSession): boolean
  scheduleAutoRotationIfNeeded(sessionName: string): void
}

interface StreamEventProviderRuntime {
  scheduleCodexTurnWatchdog(session: StreamSession): void
}

interface StreamEventApprovalRuntime {
  clearCodexPendingApprovals(session: StreamSession): void
}

interface StreamEventAppenderDeps {
  autoRotateEntryThreshold: number
  commanderTranscriptAppender?: CommanderTranscriptAppender
  getQueueRuntime(): StreamEventQueueRuntime
  getAutoRotationRuntime(): StreamEventAutoRotationRuntime
  getProviderRuntime(): StreamEventProviderRuntime
  getApprovalRuntime(): StreamEventApprovalRuntime
  schedulePersistedSessionsWrite(): void
}

export function createStreamEventAppender(
  deps: StreamEventAppenderDeps,
): (session: StreamSession, event: StreamJsonEvent) => void {
  return function appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void {
    session.lastEventAt = new Date().toISOString()
    session.events.push(event)
    if (session.events.length > MAX_STREAM_EVENTS) {
      session.events = session.events.slice(-MAX_STREAM_EVENTS)
    }

    const provider = getProvider(session.agentType)
    const usesRuntimeWatchdog = Boolean(provider?.runtimeWatchdog)
    const persistsResumeFromEvents = Boolean(provider?.uiCapabilities.supportsEffort)
    if (isTranscriptTurnStartRecord(event)) {
      const wasCompleted = session.lastTurnCompleted
      const isCompletedOneShot =
        (
          session.sessionType === 'cron' ||
          session.sessionType === 'sentinel' ||
          session.sessionType === 'automation'
        ) &&
        Boolean(session.finalResultEvent)
      if (!isCompletedOneShot) {
        session.lastTurnCompleted = false
        session.completedTurnAt = undefined
        session.finalResultEvent = undefined
        session.restoredIdle = false
      }
      if (usesRuntimeWatchdog) {
        deps.getApprovalRuntime().clearCodexPendingApprovals(session)
        deps.getProviderRuntime().scheduleCodexTurnWatchdog(session)
      }
      if (wasCompleted && persistsResumeFromEvents) {
        deps.schedulePersistedSessionsWrite()
      }
    }
    if (isTranscriptTurnEndRecord(event)) {
      const queueRuntime = deps.getQueueRuntime()
      const autoRotation = deps.getAutoRotationRuntime()
      const wasCompleted = session.lastTurnCompleted
      session.lastTurnCompleted = true
      session.completedTurnAt = new Date().toISOString()
      session.finalResultEvent = event
      if (!wasCompleted) {
        session.conversationEntryCount += 1
      }
      if (!wasCompleted && persistsResumeFromEvents) {
        deps.schedulePersistedSessionsWrite()
      }
      if (usesRuntimeWatchdog) {
        deps.getApprovalRuntime().clearCodexPendingApprovals(session)
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
      }
      if (
        !wasCompleted &&
        autoRotation.supportsAutoRotation(session) &&
        session.conversationEntryCount >= deps.autoRotateEntryThreshold
      ) {
        session.autoRotatePending = true
      }
      if (session.currentQueuedMessage) {
        session.currentQueuedMessage = undefined
        queueRuntime.clearQueuedMessageRetry(session)
        queueRuntime.resetQueuedMessageRetryDelay(session)
        queueRuntime.broadcastQueueUpdate(session)
        deps.schedulePersistedSessionsWrite()
        if (session.autoRotatePending) {
          autoRotation.scheduleAutoRotationIfNeeded(session.name)
        }
        queueRuntime.scheduleQueuedMessageDrain(session)
      } else if (queueRuntime.getQueuedBacklogCount(session) > 0) {
        if (session.autoRotatePending) {
          autoRotation.scheduleAutoRotationIfNeeded(session.name)
        }
        queueRuntime.scheduleQueuedMessageDrain(session)
      } else if (session.autoRotatePending) {
        autoRotation.scheduleAutoRotationIfNeeded(session.name)
      }
    }
    if (isTranscriptExitRecord(event) && usesRuntimeWatchdog) {
      deps.getApprovalRuntime().clearCodexPendingApprovals(session)
      clearCodexTurnWatchdog(session)
      markCodexTurnHealthy(session)
    }
    applyStreamUsageEvent(session, event)
    const usageUpdate = extractTranscriptUsageUpdate(event)
    if (usageUpdate?.totalCostUsd !== undefined) {
      session.usage.costUsd = usageUpdate.totalCostUsd
    } else if (usageUpdate?.costUsd !== undefined) {
      session.usage.costUsd = usageUpdate.costUsd
    }

    if (persistsResumeFromEvents) {
      const sessionId = extractClaudeSessionId(event) ?? readTranscriptEnvelopeSessionId(event)
      if (sessionId && readClaudeSessionId(session) !== sessionId) {
        ensureClaudeProviderContext(session).sessionId = sessionId
        deps.schedulePersistedSessionsWrite()
      }
    }

    appendCommanderTranscriptEvent(
      session,
      event,
      deps.commanderTranscriptAppender,
      extractClaudeSessionId,
    )
    appendGenericTranscriptEvent(session, event)
  }
}
