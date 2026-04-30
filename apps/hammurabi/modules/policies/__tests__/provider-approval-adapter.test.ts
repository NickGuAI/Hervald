import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildFallbackClaudeApprovalSession } from '../../agents/adapters/claude/approval-adapter'
import { ActionPolicyGate, type ActionPolicyGateRequest, type ActionPolicyGateResult } from '../action-policy-gate'
import { ApprovalCoordinator } from '../pending-store'
import { handleProviderApproval, type ProviderApprovalAdapter } from '../provider-approval-adapter'
import { PolicyStore } from '../store'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('handleProviderApproval', () => {
  it('handles enqueued approvals and reply delivery without provider-specific orchestration logic', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-approval-'))
    tempDirectories.push(rootDir)

    const approvalCoordinator = new ApprovalCoordinator({
      snapshotFilePath: path.join(rootDir, 'pending.json'),
      auditFilePath: path.join(rootDir, 'audit.jsonl'),
    })
    const policyStore = new PolicyStore({
      filePath: path.join(rootDir, 'policies.json'),
    })
    const actionPolicyGate = new ActionPolicyGate({
      approvalCoordinator,
      policyStore,
      getApprovalSessionsInterface: () => null,
    })

    const sendReply = vi.fn<ProviderApprovalAdapter<{ kind: string }, void>['sendReply']>()
    const emitTranscriptEvent = vi.fn<ProviderApprovalAdapter<{ kind: string }, void>['emitTranscriptEvent']>()

    const adapter: ProviderApprovalAdapter<{ kind: string }, void> = {
      source: 'mock-provider',
      toUnifiedRequest(): ActionPolicyGateRequest {
        return {
          source: 'mock-provider',
          toolName: 'Bash',
          toolInput: {
            command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
          },
          sessionName: 'mock-session-1',
          fallbackSessionName: 'mock-session-1',
        }
      },
      sendReply,
      emitTranscriptEvent,
    }

    const session = buildFallbackClaudeApprovalSession('mock-session-1')
    const rawEvent = { kind: 'approval-request' }
    const handlingPromise = handleProviderApproval(adapter, rawEvent, session, {
      actionPolicyGate,
    })

    let pendingApprovalId = ''
    await vi.waitFor(async () => {
      const approvals = await approvalCoordinator.listPending()
      expect(approvals).toHaveLength(1)
      pendingApprovalId = approvals[0].id
      expect(approvals[0]).toEqual(expect.objectContaining({
        actionId: 'send-email',
        source: 'mock-provider',
        sessionId: 'mock-session-1',
      }))
    })

    expect(sendReply).not.toHaveBeenCalled()

    await approvalCoordinator.resolve(pendingApprovalId, 'approve')
    await handlingPromise

    const replyResult = sendReply.mock.calls[0]?.[0] as ActionPolicyGateResult | undefined
    expect(replyResult).toEqual(expect.objectContaining({
      actionId: 'send-email',
      decision: 'allow',
      policyDecision: 'review',
      approvalId: pendingApprovalId,
    }))
    expect(sendReply).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'send-email',
        decision: 'allow',
        approvalId: pendingApprovalId,
      }),
      rawEvent,
      session,
    )
    expect(emitTranscriptEvent).toHaveBeenNthCalledWith(
      1,
      'enqueued',
      expect.objectContaining({
        source: 'mock-provider',
        toolName: 'Bash',
      }),
      undefined,
      session,
    )
    expect(emitTranscriptEvent).toHaveBeenNthCalledWith(
      2,
      'resolved',
      expect.objectContaining({
        source: 'mock-provider',
        toolName: 'Bash',
      }),
      expect.objectContaining({
        actionId: 'send-email',
        decision: 'allow',
        approvalId: pendingApprovalId,
      }),
      session,
    )
  })
})
