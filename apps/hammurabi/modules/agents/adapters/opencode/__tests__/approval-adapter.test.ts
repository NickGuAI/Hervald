import { describe, expect, it, vi } from 'vitest'
import { type ActionPolicyGateResult } from '../../../../policies/action-policy-gate'
import { buildFallbackClaudeApprovalSession } from '../../claude/approval-adapter'
import { createOpenCodeProviderContext } from '../../../providers/provider-session-context'
import {
  opencodeApprovalAdapter,
  type OpenCodeApprovalRawEvent,
} from '../approval-adapter'
import type { StreamSession } from '../../../types'

function buildOpenCodeSession(): StreamSession {
  return {
    ...buildFallbackClaudeApprovalSession('opencode-worker-1'),
    agentType: 'opencode',
    providerContext: createOpenCodeProviderContext({
      runtime: {
        sendResponse: vi.fn(),
      },
    }),
  } as StreamSession
}

function buildOpenCodeRawEvent(): OpenCodeApprovalRawEvent {
  return {
    requestId: 17,
    method: 'session/request_permission',
    params: {
      options: [
        { kind: 'allow_once', optionId: 'opt-allow-once' },
        { kind: 'reject_once', optionId: 'opt-reject-once' },
      ],
    },
    toolCall: {
      toolCallId: 'tool-call-1',
      kind: 'mcp',
      title: 'gmail.send',
      content: [
        {
          type: 'text',
          text: 'Send email to matt.feroz@example.com',
        },
      ],
      locations: [
        { path: '/tmp/worktree' },
      ],
    },
    replyDeps: {
      appendEvent: vi.fn(),
      broadcastEvent: vi.fn(),
      schedulePersistedSessionsWrite: vi.fn(),
    },
  }
}

describe('opencodeApprovalAdapter', () => {
  it('round-trips a realistic OpenCode ACP permission request on allow', async () => {
    const session = buildOpenCodeSession()
    const rawEvent = buildOpenCodeRawEvent()

    expect(opencodeApprovalAdapter.toUnifiedRequest(rawEvent, session)).toEqual({
      source: 'opencode',
      toolName: 'gmail.send',
      toolInput: {
        title: 'gmail.send',
        content: [
          {
            type: 'text',
            text: 'Send email to matt.feroz@example.com',
          },
        ],
        locations: [
          { path: '/tmp/worktree' },
        ],
      },
      sessionName: 'opencode-worker-1',
      fallbackSessionName: 'opencode-worker-1',
      providerContext: {
        requestId: 17,
        method: 'session/request_permission',
        toolCallId: 'tool-call-1',
      },
    })

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'allow',
      policyDecision: 'review',
      sessionContext: null,
    }

    await opencodeApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { sendResponse?: ReturnType<typeof vi.fn>; runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(17, {
      outcome: {
        outcome: 'selected',
        optionId: 'opt-allow-once',
      },
    })
  })

  it('selects the reject option and emits the denial reason for OpenCode ACP requests', async () => {
    const session = buildOpenCodeSession()
    const rawEvent = buildOpenCodeRawEvent()

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'deny',
      policyDecision: 'review',
      reason: 'Email to matt.feroz@example.com requires manual approval.',
      sessionContext: null,
    }

    await opencodeApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(17, {
      outcome: {
        outcome: 'selected',
        optionId: 'opt-reject-once',
      },
    })
    expect(rawEvent.replyDeps.appendEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Email to matt.feroz@example.com requires manual approval.',
      }),
    )
    expect(rawEvent.replyDeps.broadcastEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Email to matt.feroz@example.com requires manual approval.',
      }),
    )
    expect(rawEvent.replyDeps.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
  })
})
