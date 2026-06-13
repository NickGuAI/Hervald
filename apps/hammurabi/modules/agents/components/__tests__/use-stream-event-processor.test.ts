// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '@/types'
import type { MsgItem } from '../session-messages'
import { normalizeClaudeEvent } from '../../event-normalizers/claude'
import { mapCodexToTranscriptEnvelopes } from '../../event-normalizers/codex'
import {
  createOpenCodeTurnState,
  mapOpenCodePromptResponseToTranscriptEnvelopes,
  mapOpenCodeToTranscriptEnvelopes,
} from '../../event-normalizers/opencode'
import { bridgeLegacyEventToTranscriptEnvelopes } from '../../transcript-legacy-bridge'
import { useStreamEventProcessor } from '../use-stream-event-processor'

type Harness = {
  cleanup: () => void
  hydrateReplayMessages: (messages: MsgItem[], replayEvents: StreamEvent[]) => void
  dispatchReplayEvent: (event: StreamEvent) => void
  dispatchLiveEvent: (event: StreamEvent) => void
  getMessages: () => MsgItem[]
  getIsStreaming: () => boolean
}

function createHarness(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root: Root = createRoot(container)
  let processEventRef: ((event: StreamEvent, isReplay?: boolean) => void) | undefined
  let hydrateReplayMessagesRef: ((messages: MsgItem[], replayEvents: StreamEvent[]) => void) | undefined
  let messagesRef: MsgItem[] = []
  let isStreamingRef = false

  function HarnessComponent() {
    const { hydrateReplayMessages, isStreaming, processEvent, messages } = useStreamEventProcessor()
    processEventRef = processEvent
    hydrateReplayMessagesRef = hydrateReplayMessages
    messagesRef = messages
    isStreamingRef = isStreaming
    return null
  }

  flushSync(() => {
    root.render(createElement(HarnessComponent))
  })

  if (!processEventRef) {
    throw new Error('expected stream event processor hook to initialize')
  }

  return {
    hydrateReplayMessages(messages: MsgItem[], replayEvents: StreamEvent[]) {
      if (!hydrateReplayMessagesRef) {
        throw new Error('expected replay hydrator to initialize')
      }
      flushSync(() => {
        hydrateReplayMessagesRef!(messages, replayEvents)
      })
    },
    dispatchReplayEvent(event: StreamEvent) {
      flushSync(() => {
        processEventRef!(event, true)
      })
    },
    dispatchLiveEvent(event: StreamEvent) {
      flushSync(() => {
        processEventRef!(event, false)
      })
    },
    getMessages() {
      return messagesRef
    },
    getIsStreaming() {
      return isStreamingRef
    },
    cleanup() {
      flushSync(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function replayUserText(text: string): StreamEvent {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
  }
}

const codexSource = {
  provider: 'codex' as const,
  backend: 'rpc' as const,
}

function dispatchBridgedClaudeReplayEvent(
  harness: Harness,
  event: { type: string; [key: string]: unknown },
) {
  const normalized = normalizeClaudeEvent(event as never)
  const normalizedEvents = normalized === null
    ? []
    : (Array.isArray(normalized) ? normalized : [normalized])
  for (const normalizedEvent of normalizedEvents) {
    for (const envelope of bridgeLegacyEventToTranscriptEnvelopes(normalizedEvent as never)) {
      harness.dispatchReplayEvent(envelope as StreamEvent)
    }
  }
}

describe('useStreamEventProcessor assistant tail-repeat handling', () => {
  it('appends late Codex item/agentMessage/delta chunks to the finalized assistant message', () => {
    const harness = createHarness()
    const baseParams = {
      threadId: 'thread-codex-tail',
      turnId: 'turn-codex-tail',
      itemId: 'msg-codex-tail',
    }
    const replayEvents = [
      ...mapCodexToTranscriptEnvelopes('item/started', {
        threadId: baseParams.threadId,
        turnId: baseParams.turnId,
        item: { id: baseParams.itemId, type: 'agentMessage' },
      }),
      ...mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
        ...baseParams,
        delta: 'Codex final ',
      }),
      ...mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: baseParams.threadId,
        turnId: baseParams.turnId,
        item: { id: baseParams.itemId, type: 'agentMessage' },
      }),
    ] as StreamEvent[]
    const lateDelta = mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
      ...baseParams,
      delta: 'tail',
    })[0] as StreamEvent

    for (const event of replayEvents) {
      harness.dispatchLiveEvent(event)
    }
    expect(harness.getIsStreaming()).toBe(false)

    harness.dispatchLiveEvent(lateDelta)

    const agentMessages = harness.getMessages().filter((message) => message.kind === 'agent')
    expect(agentMessages).toHaveLength(1)
    expect(agentMessages[0]?.text).toBe('Codex final tail')
    expect(harness.getIsStreaming()).toBe(false)

    harness.cleanup()
  })

  it('hydrates projected replay messages without creating a second tail-only live block', () => {
    const harness = createHarness()
    const baseParams = {
      threadId: 'thread-hydrated-tail',
      turnId: 'turn-hydrated-tail',
      itemId: 'msg-hydrated-tail',
    }
    const replayEvents = [
      ...mapCodexToTranscriptEnvelopes('item/started', {
        threadId: baseParams.threadId,
        turnId: baseParams.turnId,
        item: { id: baseParams.itemId, type: 'agentMessage' },
      }),
      ...mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
        ...baseParams,
        delta: 'Hydrated answer',
      }),
      ...mapCodexToTranscriptEnvelopes('item/completed', {
        threadId: baseParams.threadId,
        turnId: baseParams.turnId,
        item: { id: baseParams.itemId, type: 'agentMessage' },
      }),
    ] as StreamEvent[]
    const projectedMessages: MsgItem[] = [{
      id: 'msg-1',
      kind: 'agent',
      text: 'Hydrated answer',
    }]

    harness.hydrateReplayMessages(projectedMessages, replayEvents)
    harness.dispatchLiveEvent(mapCodexToTranscriptEnvelopes('item/agentMessage/delta', {
      ...baseParams,
      delta: ' tail',
    })[0] as StreamEvent)

    const agentMessages = harness.getMessages().filter((message) => message.kind === 'agent')
    expect(agentMessages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        text: 'Hydrated answer tail',
      }),
    ])

    harness.cleanup()
  })

  it('appends late Claude bridged content_block_delta text to the existing assistant block', () => {
    const harness = createHarness()
    const events = [
      ...bridgeLegacyEventToTranscriptEnvelopes({
        type: 'content_block_start',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
        content_block: { type: 'text' },
      }),
      ...bridgeLegacyEventToTranscriptEnvelopes({
        type: 'content_block_delta',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
        delta: { type: 'text_delta', text: 'Claude final ' },
      }),
      ...bridgeLegacyEventToTranscriptEnvelopes({
        type: 'content_block_stop',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
      }),
      ...bridgeLegacyEventToTranscriptEnvelopes({
        type: 'content_block_delta',
        source: { provider: 'claude', backend: 'cli' },
        index: 0,
        delta: { type: 'text_delta', text: 'tail' },
      }),
    ] as StreamEvent[]

    for (const event of events) {
      harness.dispatchLiveEvent(event)
    }

    const agentMessages = harness.getMessages().filter((message) => message.kind === 'agent')
    expect(agentMessages).toHaveLength(1)
    expect(agentMessages[0]?.text).toBe('Claude final tail')

    harness.cleanup()
  })

  it('appends late OpenCode agent_message_chunk text to the completed chunk block', () => {
    const harness = createHarness()
    const state = createOpenCodeTurnState()
    const firstChunk = mapOpenCodeToTranscriptEnvelopes({
      sessionUpdate: 'agent_message_chunk',
      sessionId: 'opencode-tail-session',
      content: { type: 'text', text: 'OpenCode final ' },
    }, state)
    const completion = mapOpenCodePromptResponseToTranscriptEnvelopes({
      stopReason: 'end_turn',
    }, state)
    const lateChunk = mapOpenCodeToTranscriptEnvelopes({
      sessionUpdate: 'agent_message_chunk',
      sessionId: 'opencode-tail-session',
      content: { type: 'text', text: 'tail' },
    }, state)

    for (const event of [...firstChunk, ...completion, ...lateChunk] as StreamEvent[]) {
      harness.dispatchLiveEvent(event)
    }

    const agentMessages = harness.getMessages().filter((message) => message.kind === 'agent')
    expect(agentMessages).toHaveLength(1)
    expect(agentMessages[0]?.text).toBe('OpenCode final tail')

    harness.cleanup()
  })
})

