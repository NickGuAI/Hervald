import { describe, expect, it } from 'vitest'
import { bridgeLegacyEventToTranscriptEnvelopes } from '../transcript-legacy-bridge'

describe('agents/transcript-legacy-bridge', () => {
  it('bridges Claude Code stream event families into v2 envelopes', () => {
    const cases = [
      {
        label: 'assistant text',
        event: {
          type: 'assistant',
          source: { provider: 'claude', backend: 'cli' },
          message: {
            id: 'assistant-text',
            role: 'assistant',
            content: [{ type: 'text', text: 'hello' }],
          },
        },
        expectedEventTypes: ['message.start', 'message.delta', 'message.end'],
      },
      {
        label: 'assistant thinking and tool',
        event: {
          type: 'assistant',
          source: { provider: 'claude', backend: 'cli' },
          message: {
            id: 'assistant-tool',
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'think' },
              { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
            ],
          },
        },
        expectedEventTypes: ['thinking.delta', 'tool.start'],
      },
      {
        label: 'user text',
        event: {
          type: 'user',
          source: { provider: 'claude', backend: 'cli' },
          message: { role: 'user', content: 'human input' },
        },
        expectedEventTypes: ['message.start', 'message.delta', 'message.end'],
      },
      {
        label: 'user tool result',
        event: {
          type: 'user',
          source: { provider: 'claude', backend: 'cli' },
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }],
          },
        },
        expectedEventTypes: ['tool.end'],
      },
      {
        label: 'planning decision',
        event: {
          type: 'planning',
          source: { provider: 'claude', backend: 'cli' },
          action: 'decision',
          toolId: 'plan-tool',
          approved: false,
          message: 'Need tests',
        },
        expectedEventTypes: ['plan.update', 'approval.resolved'],
      },
      {
        label: 'message start',
        event: {
          type: 'message_start',
          source: { provider: 'claude', backend: 'cli' },
          message: { id: 'msg-1', role: 'assistant' },
        },
        expectedEventTypes: ['turn.start', 'message.start'],
      },
      {
        label: 'content block delta',
        event: {
          type: 'content_block_delta',
          source: { provider: 'claude', backend: 'cli' },
          index: 2,
          delta: { type: 'thinking_delta', thinking: 'partial thought' },
        },
        expectedEventTypes: ['thinking.delta'],
      },
      {
        label: 'message delta usage',
        event: {
          type: 'message_delta',
          source: { provider: 'claude', backend: 'cli' },
          usage: { input_tokens: 3, output_tokens: 2 },
          usage_is_total: true,
        },
        expectedEventTypes: ['provider.activity'],
      },
      {
        label: 'message stop',
        event: {
          type: 'message_stop',
          source: { provider: 'claude', backend: 'cli' },
        },
        expectedEventTypes: ['message.end'],
      },
      {
        label: 'result',
        event: {
          type: 'result',
          source: { provider: 'claude', backend: 'cli' },
          result: 'done',
        },
        expectedEventTypes: ['turn.end'],
      },
      {
        label: 'system',
        event: {
          type: 'system',
          source: { provider: 'claude', backend: 'cli' },
          subtype: 'init',
        },
        expectedEventTypes: ['provider.activity'],
      },
      {
        label: 'agent text',
        event: {
          type: 'agent',
          source: { provider: 'claude', backend: 'cli' },
          text: 'agent output',
        },
        expectedEventTypes: ['message.start', 'message.delta', 'message.end'],
      },
      {
        label: 'top-level tool use',
        event: {
          type: 'tool_use',
          source: { provider: 'claude', backend: 'cli' },
          id: 'tool-2',
          name: 'Read',
          input: { file_path: 'README.md' },
        },
        expectedEventTypes: ['tool.start'],
      },
      {
        label: 'top-level tool result',
        event: {
          type: 'tool_result',
          source: { provider: 'claude', backend: 'cli' },
          tool_use_id: 'tool-2',
          content: 'ok',
        },
        expectedEventTypes: ['tool.end'],
      },
      {
        label: 'rate limit fallback',
        event: {
          type: 'rate_limit_event',
          source: { provider: 'claude', backend: 'cli' },
        },
        expectedEventTypes: ['provider.activity'],
      },
    ]

    for (const testCase of cases) {
      const envelopes = bridgeLegacyEventToTranscriptEnvelopes(testCase.event as never)
      expect(envelopes.length, testCase.label).toBeGreaterThan(0)
      expect(envelopes.map((envelope) => envelope.ev.type), testCase.label)
        .toEqual(testCase.expectedEventTypes)
      expect(envelopes.every((envelope) => envelope.schemaVersion === 2), testCase.label).toBe(true)
      expect(envelopes.every((envelope) => envelope.source.provider === 'claude'), testCase.label).toBe(true)
    }
  })

  it('keeps bridged Claude content-block deltas on a stable item identity', () => {
    const first = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'content_block_delta',
      source: { provider: 'claude', backend: 'cli' },
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'first ' },
    })
    const second = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'content_block_delta',
      source: { provider: 'claude', backend: 'cli' },
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'second' },
    })

    expect(first[0]).toEqual(expect.objectContaining({ itemId: 'content-block-0' }))
    expect(second[0]).toEqual(expect.objectContaining({ itemId: 'content-block-0' }))
  })

  it('maps Claude Code Agent tool ids and parent_tool_use_id into v2 subagent identity', () => {
    const agentTool = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'assistant-agent',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_parent',
          name: 'Agent',
          input: { description: 'Investigate flaky chat rendering' },
        }],
      },
    })

    expect(agentTool).toEqual([
      expect.objectContaining({
        itemId: 'toolu_parent',
        parentId: 'assistant-agent',
        subagentId: 'toolu_parent',
        ev: expect.objectContaining({
          type: 'tool.start',
          toolCallId: 'toolu_parent',
          name: 'Agent',
        }),
      }),
    ])

    const nestedAssistant = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'assistant-child',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading the file.' },
          { type: 'tool_use', id: 'toolu_child', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    })

    expect(nestedAssistant).toEqual([
      expect.objectContaining({
        itemId: 'assistant-child',
        subagentId: 'toolu_parent',
        ev: { type: 'message.start', role: 'assistant' },
      }),
      expect.objectContaining({
        itemId: 'assistant-child',
        subagentId: 'toolu_parent',
        ev: { type: 'message.delta', text: 'Reading the file.', channel: 'final' },
      }),
      expect.objectContaining({
        itemId: 'toolu_child',
        parentId: 'assistant-child',
        subagentId: 'toolu_parent',
        ev: expect.objectContaining({
          type: 'tool.start',
          toolCallId: 'toolu_child',
          name: 'Read',
        }),
      }),
      expect.objectContaining({
        itemId: 'assistant-child',
        subagentId: 'toolu_parent',
        ev: { type: 'message.end' },
      }),
    ])

    const nestedToolResult = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'user',
      source: { provider: 'claude', backend: 'cli' },
      parent_tool_use_id: 'toolu_parent',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_child', content: 'done' }],
      },
    })

    expect(nestedToolResult).toEqual([
      expect.objectContaining({
        subagentId: 'toolu_parent',
        ev: expect.objectContaining({
          type: 'tool.end',
          toolCallId: 'toolu_child',
          result: 'done',
        }),
      }),
    ])
  })

  it('maps Claude Code task system tool_use_id into v2 subagent identity with task metadata', () => {
    const taskEvents = [
      {
        subtype: 'task_progress',
        expectedTitle: 'Running nested investigation [Read]',
        extra: { description: 'Running nested investigation', last_tool_name: 'Read' },
      },
      {
        subtype: 'task_started',
        expectedTitle: 'Sub-agent: Investigate flaky chat rendering',
        extra: { description: 'Investigate flaky chat rendering' },
      },
      {
        subtype: 'task_notification',
        expectedTitle: 'Sub-agent completed',
        extra: { summary: 'Sub-agent completed', status: 'done' },
      },
    ]

    for (const taskEvent of taskEvents) {
      const envelopes = bridgeLegacyEventToTranscriptEnvelopes({
        type: 'system',
        source: { provider: 'claude', backend: 'cli' },
        subtype: taskEvent.subtype,
        tool_use_id: 'toolu_parent',
        task_id: 'task-1',
        subagent_type: 'general-purpose',
        task_description: 'Investigate flaky chat rendering',
        ...taskEvent.extra,
      } as never)

      expect(envelopes).toEqual([
        expect.objectContaining({
          subagentId: 'toolu_parent',
          ev: {
            type: 'provider.activity',
            title: taskEvent.expectedTitle,
            data: expect.objectContaining({
              subtype: taskEvent.subtype,
              tool_use_id: 'toolu_parent',
              task_id: 'task-1',
              subagent_type: 'general-purpose',
              task_description: 'Investigate flaky chat rendering',
            }),
          },
        }),
      ])
    }
  })

  it('leaves normal top-level and non-Claude tool calls without Claude subagent identity', () => {
    const [topLevelTool] = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'assistant-top-tool',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_top', name: 'Read', input: { file_path: 'README.md' } }],
      },
    })
    const [nonClaudeAgentTool] = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'gemini', backend: 'acp' },
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'assistant-gemini-agent',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_gemini', name: 'Agent', input: {} }],
      },
    } as never)

    expect(topLevelTool?.subagentId).toBeUndefined()
    expect(nonClaudeAgentTool?.subagentId).toBeUndefined()
  })

  it('bridges Claude assistant text into v2 message envelopes', () => {
    const envelopes = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude' }],
      },
    })

    expect(envelopes).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        itemId: 'assistant-1',
        source: expect.objectContaining({ provider: 'claude', backend: 'cli' }),
        ev: { type: 'message.start', role: 'assistant' },
      }),
      expect.objectContaining({
        itemId: 'assistant-1',
        ev: { type: 'message.delta', text: 'Hello from Claude', channel: 'final' },
      }),
      expect.objectContaining({
        itemId: 'assistant-1',
        ev: { type: 'message.end' },
      }),
    ])
  })

  it('bridges assistant image blocks into v2 message image envelopes', () => {
    const envelopes = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'assistant-image',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Chart ready' },
          {
            type: 'image',
            alt: 'chart',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'assistant-chart',
            },
          },
        ],
      },
    })

    expect(envelopes).toEqual([
      expect.objectContaining({
        itemId: 'assistant-image',
        ev: { type: 'message.start', role: 'assistant' },
      }),
      expect.objectContaining({
        itemId: 'assistant-image',
        ev: { type: 'message.delta', text: 'Chart ready', channel: 'final' },
      }),
      expect.objectContaining({
        itemId: 'assistant-image',
        ev: {
          type: 'message.image',
          role: 'assistant',
          image: expect.objectContaining({
            type: 'image',
            alt: 'chart',
            source: expect.objectContaining({
              media_type: 'image/png',
              data: 'assistant-chart',
            }),
          }),
        },
      }),
      expect.objectContaining({
        itemId: 'assistant-image',
        ev: { type: 'message.end' },
      }),
    ])
  })

  it('bridges image content block starts into v2 image envelopes', () => {
    const envelopes = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'content_block_start',
      source: { provider: 'claude', backend: 'cli' },
      index: 3,
      content_block: {
        type: 'image',
        url: 'https://example.test/plot.webp',
        alt: 'plot',
      },
    })

    expect(envelopes).toEqual([
      expect.objectContaining({
        itemId: 'content-block-3',
        ev: {
          type: 'message.image',
          role: 'assistant',
          image: expect.objectContaining({
            type: 'image',
            url: 'https://example.test/plot.webp',
            alt: 'plot',
          }),
        },
      }),
    ])
  })

  it('bridges plan approvals into plan plus approval lifecycle envelopes', () => {
    const envelopes = bridgeLegacyEventToTranscriptEnvelopes({
      type: 'plan_approval',
      source: { provider: 'claude', backend: 'cli' },
      interactionKind: 'plan_approval',
      toolId: 'plan-1',
      toolName: 'ExitPlanMode',
      plan: '1. Inspect\n2. Patch',
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      customResponseLabel: 'Respond',
      expiresAt: '2026-05-27T01:00:00.000Z',
      autoResolveAfterMs: 60_000,
      defaultDecision: 'reject',
      providerContext: {
        provider: 'claude',
        backend: 'cli',
        toolUseId: 'plan-1',
        toolName: 'ExitPlanMode',
        answerFormat: 'claude.exit_plan_mode',
      },
    })

    expect(envelopes).toEqual([
      expect.objectContaining({
        itemId: 'plan-1',
        ev: { type: 'plan.update', plan: '1. Inspect\n2. Patch' },
      }),
      expect.objectContaining({
        itemId: 'plan-1',
        ev: {
          type: 'approval.request',
          toolCallId: 'plan-1',
          interactionKind: 'plan_approval',
          prompt: '1. Inspect\n2. Patch',
          expiresAt: '2026-05-27T01:00:00.000Z',
          autoResolveAfterMs: 60_000,
          defaultDecision: 'reject',
          request: expect.objectContaining({
            toolName: 'ExitPlanMode',
            approveLabel: 'Approve',
            rejectLabel: 'Reject',
            expiresAt: '2026-05-27T01:00:00.000Z',
            autoResolveAfterMs: 60_000,
            defaultDecision: 'reject',
          }),
        },
      }),
    ])
  })
})
