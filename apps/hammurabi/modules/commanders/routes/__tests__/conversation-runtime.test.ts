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

import { startConversationSession } from '../conversation-runtime.js'
import type { Conversation } from '../../conversation-store.js'
import type { CommanderRoutesContext } from '../types.js'
import type { StreamSession } from '../../../agents/types.js'

function buildLiveSession(name: string): StreamSession {
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
  } as StreamSession
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
          persona: '',
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
    } as unknown as CommanderRoutesContext

    const started = await startConversationSession(
      context,
      commanderId,
      currentConversation,
    )

    expect(sessionsInterface.deleteSession).not.toHaveBeenCalled()
    expect(sessionsInterface.createCommanderSession).not.toHaveBeenCalled()
    expect(sessionsInterface.sendToSession).not.toHaveBeenCalled()
    expect(liveSession.systemPrompt).toBe('fresh commander prompt')
    expect(liveSession.maxTurns).toBe(12)
    expect(started.sent).toBe(true)
    expect(started.conversation.status).toBe('active')
  })
})
