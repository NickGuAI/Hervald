// @vitest-environment jsdom

import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '@/types'
import type { MsgItem } from '../session-messages'
import { useStreamEventProcessor } from '../use-stream-event-processor'

type Harness = {
  cleanup: () => void
  dispatchReplayEvent: (event: StreamEvent) => void
  dispatchLiveEvent: (event: StreamEvent) => void
  getMessages: () => MsgItem[]
}

function createHarness(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root: Root = createRoot(container)
  let processEventRef: ((event: StreamEvent, isReplay?: boolean) => void) | undefined
  let messagesRef: MsgItem[] = []

  function HarnessComponent() {
    const { processEvent, messages } = useStreamEventProcessor()
    processEventRef = processEvent
    messagesRef = messages
    return null
  }

  flushSync(() => {
    root.render(createElement(HarnessComponent))
  })

  if (!processEventRef) {
    throw new Error('expected stream event processor hook to initialize')
  }

  return {
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

describe('useStreamEventProcessor replay user handling', () => {
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
  it('renders a Thinking row with summarized plaintext when CLAUDE_CODE_EXTRA_BODY is in effect', () => {
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
              " I'm thinking through how to structure a practical debugging approach for Node memory leaks—the user wants a clear 3-step plan, so I should focus on the key phases.",
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

  it('renders a Thinking row with the redaction stub when body is empty but signature is present', () => {
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
        content: [{ type: 'thinking', thinking: '', signature }],
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
        content: [{ type: 'thinking', thinking: 'Final completed reasoning' }],
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
        content: [{ type: 'thinking', thinking: 'Completed reasoning text' }],
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
        content: [{ type: 'thinking', thinking: 'Authoritative completed reasoning' }],
      },
    })

    const thinkingMessages = harness.getMessages().filter((msg) => msg.kind === 'thinking')
    expect(thinkingMessages).toHaveLength(1)
    expect(thinkingMessages[0]?.text).toBe('Authoritative completed reasoning')

    harness.cleanup()
  })
})
