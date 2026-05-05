import { describe, expect, it, vi } from 'vitest'
import {
  consumeInternalUserMessage,
  resolveEffectiveHeartbeat,
  sendQueuedInternalUserMessage,
} from '../routes/context'
import type { CommanderRuntime } from '../routes/types'
import type { CommanderSessionsInterface } from '../../agents/routes'
import { mergeHeartbeatConfig, createDefaultHeartbeatConfig } from '../heartbeat'

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
