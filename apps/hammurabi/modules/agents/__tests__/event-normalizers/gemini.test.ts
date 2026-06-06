import { describe, expect, it } from 'vitest'
import {
  createGeminiTurnState,
  mapGeminiPromptResponseToTranscriptEnvelopes,
  mapGeminiToTranscriptEnvelopes,
  normalizeGeminiPromptResponse,
  normalizeGeminiSessionUpdate,
} from '../../event-normalizers/gemini'

const GEMINI_SOURCE = {
  source: { provider: 'gemini', backend: 'acp' },
} as const

describe('agents/event-normalizers/gemini', () => {
  it('maps non-final Gemini tool updates into v2 tool.delta envelopes', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'tool_call_update',
      sessionId: 'gemini-session-1',
      toolCallId: 'tool-2',
      status: 'running',
      rawOutput: { progress: 'streaming' },
    }, state)).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        itemId: 'tool-2',
        source: expect.objectContaining({
          provider: 'gemini',
          backend: 'acp',
          sessionId: 'gemini-session-1',
          rawEventType: 'tool_call_update',
        }),
        ev: {
          type: 'tool.delta',
          toolCallId: 'tool-2',
          status: 'running',
          output: '{\n  "progress": "streaming"\n}',
          data: expect.objectContaining({ status: 'running' }),
        },
      }),
    ])
  })

  it('preserves unsupported Gemini updates and emits v2 prompt completion', () => {
    const state = createGeminiTurnState()

    expect(mapGeminiToTranscriptEnvelopes({
      sessionUpdate: 'session/error',
      sessionId: 'gemini-session-2',
      error: { message: 'boom' },
    }, state)).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({
          rawEventType: 'session/error',
        }),
        ev: {
          type: 'provider.activity',
          title: 'session/error',
          data: expect.objectContaining({
            error: { message: 'boom' },
          }),
        },
      }),
    ])

    expect(mapGeminiPromptResponseToTranscriptEnvelopes({
      stopReason: 'end_turn',
      usage: { inputTokens: 2, outputTokens: 3 },
    }, state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ev: {
          type: 'turn.end',
          status: 'ok',
          result: 'Turn completed',
          usage: { input_tokens: 2, output_tokens: 3 },
          error: undefined,
        },
      }),
    ]))
  })

  it('preserves malformed Gemini updates as provider.raw envelopes', () => {
    expect(mapGeminiToTranscriptEnvelopes('not-json-object', createGeminiTurnState())).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        source: expect.objectContaining({
          provider: 'gemini',
          backend: 'acp',
        }),
        ev: {
          type: 'provider.raw',
          payload: 'not-json-object',
        },
      }),
    ])
  })

  it('maps Gemini ACP streaming chunks into canonical delta events', () => {
    const state = createGeminiTurnState()

    expect(normalizeGeminiSessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'pondering' },
    }, state)).toEqual([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking' },
        ...GEMINI_SOURCE,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'pondering' },
        ...GEMINI_SOURCE,
      },
    ])

    expect(normalizeGeminiSessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'done' },
    }, state)).toEqual([
      {
        type: 'content_block_stop',
        index: 0,
        ...GEMINI_SOURCE,
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text' },
        ...GEMINI_SOURCE,
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'done' },
        ...GEMINI_SOURCE,
      },
    ])
  })

  it('maps tool calls and prompt completion into canonical events', () => {
    const state = createGeminiTurnState()

    expect(normalizeGeminiSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      kind: 'execute',
      title: 'Run shell command',
      rawInput: { command: 'pwd' },
    }, state)).toEqual([
      {
        type: 'assistant',
        message: {
          id: 'tool-1',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pwd' },
          }],
        },
        ...GEMINI_SOURCE,
      },
    ])

    expect(normalizeGeminiSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: { stdout: '/tmp/project' },
    }, state)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: '{\n  "stdout": "/tmp/project"\n}',
          is_error: false,
        }],
      },
      ...GEMINI_SOURCE,
    })

    expect(normalizeGeminiPromptResponse({
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    }, state)).toEqual([
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 4, output_tokens: 6 },
        ...GEMINI_SOURCE,
      },
      {
        type: 'message_stop',
        ...GEMINI_SOURCE,
      },
      {
        type: 'result',
        result: 'Turn completed',
        ...GEMINI_SOURCE,
      },
    ])
  })
})
