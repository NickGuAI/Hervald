import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { deliverPlanApprovalDecision, type PlanApprovalEvent } from '../../../plan-approval'
import { isTranscriptEnvelope } from '../../../../../src/types/transcript-envelope'
import { createOpenCodeAcpSession } from '../session'

function createMockProcess(): ChildProcess {
  const process = Object.assign(new EventEmitter(), {
    pid: 1234,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
  return process as unknown as ChildProcess
}

function createRuntime(process: ChildProcess | null = null) {
  return {
    process,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    sendResponse: vi.fn(),
    addNotificationListener: vi.fn().mockReturnValue(() => {}),
    teardown: vi.fn().mockResolvedValue(undefined),
    teardownOnProcessExit: vi.fn(),
  }
}

function createDeps(runtimeFactory: ReturnType<typeof vi.fn>) {
  return {
    appendEvent: vi.fn(),
    broadcastEvent: vi.fn(),
    clearExitedSession: vi.fn(),
    deleteLiveSession: vi.fn(),
    deleteSessionEventHandlers: vi.fn(),
    getActiveSession: vi.fn(),
    resetActiveTurnState: vi.fn(),
    runtimeFactory,
    schedulePersistedSessionsWrite: vi.fn(),
    setCompletedSession: vi.fn(),
    setExitedSession: vi.fn(),
    writeTranscriptMeta: vi.fn(),
  } as const
}

describe('createOpenCodeAcpSession', () => {
  it('tears down and rethrows a friendly startup error when ensureConnected rejects', async () => {
    const runtime = createRuntime()
    runtime.ensureConnected.mockRejectedValue(new Error('spawn opencode ENOENT'))
    const runtimeFactory = vi.fn(() => runtime)

    await expect(createOpenCodeAcpSession(
      'opencode-worker-1',
      'default',
      '',
      '/tmp/opencode-worker',
      {},
      createDeps(runtimeFactory) as Parameters<typeof createOpenCodeAcpSession>[5],
    )).rejects.toThrow('OpenCode runtime failed to start: spawn opencode ENOENT')

    expect(runtime.teardown).toHaveBeenCalledWith({
      reason: 'OpenCode runtime failed to start: spawn opencode ENOENT',
    })
    expect(runtime.sendRequest).not.toHaveBeenCalled()
  })

  it('routes response-bearing session/update plan approvals through the plan normalizer', async () => {
    const runtime = createRuntime(createMockProcess())
    runtime.sendRequest.mockResolvedValue({ sessionId: 'opencode-session-1' })
    let listener: ((event: { method: string; params?: unknown; requestId?: number | string }) => void) | undefined
    runtime.addNotificationListener.mockImplementation((_sessionId, callback) => {
      listener = callback
      return vi.fn()
    })
    const runtimeFactory = vi.fn(() => runtime)
    const deps = createDeps(runtimeFactory)
    deps.appendEvent.mockImplementation((session, event) => {
      session.events.push(event)
    })

    const session = await createOpenCodeAcpSession(
      'opencode-plan-session',
      'default',
      '',
      '/tmp/opencode-worker',
      {},
      deps as Parameters<typeof createOpenCodeAcpSession>[5],
    )

    listener?.({
      method: 'session/update',
      requestId: 17,
      params: {
        sessionId: 'opencode-session-1',
        update: {
          type: 'plan',
          toolCallId: 'opencode-plan-1',
          status: 'waiting_for_approval',
          plan: '1. Patch the adapter\n2. Verify the approval response',
        },
      },
    })

    const planEvent = session.events.find((event) =>
      isTranscriptEnvelope(event) &&
      event.ev.type === 'approval.request' &&
      event.ev.interactionKind === 'plan_approval',
    ) as PlanApprovalEvent | undefined
    expect(planEvent).toEqual(expect.objectContaining({
      schemaVersion: 2,
      ev: expect.objectContaining({
        type: 'approval.request',
        toolCallId: 'opencode-plan-1',
        interactionKind: 'plan_approval',
        request: expect.objectContaining({
          providerContext: expect.objectContaining({
            provider: 'opencode',
            backend: 'acp',
            requestId: 17,
            answerFormat: 'opencode.plan_decision',
          }),
        }),
      }),
    }))

    const result = deliverPlanApprovalDecision(
      session,
      planEvent as PlanApprovalEvent,
      'approve',
      undefined,
      vi.fn(() => {
        throw new Error('OpenCode plan approval should not write to stdin')
      }),
    )

    expect(result.ok).toBe(true)
    expect(runtime.sendResponse).toHaveBeenCalledWith(17, {
      decision: 'approve',
      approved: true,
    })
  })
})
