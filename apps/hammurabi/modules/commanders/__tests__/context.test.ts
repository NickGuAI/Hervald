import { describe, expect, it, vi } from 'vitest'
import {
  consumeInternalUserMessage,
  isInputTokenContextPressureEvent,
  resolveEffectiveHeartbeat,
  resolveCommanderTerminalState,
  sendQueuedInternalUserMessage,
} from '../routes/context'
import type { CommanderRuntime } from '../routes/types'
import type { CommanderSessionsInterface } from '../../agents/routes'
import { mergeHeartbeatConfig, createDefaultHeartbeatConfig } from '../heartbeat'
import type { TranscriptEnvelope } from '../../../src/types/transcript-envelope'

function createRuntime(): CommanderRuntime {
  return {
    manager: {} as CommanderRuntime['manager'],
    contextPressureBridge: {} as CommanderRuntime['contextPressureBridge'],
    lastTaskState: '',
    heartbeatCount: 0,
    lastKnownInputTokens: 0,
    forceNextFatHeartbeat: false,
    pendingCollect: [],
    pendingInternalUserMessages: new Map(),
    collectTimer: null,
    subAgents: new Map(),
  }
}

function createSessionsInterface(sendResult: boolean): CommanderSessionsInterface {
  return {
    createCommanderSession: vi.fn(),
    dispatchWorkerForCommander: vi.fn().mockResolvedValue({
      status: 501,
      body: { error: 'dispatchWorkerForCommander not stubbed in this fixture' },
    }),
    sendToSession: vi.fn().mockResolvedValue(sendResult),
    deleteSession: vi.fn(),
    getSession: vi.fn(),
    subscribeToEvents: vi.fn(),
  }
}

function createTranscriptEnvelope(
  ev: TranscriptEnvelope['ev'],
  overrides: Partial<Omit<TranscriptEnvelope, 'schemaVersion' | 'id' | 'time' | 'source' | 'ev'>> = {},
): TranscriptEnvelope {
  return {
    schemaVersion: 2,
    id: 'env-1',
    time: '2026-05-27T18:04:32.000Z',
    source: {
      provider: 'codex',
      backend: 'cli',
    },
    ev,
    ...overrides,
  }
}

describe('sendQueuedInternalUserMessage', () => {
  it('marks a message as internal only after the queued send succeeds', async () => {
    const runtime = createRuntime()
    const sessionsInterface = createSessionsInterface(true)

    await expect(
      sendQueuedInternalUserMessage(runtime, sessionsInterface, 'commander-alpha', '[HEARTBEAT]', {
        queue: true,
        priority: 'low',
      }),
    ).resolves.toBe(true)

    expect(consumeInternalUserMessage(runtime, '[HEARTBEAT]')).toBe(true)
    expect(consumeInternalUserMessage(runtime, '[HEARTBEAT]')).toBe(false)
  })

  it('does not mark a message as internal when the queued send fails', async () => {
    const runtime = createRuntime()
    const sessionsInterface = createSessionsInterface(false)

    await expect(
      sendQueuedInternalUserMessage(runtime, sessionsInterface, 'commander-alpha', '[HEARTBEAT]', {
        queue: true,
        priority: 'low',
      }),
    ).resolves.toBe(false)

    expect(consumeInternalUserMessage(runtime, '[HEARTBEAT]')).toBe(false)
  })
})

describe('resolveEffectiveHeartbeat', () => {
  it('returns the stored session heartbeat without consulting workflow frontmatter', () => {
    const storedHeartbeat = mergeHeartbeatConfig(createDefaultHeartbeatConfig(), {
      intervalMs: 42_000,
      messageTemplate: '[SESSION {{timestamp}}]',
    })

    expect(resolveEffectiveHeartbeat({ heartbeat: storedHeartbeat })).toEqual(storedHeartbeat)
  })
})

describe('isInputTokenContextPressureEvent', () => {
  it('recognizes v2 provider activity usage updates', () => {
    const event = createTranscriptEnvelope({
      type: 'provider.activity',
      title: 'Token usage updated',
      data: {
        usage: {
          input_tokens: 160_000,
          output_tokens: 32,
        },
      },
    })

    expect(isInputTokenContextPressureEvent(event, 160_000, 150_000)).toBe(true)
  })

  it('recognizes v2 turn completions as usage-bearing context pressure events', () => {
    const event = createTranscriptEnvelope({
      type: 'turn.end',
      status: 'completed',
      usage: {
        input_tokens: 160_000,
        output_tokens: 32,
      },
    })

    expect(isInputTokenContextPressureEvent(event, 160_000, 150_000)).toBe(true)
  })

  it('ignores unrelated provider activity envelopes', () => {
    const event = createTranscriptEnvelope({
      type: 'provider.activity',
      title: 'Sandbox prepared',
      data: {
        status: 'ready',
      },
    })

    expect(isInputTokenContextPressureEvent(event, 160_000, 150_000)).toBe(false)
  })
})

describe('resolveCommanderTerminalState', () => {
  it('reads max-turn terminal state from v2 turn completion payloads', () => {
    const event = createTranscriptEnvelope({
      type: 'turn.end',
      status: 'failed',
      result: {
        subtype: 'error_max_turns',
        terminal_reason: 'max_turns',
        message: 'Reached maximum number of turns (9)',
        errors: ['Reached maximum number of turns (9)'],
      },
    })

    expect(resolveCommanderTerminalState(event)).toEqual({
      kind: 'max_turns',
      subtype: 'error_max_turns',
      terminalReason: 'max_turns',
      message: 'Reached maximum number of turns (9)',
      errors: ['Reached maximum number of turns (9)'],
    })
  })

  it('ignores non-terminal v2 turn completions', () => {
    const event = createTranscriptEnvelope({
      type: 'turn.end',
      status: 'completed',
      result: {
        message: 'Turn completed successfully',
      },
    })

    expect(resolveCommanderTerminalState(event)).toBeNull()
  })
})
