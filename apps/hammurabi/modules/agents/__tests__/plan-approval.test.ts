import { describe, expect, it, vi } from 'vitest'

import {
  buildPlanApprovalAutoResolvedSystemEvent,
  buildOpenCodePlanApprovalResult,
  buildPlanApprovalToolResultPayload,
  buildToolAnswerPayload,
  deliverPlanApprovalDecision,
  findExpiredPendingPlanApproval,
  isPlanApprovalExpired,
  readPlanApprovalDefaultDecision,
  readPlanApprovalToolId,
} from '../plan-approval'
import type { StreamJsonEvent, StreamSession } from '../types'

function makeSession(events: StreamJsonEvent[]): StreamSession {
  return {
    kind: 'stream',
    name: 'plan-session',
    events,
  } as unknown as StreamSession
}

function makePlanApproval(overrides: Partial<Extract<StreamJsonEvent, { type: 'plan_approval' }>> = {}) {
  return {
    type: 'plan_approval',
    interactionKind: 'plan_approval',
    toolId: 'plan-1',
    toolName: 'ExitPlanMode',
    plan: '1. Patch\n2. Test',
    providerContext: {
      provider: 'claude',
      backend: 'stream-json',
      toolUseId: 'plan-1',
      toolName: 'ExitPlanMode',
      answerFormat: 'claude.exit_plan_mode',
    },
    ...overrides,
  } satisfies Extract<StreamJsonEvent, { type: 'plan_approval' }>
}