describe('useStreamEventProcessor replay user handling', () => {
  it('renders live v2 transcript envelopes with tool and provider activity state', () => {
    const harness = createHarness()

    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-msg-start',
      time: '2026-05-27T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
      turnId: 'turn-live-1',
      itemId: 'msg-live-1',
      ev: { type: 'message.start', role: 'assistant' },
    })
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-msg-delta',
      time: '2026-05-27T00:00:01.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
      turnId: 'turn-live-1',
      itemId: 'msg-live-1',
      ev: { type: 'message.delta', text: 'live transcript envelope', channel: 'final' },
    })
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-tool-start',
      time: '2026-05-27T00:00:02.000Z',
      source: { provider: 'opencode', backend: 'acp', rawEventType: 'tool_call' },
      turnId: 'turn-live-1',
      itemId: 'tool-live-1',
      ev: { type: 'tool.start', toolCallId: 'tool-live-1', name: 'read', input: { path: 'README.md' } },
    })
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-provider-raw',
      time: '2026-05-27T00:00:03.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/custom' },
      turnId: 'turn-live-1',
      ev: { type: 'provider.raw', method: 'thread/custom', payload: { future: true } },
    })

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'live transcript envelope',
        transcript: expect.objectContaining({
          source: expect.objectContaining({ provider: 'codex' }),
          itemId: 'msg-live-1',
        }),
      }),
      expect.objectContaining({
        kind: 'tool',
        toolName: 'read',
        toolStatus: 'running',
        transcript: expect.objectContaining({
          source: expect.objectContaining({ provider: 'opencode' }),
          itemId: 'tool-live-1',
        }),
      }),
      expect.objectContaining({
        kind: 'provider',
        text: 'codex raw: thread/custom',
      }),
    ])

    harness.cleanup()
  })

  it('renders bridged Claude Code Agent child events under the Agent block', () => {
    const harness = createHarness()

    dispatchBridgedClaudeReplayEvent(harness, {
      type: 'assistant',
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
    dispatchBridgedClaudeReplayEvent(harness, {
      type: 'system',
      subtype: 'task_progress',
      tool_use_id: 'toolu_parent',
      task_id: 'task-1',
      subagent_type: 'general-purpose',
      task_description: 'Investigate flaky chat rendering',
      description: 'Running nested investigation',
      last_tool_name: 'Read',
    })
    dispatchBridgedClaudeReplayEvent(harness, {
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'assistant-child-tool',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_child',
          name: 'Read',
          input: { file_path: 'apps/hammurabi/README.md' },
        }],
      },
    })
    dispatchBridgedClaudeReplayEvent(harness, {
      type: 'user',
      parent_tool_use_id: 'toolu_parent',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_child', content: 'file contents' }],
      },
    })
    dispatchBridgedClaudeReplayEvent(harness, {
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'assistant-child-text',
        role: 'assistant',
        content: [{ type: 'text', text: 'Nested answer after tool result.' }],
      },
    })

    const messages = harness.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(expect.objectContaining({
      kind: 'tool',
      toolId: 'toolu_parent',
      toolName: 'Agent',
      subagentDescription: 'Investigate flaky chat rendering',
      transcript: expect.objectContaining({ subagentId: 'toolu_parent' }),
    }))
    expect(messages[0]?.children).toEqual([
      expect.objectContaining({
        kind: 'provider',
        text: 'Running nested investigation [Read]',
        transcript: expect.objectContaining({
          subagentId: 'toolu_parent',
          providerPayload: expect.objectContaining({
            subtype: 'task_progress',
            tool_use_id: 'toolu_parent',
            task_id: 'task-1',
          }),
        }),
      }),
      expect.objectContaining({
        kind: 'tool',
        toolId: 'toolu_child',
        toolName: 'Read',
        toolStatus: 'success',
        toolFile: 'apps/hammurabi/README.md',
        toolOutput: 'file contents',
        transcript: expect.objectContaining({ subagentId: 'toolu_parent' }),
      }),
      expect.objectContaining({
        kind: 'agent',
        text: 'Nested answer after tool result.',
        transcript: expect.objectContaining({ subagentId: 'toolu_parent' }),
      }),
    ])

    harness.cleanup()
  })

  it('promotes legacy Codex raw agentMessage delta envelopes into assistant chat text', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-legacy-raw-delta-1',
      time: '2026-05-29T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
      turnId: 'turn-legacy-1',
      itemId: 'msg-legacy-1',
      ev: {
        type: 'provider.raw',
        method: 'item/agentMessage/delta',
        payload: { delta: 'Final ' },
      },
    })
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-legacy-raw-delta-2',
      time: '2026-05-29T00:00:01.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
      turnId: 'turn-legacy-1',
      itemId: 'msg-legacy-1',
      ev: {
        type: 'provider.raw',
        method: 'item/agentMessage/delta',
        payload: { delta: 'answer' },
      },
    })

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'agent',
        text: 'Final answer',
      }),
    ])

    harness.cleanup()
  })

  it('suppresses internal Agent replay prompts while preserving human user messages', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent(replayUserText('human message before tool'))

    harness.dispatchReplayEvent({
      type: 'assistant',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-agent-1',
            name: 'Agent',
            input: { description: 'Very thorough exploration of the Gehirn site app.' },
          },
        ],
      },
    })

    harness.dispatchReplayEvent(replayUserText('Very thorough exploration of the Gehirn site app.'))

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-agent-1', content: 'done' }],
      },
    })

    harness.dispatchReplayEvent(replayUserText('human message after tool'))

    const allMessages = harness.getMessages()
    const userTexts = allMessages
      .filter((msg) => msg.kind === 'user')
      .map((msg) => msg.text)

    expect(userTexts).toEqual(['human message before tool', 'human message after tool'])

    const agentTool = allMessages.find(
      (msg) => msg.kind === 'tool' && msg.toolName === 'Agent' && msg.toolId === 'tool-agent-1',
    )
    expect(agentTool?.subagentDescription).toBe('Very thorough exploration of the Gehirn site app.')
    expect(agentTool?.toolStatus).toBe('success')

    harness.cleanup()
  })

  it('keeps replayed text/image user envelopes once Agent tool result clears active state', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'assistant',
      message: {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-agent-2',
            name: 'Agent',
            input: { description: 'Analyze screenshot' },
          },
        ],
      },
    })

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'internal subagent prompt' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'internal-image' },
          },
        ],
      },
    })

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-agent-2', content: 'complete' }],
      },
    })

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'human message with screenshot' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      },
    })

    const userMessages = harness.getMessages().filter((msg) => msg.kind === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]).toMatchObject({
      text: 'human message with screenshot',
      images: [{ mediaType: 'image/png', data: 'abc123' }],
    })

    harness.cleanup()
  })

  it('normalizes assistant image blocks into agent message images during replay and live processing', () => {
    const harness = createHarness()
    const makeAssistantImageEvent = (
      id: string,
      text: string,
      mediaType: string,
      data: string,
    ): StreamEvent => ({
      type: 'assistant',
      message: {
        id,
        role: 'assistant',
        content: [
          { type: 'text', text },
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data },
          },
        ],
      },
    } as StreamEvent)

    harness.dispatchReplayEvent(makeAssistantImageEvent(
      'assistant-image-replay',
      'Replay chart ready',
      'image/png',
      'replay-image-base64',
    ))
    harness.dispatchLiveEvent(makeAssistantImageEvent(
      'assistant-image-live',
      'Live chart ready',
      'image/webp',
      'live-image-base64',
    ))

    const agentMessages = harness.getMessages().filter((msg) => msg.kind === 'agent')
    expect(agentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'agent',
        text: 'Replay chart ready',
      }),
      expect.objectContaining({
        kind: 'agent',
        text: 'Live chart ready',
      }),
      expect.objectContaining({
        kind: 'agent',
        images: [{ mediaType: 'image/png', data: 'replay-image-base64' }],
      }),
      expect.objectContaining({
        kind: 'agent',
        images: [{ mediaType: 'image/webp', data: 'live-image-base64' }],
      }),
    ]))

    harness.cleanup()
  })

  it('normalizes image payloads from v2 tool and provider transcript events', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-tool-start-image',
      time: '2026-05-27T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/started' },
      itemId: 'tool-image-1',
      ev: {
        type: 'tool.start',
        toolCallId: 'tool-image-1',
        name: 'GenerateImage',
        input: { prompt: 'chart' },
      },
    })
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-tool-end-image',
      time: '2026-05-27T00:00:01.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/completed' },
      itemId: 'tool-image-1',
      ev: {
        type: 'tool.end',
        toolCallId: 'tool-image-1',
        status: 'ok',
        result: {
          content: [{
            type: 'image',
            alt: 'tool chart',
            source: { media_type: 'image/png', data: 'tool-result-image' },
          }],
        },
      },
    })
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-provider-raw-image',
      time: '2026-05-27T00:00:02.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/generated' },
      ev: {
        type: 'provider.raw',
        method: 'item/generated',
        payload: {
          item: {
            content: [{
              type: 'output_image',
              alt: 'raw generated image',
              image_url: 'https://example.test/generated.webp',
            }],
          },
        },
      },
    })
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-provider-activity-image',
      time: '2026-05-27T00:00:03.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'artifact/ready' },
      ev: {
        type: 'provider.activity',
        title: 'Artifact ready',
        data: {
          images: [{
            alt: 'artifact chart',
            url: '/api/workspace/raw?path=charts%2Fartifact.png',
          }],
        },
      },
    })

    const agentImages = harness
      .getMessages()
      .filter((msg) => msg.kind === 'agent')
      .flatMap((msg) => msg.images ?? [])

    expect(agentImages).toEqual(expect.arrayContaining([
      { mediaType: 'image/png', data: 'tool-result-image', alt: 'tool chart' },
      { url: 'https://example.test/generated.webp', alt: 'raw generated image' },
      { url: '/api/workspace/raw?path=charts%2Fartifact.png', alt: 'artifact chart' },
    ]))

    harness.cleanup()
  })

  it('normalizes structured legacy tool result images into agent attachments', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'assistant',
      message: {
        id: 'assistant-tool-image',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-image-legacy',
          name: 'GenerateImage',
          input: { prompt: 'chart' },
        }],
      },
    })
    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-image-legacy',
          content: JSON.stringify({
            content: [{
              type: 'image',
              alt: 'legacy tool chart',
              source: { media_type: 'image/jpeg', data: 'legacy-tool-result-image' },
            }],
          }),
        }],
      },
    })

    expect(harness.getMessages()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool',
        toolName: 'GenerateImage',
        toolStatus: 'success',
      }),
      expect.objectContaining({
        kind: 'agent',
        images: [{
          mediaType: 'image/jpeg',
          data: 'legacy-tool-result-image',
          alt: 'legacy tool chart',
        }],
      }),
    ]))

    harness.cleanup()
  })

  it('stores replayed planning events as distinct planning messages', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({ type: 'planning', action: 'enter' })
    harness.dispatchReplayEvent({
      type: 'planning',
      action: 'proposed',
      plan: '1. Inspect the failing route\n2. Patch the handler\n3. Run tests',
    })
    harness.dispatchReplayEvent({
      type: 'planning',
      action: 'decision',
      approved: false,
      message: 'Need one more regression test before proceeding.',
    })

    const planningMessages = harness
      .getMessages()
      .filter((msg) => msg.kind === 'planning')

    expect(planningMessages).toEqual([
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'enter',
      }),
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'proposed',
        planningPlan: '1. Inspect the failing route\n2. Patch the handler\n3. Run tests',
        text: '1. Inspect the failing route\n2. Patch the handler\n3. Run tests',
      }),
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'decision',
        planningApproved: false,
        planningMessage: 'Need one more regression test before proceeding.',
        text: 'Need one more regression test before proceeding.',
      }),
    ])

    harness.cleanup()
  })

  it('stores replayed plan approval events as unanswered ask messages', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'plan_approval',
      interactionKind: 'plan_approval',
      toolId: 'plan-exit',
      toolName: 'ExitPlanMode',
      plan: '1. Normalize plan proposal\n2. Wait for approval',
      approveLabel: 'Approve',
      rejectLabel: 'Reject',
      customResponseLabel: 'Add response',
      providerContext: {
        provider: 'claude',
        backend: 'cli',
        toolUseId: 'plan-exit',
        toolName: 'ExitPlanMode',
        answerFormat: 'claude.exit_plan_mode',
      },
    })

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'ask',
        toolId: 'plan-exit',
        toolName: 'ExitPlanMode',
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: '1. Normalize plan proposal\n2. Wait for approval',
      }),
    ])

    harness.cleanup()
  })

  it('keeps waiting queued messages out of the transcript', () => {
    const harness = createHarness()

    harness.dispatchLiveEvent({
      type: 'queue_update',
      queue: {
        currentMessage: {
          id: 'queue-current',
          text: 'queued message currently waiting on transport',
          priority: 'high',
          queuedAt: '2026-05-19T00:00:00.000Z',
        },
        items: [
          {
            id: 'queue-backlog',
            text: 'queued backlog message',
            priority: 'normal',
            queuedAt: '2026-05-19T00:00:01.000Z',
          },
        ],
        maxSize: 8,
        totalCount: 2,
      },
    })

    expect(harness.getMessages()).toEqual([])

    harness.cleanup()
  })

  it('renders delivered queued_message user events live without requiring replay', () => {
    const harness = createHarness()

    harness.dispatchLiveEvent({
      type: 'user',
      subtype: 'queued_message',
      message: {
        role: 'user',
        content: 'queued follow-up that actually started',
      },
    })

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'queued follow-up that actually started',
      }),
    ])

    harness.cleanup()
  })

  it('renders delivered queued_message user events during replay', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'user',
      subtype: 'queued_message',
      message: {
        role: 'user',
        content: 'replayed queued follow-up',
      },
    })

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'replayed queued follow-up',
      }),
    ])

    harness.cleanup()
  })

  it('does not render duplicate queued_message user echoes', () => {
    const harness = createHarness()
    const event: StreamEvent = {
      type: 'user',
      subtype: 'queued_message',
      message: {
        role: 'user',
        content: 'queued follow-up that actually started',
      },
    }

    harness.dispatchReplayEvent(event)
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-status-between-user-echoes',
      time: '2026-05-29T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
      ev: { type: 'provider.activity', title: 'Thread status changed' },
    })
    harness.dispatchLiveEvent(event)
    harness.dispatchLiveEvent(event)

    const queuedUserMessages = harness.getMessages().filter((message) => (
      message.kind === 'user' && message.text === 'queued follow-up that actually started'
    ))
    expect(queuedUserMessages).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'queued follow-up that actually started',
      }),
    ])
    expect(harness.getMessages()).toEqual([
      expect.objectContaining({ kind: 'user' }),
      expect.objectContaining({ kind: 'provider', text: 'Thread status changed' }),
    ])

    harness.cleanup()
  })

  it('does not render duplicate queued_message echoes across an empty Codex turn placeholder', () => {
    const harness = createHarness()
    const event: StreamEvent = {
      type: 'user',
      subtype: 'queued_message',
      message: {
        role: 'user',
        content: 'status',
      },
    }

    harness.dispatchLiveEvent(event)
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-status-active',
      time: '2026-05-29T00:00:00.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'thread/status/changed' },
      ev: { type: 'provider.activity', title: 'Thread status changed' },
    })
    harness.dispatchLiveEvent({
      schemaVersion: 2,
      id: 'env-empty-turn-start',
      time: '2026-05-29T00:00:01.000Z',
      source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
      turnId: 'turn-status',
      ev: { type: 'message.start', role: 'assistant' },
    })
    harness.dispatchLiveEvent({
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
    })
    harness.dispatchLiveEvent(event)

    const statusMessages = harness.getMessages().filter((message) => (
      message.kind === 'user' && message.text === 'status'
    ))
    expect(statusMessages).toHaveLength(1)

    harness.cleanup()
  })

  it('dedupes optimistic, live echo, and historical image prompts by client send id across a tool row', () => {
    const harness = createHarness()
    const clientSendId = 'send-image-123'
    const imageEvent = (data: string): StreamEvent => ({
      type: 'user',
      subtype: 'queued_message',
      clientSendId,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Generate a visual summary' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data,
            },
          },
        ],
      },
    } as StreamEvent)

    harness.hydrateReplayMessages([
      {
        id: 'optimistic-image',
        kind: 'user',
        text: 'Generate a visual summary',
        clientSendId,
        images: [{ mediaType: 'image/png', data: 'optimistic-image-data' }],
      },
      {
        id: 'separating-tool',
        kind: 'tool',
        text: '',
        toolId: 'tool-between-image-echoes',
        toolName: 'Bash',
        toolStatus: 'running',
      },
    ], [])
    harness.dispatchLiveEvent(imageEvent('live-echo-image-data'))
    harness.dispatchReplayEvent(imageEvent('historical-image-data'))

    const imageUserMessages = harness.getMessages().filter((message) => (
      message.kind === 'user'
      && message.clientSendId === clientSendId
      && (message.images?.length ?? 0) > 0
    ))
    expect(imageUserMessages).toEqual([
      expect.objectContaining({
        id: 'optimistic-image',
        kind: 'user',
        text: 'Generate a visual summary',
        images: [{ mediaType: 'image/png', data: 'optimistic-image-data' }],
      }),
    ])
    expect(harness.getMessages().filter((message) => message.kind === 'tool')).toHaveLength(1)

    harness.cleanup()
  })

  it('does not render Codex reflected userMessage item images as agent images', () => {
    const harness = createHarness()
    const clientSendId = 'send-image-reflection-1709'
    const reflectedUserMessageItem = {
      id: 'codex-user-reflection',
      type: 'userMessage',
      input: [
        {
          type: 'image',
          url: 'data:image/png;base64,reflected-provider-image',
        },
      ],
    }

    harness.dispatchLiveEvent({
      type: 'user',
      subtype: 'queued_message',
      clientSendId,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this screenshot' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'synthetic-user-image',
            },
          },
        ],
      },
    } as StreamEvent)

    for (const [id, rawEventType, title] of [
      ['env-codex-user-start', 'item/started', 'User message item started'],
      ['env-codex-user-complete', 'item/completed', 'userMessage completed'],
    ] as const) {
      harness.dispatchLiveEvent({
        schemaVersion: 2,
        id,
        time: '2026-06-12T00:00:00.000Z',
        source: { provider: 'codex', backend: 'rpc', rawEventType },
        turnId: 'turn-codex-reflection',
        itemId: reflectedUserMessageItem.id,
        ev: {
          type: 'provider.activity',
          title,
          detail: 'userMessage',
          data: reflectedUserMessageItem,
        },
      })
    }

    const imageMessages = harness.getMessages().filter((message) => (
      (message.images?.length ?? 0) > 0
    ))
    expect(imageMessages).toEqual([
      expect.objectContaining({
        kind: 'user',
        clientSendId,
        images: [{ mediaType: 'image/png', data: 'synthetic-user-image' }],
      }),
    ])
    expect(harness.getMessages().filter((message) => (
      message.kind === 'agent' && (message.images?.length ?? 0) > 0
    ))).toHaveLength(0)

    harness.cleanup()
  })

  it('preserves repeated queued_message text after an assistant response', () => {
    const harness = createHarness()
    const event: StreamEvent = {
      type: 'user',
      subtype: 'queued_message',
      message: {
        role: 'user',
        content: 'same follow-up after reply',
      },
    }

    harness.dispatchReplayEvent(event)
    harness.dispatchLiveEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant reply separates turns' }],
      },
    })
    harness.dispatchLiveEvent(event)

    const repeatedUserMessages = harness.getMessages().filter((message) => (
      message.kind === 'user' && message.text === 'same follow-up after reply'
    ))
    expect(repeatedUserMessages).toHaveLength(2)

    harness.cleanup()
  })

  it('renders v2 bridged plan approval requests as answerable asks', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-plan-approval',
      time: '2026-05-27T00:00:00.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'plan_approval' },
      itemId: 'plan-1',
      ev: {
        type: 'approval.request',
        toolCallId: 'plan-1',
        interactionKind: 'plan_approval',
        prompt: '1. Inspect\n2. Patch',
        request: {
          interactionKind: 'plan_approval',
          toolName: 'ExitPlanMode',
          approveLabel: 'Approve',
          rejectLabel: 'Reject',
          customResponseLabel: 'Respond',
        },
      },
    } as StreamEvent)

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        kind: 'ask',
        toolId: 'plan-1',
        toolName: 'ExitPlanMode',
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: '1. Inspect\n2. Patch',
        planApprovalApproveLabel: 'Approve',
        planApprovalRejectLabel: 'Reject',
        planApprovalCustomResponseLabel: 'Respond',
      }),
    ])

    harness.cleanup()
  })

  it('keeps bridged v2 Claude thinking deltas on one reasoning row', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-thinking-1',
      time: '2026-05-27T00:00:00.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'content_block_delta' },
      itemId: 'content-block-0',
      ev: { type: 'thinking.delta', text: 'first ' },
    } as StreamEvent)
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-thinking-2',
      time: '2026-05-27T00:00:01.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'content_block_delta' },
      itemId: 'content-block-0',
      ev: { type: 'thinking.delta', text: 'second' },
    } as StreamEvent)

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'first second',
        transcript: expect.objectContaining({
          itemId: 'content-block-0',
          source: expect.objectContaining({ provider: 'claude' }),
        }),
      }),
    ])

    harness.cleanup()
  })

  it('preserves bridged v2 Claude planning enter, proposal, and decision semantics', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-plan-enter',
      time: '2026-05-27T00:00:00.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'planning' },
      ev: { type: 'plan.update', plan: { action: 'enter' } },
    } as StreamEvent)
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-plan-proposed',
      time: '2026-05-27T00:00:01.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'planning' },
      itemId: 'plan-tool',
      ev: {
        type: 'plan.update',
        plan: { action: 'proposed', plan: '1. Patch\n2. Test' },
        toolCallId: 'plan-tool',
      },
    } as StreamEvent)
    harness.dispatchReplayEvent({
      schemaVersion: 2,
      id: 'env-plan-decision',
      time: '2026-05-27T00:00:02.000Z',
      source: { provider: 'claude', backend: 'cli', rawEventType: 'planning' },
      itemId: 'plan-tool',
      ev: {
        type: 'plan.update',
        plan: {
          action: 'decision',
          approved: false,
          message: 'Need one more regression test before proceeding.',
        },
        toolCallId: 'plan-tool',
      },
    } as StreamEvent)

    expect(harness.getMessages().filter((msg) => msg.kind === 'planning')).toEqual([
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'enter',
      }),
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'proposed',
        planningPlan: '1. Patch\n2. Test',
      }),
      expect.objectContaining({
        kind: 'planning',
        planningAction: 'decision',
        planningApproved: false,
        planningMessage: 'Need one more regression test before proceeding.',
      }),
    ])

    harness.cleanup()
  })

  it('maps raw Claude plan-mode tool traffic into planning messages instead of generic tool badges', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'plan-enter-tool',
        name: 'EnterPlanMode',
      },
    })
    harness.dispatchReplayEvent({ type: 'content_block_stop', index: 0 })

    harness.dispatchReplayEvent({
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'plan-exit-tool',
        name: 'ExitPlanMode',
      },
    })
    harness.dispatchReplayEvent({
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"plan":"1. Capture the event\\n2. Render the plan"}',
      },
    })
    harness.dispatchReplayEvent({ type: 'content_block_stop', index: 1 })

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'plan-exit-tool',
            content: 'Need one more regression test before proceeding.',
            is_error: true,
          },
        ],
      },
    })

    expect(harness.getMessages()).toEqual([
      {
        id: 'msg-1',
        kind: 'planning',
        text: '',
        planningAction: 'enter',
      },
      {
        id: 'msg-3',
        kind: 'planning',
        text: '1. Capture the event\n2. Render the plan',
        planningAction: 'proposed',
        planningPlan: '1. Capture the event\n2. Render the plan',
      },
      {
        id: 'msg-4',
        kind: 'planning',
        text: 'Need one more regression test before proceeding.',
        planningAction: 'decision',
        planningApproved: false,
        planningMessage: 'Need one more regression test before proceeding.',
      },
    ])

    expect(
      harness.getMessages().some(
        (msg) =>
          msg.kind === 'tool' &&
          (msg.toolName === 'EnterPlanMode' || msg.toolName === 'ExitPlanMode'),
      ),
    ).toBe(false)

    harness.cleanup()
  })

  it('maps legacy Claude plan-mode tools into planning messages instead of generic tool badges', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'assistant',
      message: {
        id: 'assistant-plan-tools',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'plan-enter', name: 'EnterPlanMode', input: {} },
          {
            type: 'tool_use',
            id: 'plan-exit',
            name: 'ExitPlanMode',
            input: { plan: '## Plan\n\n- Add coverage' },
          },
        ],
      },
    })

    harness.dispatchReplayEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'plan-enter', content: '' },
          {
            type: 'tool_result',
            tool_use_id: 'plan-exit',
            content: '{"approved":true,"message":"Proceed"}',
          },
        ],
      },
    })

    const messages = harness.getMessages()
    expect(messages.filter((msg) => msg.kind === 'tool')).toHaveLength(0)
    expect(messages.map((msg) => ({
      kind: msg.kind,
      planningAction: msg.planningAction,
      planningPlan: msg.planningPlan,
      planningApproved: msg.planningApproved,
      planningMessage: msg.planningMessage,
    }))).toEqual([
      {
        kind: 'planning',
        planningAction: 'enter',
        planningPlan: undefined,
        planningApproved: undefined,
        planningMessage: undefined,
      },
      {
        kind: 'planning',
        planningAction: 'proposed',
        planningPlan: '## Plan\n\n- Add coverage',
        planningApproved: undefined,
        planningMessage: undefined,
      },
      {
        kind: 'planning',
        planningAction: 'decision',
        planningPlan: undefined,
        planningApproved: true,
        planningMessage: 'Proceed',
      },
    ])

    harness.cleanup()
  })
})

