import { describe, expect, it, vi } from 'vitest'
import { type ActionPolicyGateResult } from '../../../../policies/action-policy-gate'
import { buildFallbackClaudeApprovalSession } from '../../claude/approval-adapter'
import {
  geminiApprovalAdapter,
  type GeminiApprovalRawEvent,
} from '../approval-adapter'
import type { StreamSession } from '../../../types'

function buildGeminiSession(): StreamSession {
  return {
    ...buildFallbackClaudeApprovalSession('gemini-worker-1'),
    agentType: 'gemini',
    geminiRuntime: {
      sendResponse: vi.fn(),
    },
  } as StreamSession
}

function buildGeminiRawEvent(): GeminiApprovalRawEvent {
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

describe('geminiApprovalAdapter', () => {
  it('round-trips a realistic Gemini ACP permission request on allow', async () => {
    const session = buildGeminiSession()
    const rawEvent = buildGeminiRawEvent()

    expect(geminiApprovalAdapter.toUnifiedRequest(rawEvent, session)).toEqual({
      source: 'gemini',
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
      sessionName: 'gemini-worker-1',
      fallbackSessionName: 'gemini-worker-1',
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

    await geminiApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.geminiRuntime as { sendResponse: ReturnType<typeof vi.fn> }
    expect(runtime.sendResponse).toHaveBeenCalledWith(17, {
      outcome: {
        outcome: 'selected',
        optionId: 'opt-allow-once',
      },
    })
  })

  it('selects the reject option and emits the denial reason for Gemini ACP requests', async () => {
    const session = buildGeminiSession()
    const rawEvent = buildGeminiRawEvent()

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'deny',
      policyDecision: 'review',
      reason: 'Email to matt.feroz@example.com requires manual approval.',
      sessionContext: null,
    }

    await geminiApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.geminiRuntime as { sendResponse: ReturnType<typeof vi.fn> }
    expect(runtime.sendResponse).toHaveBeenCalledWith(17, {
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
