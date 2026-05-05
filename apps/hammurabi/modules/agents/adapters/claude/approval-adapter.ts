import type { ActionPolicyGateResult } from '../../../policies/action-policy-gate.js'
import {
  type ProviderApprovalAdapter,
} from '../../../policies/provider-approval-adapter.js'
import { registerApprovalAdapter } from '../../../policies/types.js'
import { createClaudeProviderContext } from '../../providers/provider-session-context.js'
import type { StreamSession } from '../../types.js'

export interface ClaudeApprovalHookEvent {
  payload: Record<string, unknown>
  respond(body: { decision: 'allow' | 'deny'; reason?: string }): void
}

export const claudeApprovalAdapter = registerApprovalAdapter<ProviderApprovalAdapter<ClaudeApprovalHookEvent, void>>({
  source: 'claude',

  toUnifiedRequest(rawEvent, session) {
    const sessionName = typeof rawEvent.payload.hammurabi_session_name === 'string'
      && rawEvent.payload.hammurabi_session_name.trim().length > 0
      ? rawEvent.payload.hammurabi_session_name.trim()
      : session.name

    return {
      source: 'claude',
      toolName: typeof rawEvent.payload.tool_name === 'string' ? rawEvent.payload.tool_name.trim() : '',
      toolInput: rawEvent.payload.tool_input,
      sessionName,
      fallbackSessionName: sessionName || 'claude-hook',
      providerContext: {
        sessionId: typeof rawEvent.payload.session_id === 'string' ? rawEvent.payload.session_id.trim() : undefined,
      },
    }
  },

  async sendReply(result: ActionPolicyGateResult, rawEvent: ClaudeApprovalHookEvent): Promise<void> {
    rawEvent.respond({
      decision: result.decision,
      reason: result.reason,
    })
  },
})

export function buildFallbackClaudeApprovalSession(sessionName = 'claude-hook'): StreamSession {
  return {
    kind: 'stream',
    name: sessionName,
    sessionType: 'worker',
    creator: { kind: 'human' },
    agentType: 'claude',
    mode: 'default',
    cwd: process.cwd(),
    providerContext: createClaudeProviderContext(),
    spawnedWorkers: [],
    process: {} as StreamSession['process'],
    events: [],
    clients: new Set(),
    createdAt: new Date(0).toISOString(),
    lastEventAt: new Date(0).toISOString(),
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: true,
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexPendingApprovals: new Map(),
    codexUnclassifiedIncomingCount: 0,
    messageQueue: {} as StreamSession['messageQueue'],
    pendingDirectSendMessages: [],
    queuedMessageRetryDelayMs: 250,
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    restoredIdle: false,
  }
}