const claudeSource = {
  provider: 'claude' as const,
  backend: 'cli' as const,
}

describe('useStreamEventProcessor Claude thinking handling (issue #1004)', () => {
  it('renders a Thinking row with backend-normalized summarized plaintext when CLAUDE_CODE_EXTRA_BODY is in effect', () => {
    // Wire shape from /tmp/probe-extrabody.jsonl — Opus 4-7 with the
    // CLAUDE_CODE_EXTRA_BODY env var injected by buildClaudeSpawnEnv.
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: claudeSource,
      message: {
        id: 'claude-opus-summarized',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking:
              "I'm thinking through how to structure a practical debugging approach for Node memory leaks—the user wants a clear 3-step plan, so I should focus on the key phases.",
            signature: 'ZXhhbXBsZS1zaWduYXR1cmUtYmxvYi0xNzI0LWJ5dGVz',
          },
        ],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe(
      "I'm thinking through how to structure a practical debugging approach for Node memory leaks—the user wants a clear 3-step plan, so I should focus on the key phases.",
    )

    harness.cleanup()
  })

  it('renders a Thinking row with the backend-normalized redaction stub', () => {
    // Wire shape from /tmp/probe-with-flag.jsonl — Opus 4-7 baseline
    // (no extra-body env), encrypted thinking only.
    const harness = createHarness()

    const signature = 'A'.repeat(464)

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: claudeSource,
      message: {
        id: 'claude-opus-encrypted',
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
          signature,
        }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe(
      `(reasoning content redacted by Claude · ${signature.length} bytes signed)`,
    )

    harness.cleanup()
  })

  it('skips the Thinking row entirely when body and signature are both empty', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: claudeSource,
      message: {
        id: 'claude-thinking-no-content',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '' }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(0)

    harness.cleanup()
  })
})

