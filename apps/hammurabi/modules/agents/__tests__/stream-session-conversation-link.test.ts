import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'
import type { RunningServer } from './routes-test-harness'

const COMMANDER_ID = '00000000-0000-4000-a000-0000000000aa'
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'

describe('stream session conversation links', () => {
  function installMockProcess() {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValue(mock.cp as never)
    return mock
  }

  it('carries conversationId in live sessions and persists it across restart restore', async () => {
    const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-conversation-link-'))
    const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
    let firstServer: RunningServer | null = null
    let secondServer: RunningServer | null = null
    const firstMock = installMockProcess()

    try {
      firstServer = await startServer({
        autoResumeSessions: false,
        sessionStorePath,
      })

      const created = await firstServer.agents.sessionsInterface.createCommanderSession({
        name: 'commander-conversation-link-01',
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        systemPrompt: 'Conversation session prompt',
        agentType: 'claude',
        cwd: '/tmp',
      })

      expect(created.conversationId).toBe(CONVERSATION_ID)
      expect(created.sessionType).toBe('commander')
      expect(created.creator).toEqual({
        kind: 'commander',
        id: COMMANDER_ID,
      })

      firstMock.emitStdout(
        '{"type":"system","subtype":"init","session_id":"claude-conversation-link-123"}\n',
      )

      await vi.waitFor(async () => {
        const raw = await readFile(sessionStorePath, 'utf8')
        const parsed = JSON.parse(raw) as {
          sessions: Array<{
            name: string
            conversationId?: string
            sessionType?: string
            creator?: {
              kind: string
              id?: string
            }
            providerContext?: { sessionId?: string }
          }>
        }
        const saved = parsed.sessions.find((session) => session.name === 'commander-conversation-link-01')
        expect(saved).toEqual(expect.objectContaining({
          conversationId: CONVERSATION_ID,
          sessionType: 'commander',
          creator: {
            kind: 'commander',
            id: COMMANDER_ID,
          },
        }))
        expect(saved?.providerContext?.sessionId).toBe('claude-conversation-link-123')
      })

      await firstServer.close()
      firstServer = null

      mockedSpawn.mockClear()
      installMockProcess()

      secondServer = await startServer({
        autoResumeSessions: true,
        sessionStorePath,
      })

      await vi.waitFor(() => {
        const restored = secondServer?.agents.sessionsInterface.getSession('commander-conversation-link-01')
        expect(restored?.conversationId).toBe(CONVERSATION_ID)
        expect(restored?.sessionType).toBe('commander')
        expect(restored?.creator).toEqual({
          kind: 'commander',
          id: COMMANDER_ID,
        })
      })
    } finally {
      if (secondServer) {
        await secondServer.close()
      }
      if (firstServer) {
        await firstServer.close()
      }
      await rm(sessionStoreDir, { recursive: true, force: true })
    }
  })

  it('preserves conversationId across auto-rotated commander sessions', async () => {
    // Regression for codex-review P1 (PR #1279): rotation used to drop
    // session.conversationId, falling back to buildLegacyCommanderConversationId
    // and seeding the next turn from the wrong conversation when multiple chats
    // exist under one commander.
    const processMocks: Array<ReturnType<typeof createMockChildProcess>> = []
    mockedSpawn.mockImplementation(() => {
      const mock = createMockChildProcess()
      processMocks.push(mock)
      return mock.cp as never
    })

    const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-conversation-rotation-'))
    const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
    let server: RunningServer | null = null

    try {
      server = await startServer({
        autoRotateEntryThreshold: 1,
        autoResumeSessions: false,
        sessionStorePath,
      })

      const sessionName = 'commander-conversation-rotation-01'

      const created = await server.agents.sessionsInterface.createCommanderSession({
        name: sessionName,
        commanderId: COMMANDER_ID,
        conversationId: CONVERSATION_ID,
        systemPrompt: 'Conversation rotation prompt',
        agentType: 'claude',
        cwd: '/tmp',
      })

      expect(created.conversationId).toBe(CONVERSATION_ID)
      expect(processMocks).toHaveLength(1)

      // Drive a complete turn so the session crosses the rotation entry-count
      // threshold and is replaced by createReplacementStreamSession.
      processMocks[0].emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      processMocks[0].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotation-old"}\n')
      processMocks[0].emitStdout('{"type":"result","result":"turn-1 done"}\n')

      await vi.waitFor(() => {
        expect(processMocks).toHaveLength(2)
      })

      // Live session must still carry the original conversationId after rotation.
      const live = server.agents.sessionsInterface.getSession(sessionName)
      expect(live?.conversationId).toBe(CONVERSATION_ID)

      // Persisted snapshot must round-trip the conversationId so a subsequent
      // rotation (which reads from session.conversationId again) does not
      // collapse to buildLegacyCommanderConversationId(commanderId).
      processMocks[1].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotation-new"}\n')

      await vi.waitFor(async () => {
        const raw = await readFile(sessionStorePath, 'utf8')
        const parsed = JSON.parse(raw) as {
          sessions: Array<{
            name: string
            conversationId?: string
            providerContext?: { sessionId?: string }
          }>
        }
        const saved = parsed.sessions.find((session) => session.name === sessionName)
        expect(saved).toEqual(expect.objectContaining({
          conversationId: CONVERSATION_ID,
        }))
        expect(saved?.providerContext?.sessionId).toBe('claude-rotation-new')
      })
    } finally {
      if (server) {
        await server.close()
      }
      await rm(sessionStoreDir, { recursive: true, force: true })
    }
  })
})
