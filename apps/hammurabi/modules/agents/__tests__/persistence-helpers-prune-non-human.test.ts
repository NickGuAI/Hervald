import { describe, expect, it, vi } from 'vitest'
import {
  createPersistenceHelpers,
  type PersistenceHelpersContext,
  type SessionPrunerConfig,
} from '../persistence-helpers'
import {
  createClaudeProviderContext,
  createCodexProviderContext,
} from '../providers/provider-session-context'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  StreamSession,
} from '../types'

interface TestPersistenceHelpersContext extends PersistenceHelpersContext {
  restoreProviderSessionMock: ReturnType<typeof vi.fn>
  teardownProviderSessionMock: ReturnType<typeof vi.fn>
}

function makeBaseContext(
  overrides: Partial<TestPersistenceHelpersContext> = {},
): TestPersistenceHelpersContext {
  const restoreProviderSessionMock = vi.fn()
  const teardownProviderSessionMock = vi.fn(async () => undefined)
  return {
    sessionStorePath: '/tmp/test-session-store.json',
    maxSessions: 32,
    machineRegistry: {} as PersistenceHelpersContext['machineRegistry'],
    sessions: new Map<string, AnySession>(),
    completedSessions: new Map<string, CompletedSession>(),
    exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
    applyStreamUsageEvent: vi.fn(),
    restoreProviderSession: restoreProviderSessionMock,
    restoreProviderSessionMock,
    teardownProviderSession: teardownProviderSessionMock,
    teardownProviderSessionMock,
    isExitedSessionResumeAvailable: vi.fn(async () => false),
    isLiveSessionResumeAvailable: vi.fn(async () => false),
    ...overrides,
  }
}

function makeLiveSession(
  name: string,
  overrides: Partial<StreamSession> = {},
): StreamSession {
  return {
    kind: 'stream',
    name,
    agentType: 'claude',
    mode: 'default',
    sessionType: 'worker',
    creator: { kind: 'commander', id: 'cmdr-atlas' },
    cwd: '/tmp',
    createdAt: '2026-04-26T08:00:00.000Z',
    lastEventAt: '2026-04-26T08:00:00.000Z',
    events: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    clients: new Set(),
    spawnedWorkers: [],
    providerContext: createClaudeProviderContext(),
    messageQueue: { list: () => [] } as StreamSession['messageQueue'],
    pendingDirectSendMessages: [],
    process: { kill: vi.fn() } as StreamSession['process'],
    lastTurnCompleted: false,
    ...overrides,
  } as StreamSession
}

function makeExitedSession(
  name: string,
  overrides: Partial<ExitedStreamSessionState> = {},
): ExitedStreamSessionState {
  return {
    phase: 'exited',
    hadResult: true,
    sessionType: 'worker',
    creator: { kind: 'commander', id: 'cmdr-atlas' },
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp',
    host: undefined,
    spawnedBy: undefined,
    spawnedWorkers: [],
    createdAt: '2026-04-26T06:00:00.000Z',
    providerContext: createClaudeProviderContext({
      sessionId: `claude-${name}`,
    }),
    activeTurnId: undefined,
    resumedFrom: undefined,
    conversationEntryCount: 1,
    events: [
      {
        type: 'result',
        subtype: 'success',
        timestamp: '2026-04-26T06:05:00.000Z',
      },
    ],
    queuedMessages: [],
    currentQueuedMessage: undefined,
    pendingDirectSendMessages: [],
    ...overrides,
  } as ExitedStreamSessionState
}

const PRUNER_CONFIG: SessionPrunerConfig = {
  enabled: true,
  staleSessionTtlMs: 10 * 60_000,
  exitedSessionTtlMs: 30 * 60_000,
}