describe('useStreamEventProcessor Codex thinking completion handling', () => {
  it('keeps Codex thinking handling unchanged after the 3-way switch refactor', () => {
    // Regression guard for issue #1004 — adding the new Claude branch
    // must not perturb any existing Codex path.
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
      source: codexSource,
    })

    harness.dispatchReplayEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Streaming partial' },
      source: codexSource,
    })

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: codexSource,
      message: {
        id: 'codex-reasoning-after-deltas',
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: 'Final completed reasoning',
          presentation: { mergeWithActiveThinking: true },
        }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe('Final completed reasoning')

    harness.cleanup()
  })

  it('fills an active Codex thinking placeholder when completed reasoning arrives without deltas', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
      source: codexSource,
    })

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: codexSource,
      message: {
        id: 'codex-reasoning-completed-no-delta',
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: 'Completed reasoning text',
          presentation: { mergeWithActiveThinking: true },
        }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe('Completed reasoning text')

    harness.cleanup()
  })

  it('keeps a single Codex thinking row when deltas stream before completed reasoning', () => {
    const harness = createHarness()

    harness.dispatchReplayEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
      source: codexSource,
    })

    harness.dispatchReplayEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Streaming draft reasoning' },
      source: codexSource,
    })

    harness.dispatchReplayEvent({
      type: 'assistant',
      source: codexSource,
      message: {
        id: 'codex-reasoning-completed-with-delta',
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: 'Authoritative completed reasoning',
          presentation: { mergeWithActiveThinking: true },
        }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe('Authoritative completed reasoning')

    harness.cleanup()
  })
})
