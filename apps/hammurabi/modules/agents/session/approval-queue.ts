import { COMMANDER_SESSION_NAME_PREFIX } from '../constants.js'
import {
  getCodexApprovalActionId,
  getCodexApprovalActionLabel,
  serializeCodexApprovalId,
} from '../codex-approval.js'
import { clearCodexPendingApprovals as clearCodexPendingApprovalsFromHelper } from '../adapters/codex/helpers.js'
import type {
  AnySession,
  CodexApprovalDecision,
  CodexApprovalQueueEvent,
  CodexPendingApprovalRequest,
  PendingCodexApprovalView,
  StreamSession,
} from '../types.js'

interface CodexApprovalQueueRuntimeDeps {
  sessions: Map<string, AnySession>
  subscribers: Set<(event: CodexApprovalQueueEvent) => void>
}

export interface CodexApprovalQueueRuntime {
  getApprovalCommanderScopeId(session: StreamSession): string | undefined
  toPendingCodexApprovalView(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): PendingCodexApprovalView
  emitCodexApprovalQueueEvent(event: CodexApprovalQueueEvent): void
  clearCodexPendingApprovals(session: StreamSession): void
  notifyApprovalEnqueued(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): void
  notifyApprovalResolved(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
    decision: CodexApprovalDecision,
    delivered: boolean,
  ): void
}

export function createCodexApprovalQueueRuntime(
  deps: CodexApprovalQueueRuntimeDeps,
): CodexApprovalQueueRuntime {
  function getApprovalCommanderScopeId(session: StreamSession): string | undefined {
    if (session.sessionType === 'commander') {
      return session.name
    }
    if (session.creator.kind === 'commander' && session.creator.id) {
      return `${COMMANDER_SESSION_NAME_PREFIX}${session.creator.id}`
    }
    const parentSession = session.spawnedBy ? deps.sessions.get(session.spawnedBy) : undefined
    if (parentSession?.kind === 'stream' && parentSession.sessionType === 'commander') {
      return session.spawnedBy
    }
    return undefined
  }

  function toPendingCodexApprovalView(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): PendingCodexApprovalView {
    return {
      id: serializeCodexApprovalId(session.name, pendingRequest.requestId),
      sessionName: session.name,
      commanderScopeId: getApprovalCommanderScopeId(session),
      requestId: pendingRequest.requestId,
      actionId: getCodexApprovalActionId(pendingRequest.method),
      actionLabel: getCodexApprovalActionLabel(pendingRequest.method),
      requestedAt: pendingRequest.requestedAt,
      reason: pendingRequest.reason,
      risk: pendingRequest.risk,
      threadId: pendingRequest.threadId,
      itemId: pendingRequest.itemId,
      turnId: pendingRequest.turnId,
    }
  }

  function emitCodexApprovalQueueEvent(event: CodexApprovalQueueEvent): void {
    for (const subscriber of deps.subscribers) {
      try {
        subscriber(event)
      } catch {
        // Approval queue subscribers must not interrupt session flow.
      }
    }
  }

  function clearCodexPendingApprovals(session: StreamSession): void {
    if (session.codexPendingApprovals.size > 0) {
      for (const pendingRequest of session.codexPendingApprovals.values()) {
        emitCodexApprovalQueueEvent({
          type: 'resolved',
          approval: toPendingCodexApprovalView(session, pendingRequest),
          delivered: false,
        })
      }
    }
    clearCodexPendingApprovalsFromHelper(session)
  }

  function notifyApprovalEnqueued(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): void {
    emitCodexApprovalQueueEvent({
      type: 'enqueued',
      approval: toPendingCodexApprovalView(session, pendingRequest),
    })
  }

  function notifyApprovalResolved(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
    decision: CodexApprovalDecision,
    delivered: boolean,
  ): void {
    emitCodexApprovalQueueEvent({
      type: 'resolved',
      approval: toPendingCodexApprovalView(session, pendingRequest),
      decision: decision === 'accept' ? 'approve' : decision === 'cancel' ? 'cancel' : 'reject',
      delivered,
    })
  }

  return {
    getApprovalCommanderScopeId,
    toPendingCodexApprovalView,
    emitCodexApprovalQueueEvent,
    clearCodexPendingApprovals,
    notifyApprovalEnqueued,
    notifyApprovalResolved,
  }
}