describe('prune stale non-human sessions', () => {
  it('reports only stale non-human sessions that are detached and not resumable', async () => {
    const nowMs = Date.parse('2026-04-26T12:00:00.000Z')
    const attachedClient = { close: vi.fn() }
    const staleCommander = makeLiveSession('worker-stale-owned')
    const staleHuman = makeLiveSession('worker-stale-human', {
      creator: { kind: 'human', id: 'api-key' },
    })
    const attachedCron = makeLiveSession('cron-attached', {
      sessionType: 'cron',
      creator: { kind: 'cron', id: 'cron-1' },
      clients: new Set([attachedClient as never]),
    })
    const resumableSentinel = makeLiveSession('sentinel-resumable', {
      sessionType: 'sentinel',
      creator: { kind: 'sentinel', id: 'sentinel-1' },
    })

    const exitedSentinel = makeExitedSession('sentinel-exited', {
      sessionType: 'sentinel',
      creator: { kind: 'sentinel', id: 'sentinel-1' },
    })

    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([
        [staleCommander.name, staleCommander],
        [staleHuman.name, staleHuman],
        [attachedCron.name, attachedCron],
        [resumableSentinel.name, resumableSentinel],
      ]),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>([
        [exitedSentinel.name, exitedSentinel],
      ]),
      isLiveSessionResumeAvailable: vi.fn(async (session: StreamSession) => session.name === 'sentinel-resumable'),
    })
    const { getStaleNonHumanSessionCandidates } = createPersistenceHelpers(ctx)

    const candidates = await getStaleNonHumanSessionCandidates(PRUNER_CONFIG, nowMs)

    expect(candidates).toEqual([
      expect.objectContaining({
        name: 'worker-stale-owned',
        sessionType: 'worker',
        creator: { kind: 'commander', id: 'cmdr-atlas' },
        lifecycle: 'stale',
        reason: 'stale-non-human-ttl',
      }),
      expect.objectContaining({
        name: exitedSentinel.name,
        sessionType: 'sentinel',
        creator: { kind: 'sentinel', id: 'sentinel-1' },
        lifecycle: 'exited',
        reason: 'exited-non-human-ttl',
      }),
    ])
  })

  it('prunes stale/completed non-human live sessions and old exited entries', async () => {
    const nowMs = Date.parse('2026-04-26T12:00:00.000Z')
    const staleCodex = makeLiveSession('worker-stale-codex', {
      agentType: 'codex',
      providerContext: createCodexProviderContext({ threadId: 'thread-1' }),
    })
    const completedCron = makeLiveSession('cron-completed', {
      sessionType: 'cron',
      creator: { kind: 'cron', id: 'cron-1' },
      lastTurnCompleted: true,
      completedTurnAt: '2026-04-26T08:00:00.000Z',
      finalResultEvent: { type: 'result', subtype: 'success' } as never,
    })
    const exitedCommander = makeExitedSession('worker-exited-old')

    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([
        [staleCodex.name, staleCodex],
        [completedCron.name, completedCron],
      ]),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>([
        ['worker-exited-old', exitedCommander],
      ]),
      completedSessions: new Map<string, CompletedSession>([
        ['worker-exited-old', {
          name: 'worker-exited-old',
          createdAt: '2026-04-26T06:00:00.000Z',
          completedAt: '2026-04-26T06:05:00.000Z',
          subtype: 'success',
          finalComment: '',
          costUsd: 0,
          sessionType: 'worker',
          creator: { kind: 'commander', id: 'cmdr-atlas' },
        }],
      ]),
    })
    const { pruneStaleNonHumanSessions } = createPersistenceHelpers(ctx)

    const pruned = await pruneStaleNonHumanSessions(PRUNER_CONFIG, nowMs)

    expect(pruned).toBe(3)
    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      staleCodex,
      'Pruning stale non-human session',
    )
    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      completedCron,
      'Pruning stale non-human session',
    )
    expect(ctx.sessions.has(staleCodex.name)).toBe(false)
    expect(ctx.sessions.has(completedCron.name)).toBe(false)
    expect(ctx.exitedStreamSessions.has('worker-exited-old')).toBe(false)
    expect(ctx.completedSessions.has('worker-exited-old')).toBe(false)
  })
})
