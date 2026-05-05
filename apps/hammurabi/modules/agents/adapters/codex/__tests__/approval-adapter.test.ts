import { describe, expect, it, vi } from 'vitest'
import { type ActionPolicyGateResult } from '../../../../policies/action-policy-gate'
import { buildFallbackClaudeApprovalSession } from '../../claude/approval-adapter'
import { createCodexProviderContext } from '../../../providers/provider-session-context'
import {
  codexApprovalAdapter,
  type CodexApprovalRawEvent,
} from '../approval-adapter'
import type { StreamSession } from '../../../types'

function buildCodexSession(): StreamSession {
  return {
    ...buildFallbackClaudeApprovalSession('codex-worker-1'),
    agentType: 'codex',
    activeTurnId: 'turn-approve-1',
    lastTurnCompleted: true,
    providerContext: createCodexProviderContext({
      runtime: {
        sendResponse: vi.fn(),
        log: vi.fn(),
      } as never,
    }),
  } as StreamSession
}

describe('codexApprovalAdapter', () => {
  it('round-trips a realistic Codex command approval request', async () => {
    const appendEvent = vi.fn()
    const broadcastEvent = vi.fn()
    const schedulePersistedSessionsWrite = vi.fn()
    const scheduleTurnWatchdog = vi.fn()
    const session = buildCodexSession()

    const rawEvent: CodexApprovalRawEvent = {
      request: {
        requestId: 42,
        method: 'item/commandExecution/requestApproval',
        threadId: 'thread-1',
        itemId: 'cmd-send-1',
        turnId: 'turn-1',
        reason: 'Command requires approval',
        requestedAt: '2026-04-26T12:00:00.000Z',
      },
      toolName: 'Bash',
      toolInput: {
        command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
      },
      replyDeps: {
        appendEvent,
        broadcastEvent,
        schedulePersistedSessionsWrite,
        scheduleTurnWatchdog,
      },
    }

    expect(codexApprovalAdapter.toUnifiedRequest(rawEvent, session)).toEqual({
      source: 'codex',
      toolName: 'Bash',
      toolInput: {
        command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
      },
      sessionName: 'codex-worker-1',
      fallbackSessionName: 'codex-worker-1',
      providerContext: {
        requestId: 42,
        threadId: 'thread-1',
        itemId: 'cmd-send-1',
        turnId: 'turn-1',
      },
    })

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'allow',
      policyDecision: 'review',
      sessionContext: null,
    }

    await codexApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(42, { decision: 'accept' })
    expect(appendEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Accepted Codex command execution approval request 42.',
      }),
    )
    expect(broadcastEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Accepted Codex command execution approval request 42.',
      }),
    )
    expect(schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
    expect(scheduleTurnWatchdog).not.toHaveBeenCalled()
  })
})
