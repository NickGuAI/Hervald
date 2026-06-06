import { describe, expect, it } from 'vitest'
import { mapCodexToTranscriptEnvelopes, normalizeCodexEvent } from '../../event-normalizers/codex'

const CODEX_SOURCE = {
  source: { provider: 'codex', backend: 'rpc' },
} as const

function withCodexSource<T extends object>(event: T): T & typeof CODEX_SOURCE {
  return {
    ...event,
    ...CODEX_SOURCE,
  }
}

describe('agents/event-normalizers/codex', () => {
  describe('TranscriptEnvelope v2 mapping', () => {
    it('covers every Codex app-server event family called out by issue #1569', () => {
      const cases: Array<{
        method: string
        params: Record<string, unknown>
        expectedEventTypes: string[]
      }> = [
        {
          method: 'thread/archived',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/unarchived',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/closed',
          params: { thread: { id: 'thread-coverage' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'thread/status/changed',
          params: { thread: { id: 'thread-coverage' }, status: 'archived' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'turn/diff/updated',
          params: { turn: { id: 'turn-coverage', threadId: 'thread-coverage' }, diff: '@@' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'turn/plan/updated',
          params: { turn: { id: 'turn-coverage', threadId: 'thread-coverage' }, plan: '1. Test' },
          expectedEventTypes: ['plan.update'],
        },
        {
          method: 'item/plan/delta',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'plan-coverage',
            delta: 'Add all event coverage',
          },
          expectedEventTypes: ['plan.update'],
        },
        {
          method: 'item/reasoning/summaryPartAdded',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'reasoning-coverage',
            summary: { text: 'Observed a branch' },
          },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'item/commandExecution/outputDelta',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'command-coverage',
            delta: 'stdout chunk',
          },
          expectedEventTypes: ['tool.delta'],
        },
        {
          method: 'serverRequest/resolved',
          params: { threadId: 'thread-coverage', requestId: 99 },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'fuzzyFileSearch/sessionUpdated',
          params: { threadId: 'thread-coverage', sessionId: 'search-1', query: 'routes' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'fuzzyFileSearch/sessionCompleted',
          params: { threadId: 'thread-coverage', sessionId: 'search-1' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'windowsSandbox/setupCompleted',
          params: { threadId: 'thread-coverage', sandboxId: 'sandbox-1' },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'error',
          params: { threadId: 'thread-coverage', error: { message: 'boom' } },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'item/tool/requestUserInput',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            requestId: 101,
            prompt: 'Need input',
          },
          expectedEventTypes: ['provider.activity'],
        },
        {
          method: 'item/tool/call',
          params: {
            threadId: 'thread-coverage',
            turnId: 'turn-coverage',
            itemId: 'dynamic-call-coverage',
            tool: { name: 'lookup' },
          },
          expectedEventTypes: ['provider.activity'],
        },
      ]

      for (const testCase of cases) {
        const envelopes = mapCodexToTranscriptEnvelopes(testCase.method, testCase.params)
        expect(envelopes, testCase.method).toHaveLength(testCase.expectedEventTypes.length)
        expect(envelopes.map((envelope) => envelope.ev.type), testCase.method)
          .toEqual(testCase.expectedEventTypes)
        expect(envelopes.every((envelope) => envelope.schemaVersion === 2), testCase.method).toBe(true)
        expect(envelopes.every((envelope) => envelope.source.provider === 'codex'), testCase.method).toBe(true)
        expect(envelopes.some((envelope) => envelope.ev.type === 'provider.raw'), testCase.method).toBe(false)
      }
    })

    it('covers the Codex item lifecycle families without dropping to raw fallback', () => {
      const itemTypes = [
        'userMessage',
        'agentMessage',
        'plan',
        'reasoning',
        'commandExecution',
        'fileChange',
        'mcpToolCall',
        'dynamicToolCall',
        'collabToolCall',
        'collabAgentToolCall',
        'webSearch',
        'imageView',
        'enteredReviewMode',
        'exitedReviewMode',
        'contextCompaction',
      ]

      for (const itemType of itemTypes) {
        const started = mapCodexToTranscriptEnvelopes('item/started', {
          threadId: 'thread-items',
          turnId: 'turn-items',
          item: {
            id: `${itemType}-started`,
            type: itemType,
            command: 'pwd',
            changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@' }],
            text: 'Plan text',
          },
        })
        const completed = mapCodexToTranscriptEnvelopes('item/completed', {
          threadId: 'thread-items',
          turnId: 'turn-items',
          item: {
            id: `${itemType}-completed`,
            type: itemType,
            command: 'pwd',
            output: 'done',
            changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@' }],
            text: 'Plan text',
          },
        })

        expect(started.length, `${itemType} started`).toBeGreaterThan(0)
        expect(completed.length, `${itemType} completed`).toBeGreaterThan(0)
        expect(started.every((envelope) => envelope.ev.type !== 'provider.raw'), `${itemType} started`).toBe(true)
        expect(completed.every((envelope) => envelope.ev.type !== 'provider.raw'), `${itemType} completed`).toBe(true)
      }
    })

    it('normalizes Codex collabAgentToolCall items into Agent tool lifecycle envelopes', () => {
      const started = mapCodexToTranscriptEnvelopes('item/started', {
        threadId: 'thread-collab',
        turnId: 'turn-collab',
        item: {
          id: 'call-collab-1',
          type: 'collabAgentToolCall',
          name: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Investigate transcript noise',
          status: 'inProgress',
        },
      })
      const completed = mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-collab',
        turnId: 'turn-collab',
        item: {
          id: 'call-collab-1',
          type: 'collabAgentToolCall',
          name: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Investigate transcript noise',
          status: 'completed',
          receiverThreadIds: ['thread-child-1'],
        },
      })

      expect(started).toEqual([
        expect.objectContaining({
          itemId: 'call-collab-1',
          ev: expect.objectContaining({
            type: 'tool.start',
            toolCallId: 'call-collab-1',
            name: 'Agent',
            input: expect.objectContaining({
              prompt: 'Investigate transcript noise',
            }),
          }),
        }),
      ])
      expect(completed).toEqual([
        expect.objectContaining({
          itemId: 'call-collab-1',
          ev: expect.objectContaining({
            type: 'tool.end',
            toolCallId: 'call-collab-1',
            status: 'ok',
          }),
        }),
      ])
    })

    it('maps command output deltas to tool.delta envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/commandExecution/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        delta: 'hello\n',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            provider: 'codex',
            backend: 'rpc',
            sessionId: 'thread-1',
            rawEventType: 'item/commandExecution/outputDelta',
            rawEventId: 'cmd-1',
          }),
          turnId: 'turn-1',
          itemId: 'cmd-1',
          ev: {
            type: 'tool.delta',
            toolCallId: 'cmd-1',
            output: 'hello\n',
          },
        }),
      ])
    })

    it('maps Codex agent message delta payloads into final assistant text chunks', () => {
      expect(mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Final answer chunk',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            provider: 'codex',
            backend: 'rpc',
            sessionId: 'thread-1',
            rawEventType: 'item/agentMessage/delta',
            rawEventId: 'msg-1',
          }),
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: {
            type: 'message.delta',
            text: 'Final answer chunk',
            channel: 'final',
          },
        }),
      ])
    })

    it('maps file change output deltas to tool.delta envelopes', () => {
      expect(mapCodexToTranscriptEnvelopes('item/fileChange/outputDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'file-1',
        diff: '@@ -1 +1 @@',
      })).toEqual([
        expect.objectContaining({
          schemaVersion: 2,
          source: expect.objectContaining({
            rawEventType: 'item/fileChange/outputDelta',
            rawEventId: 'file-1',
          }),
          turnId: 'turn-1',
          itemId: 'file-1',
          ev: {
            type: 'tool.delta',
            toolCallId: 'file-1',
            output: '@@ -1 +1 @@',
            patch: '@@ -1 +1 @@',
          },
        }),
      ])
    })

    it('maps plan updates and preserves unknown events as provider.raw', () => {
      expect(mapCodexToTranscriptEnvelopes('turn/plan/updated', {
        turn: { id: 'turn-2' },
        plan: '1. Inspect\n2. Patch',
      })[0]).toEqual(expect.objectContaining({
        schemaVersion: 2,
        turnId: 'turn-2',
        ev: {
          type: 'plan.update',
          plan: '1. Inspect\n2. Patch',
        },
      }))

      expect(mapCodexToTranscriptEnvelopes('thread/customFutureEvent', {
        thread: { id: 'thread-2' },
        payload: { keep: 'me' },
      })[0]).toEqual(expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({
          sessionId: 'thread-2',
          rawEventType: 'thread/customFutureEvent',
        }),
        ev: {
          type: 'provider.raw',
          method: 'thread/customFutureEvent',
          payload: {
            thread: { id: 'thread-2' },
            payload: { keep: 'me' },
          },
        },
      }))
    })

    it('maps completed file changes to file.change plus tool.end', () => {
      const envelopes = mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: 'thread-9',
        turnId: 'turn-9',
        item: {
          id: 'file-9',
          type: 'fileChange',
          changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
        },
      })

      expect(envelopes).toEqual([
        expect.objectContaining({
          itemId: 'file-9',
          ev: {
            type: 'file.change',
            path: 'src/example.ts',
            action: 'applied',
            data: expect.objectContaining({
              changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
            }),
          },
        }),
        expect.objectContaining({
          itemId: 'file-9',
          ev: {
            type: 'tool.end',
            toolCallId: 'file-9',
            status: 'ok',
            result: expect.objectContaining({
              changes: [{ path: 'src/example.ts', kind: 'update', diff: '@@ -1 +1 @@' }],
            }),
          },
        }),
      ])
    })

    it('preserves Codex tool requests and review lifecycle events as v2 activity', () => {
      expect(mapCodexToTranscriptEnvelopes('item/tool/requestUserInput', {
        threadId: 'thread-7',
        turnId: 'turn-7',
        requestId: 7,
        prompt: 'Need input',
      })[0]).toEqual(expect.objectContaining({
        itemId: '7',
        ev: {
          type: 'provider.activity',
          title: 'Codex requested user input',
          data: expect.objectContaining({ prompt: 'Need input' }),
        },
      }))

      expect(mapCodexToTranscriptEnvelopes('item/started', {
        threadId: 'thread-review',
        turnId: 'turn-review',
        item: { id: 'review-1', type: 'enteredReviewMode', review: { id: 'r1' } },
      })[0]).toEqual(expect.objectContaining({
        itemId: 'review-1',
        ev: {
          type: 'provider.activity',
          title: 'Review mode entered',
          detail: 'enteredReviewMode',
          data: expect.objectContaining({ review: { id: 'r1' } }),
        },
      }))
    })
  })

  it('attaches the codex source envelope to replay-safe turn events', () => {
    expect(normalizeCodexEvent('thread/started', {})).toEqual(
      withCodexSource({ type: 'system', text: 'Codex session started' }),
    )

    expect(normalizeCodexEvent('turn/started', { turn: { id: 'turn_1' } })).toEqual(
      withCodexSource({
        type: 'message_start',
        message: { id: 'turn_1', role: 'assistant' },
      }),
    )

    expect(normalizeCodexEvent('turn/completed', { turn: { status: 'failed' } })).toEqual(
      withCodexSource({
        type: 'result',
        result: 'Turn failed',
        is_error: true,
      }),
    )
  })

  describe('reasoning streaming deltas', () => {
    it('reads params.delta for item/reasoning/summaryTextDelta', () => {
      const result = normalizeCodexEvent('item/reasoning/summaryTextDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        summaryIndex: 0,
        delta: 'Thinking about the problem...',
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Thinking about the problem...' },
        }),
      )
    })

    it('reads params.delta for item/reasoning/textDelta', () => {
      const result = normalizeCodexEvent('item/reasoning/textDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        contentIndex: 0,
        delta: 'Raw chain of thought...',
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Raw chain of thought...' },
        }),
      )
    })

    it('reads structured delta payloads with text fields', () => {
      const result = normalizeCodexEvent('item/reasoning/summaryTextDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        summaryIndex: 0,
        delta: { type: 'summary_text', text: 'Structured summary chunk' },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Structured summary chunk' },
        }),
      )
    })

    it('returns null when delta is empty', () => {
      const result = normalizeCodexEvent('item/reasoning/summaryTextDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        summaryIndex: 0,
        delta: '',
      })
      expect(result).toBeNull()
    })

    it('returns null when delta payload is non-string and missing text', () => {
      const result = normalizeCodexEvent('item/reasoning/textDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        contentIndex: 0,
        delta: { type: 'reasoning_text' },
      })
      expect(result).toBeNull()
    })

    it('returns null when delta field is missing', () => {
      const result = normalizeCodexEvent('item/reasoning/textDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        contentIndex: 0,
      })
      expect(result).toBeNull()
    })

    it('does not read params.text for reasoning deltas', () => {
      const result = normalizeCodexEvent('item/reasoning/summaryTextDelta', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        summaryIndex: 0,
        text: 'This should be ignored',
      })
      expect(result).toBeNull()
    })
  })

  describe('reasoning item/completed', () => {
    it('extracts thinking from summary and content string arrays', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_123',
          type: 'reasoning',
          summary: ['Summary part 1', 'Summary part 2'],
          content: ['Raw reasoning'],
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'rs_123',
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: 'Summary part 1Summary part 2Raw reasoning',
              presentation: { mergeWithActiveThinking: true },
            }],
          },
        }),
      )
    })

    it('extracts thinking from structured summary/content blocks', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_structured',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Summary chunk' }],
          content: [{ type: 'reasoning_text', text: 'Raw chunk' }],
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'rs_structured',
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: 'Summary chunkRaw chunk',
              presentation: { mergeWithActiveThinking: true },
            }],
          },
        }),
      )
    })

    it('handles reasoning item with only summary', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_456',
          type: 'reasoning',
          summary: ['Only summary here'],
          content: [],
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'rs_456',
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: 'Only summary here',
              presentation: { mergeWithActiveThinking: true },
            }],
          },
        }),
      )
    })

    it('handles reasoning item with empty arrays', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_789',
          type: 'reasoning',
          summary: [],
          content: [],
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'rs_789',
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: '',
              presentation: { mergeWithActiveThinking: true },
            }],
          },
        }),
      )
    })

    it('handles reasoning item with missing arrays', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_000',
          type: 'reasoning',
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'rs_000',
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: '',
              presentation: { mergeWithActiveThinking: true },
            }],
          },
        }),
      )
    })

    it('does not read item.text for reasoning', () => {
      const result = normalizeCodexEvent('item/completed', {
        item: {
          id: 'rs_old',
          type: 'reasoning',
          text: 'This should be ignored',
        },
      }) as { message: { content: Array<{ thinking: string }> } }
      expect(result.message.content[0].thinking).toBe('')
    })
  })

  describe('reasoning item/started', () => {
    it('emits content_block_start for reasoning item', () => {
      const result = normalizeCodexEvent('item/started', {
        item: { id: 'rs_start', type: 'reasoning' },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
      )
    })
  })

  describe('user item/started', () => {
    it('ignores Codex userMessage echoes to avoid duplicate local user events', () => {
      const result = normalizeCodexEvent('item/started', {
        item: {
          id: 'usr_1',
          type: 'userMessage',
          content: [{ type: 'input_text', text: 'status?' }],
        },
      })
      expect(result).toBeNull()
    })
  })

  describe('non-reasoning events still work', () => {
    it('handles item/agentMessage/delta with params.text', () => {
      const result = normalizeCodexEvent('item/agentMessage/delta', {
        text: 'Hello world',
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello world' },
        }),
      )
    })

    it('handles item/agentMessage/delta with current Codex params.delta chunks', () => {
      const result = normalizeCodexEvent('item/agentMessage/delta', {
        delta: 'Hello from delta',
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello from delta' },
        }),
      )
    })

    it('returns null for unknown methods', () => {
      const result = normalizeCodexEvent('unknown/method', {})
      expect(result).toBeNull()
    })

    it('keeps Codex plan-like methods unsupported until the runtime emits a real plan signal', () => {
      expect(normalizeCodexEvent('item/plan/updated', {
        plan: '1. Patch\n2. Test',
      })).toBeNull()
      expect(normalizeCodexEvent('item/planApproval/requested', {
        toolId: 'codex-plan-1',
        plan: '1. Patch\n2. Test',
      })).toBeNull()
    })
  })

  describe('command execution and file changes', () => {
    it('normalizes command execution into assistant/user replay pairs', () => {
      expect(normalizeCodexEvent('item/completed', {
        item: {
          id: 'exec_1',
          type: 'commandExecution',
          command: 'ls -la',
          output: 'ok',
          exitCode: 0,
        },
      })).toEqual([
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'exec_1',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'exec_1',
              name: 'Bash',
              input: { command: 'ls -la' },
            }],
          },
        }),
        withCodexSource({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'exec_1',
              content: 'ok',
              is_error: false,
            }],
          },
        }),
      ])
    })

    it('normalizes file changes into assistant/user replay pairs', () => {
      expect(normalizeCodexEvent('item/completed', {
        item: {
          id: 'edit_1',
          type: 'fileChange',
          filePath: '/tmp/demo.txt',
          patch: 'patched',
        },
      })).toEqual([
        withCodexSource({
          type: 'assistant',
          message: {
            id: 'edit_1',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'edit_1',
              name: 'Edit',
              input: {
                file_path: '/tmp/demo.txt',
                old_string: '',
                new_string: 'patched',
              },
            }],
          },
        }),
        withCodexSource({
          type: 'user',
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'edit_1',
              content: 'Applied',
            }],
          },
        }),
      ])
    })
  })

  describe('thread token usage updates', () => {
    it('normalizes tokenUsage payloads to total usage events', () => {
      const result = normalizeCodexEvent('thread/tokenUsage/updated', {
        threadId: 'thr_1',
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 45,
          totalCostUsd: 0.18,
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'message_delta',
          usage: {
            input_tokens: 120,
            output_tokens: 45,
          },
          usage_is_total: true,
          total_cost_usd: 0.18,
        }),
      )
    })

    it('accepts snake_case usage payloads', () => {
      const result = normalizeCodexEvent('thread/tokenUsage/updated', {
        usage: {
          input_tokens: 21,
          output_tokens: 9,
          total_cost_usd: 0.02,
        },
      })
      expect(result).toEqual(
        withCodexSource({
          type: 'message_delta',
          usage: {
            input_tokens: 21,
            output_tokens: 9,
          },
          usage_is_total: true,
          total_cost_usd: 0.02,
        }),
      )
    })

    it('returns null when usage fields are absent', () => {
      const result = normalizeCodexEvent('thread/tokenUsage/updated', {
        threadId: 'thr_1',
        tokenUsage: { limit: 1000 },
      })
      expect(result).toBeNull()
    })
  })
})
