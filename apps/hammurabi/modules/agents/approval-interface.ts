/**
 * Approval sessions interface — the implementation that backs
 * ApprovalSessionsInterface declared in `./types.ts`.
 *
 * Extracted from `createAgentsRouter()` inside `routes.ts` in issue/921
 * Phase P6a so the approval-queue surface lives in a focused module. Pair
 * of the sessionsInterface extraction landed in PR #1130 (P5).
 *
 * Like commander-interface.ts, this depends on router-local closures that
 * cannot be module-imported (they read/write the router's mutable state).
 * Those dependencies are passed through `ApprovalInterfaceContext` at
 * construction time so the contract is explicit and unit-testable.
 */
import { parseCodexApprovalId } from './codex-approval.js'
import type {
  AnySession,
  ApprovalSessionContext,
  ApprovalSessionsInterface,
  CodexApprovalDecision,
  CodexApprovalQueueEvent,
  CodexPendingApprovalRequest,
  PendingCodexApprovalView,
  StreamSession,
} from './types.js'

/** Signature for the router's helper that resolves a session's commander scope id. */
export type ApprovalCommanderScopeResolver = (session: StreamSession) => string | undefined

/** Signature for the router's pending-approval projection helper. */
export type PendingCodexApprovalProjection = (
  session: StreamSession,
  pendingRequest: CodexPendingApprovalRequest,
) => PendingCodexApprovalView

/** Signature for the router's codex approval-decision applier. */
export type CodexApprovalDecider = (
  session: StreamSession,
  requestId: number,
  decision: CodexApprovalDecision,
) => { ok: true } | {
  ok: false
  code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
  reason: string
}

/**
 * Every router-local closure the ApprovalSessionsInterface implementation
 * needs. Kept explicit so future changes to the approval-queue dependency
 * set show up in the type, not in hidden closure references.
 */
export interface ApprovalInterfaceContext {
  sessions: Map<string, AnySession>
  codexApprovalQueueSubscribers: Set<(event: CodexApprovalQueueEvent) => void>
  getApprovalCommanderScopeId: ApprovalCommanderScopeResolver
  toPendingCodexApprovalView: PendingCodexApprovalProjection
  applyCodexApprovalDecision: CodexApprovalDecider
}

/**
 * Construct the approval-sessions interface backed by the given router
 * context. Behavior is identical to the pre-#921-P6a inline object literal;
 * pure refactor.
 */
export function createApprovalSessionsInterface(
  ctx: ApprovalInterfaceContext,
): ApprovalSessionsInterface {
  const {
    sessions,
    codexApprovalQueueSubscribers,
    getApprovalCommanderScopeId,
    toPendingCodexApprovalView,
    applyCodexApprovalDecision,
  } = ctx

  /**
   * Project a StreamSession into the lightweight ApprovalSessionContext
   * consumed by approval-policy code.
   */
  function projectSessionContext(session: StreamSession): ApprovalSessionContext {
    return {
      sessionName: session.name,
      sessionType: session.sessionType,
      creator: session.creator,
      agentType: session.agentType,
      mode: session.mode,
      cwd: session.cwd,
      host: session.host,
      commanderScopeId: getApprovalCommanderScopeId(session),
      currentSkillInvocation: session.currentSkillInvocation
        ? { ...session.currentSkillInvocation }
        : undefined,
    }
  }

  return {
    getSessionContext(name) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return null
      }
      return projectSessionContext(session)
    },

    findSessionContextByClaudeSessionId(sessionId) {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) {
        return null
      }
      for (const session of sessions.values()) {
        if (
          session.kind === 'stream'
          && session.agentType === 'claude'
          && session.claudeSessionId === normalizedSessionId
        ) {
          return projectSessionContext(session)
        }
      }
      return null
    },

    getLiveSession(name) {
      const session = sessions.get(name)
      if (!session || session.kind !== 'stream') {
        return null
      }
      return session
    },

    findLiveSessionByClaudeSessionId(sessionId) {
      const normalizedSessionId = sessionId.trim()
      if (!normalizedSessionId) {
        return null
      }
      for (const session of sessions.values()) {
        if (
          session.kind === 'stream'
          && session.agentType === 'claude'
          && session.claudeSessionId === normalizedSessionId
        ) {
          return session
        }
      }
      return null
    },

    listPendingCodexApprovals() {
      const pending: PendingCodexApprovalView[] = []
      for (const session of sessions.values()) {
        if (session.kind !== 'stream' || session.agentType !== 'codex') {
          continue
        }
        for (const request of session.codexPendingApprovals.values()) {
          pending.push(toPendingCodexApprovalView(session, request))
        }
      }
      pending.sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      return pending
    },

    resolvePendingCodexApproval(approvalId, decision) {
      const parsed = parseCodexApprovalId(approvalId)
      if (!parsed) {
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason: `Codex approval "${approvalId}" not found`,
        }
      }

      const session = sessions.get(parsed.sessionName)
      if (!session || session.kind !== 'stream') {
        return {
          ok: false as const,
          code: 'not_found' as const,
          reason: `Codex approval "${approvalId}" not found`,
        }
      }

      return applyCodexApprovalDecision(session, parsed.requestId, decision)
    },

    subscribeToCodexApprovalQueue(listener) {
      codexApprovalQueueSubscribers.add(listener)
      return () => {
        codexApprovalQueueSubscribers.delete(listener)
      }
    },
  }
}
