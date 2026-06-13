import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultCommanderConversationId } from '../../commanders/store'
import { migrateLegacyPersistedSessionSources } from '../legacy-session-source-migration'
import type { PersistedSessionsState, PersistedStreamSession } from '../types'

function makeLegacyEntry(
  name: string,
  overrides: Partial<PersistedStreamSession> = {},
): PersistedStreamSession {
  return {
    name,
    agentType: 'claude',
    mode: 'default',
    cwd: '/tmp/legacy-session',
    createdAt: '2026-04-20T00:00:00.000Z',
    providerContext: {
      providerId: 'claude',
      sessionId: `claude-${name}`,
    },
    ...overrides,
  }
}

describe('legacy session source migration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves commander id and conversation id from commander conversation session names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-legacy-session-source-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    try {
      const state: PersistedSessionsState = {
        sessions: [
          makeLegacyEntry('commander-atlas-prime-conversation-chat-2026-06-10'),
          makeLegacyEntry('commander-borealis'),
        ],
      }
      await writeFile(sessionStorePath, JSON.stringify(state, null, 2), 'utf8')

      const result = await migrateLegacyPersistedSessionSources(sessionStorePath, state)

      expect(result.changed).toBe(true)
      expect(result.state.sessions).toEqual([
        expect.objectContaining({
          name: 'commander-atlas-prime-conversation-chat-2026-06-10',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'atlas-prime' },
          conversationId: 'chat-2026-06-10',
        }),
        expect.objectContaining({
          name: 'commander-borealis',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'borealis' },
          conversationId: buildDefaultCommanderConversationId('borealis'),
        }),
      ])
      expect(consoleInfo).toHaveBeenCalledTimes(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('derives worker commander ownership from legacy parent conversation session names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-legacy-worker-source-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    try {
      const persisted: PersistedSessionsState = {
        sessions: [
          makeLegacyEntry('worker-1710000000000'),
        ],
      }
      await writeFile(
        sessionStorePath,
        JSON.stringify({
          sessions: [
            {
              ...persisted.sessions[0],
              parentSession: 'commander-atlas-prime-conversation-chat-2026-06-10',
            },
          ],
        }, null, 2),
        'utf8',
      )

      const result = await migrateLegacyPersistedSessionSources(sessionStorePath, persisted)

      expect(result.state.sessions[0]).toEqual(expect.objectContaining({
        name: 'worker-1710000000000',
        sessionType: 'worker',
        creator: { kind: 'commander', id: 'atlas-prime' },
        spawnedBy: 'commander-atlas-prime-conversation-chat-2026-06-10',
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
