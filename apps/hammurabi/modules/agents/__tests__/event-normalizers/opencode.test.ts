import { describe, expect, it } from 'vitest'

import {
  createOpenCodeTurnState,
  mapOpenCodeToTranscriptEnvelopes,
  normalizeOpenCodeSessionUpdate,
} from '../../event-normalizers/opencode'

const OPENCODE_SOURCE = {
  source: { provider: 'opencode', backend: 'acp' },
} as const

function withOpenCodeSource<T extends object>(event: T): T & typeof OPENCODE_SOURCE {
  return {
    ...event,
    ...OPENCODE_SOURCE,
  }
}

describe('agents/event-normalizers/opencode', () => {
  it('covers every OpenCode native part family called out by issue #1569', () => {
    const partCases: Array<{
      part: Record<string, unknown>
      expectedEventType: string
    }> = [
      { part: { id: 'text-1', type: 'text', text: 'hello' }, expectedEventType: 'message.delta' },
      { part: { id: 'subtask-1', type: 'subtask', name: 'subtask', input: { task: 'inspect' } }, expectedEventType: 'tool.start' },
      { part: { id: 'reasoning-1', type: 'reasoning', text: 'thinking' }, expectedEventType: 'thinking.delta' },
      { part: { id: 'file-1', type: 'file', path: 'src/app.ts' }, expectedEventType: 'file.change' },
      { part: { id: 'tool-1', type: 'tool', name: 'Bash', input: { command: 'pwd' } }, expectedEventType: 'tool.start' },
      { part: { id: 'step-start-1', type: 'step-start', title: 'Run step' }, expectedEventType: 'provider.activity' },
      { part: { id: 'step-finish-1', type: 'step-finish', title: 'Done' }, expectedEventType: 'provider.activity' },
      { part: { id: 'snapshot-1', type: 'snapshot', files: [] }, expectedEventType: 'provider.activity' },
      { part: { id: 'patch-1', type: 'patch', path: 'src/app.ts', diff: '@@' }, expectedEventType: 'file.change' },
      { part: { id: 'agent-1', type: 'agent', name: 'planner', input: { task: 'plan' } }, expectedEventType: 'tool.start' },
      { part: { id: 'retry-1', type: 'retry', reason: 'tool failed' }, expectedEventType: 'provider.activity' },
      { part: { id: 'compaction-1', type: 'compaction', summary: 'compressed' }, expectedEventType: 'provider.activity' },
    ]

    const envelopes = mapOpenCodeToTranscriptEnvelopes({
      type: 'message.updated',
      sessionId: 'session-parts',
      message: {
        parts: partCases.map(({ part }) => part),
      },
    }, createOpenCodeTurnState())

    expect(envelopes).toHaveLength(partCases.length)
    expect(envelopes.map((envelope) => envelope.ev.type))
      .toEqual(partCases.map(({ expectedEventType }) => expectedEventType))
    expect(envelopes.every((envelope) => envelope.schemaVersion === 2)).toBe(true)
    expect(envelopes.every((envelope) => envelope.source.provider === 'opencode')).toBe(true)
    expect(envelopes.some((envelope) => envelope.ev.type === 'provider.raw')).toBe(false)
  })

  it('preserves OpenCode task, tool, permission, question, todo, and status updates as v2 activity', () => {
    const taskLikeParts = [
      { id: 'task-1', type: 'task', name: 'Task', input: { prompt: 'delegate' } },
      { id: 'read-1', type: 'read', path: 'README.md' },
      { id: 'glob-1', type: 'glob', pattern: '**/*.ts' },
      { id: 'mcp-1', type: 'mcp', name: 'github.search' },
      { id: 'todo-1', type: 'todowrite', input: { todos: [{ content: 'test', status: 'pending' }] } },
    ]
    const partEvents = mapOpenCodeToTranscriptEnvelopes({
      type: 'message.updated',
      sessionId: 'session-task-parts',
      parts: taskLikeParts,
    }, createOpenCodeTurnState())

    expect(partEvents.map((envelope) => envelope.ev.type)).toEqual([
      'tool.start',
      'tool.start',
      'tool.start',
      'tool.start',
      'tool.start',
    ])
    expect(partEvents.map((envelope) => envelope.itemId)).toEqual([
      'task-1',
      'read-1',
      'glob-1',
      'mcp-1',
      'todo-1',
    ])

    for (const sessionUpdate of [
      'permission/requested',
      'question/asked',
      'todo/updated',
      'session/status',
      'message/status',
    ]) {
      const activity = mapOpenCodeToTranscriptEnvelopes({
        sessionUpdate,
        sessionId: 'session-status',
        status: 'running',
      }, createOpenCodeTurnState())
      expect(activity, sessionUpdate).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({
            provider: 'opencode',
            rawEventType: sessionUpdate,
          }),
          ev: {
            type: 'provider.activity',
            title: sessionUpdate,
            data: expect.objectContaining({ status: 'running' }),
          },
        }),
      ])
    }
  })

  it('maps non-final tool updates into v2 tool.delta envelopes', () => {
    const result = mapOpenCodeToTranscriptEnvelopes({
      sessionUpdate: 'tool_call_update',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      status: 'running',
      rawOutput: { progress: '50%' },
    }, createOpenCodeTurnState())

    expect(result).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        itemId: 'tool-1',
        source: expect.objectContaining({
          provider: 'opencode',
          backend: 'acp',
          sessionId: 'session-1',
          rawEventType: 'tool_call_update',
        }),
        ev: {
          type: 'tool.delta',
          toolCallId: 'tool-1',
          status: 'running',
          output: '{\n  "progress": "50%"\n}',
          data: expect.objectContaining({ status: 'running' }),
        },
      }),
    ])
  })

  it('maps native part payloads and preserves unknown updates', () => {
    const partEvents = mapOpenCodeToTranscriptEnvelopes({
      type: 'message.updated',
      sessionId: 'session-2',
      message: {
        parts: [
          { id: 'patch-1', type: 'patch', path: 'src/app.ts', diff: '@@' },
          { id: 'agent-1', type: 'agent', name: 'planner', status: 'running', input: { task: 'plan' } },
          { id: 'future-1', type: 'future-part', parentId: 'agent-1', payload: { keep: true } },
        ],
      },
    }, createOpenCodeTurnState())

    expect(partEvents).toEqual([
      expect.objectContaining({
        itemId: 'patch-1',
        ev: {
          type: 'file.change',
          path: 'src/app.ts',
          action: 'patch',
          data: expect.objectContaining({ diff: '@@' }),
        },
      }),
      expect.objectContaining({
        itemId: 'agent-1',
        ev: {
          type: 'tool.start',
          toolCallId: 'agent-1',
          name: 'planner',
          input: expect.objectContaining({ task: 'plan' }),
        },
      }),
      expect.objectContaining({
        itemId: 'future-1',
        parentId: 'agent-1',
        ev: {
          type: 'provider.raw',
          method: 'message.updated/part:future-part',
          payload: expect.objectContaining({ payload: { keep: true } }),
        },
      }),
    ])

    const raw = mapOpenCodeToTranscriptEnvelopes({
      sessionUpdate: 'brand_new_update',
      sessionId: 'session-3',
      payload: { keep: true },
    }, createOpenCodeTurnState())

    expect(raw).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ rawEventType: 'brand_new_update' }),
        ev: {
          type: 'provider.raw',
          method: 'brand_new_update',
          payload: expect.objectContaining({ payload: { keep: true } }),
        },
      }),
    ])
  })

  it('preserves malformed OpenCode updates as provider.raw envelopes', () => {
    expect(mapOpenCodeToTranscriptEnvelopes('not-json-object', createOpenCodeTurnState())).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({
          provider: 'opencode',
          backend: 'acp',
        }),
        ev: {
          type: 'provider.raw',
          payload: 'not-json-object',
        },
      }),
    ])
  })

  it('keeps non-blocking plan summaries read-only', () => {
    const result = normalizeOpenCodeSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect current behavior', status: 'completed' },
        { content: 'Patch the normalizer', status: 'in_progress' },
      ],
    }, createOpenCodeTurnState())

    expect(result).toEqual(withOpenCodeSource({
      type: 'planning',
      action: 'proposed',
      plan: '[x] Inspect current behavior\n[>] Patch the normalizer',
    }))
  })

  it('maps waiting plan updates into blocking plan approval asks', () => {
    const result = normalizeOpenCodeSessionUpdate({
      type: 'plan',
      toolCallId: 'opencode-plan-1',
      status: 'waiting_for_approval',
      plan: '1. Patch\n2. Test',
      expiresAt: '2026-05-19T00:05:00.000Z',
      defaultDecision: 'reject',
    }, createOpenCodeTurnState())

    expect(result).toEqual(withOpenCodeSource({
      type: 'plan_approval',
      interactionKind: 'plan_approval',
      toolId: 'opencode-plan-1',
      toolName: 'PlanApproval',
      plan: '1. Patch\n2. Test',
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      customResponseLabel: 'Response',
      expiresAt: '2026-05-19T00:05:00.000Z',
      defaultDecision: 'reject',
      providerContext: {
        provider: 'opencode',
        backend: 'acp',
        toolUseId: 'opencode-plan-1',
        toolName: 'PlanApproval',
        answerFormat: 'opencode.plan_decision',
      },
    }))
  })
})
