import { performance } from 'node:perf_hooks'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../migrations/write-json-file-atomically.js', () => ({
  writeJsonFileAtomically: vi.fn(async () => undefined),
}))

import { writeJsonFileAtomically } from '../../../../migrations/write-json-file-atomically.js'
import {
  readPersistedSessionsState,
  restorePersistedSessions,
} from '../persistence.js'
import {
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
} from '../../transcript-store.js'
import type {
  CompletedSession,
  ExitedStreamSessionState,
  PersistedStreamSession,
  StreamSession,
} from '../../types.js'

const writeJsonFileAtomicallyMock = vi.mocked(writeJsonFileAtomically)

function buildPersistedSession(name: string): PersistedStreamSession {
  return {
    name,
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp/project',
    createdAt: '2026-05-04T00:00:00.000Z',
    sessionType: 'commander',
    creator: { kind: 'commander', id: 'commander-1' },
    providerContext: {
      providerId: 'claude',
      sessionId: `${name}-resume`,
    },
  }
}

function buildRestoredSession(entry: PersistedStreamSession): StreamSession {
  return {
    kind: 'stream',
    name: entry.name,
    sessionType: entry.sessionType ?? 'commander',
    creator: entry.creator ?? { kind: 'commander', id: 'commander-1' },
    agentType: entry.agentType,
    mode: entry.mode,
    cwd: entry.cwd,
    createdAt: entry.createdAt,
    lastEventAt: entry.createdAt,
    spawnedWorkers: [],
    events: [],
    clients: new Set(),
    systemPrompt: 'restored prompt',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    stdoutBuffer: '',
    stdinDraining: false,
    lastTurnCompleted: true,
    providerContext: entry.providerContext,
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

describe('session persistence quick wins', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hammurabi-persistence-test-'))
    setTranscriptStoreRoot(join(tempDir, 'transcripts'))
    writeJsonFileAtomicallyMock.mockClear()
  })

  afterEach(async () => {
    resetTranscriptStoreRoot()
    vi.restoreAllMocks()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('restores persisted live sessions in parallel and shares the machine-registry read', async () => {
    const entries = [
      buildPersistedSession('restore-alpha'),
      buildPersistedSession('restore-beta'),
      buildPersistedSession('restore-gamma'),
    ]
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    await writeFile(sessionStorePath, JSON.stringify({ sessions: entries }, null, 2), 'utf8')

    const machineRegistry = {
      readMachineRegistry: vi.fn(async () => []),
    }
    const restoreProviderSession = vi.fn(async (entry: PersistedStreamSession) => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return buildRestoredSession(entry)
    })

    const startedAt = performance.now()
    const sessions = new Map<string, StreamSession>()
    await restorePersistedSessions({
      sessionStorePath,
      sessions,
      completedSessions: new Map<string, CompletedSession>(),
      exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
      maxSessions: 10,
      machineRegistry: machineRegistry as never,
      applyUsageEvent: vi.fn(),
      restoreProviderSession,
    })
    const elapsedMs = performance.now() - startedAt

    expect(restoreProviderSession).toHaveBeenCalledTimes(3)
    expect(machineRegistry.readMachineRegistry).toHaveBeenCalledTimes(1)
    expect(sessions.size).toBe(3)
    expect(elapsedMs).toBeLessThan(180)
  })

  it('skips rewriting persisted session state when providerContext migration is a no-op', async () => {
    const sessionStorePath = join(tempDir, 'stream-sessions.json')
    const payload = {
      sessions: [buildPersistedSession('canonical-session')],
    }
    await writeFile(sessionStorePath, JSON.stringify(payload, null, 2), 'utf8')

    const parsed = await readPersistedSessionsState(sessionStorePath)

    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0]?.providerContext).toEqual(expect.objectContaining({
      providerId: 'claude',
      sessionId: 'canonical-session-resume',
    }))
    expect(writeJsonFileAtomicallyMock).not.toHaveBeenCalled()
  })
})
