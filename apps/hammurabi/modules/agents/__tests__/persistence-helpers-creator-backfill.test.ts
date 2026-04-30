import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPersistenceHelpers,
  type PersistenceHelpersContext,
} from '../persistence-helpers'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  PersistedSessionsState,
} from '../types'

function makeBaseContext(sessionStorePath: string): PersistenceHelpersContext {
  return {
    sessionStorePath,
    maxSessions: 32,
    machineRegistry: {} as PersistenceHelpersContext['machineRegistry'],
    sessions: new Map<string, AnySession>(),
    completedSessions: new Map<string, CompletedSession>(),
    exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
    applyStreamUsageEvent: vi.fn(),
    createClaudeSession: vi.fn(),
    createCodexSession: vi.fn(),
    createGeminiSession: vi.fn(),
    teardownCodexSessionRuntime: vi.fn(async () => undefined),
    isExitedSessionResumeAvailable: vi.fn(async () => false),
    isLiveSessionResumeAvailable: vi.fn(async () => false),
  }
}

function makeLegacyExitedEntry(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp/legacy-session',
    createdAt: '2026-04-20T00:00:00.000Z',
    sessionState: 'exited',
    hadResult: true,
    claudeSessionId: `claude-${name}`,
    events: [
      {
        type: 'result',
        subtype: 'success',
        timestamp: '2026-04-20T00:05:00.000Z',
        total_cost_usd: 0.01,
      },
    ],
    ...overrides,
  }
}

describe('persisted session creator backfill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('backfills creator + sessionType once and persists the upgraded state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-backfill-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    try {
      const legacyState: PersistedSessionsState = {
        sessions: [
          makeLegacyExitedEntry('command-room-nightly') as never,
          makeLegacyExitedEntry('sentinel-watchdog') as never,
          makeLegacyExitedEntry('worker-1710000000000', {
            parentSession: 'commander-cmdr-athena',
          }) as never,
          makeLegacyExitedEntry('commander-cmdr-borealis') as never,
          makeLegacyExitedEntry('session-plain', {
            sessionCategory: 'regular',
          }) as never,
        ],
      }
      await writeFile(sessionStorePath, JSON.stringify(legacyState, null, 2), 'utf8')

      const ctx = makeBaseContext(sessionStorePath)
      const { restorePersistedSessions } = createPersistenceHelpers(ctx)

      await restorePersistedSessions()

      const persisted = JSON.parse(await readFile(sessionStorePath, 'utf8')) as PersistedSessionsState
      expect(persisted.sessions).toEqual([
        expect.objectContaining({
          name: 'command-room-nightly',
          sessionType: 'cron',
          creator: { kind: 'cron', id: '<unknown-cron-task>' },
        }),
        expect.objectContaining({
          name: 'sentinel-watchdog',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: '<unknown-sentinel>' },
        }),
        expect.objectContaining({
          name: 'worker-1710000000000',
          sessionType: 'worker',
          creator: { kind: 'commander', id: 'cmdr-athena' },
          spawnedBy: 'commander-cmdr-athena',
        }),
        expect.objectContaining({
          name: 'commander-cmdr-borealis',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-borealis' },
        }),
        expect.objectContaining({
          name: 'session-plain',
          sessionType: 'worker',
          creator: { kind: 'human', id: '<legacy-unknown-user>' },
        }),
      ])

      expect(consoleInfo).toHaveBeenCalledTimes(5)
      expect(ctx.exitedStreamSessions.get('worker-1710000000000')).toMatchObject({
        sessionType: 'worker',
        creator: { kind: 'commander', id: 'cmdr-athena' },
        spawnedBy: 'commander-cmdr-athena',
      })
      expect(ctx.exitedStreamSessions.get('session-plain')).toMatchObject({
        sessionType: 'worker',
        creator: { kind: 'human', id: '<legacy-unknown-user>' },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
