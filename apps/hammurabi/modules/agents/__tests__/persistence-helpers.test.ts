/**
 * Tests for createPersistenceHelpers — the issue/921 P6b extraction.
 *
 * Focus is on pruneStaleCommandRoomSessions (the most logic-heavy of the
 * four helpers) plus a smoke test that the factory wires the remaining
 * three thin wrappers correctly. Full integration of restore + write is
 * covered by session/persistence tests that live alongside the underlying
 * store module.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createPersistenceHelpers,
  type PersistenceHelpersContext,
} from '../persistence-helpers'
import { COMMAND_ROOM_COMPLETED_SESSION_TTL_MS } from '../constants'
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

function makeCommandRoomCodexSession(
  name: string,
  completedAtOffsetMs: number,
): StreamSession {
  const now = Date.now()
  return {
    name,
    kind: 'stream',
    agentType: 'codex',
    sessionType: 'cron',
    creator: { kind: 'cron', id: 'cron-1' },
    createdAt: new Date(now - completedAtOffsetMs - 60_000).toISOString(),
    completedTurnAt: new Date(now - completedAtOffsetMs).toISOString(),
    lastTurnCompleted: true,
    finalResultEvent: { type: 'result', subtype: 'success' } as unknown,
    clients: new Set(),
  } as unknown as StreamSession
}

function makeCommandRoomClaudeSession(
  name: string,
  completedAtOffsetMs: number,
): StreamSession {
  const now = Date.now()
  const processKill = vi.fn()
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    sessionType: 'cron',
    creator: { kind: 'cron', id: 'cron-1' },
    createdAt: new Date(now - completedAtOffsetMs - 60_000).toISOString(),
    completedTurnAt: new Date(now - completedAtOffsetMs).toISOString(),
    lastTurnCompleted: true,
    finalResultEvent: { type: 'result', subtype: 'success' } as unknown,
    clients: new Set(),
    process: { kill: processKill },
  } as unknown as StreamSession
}

function makeRunningCommandRoomSession(name: string): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    sessionType: 'cron',
    creator: { kind: 'cron', id: 'cron-1' },
    createdAt: new Date().toISOString(),
    lastTurnCompleted: false,
    finalResultEvent: null,
    clients: new Set(),
    process: { kill: vi.fn() },
  } as unknown as StreamSession
}

function makeWorkerSession(name: string): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    sessionType: 'worker',
    creator: { kind: 'human', id: 'user-1' },
    createdAt: new Date(Date.now() - 999_999_999).toISOString(),
    completedTurnAt: new Date(Date.now() - 999_999_999).toISOString(),
    lastTurnCompleted: true,
    finalResultEvent: { type: 'result' } as unknown,
    clients: new Set(),
    process: { kill: vi.fn() },
  } as unknown as StreamSession
}

function makeBaseContext(
  overrides: Partial<TestPersistenceHelpersContext> = {},
): TestPersistenceHelpersContext {
  const restoreProviderSessionMock = vi.fn()
  const teardownProviderSessionMock = vi.fn(async () => undefined)
  const defaults: TestPersistenceHelpersContext = {
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
  }
  return { ...defaults, ...overrides }
}

describe('createPersistenceHelpers — pruneStaleCommandRoomSessions', () => {
  it('prunes command-room sessions that completed longer than TTL ago', () => {
    const stale = makeCommandRoomCodexSession(
      'command-room-alpha',
      COMMAND_ROOM_COMPLETED_SESSION_TTL_MS + 10_000,
    )
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['command-room-alpha', stale]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    pruneStaleCommandRoomSessions()

    expect(ctx.sessions.has('command-room-alpha')).toBe(false)
    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      stale,
      'Pruning stale automation session',
    )
  })

  it('keeps command-room sessions that completed within TTL', () => {
    const fresh = makeCommandRoomCodexSession('command-room-fresh', 5_000)
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['command-room-fresh', fresh]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    pruneStaleCommandRoomSessions()

    expect(ctx.sessions.has('command-room-fresh')).toBe(true)
    expect(ctx.teardownProviderSessionMock).not.toHaveBeenCalled()
  })

  it('keeps command-room sessions that are still running (no lastTurnCompleted)', () => {
    const running = makeRunningCommandRoomSession('command-room-live')
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['command-room-live', running]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    pruneStaleCommandRoomSessions()

    expect(ctx.sessions.has('command-room-live')).toBe(true)
  })

  it('ignores non-command-room sessions regardless of age', () => {
    const worker = makeWorkerSession('worker-old')
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['worker-old', worker]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    pruneStaleCommandRoomSessions()

    expect(ctx.sessions.has('worker-old')).toBe(true)
  })

  it('kills the process with SIGTERM for non-codex stale command-room sessions', () => {
    const stale = makeCommandRoomClaudeSession(
      'command-room-claude',
      COMMAND_ROOM_COMPLETED_SESSION_TTL_MS + 1_000,
    )
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['command-room-claude', stale]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    pruneStaleCommandRoomSessions()

    expect(ctx.teardownProviderSessionMock).toHaveBeenCalledWith(
      stale,
      'Pruning stale automation session',
    )
    expect(ctx.sessions.has('command-room-claude')).toBe(false)
  })

  it('nowMs override allows deterministic "time travel" in tests', () => {
    const session = makeCommandRoomCodexSession('command-room-t', 0)
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['command-room-t', session]]),
    })
    const { pruneStaleCommandRoomSessions } = createPersistenceHelpers(ctx)

    const futureNow = Date.now() + COMMAND_ROOM_COMPLETED_SESSION_TTL_MS + 60_000
    pruneStaleCommandRoomSessions(futureNow)

    expect(ctx.sessions.has('command-room-t')).toBe(false)
  })
})

describe('createPersistenceHelpers — factory smoke', () => {
  it('returns all 4 helpers wired', () => {
    const { schedulePersistedSessionsWrite, readPersistedSessionsState, restorePersistedSessions, pruneStaleCommandRoomSessions } =
      createPersistenceHelpers(makeBaseContext())

    expect(typeof schedulePersistedSessionsWrite).toBe('function')
    expect(typeof readPersistedSessionsState).toBe('function')
    expect(typeof restorePersistedSessions).toBe('function')
    expect(typeof pruneStaleCommandRoomSessions).toBe('function')
  })
})
