import { describe, expect, it } from 'vitest'
import { normalizeCodexEvent } from '../../event-normalizers/codex'
import type { StreamJsonEvent } from '../../types'
import { mapStreamEventsToMessages } from '../history'
import { MAX_CLIENT_MESSAGES } from '../model'

function assistantTextEvent(index: number): StreamJsonEvent {
  return {
    type: 'assistant',
    message: {
      id: `message-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text: `message ${index}` }],
    },
  }
}

describe('mapStreamEventsToMessages', () => {
  it('preserves server-side replay history beyond the client render cap', () => {
    const messageCount = MAX_CLIENT_MESSAGES + 25

    const messages = mapStreamEventsToMessages(
      Array.from({ length: messageCount }, (_, index) => assistantTextEvent(index)),
    )

    expect(messages).toHaveLength(messageCount)
    expect(messages[0]).toMatchObject({ kind: 'agent', text: 'message 0' })
    expect(messages[messageCount - 1]).toMatchObject({
      kind: 'agent',
      text: `message ${messageCount - 1}`,
    })
  })

  it('renders Claude signed empty thinking through the backend projection contract', () => {
    const signature = 'A'.repeat(464)

    const messages = mapStreamEventsToMessages([{
      type: 'assistant',
      source: { provider: 'claude', backend: 'cli' },
      message: {
        id: 'claude-thinking',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '', signature }],
      },
    }])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
      }),
    ])
  })

  it('projects user display text without leaking provider-bound workspace context', () => {
    const messages = mapStreamEventsToMessages([{
      type: 'user',
      subtype: 'queued_message',
      displayText: 'Use this context.',
      message: {
        role: 'user',
        content: '<workspace-files>\n@README.md\n</workspace-files>\nUse this context.',
      },
    } as StreamJsonEvent])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Use this context.',
      }),
    ])
    expect(messages[0]?.text).not.toContain('<workspace-')
  })

  it('dedupes queued user echoes separated by provider status activity', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'repeat-safe prompt',
        },
      },
      {
        schemaVersion: 2,
        id: 'env-status-between-user-echoes',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'repeat-safe prompt',
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'user', text: 'repeat-safe prompt' }),
      expect.objectContaining({ kind: 'provider', text: 'Thread status changed' }),
    ])
  })

  it('dedupes queued user echoes separated by an empty Codex turn placeholder', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'status',
        },
      },
      {
        schemaVersion: 2,
        id: 'env-status-active',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
        ev: { type: 'provider.activity', title: 'Thread status changed' },
      },
      {
        schemaVersion: 2,
        id: 'env-empty-turn-start',
        time: '2026-05-29T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
        turnId: 'turn-status',
        ev: { type: 'message.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-user-start',
        time: '2026-05-29T00:00:02.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-status',
        itemId: 'user-status',
        ev: {
          type: 'provider.activity',
          title: 'User message item started',
          detail: 'userMessage',
        },
      },
      {
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'status',
        },
      },
    ] as StreamJsonEvent[])

    const statusMessages = messages.filter((message) => (
      message.kind === 'user' && message.text === 'status'
    ))
    expect(statusMessages).toHaveLength(1)
  })

  it('merges Codex completed reasoning into the active thinking row', () => {
    const started = normalizeCodexEvent('item/started', {
      item: { id: 'reasoning-1', type: 'reasoning' },
    })
    const completed = normalizeCodexEvent('item/completed', {
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        summary: ['Final completed reasoning'],
      },
    })

    const messages = mapStreamEventsToMessages([
      started as StreamJsonEvent,
      completed as StreamJsonEvent,
    ])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'Final completed reasoning',
      }),
    ])
  })

  it('renders Gemini and OpenCode canonical stream events without provider branching', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'content_block_start',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
        delta: { type: 'text_delta', text: 'Gemini says hi' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'gemini', backend: 'acp' },
        index: 0,
      },
      {
        type: 'content_block_start',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        content_block: { type: 'thinking' },
      },
      {
        type: 'content_block_delta',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
        delta: { type: 'thinking_delta', thinking: 'OpenCode thought' },
      },
      {
        type: 'content_block_stop',
        source: { provider: 'opencode', backend: 'acp' },
        index: 1,
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'agent', text: 'Gemini says hi' }),
      expect.objectContaining({ kind: 'thinking', text: 'OpenCode thought' }),
    ])
  })

  it('keeps unknown-provider thinking fallback safe and text-only', () => {
    const messages = mapStreamEventsToMessages([
      {
        type: 'assistant',
        source: { provider: 'test-provider', backend: 'cli' },
        message: {
          id: 'unknown-thinking',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'visible fallback' },
            { type: 'thinking', thinking: '' },
          ],
        },
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({ kind: 'thinking', text: 'visible fallback' }),
    ])
  })

  it('projects v2 transcript envelopes through the same reducer path as live events', () => {
    const messages = mapStreamEventsToMessages([
      {
        schemaVersion: 2,
        id: 'env-turn-start',
        time: '2026-05-27T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
        turnId: 'turn-1',
        ev: { type: 'turn.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-message-start',
        time: '2026-05-27T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-1',
        itemId: 'msg-1',
        ev: { type: 'message.start', role: 'assistant' },
      },
      {
        schemaVersion: 2,
        id: 'env-message-delta',
        time: '2026-05-27T00:00:02.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-1',
        itemId: 'msg-1',
        ev: { type: 'message.delta', text: 'Transcript v2 says hi', channel: 'final' },
      },
      {
        schemaVersion: 2,
        id: 'env-tool-start',
        time: '2026-05-27T00:00:03.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
        turnId: 'turn-1',
        itemId: 'tool-1',
        ev: { type: 'tool.start', toolCallId: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
      },
      {
        schemaVersion: 2,
        id: 'env-tool-delta',
        time: '2026-05-27T00:00:04.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/commandExecution/outputDelta' },
        turnId: 'turn-1',
        itemId: 'tool-1',
        ev: { type: 'tool.delta', toolCallId: 'tool-1', output: '/tmp/project\n', status: 'running' },
      },
      {
        schemaVersion: 2,
        id: 'env-provider-raw',
        time: '2026-05-27T00:00:05.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/custom' },
        turnId: 'turn-1',
        ev: { type: 'provider.raw', method: 'thread/custom', payload: { keep: true } },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'Transcript v2 says hi',
        transcript: expect.objectContaining({
          source: expect.objectContaining({ provider: 'codex', backend: 'rpc' }),
          itemId: 'msg-1',
        }),
      }),
      expect.objectContaining({
        kind: 'tool',
        toolName: 'Bash',
        toolInput: 'pwd',
        toolOutput: '/tmp/project\n',
        transcript: expect.objectContaining({
          itemId: 'tool-1',
          providerEventType: 'item/commandExecution/outputDelta',
        }),
      }),
      expect.objectContaining({
        kind: 'provider',
        text: 'codex raw: thread/custom',
        transcript: expect.objectContaining({
          providerPayload: { keep: true },
        }),
      }),
    ])
  })

  it('projects persisted legacy Codex raw delta envelopes as agent messages', () => {
    const messages = mapStreamEventsToMessages([
      {
        schemaVersion: 2,
        id: 'env-legacy-delta-1',
        time: '2026-05-29T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-legacy',
        itemId: 'msg-legacy',
        ev: {
          type: 'provider.raw',
          method: 'item/agentMessage/delta',
          payload: { delta: 'Final ' },
        },
      },
      {
        schemaVersion: 2,
        id: 'env-legacy-delta-2',
        time: '2026-05-29T00:00:01.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
        turnId: 'turn-legacy',
        itemId: 'msg-legacy',
        ev: {
          type: 'provider.raw',
          method: 'item/agentMessage/delta',
          payload: { delta: 'answer' },
        },
      },
    ] as StreamJsonEvent[])

    expect(messages).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'Final answer',
      }),
    ])
  })
})
