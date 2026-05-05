import type { ActionPolicyGateResult } from '../../../policies/action-policy-gate.js'
import type { ProviderApprovalAdapter } from '../../../policies/provider-approval-adapter.js'
import { registerApprovalAdapter } from '../../../policies/types.js'
import type {
  CodexApprovalDecision,
  CodexPendingApprovalRequest,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'
import { readCodexRuntime } from '../../providers/provider-session-context.js'
import { buildCodexApprovalDecisionEvent, markCodexTurnHealthy } from './helpers.js'

interface CodexApprovalReplyDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  notifyApprovalResolved?(
    session: StreamSession,
    request: CodexPendingApprovalRequest,
    decision: CodexApprovalDecision,
    delivered: boolean,
  ): void
  schedulePersistedSessionsWrite(): void
  scheduleTurnWatchdog(session: StreamSession): void
}

export interface CodexApprovalRawEvent {
  request: CodexPendingApprovalRequest
  toolName: string
  toolInput?: unknown
  replyDeps: CodexApprovalReplyDeps
}

function buildCodexApprovalResponse(
  request: CodexPendingApprovalRequest,
  decision: CodexApprovalDecision,
): unknown {
  if (request.method === 'item/permissions/requestApproval') {
    return {
      permissions: decision === 'accept' && typeof request.permissions === 'object' && request.permissions !== null
        ? request.permissions
        : {},
      scope: 'turn',
    }
  }

  if (
    request.method === 'item/mcpToolCall/requestApproval'
    || request.method === 'item/skill/requestApproval'
  ) {
    return { decision, allowed: decision === 'accept' }
  }

  if (request.method === 'item/rules/requestApproval') {
    return { decision, accepted: decision === 'accept' }
  }

  return { decision }
}

export function sendCodexApprovalReply(
  session: StreamSession,
  request: CodexPendingApprovalRequest,
  decision: CodexApprovalDecision,
  deps: CodexApprovalReplyDeps,
  options: {
    notifyNativeQueue?: boolean
    removeTrackedRequest?: boolean
  } = {},
): { ok: true } | {
  ok: false
  code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
  reason: string
} {
  if (session.agentType !== 'codex') {
    return {
      ok: false,
      code: 'invalid_session',
      reason: 'Codex approvals are only available for Codex sessions',
    }
  }

  const runtime = readCodexRuntime(session)
  if (!runtime) {
    return { ok: false, code: 'unavailable', reason: 'Codex runtime is unavailable' }
  }

  try {
    runtime.sendResponse(request.requestId, buildCodexApprovalResponse(request, decision))
  } catch (error) {
    return {
      ok: false,
      code: 'protocol_error',
      reason: error instanceof Error ? error.message : 'Failed to send Codex approval decision',
    }
  }

  if (options.removeTrackedRequest !== false) {
    session.codexPendingApprovals.delete(request.requestId)
  }
  markCodexTurnHealthy(session)
  if (!session.lastTurnCompleted) {
    deps.scheduleTurnWatchdog(session)
  }

  runtime.log('info', 'Codex approval decision sent', {
    sessionName: session.name,
    threadId: request.threadId,
    requestId: request.requestId,
    decision,
    method: request.method,
    itemId: request.itemId,
    turnId: request.turnId,
  })

  const decisionEvent = buildCodexApprovalDecisionEvent(request, decision)
  deps.appendEvent(session, decisionEvent)
  deps.broadcastEvent(session, decisionEvent)
  deps.schedulePersistedSessionsWrite()
  if (options.notifyNativeQueue !== false) {
    deps.notifyApprovalResolved?.(session, request, decision, true)
  }

  return { ok: true }
}

export const codexApprovalAdapter = registerApprovalAdapter<ProviderApprovalAdapter<CodexApprovalRawEvent, void>>({
  source: 'codex',

  toUnifiedRequest(rawEvent, session) {
    return {
      source: 'codex',
      toolName: rawEvent.toolName,
      toolInput: rawEvent.toolInput,
      sessionName: session.name,
      fallbackSessionName: session.name,
      providerContext: {
        requestId: rawEvent.request.requestId,
        threadId: rawEvent.request.threadId,
        itemId: rawEvent.request.itemId,
        turnId: rawEvent.request.turnId,
      },
    }
  },

  async sendReply(result: ActionPolicyGateResult, rawEvent: CodexApprovalRawEvent, session: StreamSession): Promise<void> {
    const delivery = sendCodexApprovalReply(
      session,
      rawEvent.request,
      result.decision === 'allow' ? 'accept' : 'decline',
      rawEvent.replyDeps,
      {
        notifyNativeQueue: false,
        removeTrackedRequest: false,
      },
    )
    if (!delivery.ok) {
      throw new Error(delivery.reason)
    }
  },
})
