import { describe, expect, it, vi } from 'vitest'
import { type ActionPolicyGateResult } from '../../../../policies/action-policy-gate'
import {
  buildFallbackClaudeApprovalSession,
  claudeApprovalAdapter,
  type ClaudeApprovalHookEvent,
} from '../approval-adapter'

describe('claudeApprovalAdapter', () => {
  it('round-trips a realistic Claude hook approval payload', async () => {
    const respond = vi.fn()
    const rawEvent: ClaudeApprovalHookEvent = {
      payload: {
        session_id: 'claude-session-1',
        hammurabi_session_name: 'claude-worker-1',
        tool_name: 'Bash',
        tool_input: {
          command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
        },
      },
      respond,
    }
    const session = buildFallbackClaudeApprovalSession('claude-worker-1')

    expect(claudeApprovalAdapter.toUnifiedRequest(rawEvent, session)).toEqual({
      source: 'claude',
      toolName: 'Bash',
      toolInput: {
        command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
      },
      sessionName: 'claude-worker-1',
      fallbackSessionName: 'claude-worker-1',
      providerContext: {
        sessionId: 'claude-session-1',
      },
    })

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'deny',
      policyDecision: 'review',
      reason: 'Email to matt.feroz@example.com requires manual approval.',
      sessionContext: null,
    }

    await claudeApprovalAdapter.sendReply(result, rawEvent, session)

    expect(respond).toHaveBeenCalledWith({
      decision: 'deny',
      reason: 'Email to matt.feroz@example.com requires manual approval.',
    })
  })
})
