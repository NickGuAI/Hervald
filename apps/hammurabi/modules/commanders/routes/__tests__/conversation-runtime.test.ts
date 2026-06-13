import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../memory/module.js', () => ({
  buildCommanderSessionSeedFromResolvedWorkflow: vi.fn(async () => ({
    systemPrompt: 'fresh commander prompt',
    maxTurns: 12,
  })),
}))

vi.mock('../../workflow-resolution.js', () => ({
  resolveCommanderWorkflow: vi.fn(async () => ({
    workflow: {},
  })),
}))

import {
  getConversationMessagesPage,
  recordChannelReplyDeliveryDelivered,
  startConversationSession,
} from '../conversation-runtime.js'
import type { Conversation } from '../../conversation-store.js'
import type { CommanderRoutesContext } from '../types.js'
import type { StreamJsonEvent, StreamSession } from '../../../agents/types.js'
import '../../../agents/adapters/claude/provider'

function buildLiveSession(name: string, overrides: Partial<StreamSession> = {}): StreamSession {
  return {
    kind: 'stream',
    name,
    sessionType: 'commander',
    creator: { kind: 'commander', id: '00000000-0000-4000-a000-0000000000aa' },
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp/workspace',
    createdAt: '2026-05-04T00:00:00.000Z',
    lastEventAt: '2026-05-04T00:00:00.000Z',
    spawnedWorkers: [],
    events: [],
    clients: new Set(),
    systemPrompt: 'stale prompt',
    maxTurns: 4,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: true,
    providerContext: {
      providerId: 'claude',
      sessionId: 'claude-session-1',
    },
    conversationEntryCount: 0,
    autoRotatePending: false,
    codexUnclassifiedIncomingCount: 0,
    codexPendingApprovals: new Map(),
    messageQueue: null as unknown as StreamSession['messageQueue'],
    pendingDirectSendMessages: [],
    queuedMessageRetryDelayMs: 0,
    queuedMessageDrainScheduled: false,
    queuedMessageDrainPending: false,
    queuedMessageDrainPendingForce: false,
    restoredIdle: false,
    ...overrides,
  } as StreamSession
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}

function emitAssistantTextTurn(handler: (event: StreamJsonEvent) => void, text: string): void {
  handler({ type: 'message_start' } as StreamJsonEvent)
  handler({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text' },
  } as StreamJsonEvent)
  handler({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  } as StreamJsonEvent)
  handler({ type: 'content_block_stop', index: 0 } as StreamJsonEvent)
  handler({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
  } as StreamJsonEvent)
  handler({
    type: 'result',
    duration_ms: 1200,
    is_error: false,
  } as StreamJsonEvent)
}