describe('plan approval helpers', () => {
  it('keeps generic AskUserQuestion answer serialization unchanged', () => {
    const payload = buildToolAnswerPayload(makeSession([]), 'ask-1', {
      choice: ['alpha', 'beta'],
      note: 'ship it',
    })

    expect(payload).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'ask-1',
          content: JSON.stringify({
            answers: {
              choice: 'alpha, beta',
              note: 'ship it',
            },
            annotations: {},
          }),
        }],
      },
    })
  })

  it('serializes Claude plan approval decisions as provider-native tool results', () => {
    const planApproval = makePlanApproval()
    const payload = buildPlanApprovalToolResultPayload(planApproval, 'reject', 'Needs one more test.')
    const content = (payload as { message: { content: Array<{ content: string }> } }).message.content[0]?.content

    expect(payload).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'plan-1',
          content,
        }],
      },
    })
    expect(JSON.parse(content)).toEqual({
      approved: false,
      message: 'Needs one more test.',
    })
  })

  it('serializes OpenCode plan approval decisions with the OpenCode answer shape', () => {
    const planApproval = makePlanApproval({
      toolName: 'PlanApproval',
      providerContext: {
        provider: 'opencode',
        backend: 'acp',
        toolUseId: 'plan-1',
        toolName: 'PlanApproval',
        requestId: 'request-1',
        answerFormat: 'opencode.plan_decision',
      },
    })
    const payload = buildPlanApprovalToolResultPayload(planApproval, 'approve')
    const content = (payload as { message: { content: Array<{ content: string }> } }).message.content[0]?.content

    expect(JSON.parse(content)).toEqual({
      decision: 'approve',
      approved: true,
    })
    expect(buildOpenCodePlanApprovalResult(planApproval, 'approve')).toEqual({
      requestId: 'request-1',
      result: {
        decision: 'approve',
        approved: true,
      },
    })
  })

  it('delivers OpenCode plan decisions through the runtime response channel', () => {
    const sendResponse = vi.fn()
    const planApproval = makePlanApproval({
      providerContext: {
        provider: 'opencode',
        backend: 'acp',
        toolUseId: 'plan-1',
        toolName: 'PlanApproval',
        requestId: 17,
        answerFormat: 'opencode.plan_decision',
      },
    })
    const session = makeSession([planApproval])
    session.providerContext = {
      providerId: 'opencode',
      sessionId: 'session-1',
      runtime: {
        sendResponse,
      },
    } as unknown as StreamSession['providerContext']
    const writeToStdin = vi.fn()

    const result = deliverPlanApprovalDecision(
      session,
      planApproval,
      'reject',
      'Needs a smaller plan.',
      writeToStdin,
    )

    expect(result.ok).toBe(true)
    expect(writeToStdin).not.toHaveBeenCalled()
    expect(sendResponse).toHaveBeenCalledWith(17, {
      decision: 'reject',
      approved: false,
      message: 'Needs a smaller plan.',
    })
  })

  it('does not treat Codex MCP user questions as plan approvals', () => {
    const event = {
      schemaVersion: 2,
      id: 'codex-question',
      time: '2026-05-19T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'mcpserver/elicitation/request' },
      itemId: 'codex-mcp-elicitation-19',
      ev: {
        type: 'approval.request',
        toolCallId: 'codex-mcp-elicitation-19',
        interactionKind: 'ask_user_question',
        prompt: 'Which value should Codex use?',
        request: {
          interactionKind: 'ask_user_question',
          toolName: 'Codex MCP Elicitation',
          providerContext: {
            provider: 'codex',
            backend: 'rpc',
            toolUseId: 'codex-mcp-elicitation-19',
            toolName: 'Codex MCP Elicitation',
            requestId: 19,
            answerFormat: 'codex.mcp_elicitation',
          },
        },
      },
    } as StreamJsonEvent
    const session = makeSession([event])

    expect(findExpiredPendingPlanApproval(session, Date.parse('2026-05-19T00:00:01.000Z'))).toBeNull()
    expect(readPlanApprovalToolId(event)).toBeUndefined()
  })

  it('finds only expired pending plan approvals', () => {
    const expired = makePlanApproval({
      expiresAt: '2026-05-19T00:00:00.000Z',
      defaultDecision: 'reject',
    })
    const session = makeSession([expired])

    expect(findExpiredPendingPlanApproval(session, Date.parse('2026-05-19T00:00:01.000Z'))).toBe(expired)
    expect(findExpiredPendingPlanApproval(session, Date.parse('2026-05-18T23:59:59.000Z'))).toBeNull()
  })

  it('finds expired v2 plan approvals with preserved default decision and tool id', () => {
    const expired = {
      schemaVersion: 2,
      id: 'env-plan-approval',
      time: '2026-05-19T00:00:00.000Z',
      source: { provider: 'opencode', backend: 'acp', rawEventType: 'plan' },
      itemId: 'plan-2',
      ev: {
        type: 'approval.request',
        toolCallId: 'plan-2',
        interactionKind: 'plan_approval',
        prompt: '1. Patch',
        expiresAt: '2026-05-19T00:00:00.000Z',
        defaultDecision: 'reject',
        request: {
          interactionKind: 'plan_approval',
          toolName: 'PlanApproval',
          providerContext: {
            provider: 'opencode',
            backend: 'acp',
            toolUseId: 'plan-2',
            toolName: 'PlanApproval',
            answerFormat: 'opencode.plan_decision',
            requestId: 12,
          },
        },
      },
    } as StreamJsonEvent
    const session = makeSession([expired])
    const found = findExpiredPendingPlanApproval(session, Date.parse('2026-05-19T00:00:01.000Z'))

    expect(found).toBe(expired)
    expect(found ? readPlanApprovalToolId(found) : undefined).toBe('plan-2')
    expect(found ? readPlanApprovalDefaultDecision(found) : undefined).toBe('reject')
  })

  it('supports autoResolveAfterMs when a timestamp anchor is present', () => {
    const event = makePlanApproval({
      autoResolveAfterMs: 1_000,
      source: {
        provider: 'claude',
        backend: 'stream-json',
        normalizedAt: '2026-05-19T00:00:00.000Z',
      },
    })

    expect(isPlanApprovalExpired(event, Date.parse('2026-05-19T00:00:01.000Z'))).toBe(true)
    expect(isPlanApprovalExpired(event, Date.parse('2026-05-19T00:00:00.999Z'))).toBe(false)
  })

  it('does not return answered plan approvals as pending', () => {
    const session = makeSession([
      makePlanApproval({ expiresAt: '2026-05-19T00:00:00.000Z' }),
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'plan-1',
            content: JSON.stringify({ approved: true }),
          }],
        },
      } as StreamJsonEvent,
    ])

    expect(findExpiredPendingPlanApproval(session, Date.parse('2026-05-19T00:00:01.000Z'))).toBeNull()
  })

  it('builds the heartbeat transcript event for auto-resolution', () => {
    expect(buildPlanApprovalAutoResolvedSystemEvent(makePlanApproval(), 'reject')).toEqual({
      type: 'system',
      subtype: 'plan_approval_auto_resolved',
      text: 'Auto-resolved on heartbeat: reject',
      last_tool_name: 'ExitPlanMode',
    })
  })
})
