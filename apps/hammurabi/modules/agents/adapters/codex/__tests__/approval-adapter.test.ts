import { describe, expect, it, vi } from 'vitest'
import { type ActionPolicyGateResult } from '../../../../policies/action-policy-gate'
import { buildFallbackClaudeApprovalSession } from '../../claude/approval-adapter'
import { createCodexProviderContext } from '../../../providers/provider-session-context'
import {
  codexApprovalAdapter,
  type CodexApprovalRawEvent,
} from '../approval-adapter'
import {
  buildCodexMcpElicitationResult,
  buildCodexMcpElicitationQuestionEvent,
  codexMcpElicitationApprovalAdapter,
  deliverCodexMcpElicitationQuestionAnswer,
  findActiveCodexMcpToolContext,
  type CodexMcpElicitationApprovalRawEvent,
} from '../elicitation'
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

  it('maps native Codex approval cancellation decisions to Codex cancel responses', async () => {
    const appendEvent = vi.fn()
    const broadcastEvent = vi.fn()
    const schedulePersistedSessionsWrite = vi.fn()
    const scheduleTurnWatchdog = vi.fn()
    const session = buildCodexSession()

    const rawEvent: CodexApprovalRawEvent = {
      request: {
        requestId: 43,
        method: 'item/commandExecution/requestApproval',
        threadId: 'thread-1',
        itemId: 'cmd-cancel-1',
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

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'cancel',
      policyDecision: 'review',
      sessionContext: null,
    }

    await codexApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(43, { decision: 'cancel' })
    expect(appendEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Cancelled Codex command execution approval request 43.',
      }),
    )
    expect(schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
    expect(scheduleTurnWatchdog).not.toHaveBeenCalled()
  })

  it('maps Codex MCP elicitation policy decisions to Codex-native responses', async () => {
    const appendEvent = vi.fn()
    const broadcastEvent = vi.fn()
    const schedulePersistedSessionsWrite = vi.fn()
    const scheduleTurnWatchdog = vi.fn()
    const session = buildCodexSession()
    session.lastTurnCompleted = false

    const rawEvent: CodexMcpElicitationApprovalRawEvent = {
      requestId: 77,
      threadId: 'thread-1',
      toolCallId: 'mcp-email-1',
      toolName: 'mcp__codex_apps__gmail_send_email',
      toolInput: {
        to: 'matt.feroz@example.com',
        subject: 'Need approval',
      },
      message: 'Allow Gmail to send an email?',
      serverName: 'codex_apps',
      tool: 'gmail_send_email',
      mode: 'default',
      replyDeps: {
        appendEvent,
        broadcastEvent,
        schedulePersistedSessionsWrite,
        scheduleTurnWatchdog,
      },
    }

    expect(codexMcpElicitationApprovalAdapter.toUnifiedRequest(rawEvent, session)).toEqual({
      source: 'codex',
      toolName: 'mcp__codex_apps__gmail_send_email',
      toolInput: {
        to: 'matt.feroz@example.com',
        subject: 'Need approval',
      },
      sessionName: 'codex-worker-1',
      fallbackSessionName: 'codex-worker-1',
      providerContext: {
        provider: 'codex',
        interaction: 'mcp_elicitation',
        requestId: 77,
        threadId: 'thread-1',
        toolCallId: 'mcp-email-1',
        serverName: 'codex_apps',
        tool: 'gmail_send_email',
        mode: 'default',
      },
    })

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'deny',
      policyDecision: 'review',
      sessionContext: null,
    }

    await codexMcpElicitationApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(77, { action: 'decline' })
    expect(appendEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Declined Codex MCP elicitation request 77.',
      }),
    )
    expect(scheduleTurnWatchdog).toHaveBeenCalledWith(session)
  })

  it('maps Codex MCP elicitation cancellation decisions to Codex cancel responses', async () => {
    const appendEvent = vi.fn()
    const broadcastEvent = vi.fn()
    const schedulePersistedSessionsWrite = vi.fn()
    const scheduleTurnWatchdog = vi.fn()
    const session = buildCodexSession()

    const rawEvent: CodexMcpElicitationApprovalRawEvent = {
      requestId: 79,
      threadId: 'thread-1',
      toolCallId: 'mcp-email-cancel-1',
      toolName: 'mcp__codex_apps__gmail_send_email',
      toolInput: {
        to: 'matt.feroz@example.com',
        subject: 'Cancel this',
      },
      message: 'Allow Gmail to send an email?',
      serverName: 'codex_apps',
      tool: 'gmail_send_email',
      replyDeps: {
        appendEvent,
        broadcastEvent,
        schedulePersistedSessionsWrite,
        scheduleTurnWatchdog,
      },
    }

    const result: ActionPolicyGateResult = {
      actionId: 'send-email',
      actionLabel: 'Send Email',
      decision: 'cancel',
      policyDecision: 'review',
      sessionContext: null,
    }

    await codexMcpElicitationApprovalAdapter.sendReply(result, rawEvent, session)

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(79, { action: 'cancel' })
    expect(appendEvent).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: 'system',
        text: 'Cancelled Codex MCP elicitation request 79.',
      }),
    )
    expect(scheduleTurnWatchdog).not.toHaveBeenCalled()
  })

  it('reads schema-backed Codex MCP answers by generated question labels', () => {
    const session = buildCodexSession()
    const event = buildCodexMcpElicitationQuestionEvent({
      requestId: 81,
      toolId: 'codex-mcp-question-1',
      message: 'Provide a response',
      requestedSchema: {
        type: 'object',
        properties: {
          response: {
            type: 'string',
            title: 'Response',
          },
        },
      },
    })

    const result = deliverCodexMcpElicitationQuestionAnswer(session, event, {
      Response: ['Use the submitted text'],
    })

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(result.ok).toBe(true)
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(81, {
      action: 'accept',
      content: {
        response: 'Use the submitted text',
      },
    })
  })

  it('populates every schema field in schema-backed Codex MCP replies', () => {
    const session = buildCodexSession()
    const event = buildCodexMcpElicitationQuestionEvent({
      requestId: 82,
      toolId: 'codex-mcp-question-2',
      message: 'Draft the message',
      requestedSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            title: 'Recipient',
          },
          subject: {
            type: 'string',
            title: 'Subject',
          },
          body: {
            type: 'string',
            title: 'Message Body',
          },
          urgent: {
            type: 'boolean',
            title: 'Urgent',
          },
        },
      },
    })

    const result = deliverCodexMcpElicitationQuestionAnswer(session, event, {
      Recipient: ['daniel@example.com'],
      Subject: ['Next week'],
      'Message Body': ['Hey Daniel'],
      Urgent: ['No'],
    })

    const runtime = session.providerContext as { runtime?: { sendResponse: ReturnType<typeof vi.fn> } }
    expect(result.ok).toBe(true)
    expect(runtime.runtime?.sendResponse).toHaveBeenCalledWith(82, {
      action: 'accept',
      content: {
        to: 'daniel@example.com',
        subject: 'Next week',
        body: 'Hey Daniel',
        urgent: false,
      },
    })
  })

  it('reads structured Codex MCP toolId context without relying on prompt text', () => {
    const session = buildCodexSession()

    expect(findActiveCodexMcpToolContext(session, {
      serverName: 'codex_apps',
      toolName: 'gmail_send_email',
      toolId: 'structured-tool-1',
      args: {
        to: 'matt.feroz@example.com',
        subject: 'Structured context',
      },
    })).toEqual({
      toolCallId: 'structured-tool-1',
      server: 'codex_apps',
      tool: 'gmail_send_email',
      toolName: 'mcp__codex_apps__gmail_send_email',
      toolInput: {
        to: 'matt.feroz@example.com',
        subject: 'Structured context',
      },
    })
  })

  it('builds Codex-native cancellation responses for MCP elicitations', () => {
    expect(buildCodexMcpElicitationResult({ requestId: 78 }, 'cancel')).toEqual({
      requestId: 78,
      result: {
        action: 'cancel',
      },
    })
  })
})