describe('conversation-runtime quick wins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reuses a compatible live session without deleting or respawning it', async () => {
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    let currentConversation: Conversation = {
      id: '55555555-5555-4555-8555-555555555555',
      commanderId,
      surface: 'ui',
      agentType: 'claude',
      name: 'reuse-live-session',
      status: 'idle',
      currentTask: null,
      providerContext: {
        providerId: 'claude',
        sessionId: 'claude-session-1',
      },
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-04T00:00:00.000Z',
    }
    const liveSession = buildLiveSession(
      `commander-${commanderId}-conversation-${currentConversation.id}`,
    )

    const sessionsInterface = {
      getSession: vi.fn(() => liveSession),
      deleteSession: vi.fn(),
      createCommanderSession: vi.fn(),
      sendToSession: vi.fn(async () => true),
    }
    const context = {
      commanderBasePath: '/tmp/commanders',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      sessionStore: {
        get: vi.fn(async () => ({
          id: commanderId,
          name: 'Commander',
          created: '2026-05-04T00:00:00.000Z',
          heartbeat: { intervalSeconds: 30 },
          agentType: 'claude',
          cwd: '/tmp/workspace',
          host: undefined,
          currentTask: null,
          taskSource: null,
          maxTurns: 12,
        })),
        update: vi.fn(async (_id, updater) => updater({
          id: commanderId,
          state: 'idle',
        })),
      },
      conversationStore: {
        update: vi.fn(async (_id, updater) => {
          currentConversation = updater(currentConversation)
          return currentConversation
        }),
        listByCommander: vi.fn(async () => [{ ...currentConversation, status: 'active' }]),
      },
      sessionsInterface,
      heartbeatManager: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      runtimes: new Map(),
      activeCommanderSessions: new Map(),
      channelReplyForwarders: new Map(),
    } as unknown as CommanderRoutesContext

    const started = await startConversationSession(
      context,
      commanderId,
      currentConversation,
    )

    expect(sessionsInterface.deleteSession).not.toHaveBeenCalled()
    expect(sessionsInterface.createCommanderSession).not.toHaveBeenCalled()
    expect(sessionsInterface.sendToSession).not.toHaveBeenCalled()
    expect(liveSession.systemPrompt).toContain('fresh commander prompt')
    expect(liveSession.systemPrompt).toContain('## Claude Code Reasoning Policy')
    expect(liveSession.maxTurns).toBe(12)
    expect(started.sent).toBe(true)
    expect(started.conversation.status).toBe('active')
  })

  it('uses a stored conversation model when resuming a non-default provider conversation', async () => {
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    let currentConversation: Conversation = {
      id: '66666666-6666-4666-8666-666666666666',
      commanderId,
      surface: 'ui',
      agentType: 'codex',
      model: 'gpt-5.5',
      name: 'stored-model-session',
      status: 'idle',
      currentTask: null,
      providerContext: {
        providerId: 'codex',
        threadId: 'codex-thread-1',
      },
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-04T00:00:00.000Z',
    }
    const sessionName = `commander-${commanderId}-conversation-${currentConversation.id}`
    const createdLiveSession = buildLiveSession(sessionName, {
      agentType: 'codex',
      model: 'gpt-5.5',
      providerContext: {
        providerId: 'codex',
        threadId: 'codex-thread-1',
      },
    })

    const sessionsInterface = {
      getSession: vi.fn(() => undefined),
      deleteSession: vi.fn(),
      createCommanderSession: vi.fn(async () => createdLiveSession),
      sendToSession: vi.fn(async () => true),
    }
    const context = {
      commanderBasePath: '/tmp/commanders',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      sessionStore: {
        get: vi.fn(async () => ({
          id: commanderId,
          name: 'Commander',
          created: '2026-05-04T00:00:00.000Z',
          heartbeat: { intervalSeconds: 30 },
          agentType: 'claude',
          cwd: '/tmp/workspace',
          host: undefined,
          currentTask: null,
          taskSource: null,
          maxTurns: 12,
        })),
        update: vi.fn(async (_id, updater) => updater({
          id: commanderId,
          state: 'idle',
        })),
      },
      conversationStore: {
        update: vi.fn(async (_id, updater) => {
          currentConversation = updater(currentConversation)
          return currentConversation
        }),
        listByCommander: vi.fn(async () => [{ ...currentConversation, status: 'active' }]),
      },
      sessionsInterface,
      heartbeatManager: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      runtimes: new Map(),
      activeCommanderSessions: new Map(),
      channelReplyForwarders: new Map(),
    } as unknown as CommanderRoutesContext

    const started = await startConversationSession(
      context,
      commanderId,
      currentConversation,
    )

    expect(sessionsInterface.createCommanderSession).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'codex',
      model: 'gpt-5.5',
      systemPrompt: 'fresh commander prompt',
      resumeProviderContext: {
        providerId: 'codex',
        threadId: 'codex-thread-1',
      },
    }))
    expect(started.conversation.model).toBe('gpt-5.5')
  })

  it('passes backend-owned Claude defaults when no commander or conversation overrides exist', async () => {
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    let currentConversation: Conversation = {
      id: '77777777-7777-4777-8777-777777777777',
      commanderId,
      surface: 'ui',
      agentType: 'claude',
      name: 'default-claude-session',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'ui',
      createdByKind: 'human',
      createdAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-04T00:00:00.000Z',
    }
    const createdLiveSession = buildLiveSession(
      `commander-${commanderId}-conversation-${currentConversation.id}`,
      {
        effort: 'max',
        adaptiveThinking: 'disabled',
        maxThinkingTokens: 128000,
        providerContext: {
          providerId: 'claude',
          effort: 'max',
          adaptiveThinking: 'disabled',
          maxThinkingTokens: 128000,
        },
      },
    )

    const sessionsInterface = {
      getSession: vi.fn(() => undefined),
      deleteSession: vi.fn(),
      createCommanderSession: vi.fn(async () => createdLiveSession),
      sendToSession: vi.fn(async () => true),
    }
    const context = {
      commanderBasePath: '/tmp/commanders',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      sessionStore: {
        get: vi.fn(async () => ({
          id: commanderId,
          name: 'Commander',
          created: '2026-05-04T00:00:00.000Z',
          heartbeat: { intervalSeconds: 30 },
          agentType: 'claude',
          cwd: '/tmp/workspace',
          host: undefined,
          currentTask: null,
          taskSource: null,
          maxTurns: 12,
        })),
        update: vi.fn(async (_id, updater) => updater({
          id: commanderId,
          state: 'idle',
        })),
      },
      conversationStore: {
        update: vi.fn(async (_id, updater) => {
          currentConversation = updater(currentConversation)
          return currentConversation
        }),
        listByCommander: vi.fn(async () => [{ ...currentConversation, status: 'active' }]),
      },
      sessionsInterface,
      heartbeatManager: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      runtimes: new Map(),
      activeCommanderSessions: new Map(),
      channelReplyForwarders: new Map(),
    } as unknown as CommanderRoutesContext

    await startConversationSession(context, commanderId, currentConversation)

    expect(sessionsInterface.createCommanderSession).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'claude',
      effort: 'max',
      adaptiveThinking: 'disabled',
      maxThinkingTokens: 128000,
      systemPrompt: expect.stringContaining('## Claude Code Reasoning Policy'),
    }))
  })

  it('preserves explicit Claude thinking values from persisted conversation provider context', async () => {
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    let currentConversation: Conversation = {
      id: '88888888-8888-4888-8888-888888888888',
      commanderId,
      surface: 'ui',
      agentType: 'claude',
      name: 'persisted-thinking-session',
      status: 'idle',
      currentTask: null,
      providerContext: {
        providerId: 'claude',
        sessionId: 'claude-session-explicit',
        effort: 'high',
        adaptiveThinking: 'enabled',
        maxThinkingTokens: 64000,
      },
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'ui',
      createdByKind: 'human',
      createdAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-04T00:00:00.000Z',
    }
    const createdLiveSession = buildLiveSession(
      `commander-${commanderId}-conversation-${currentConversation.id}`,
      {
        effort: 'high',
        adaptiveThinking: 'enabled',
        maxThinkingTokens: 64000,
        providerContext: {
          providerId: 'claude',
          sessionId: 'claude-session-explicit',
          effort: 'high',
          adaptiveThinking: 'enabled',
          maxThinkingTokens: 64000,
        },
      },
    )

    const sessionsInterface = {
      getSession: vi.fn(() => undefined),
      deleteSession: vi.fn(),
      createCommanderSession: vi.fn(async () => createdLiveSession),
      sendToSession: vi.fn(async () => true),
    }
    const context = {
      commanderBasePath: '/tmp/commanders',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      sessionStore: {
        get: vi.fn(async () => ({
          id: commanderId,
          name: 'Commander',
          created: '2026-05-04T00:00:00.000Z',
          heartbeat: { intervalSeconds: 30 },
          agentType: 'claude',
          cwd: '/tmp/workspace',
          host: undefined,
          currentTask: null,
          taskSource: null,
          maxTurns: 12,
        })),
        update: vi.fn(async (_id, updater) => updater({
          id: commanderId,
          state: 'idle',
        })),
      },
      conversationStore: {
        update: vi.fn(async (_id, updater) => {
          currentConversation = updater(currentConversation)
          return currentConversation
        }),
        listByCommander: vi.fn(async () => [{ ...currentConversation, status: 'active' }]),
      },
      sessionsInterface,
      heartbeatManager: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      runtimes: new Map(),
      activeCommanderSessions: new Map(),
      channelReplyForwarders: new Map(),
    } as unknown as CommanderRoutesContext

    await startConversationSession(context, commanderId, currentConversation)

    expect(sessionsInterface.createCommanderSession).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'claude',
      effort: 'high',
      adaptiveThinking: 'enabled',
      maxThinkingTokens: 64000,
      systemPrompt: expect.stringContaining('## Claude Code Reasoning Policy'),
      resumeProviderContext: expect.objectContaining({
        sessionId: 'claude-session-explicit',
      }),
    }))
  })

  it('persists failed automatic channel replies as visible retryable delivery state', async () => {
    const commanderId = '00000000-0000-4000-a000-0000000000aa'
    let currentConversation: Conversation = {
      id: '99999999-9999-4999-8999-999999999999',
      commanderId,
      surface: 'ui',
      channelMeta: {
        provider: 'whatsapp',
        chatType: 'direct',
        accountId: 'default',
        peerId: '15551234567@s.whatsapp.net',
        sessionKey: 'whatsapp:default:direct:15551234567@s.whatsapp.net',
        displayName: '+1 555 123 4567',
      },
      lastRoute: {
        channel: 'whatsapp',
        to: '15551234567@s.whatsapp.net',
        accountId: 'default',
      },
      agentType: 'claude',
      name: 'channel-conversation',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'channel',
      createdByKind: 'channel',
      createdAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-04T00:00:00.000Z',
    }
    const sessionName = `commander-${commanderId}-conversation-${currentConversation.id}`
    const liveSession = buildLiveSession(sessionName, { events: [] })
    let eventHandler: ((event: StreamJsonEvent) => void) | null = null
    const dispatchCommanderChannelReply = vi.fn(async () => ({
      ok: false as const,
      status: 502,
      error: 'adapter offline',
    }))

    const sessionsInterface = {
      getSession: vi.fn(() => liveSession),
      deleteSession: vi.fn(),
      createCommanderSession: vi.fn(),
      sendToSession: vi.fn(async () => true),
      subscribeToEvents: vi.fn((_name, handler) => {
        eventHandler = handler
        return vi.fn()
      }),
    }
    const context = {
      commanderBasePath: '/tmp/commanders',
      now: () => new Date('2026-05-04T00:00:00.000Z'),
      sessionStore: {
        get: vi.fn(async () => ({
          id: commanderId,
          name: 'Commander',
          created: '2026-05-04T00:00:00.000Z',
          heartbeat: { intervalSeconds: 30 },
          agentType: 'claude',
          cwd: '/tmp/workspace',
          host: undefined,
          currentTask: null,
          taskSource: null,
          maxTurns: 12,
        })),
        update: vi.fn(async (_id, updater) => updater({
          id: commanderId,
          state: 'idle',
        })),
      },
      conversationStore: {
        get: vi.fn(async () => currentConversation),
        update: vi.fn(async (_id, updater) => {
          currentConversation = updater(currentConversation)
          return currentConversation
        }),
        listByCommander: vi.fn(async () => [{ ...currentConversation, status: 'active' }]),
      },
      sessionsInterface,
      heartbeatManager: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      runtimes: new Map(),
      activeCommanderSessions: new Map(),
      channelReplyForwarders: new Map(),
      dispatchCommanderChannelReply,
    } as unknown as CommanderRoutesContext

    await startConversationSession(
      context,
      commanderId,
      currentConversation,
      null,
      undefined,
      undefined,
      true,
    )

    expect(eventHandler).not.toBeNull()
    emitAssistantTextTurn(eventHandler!, 'Reply that must reach WhatsApp')

    await waitForCondition(() => currentConversation.channelReplyDelivery?.status === 'failed')
    expect(currentConversation.channelReplyDelivery).toMatchObject({
      status: 'failed',
      message: 'Reply that must reach WhatsApp',
      error: 'adapter offline',
      attemptCount: 1,
    })
    const failedPage = await getConversationMessagesPage(context, currentConversation)
    expect(failedPage.messages.at(-1)).toMatchObject({
      kind: 'system',
      text: expect.stringContaining('adapter offline'),
    })

    await recordChannelReplyDeliveryDelivered(context, {
      conversationId: currentConversation.id,
      message: 'Reply that must reach WhatsApp',
      provider: 'whatsapp',
      sessionKey: 'whatsapp:default:direct:15551234567@s.whatsapp.net',
      lastRoute: {
        channel: 'whatsapp',
        to: '15551234567@s.whatsapp.net',
        accountId: 'default',
      },
    })

    expect(currentConversation.channelReplyDelivery?.status).toBe('delivered')
    const retriedPage = await getConversationMessagesPage(context, currentConversation)
    expect(retriedPage.messages.some((message) => message.text.includes('adapter offline'))).toBe(false)
  })
})
