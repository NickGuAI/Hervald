import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'
import type { CommanderSessionsInterface } from '../../agents/routes'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../store'

const COMMANDER_A = '00000000-0000-4000-a000-0000000000aa'
const COMMANDER_B = '00000000-0000-4000-a000-0000000000bb'
const CONVERSATION_A = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_B = '22222222-2222-4222-8222-222222222222'

const FULL_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'full-scope-key',
}

const READ_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'read-only-key',
}

const WRITE_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'write-only-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

interface ActiveSessionState {
  agentType: 'claude' | 'codex' | 'gemini'
  conversationId?: string
  claudeSessionId?: string
  codexThreadId?: string
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
}

interface MockSessionsFixture {
  iface: CommanderSessionsInterface
  createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]>
  sendCalls: Array<{
    name: string
    text: string
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }>
}

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'full-scope-key': {
      id: 'full-scope-key-id',
      name: 'Full Scope Key',
      keyHash: 'hash-full',
      prefix: 'hmrb_full',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
    },
    'read-only-key': {
      id: 'read-only-key-id',
      name: 'Read Only Key',
      keyHash: 'hash-read',
      prefix: 'hmrb_read',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read'],
    },
    'write-only-key': {
      id: 'write-only-key-id',
      name: 'Write Only Key',
      keyHash: 'hash-write',
      prefix: 'hmrb_write',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['commanders:write'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }
      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }
      return { ok: true as const, record }
    },
  }
}

function createMockSessionsInterface(): MockSessionsFixture {
  const createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]> = []
  const sendCalls: Array<{
    name: string
    text: string
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }> = []
  const activeSessions = new Map<string, ActiveSessionState>()

  const iface: CommanderSessionsInterface = {
    async createCommanderSession(params) {
      createCalls.push(params)
      activeSessions.set(params.name, {
        agentType: params.agentType,
        conversationId: params.conversationId,
        claudeSessionId: params.agentType === 'claude'
          ? `claude-${params.conversationId ?? params.name}`
          : undefined,
        codexThreadId: params.agentType === 'codex'
          ? `codex-${params.conversationId ?? params.name}`
          : undefined,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.25,
        },
      })
      return {
        kind: 'stream',
        name: params.name,
        agentType: params.agentType,
        conversationId: params.conversationId,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.25,
        },
      } as unknown as Awaited<ReturnType<CommanderSessionsInterface['createCommanderSession']>>
    },
    async dispatchWorkerForCommander() {
      return {
        status: 501,
        body: { error: 'dispatchWorkerForCommander is not stubbed for this fixture' },
      }
    },
    async sendToSession(name, text, options) {
      sendCalls.push(options ? { name, text, options } : { name, text })
      return activeSessions.has(name)
    },
    deleteSession(name) {
      activeSessions.delete(name)
    },
    getSession(name) {
      const active = activeSessions.get(name)
      if (!active) {
        return undefined
      }
      return {
        kind: 'stream',
        name,
        agentType: active.agentType,
        conversationId: active.conversationId,
        claudeSessionId: active.claudeSessionId,
        codexThreadId: active.codexThreadId,
        usage: { ...active.usage },
      } as unknown as ReturnType<CommanderSessionsInterface['getSession']>
    },
    subscribeToEvents() {
      return () => {}
    },
  }

  return {
    iface,
    createCalls,
    sendCalls,
  }
}

async function seedCommander(storePath: string, commanderId: string): Promise<void> {
  const store = new CommanderSessionStore(storePath)
  await store.create({
    id: commanderId,
    host: `host-${commanderId.slice(-4)}`,
    state: 'idle',
    created: '2026-05-01T00:00:00.000Z',
    agentType: 'claude',
    cwd: '/tmp',
    maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
    contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
    taskSource: null,
  })
}

async function startServer(
  options: Partial<CommandersRouterOptions> & {
    sessionsInterface?: CommanderSessionsInterface
  } = {},
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-commanders-conversation-routes-'), 'sessions.json')
  const memoryBasePath = options.memoryBasePath
    ?? join(dirname(sessionStorePath), 'memory')

  await mkdir(memoryBasePath, { recursive: true })

  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
    sessionStorePath,
    memoryBasePath,
  })
  app.use('/api/commanders', commanders.router)
  app.use('/api/conversations', commanders.conversationRouter)

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    httpServer,
    close: async () => {
      commanders.dispose()
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function createConversation(
  baseUrl: string,
  commanderId: string,
  input: {
    id: string
    surface: 'api' | 'ui' | 'cli' | 'discord' | 'telegram' | 'whatsapp'
  },
): Promise<Response> {
  return fetch(`${baseUrl}/api/commanders/${commanderId}/conversations`, {
    method: 'POST',
    headers: {
      ...FULL_AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

async function startConversation(
  baseUrl: string,
  conversationId: string,
  input: {
    agentType: 'claude' | 'codex' | 'gemini'
    effort?: 'low' | 'medium' | 'high' | 'max'
    adaptiveThinking?: 'enabled' | 'disabled'
    cwd?: string
    host?: string
  },
): Promise<Response> {
  return fetch(`${baseUrl}/api/conversations/${conversationId}/start`, {
    method: 'POST',
    headers: {
      ...FULL_AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

describe('conversation routes', () => {
  it('supports the explicit conversation CRUD flow including start, message reuse, and archive aliases', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-crud-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const emptyListResponse = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(emptyListResponse.status).toBe(200)
      expect(await emptyListResponse.json()).toEqual([])

      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as {
        id: string
        status: string
        liveSession: unknown
      }
      expect(created).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        liveSession: null,
      }))

      const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      expect(await detailResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        liveSession: null,
      }))

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      expect(startResponse.status).toBe(200)
      const started = await startResponse.json() as {
        conversation: {
          id: string
          status: string
          agentType?: string | null
          liveSession: {
            conversationId?: string
          } | null
        }
      }
      expect(started.conversation).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'active',
        agentType: 'claude',
      }))
      expect(started.conversation.liveSession?.conversationId).toBe(CONVERSATION_A)
      expect(sessions.createCalls).toHaveLength(1)
      expect(sessions.createCalls[0]?.conversationId).toBe(CONVERSATION_A)

      const firstMessageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Plan phase 1 and continue.',
        }),
      })
      expect(firstMessageResponse.status).toBe(200)
      const firstMessage = await firstMessageResponse.json() as {
        accepted: boolean
        createdSession: boolean
        conversation: {
          liveSession: {
            conversationId?: string
          } | null
        }
      }
      expect(firstMessage.accepted).toBe(true)
      expect(firstMessage.createdSession).toBe(false)
      expect(firstMessage.conversation.liveSession?.conversationId).toBe(CONVERSATION_A)
      expect(sessions.createCalls).toHaveLength(1)

      const secondMessageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Reuse the active session.',
        }),
      })
      expect(secondMessageResponse.status).toBe(200)
      const secondMessage = await secondMessageResponse.json() as { createdSession: boolean }
      expect(secondMessage.createdSession).toBe(false)
      expect(sessions.createCalls).toHaveLength(1)
      expect(sessions.sendCalls.at(-1)?.text).toBe('Reuse the active session.')

      const queuedMessageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Queue the next follow-up.',
          queue: true,
        }),
      })
      expect(queuedMessageResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)).toEqual(expect.objectContaining({
        text: 'Queue the next follow-up.',
        options: {
          queue: true,
          priority: 'normal',
        },
      }))

      const pauseResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pauseResponse.status).toBe(200)
      expect(await pauseResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        liveSession: null,
      }))

      const resumeResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/resume`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(resumeResponse.status).toBe(200)
      const resumed = await resumeResponse.json() as {
        id: string
        status: string
        liveSession: {
          conversationId?: string
        } | null
      }
      expect(resumed.id).toBe(CONVERSATION_A)
      expect(resumed.status).toBe('active')
      expect(resumed.liveSession?.conversationId).toBe(CONVERSATION_A)
      expect(sessions.createCalls).toHaveLength(2)

      const archiveResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/archive`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(archiveResponse.status).toBe(200)
      expect(await archiveResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'archived',
        liveSession: null,
      }))

      const createSecondResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_B,
        surface: 'ui',
      })
      expect(createSecondResponse.status).toBe(201)

      const deleteResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}`, {
        method: 'DELETE',
        headers: FULL_AUTH_HEADERS,
      })
      expect(deleteResponse.status).toBe(200)
      expect(await deleteResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_B,
        status: 'archived',
      }))
    } finally {
      await server.close()
    }
  })

  it('starts an idle conversation and persists the requested agent type', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(createResponse.status).toBe(201)

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      expect(startResponse.status).toBe(200)
      expect(await startResponse.json()).toEqual({
        conversation: expect.objectContaining({
          id: CONVERSATION_A,
          status: 'active',
          agentType: 'claude',
          liveSession: expect.objectContaining({
            conversationId: CONVERSATION_A,
          }),
        }),
      })
      expect(sessions.createCalls).toHaveLength(1)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'claude',
        conversationId: CONVERSATION_A,
      }))

      const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      expect(await detailResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'active',
        agentType: 'claude',
      }))
    } finally {
      await server.close()
    }
  })

  it('returns 409 when starting an already-active conversation', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-active-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(createResponse.status).toBe(201)

      const firstStart = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      expect(firstStart.status).toBe(200)

      const secondStart = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      expect(secondStart.status).toBe(409)
      expect(await secondStart.json()).toEqual({
        error: `Conversation "${CONVERSATION_A}" is not idle`,
      })
    } finally {
      await server.close()
    }
  })

  it('returns 404 when starting a missing conversation', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-missing-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      expect(startResponse.status).toBe(404)
      expect(await startResponse.json()).toEqual({
        error: `Conversation "${CONVERSATION_A}" not found`,
      })
    } finally {
      await server.close()
    }
  })

  it('returns 409 when posting a message to an idle conversation and points callers to /start', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-idle-message-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(createResponse.status).toBe(201)

      const messageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Do the thing.',
        }),
      })
      expect(messageResponse.status).toBe(409)
      expect(await messageResponse.json()).toEqual({
        error: `Conversation is idle. Call POST /api/conversations/${CONVERSATION_A}/start first.`,
      })
      expect(sessions.createCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('pauses one conversation without affecting active siblings', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-pause-siblings-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createFirst = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      const createSecond = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_B,
        surface: 'ui',
      })
      expect(createFirst.status).toBe(201)
      expect(createSecond.status).toBe(201)

      const startFirst = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      const startSecond = await startConversation(server.baseUrl, CONVERSATION_B, {
        agentType: 'claude',
      })
      expect(startFirst.status).toBe(200)
      expect(startSecond.status).toBe(200)

      const pauseResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pauseResponse.status).toBe(200)
      expect(await pauseResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        liveSession: null,
      }))

      const siblingResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(siblingResponse.status).toBe(200)
      expect(await siblingResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_B,
        status: 'active',
        liveSession: expect.objectContaining({
          conversationId: CONVERSATION_B,
        }),
      }))
    } finally {
      await server.close()
    }
  })

  it('enforces read/write scopes and returns 409 for cross-commander conversation id collisions', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-auth-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)
    await seedCommander(storePath, COMMANDER_B)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const readDenied = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`, {
        headers: WRITE_ONLY_AUTH_HEADERS,
      })
      expect(readDenied.status).toBe(403)

      const writeDenied = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`, {
        method: 'POST',
        headers: {
          ...READ_ONLY_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: CONVERSATION_A,
          surface: 'api',
        }),
      })
      expect(writeDenied.status).toBe(403)

      const firstCreate = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(firstCreate.status).toBe(201)

      const collision = await createConversation(server.baseUrl, COMMANDER_B, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(collision.status).toBe(409)
      expect(await collision.json()).toEqual({
        error: `Conversation "${CONVERSATION_A}" already belongs to commander "${COMMANDER_A}"`,
      })
    } finally {
      await server.close()
    }
  })

  it('returns 409 when pausing an archived conversation (does not silently unarchive)', async () => {
    // Regression for codex-review P2 on PR #1279 (comment 3175274914):
    // pause used to call stopConversationSession(..., 'idle') unconditionally,
    // which silently moved archived conversations back to idle and broke
    // archive semantics. The pause handler now guards on status === 'archived'.
    const dir = await createTempDir('hammurabi-commanders-conversation-pause-archived-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)

      const archive = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/archive`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(archive.status).toBe(200)
      expect(await archive.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'archived',
      }))

      const pause = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pause.status).toBe(409)
      expect(await pause.json()).toEqual({
        error: `Conversation "${CONVERSATION_A}" is archived`,
      })

      const detail = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detail.status).toBe(200)
      expect(await detail.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'archived',
      }))
    } finally {
      await server.close()
    }
  })

  it('channel-message auto-starts an idle conversation and delivers the inbound message', async () => {
    // Regression for codex-review P1 on PR #1279 (comment 3174904129):
    // channel webhooks cannot manually call POST /api/conversations/:id/start,
    // so deliverConversationMessage now opts into autoStartIdle for channel
    // surfaces — the first inbound message implicitly starts the chat.
    const dir = await createTempDir('hammurabi-commanders-channel-autostart-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const channelResponse = await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-autostart',
          chatType: 'direct',
          peerId: 'peer-autostart',
          message: 'Hello, athena.',
          commanderId: COMMANDER_A,
        }),
      })

      expect(channelResponse.status).toBe(201)
      const body = await channelResponse.json()
      expect(body).toEqual(expect.objectContaining({
        accepted: true,
        delivered: true,
        created: true,
        createdSession: true,
        commanderId: COMMANDER_A,
      }))
      // Auto-start must spawn a session (createCommanderSession was called)
      // and the inbound message must reach sendToSession.
      expect(sessions.createCalls.length).toBe(1)
      expect(sessions.sendCalls.some((call) => call.text === 'Hello, athena.')).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('channel-message preserves collect mode by queueing the send instead of pushing live', async () => {
    // Regression for codex-review P1 on PR #1279 (comment 3174491798):
    // channel-message used to drop the parsed mode; collect-mode traffic now
    // travels the deferred queue lane (queue: true) instead of being sent
    // live like followup mode.
    const dir = await createTempDir('hammurabi-commanders-channel-collect-mode-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      // First inbound prime: starts the conversation in followup mode (live send).
      expect((await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-collect',
          chatType: 'direct',
          peerId: 'peer-collect',
          message: 'first inbound',
          commanderId: COMMANDER_A,
        }),
      })).status).toBe(201)

      const beforeSendCalls = sessions.sendCalls.length

      // Second inbound: explicit collect mode must queue.
      expect((await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-collect',
          chatType: 'direct',
          peerId: 'peer-collect',
          message: 'collect inbound',
          mode: 'collect',
          commanderId: COMMANDER_A,
        }),
      })).status).toBe(200)

      const collectCall = sessions.sendCalls.slice(beforeSendCalls).find((call) => call.text === 'collect inbound')
      expect(collectCall).toBeDefined()
      expect(collectCall?.options).toEqual({ queue: true, priority: 'normal' })
    } finally {
      await server.close()
    }
  })

  it('channel-message returns 410 and archives the orphan when the bound commander has been deleted', async () => {
    // Regression for codex-review P1 on PR #1279 (comment 3174814198):
    // an inbound channel message that hits a conversation whose owning
    // commander was deleted used to throw and 500. The route now archives
    // the orphan and returns 410 Gone so webhooks treat the binding as
    // unrecoverable.
    const dir = await createTempDir('hammurabi-commanders-channel-orphan-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      // Prime an existing channel conversation under COMMANDER_A.
      expect((await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-orphan',
          chatType: 'direct',
          peerId: 'peer-orphan',
          message: 'first contact',
          commanderId: COMMANDER_A,
        }),
      })).status).toBe(201)

      // Operator stops the commander first (DELETE refuses to remove a
      // running commander), then deletes via the route. Cascade-archive runs
      // for every conversation owned by it, but the conversation row itself
      // survives in the store (archived). The next inbound channel message
      // for the same sessionKey hits the orphan path because the commander
      // record is gone.
      expect((await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/stop`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })).status).toBe(200)
      const deleteResponse = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}`, {
        method: 'DELETE',
        headers: FULL_AUTH_HEADERS,
      })
      expect(deleteResponse.status).toBe(204)

      const orphanResponse = await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-orphan',
          chatType: 'direct',
          peerId: 'peer-orphan',
          message: 'inbound after commander delete',
        }),
      })

      expect(orphanResponse.status).toBe(410)
      const body = await orphanResponse.json()
      expect(body).toEqual(expect.objectContaining({
        accepted: false,
        delivered: false,
        commanderId: COMMANDER_A,
      }))
      expect(typeof body.error).toBe('string')
      expect(body.error).toContain('deleted commander')
    } finally {
      await server.close()
    }
  })

  it('commander stop sweeps every per-conversation session, not just the legacy session', async () => {
    // Regression for codex-review P1 on PR #1279 (comment 3174778566):
    // POST /:id/stop used to delete only `activeCommanderSessions[id]` /
    // `toCommanderSessionName(id)`, leaving non-legacy per-conversation
    // sessions (`commander-${id}-conversation-${convId}`) running silently.
    // The handler now iterates conversations and calls stopConversationSession
    // for each before reporting `stopped`.
    const dir = await createTempDir('hammurabi-commanders-stop-sweep-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      // Two non-legacy conversations under one commander.
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'ui',
      })).status).toBe(201)
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_B,
        surface: 'api',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)
      expect((await startConversation(server.baseUrl, CONVERSATION_B, {
        agentType: 'claude',
      })).status).toBe(200)

      // Both per-conversation sessions exist on the live interface.
      const sessionNameA = `commander-${COMMANDER_A}-conversation-${CONVERSATION_A}`
      const sessionNameB = `commander-${COMMANDER_A}-conversation-${CONVERSATION_B}`
      expect(sessions.iface.getSession(sessionNameA)).toBeTruthy()
      expect(sessions.iface.getSession(sessionNameB)).toBeTruthy()

      // Stop the commander. Sweep must reach BOTH per-conversation sessions.
      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/stop`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(stopResponse.status).toBe(200)
      expect(await stopResponse.json()).toEqual(expect.objectContaining({
        id: COMMANDER_A,
        state: 'stopped',
        stopped: true,
      }))

      // No live per-conversation sessions remain after the sweep.
      expect(sessions.iface.getSession(sessionNameA)).toBeUndefined()
      expect(sessions.iface.getSession(sessionNameB)).toBeUndefined()

      // Both conversations land at status="idle" (not silently archived).
      const detailA = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      const detailB = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect((await detailA.json()).status).toBe('idle')
      expect((await detailB.json()).status).toBe('idle')
    } finally {
      await server.close()
    }
  })

  it('keeps commander state="stopped" intact when conversation mutations call updateCommanderDerivedState', async () => {
    // Regression for codex-review P2 on PR #1279 (comment 3174988519):
    // updateCommanderDerivedState used to flip stopped -> idle whenever a
    // conversation pause/archive/message ran, silently undoing the operator's
    // explicit /stop. The helper now treats stopped as a terminal state until
    // an explicit /start.
    const dir = await createTempDir('hammurabi-commanders-conversation-stopped-preserved-')
    const storePath = join(dir, 'sessions.json')
    const store = new CommanderSessionStore(storePath)
    await store.create({
      id: COMMANDER_A,
      host: 'host-stopped',
      state: 'stopped',
      created: '2026-05-01T00:00:00.000Z',
      agentType: 'claude',
      cwd: '/tmp',
      maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
      contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
      taskSource: null,
    })

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      // Create + archive an idle conversation. The archive path runs
      // updateCommanderDerivedState; the commander must remain `stopped`
      // afterwards (no flip to `idle`).
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })).status).toBe(201)

      const archive = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/archive`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(archive.status).toBe(200)

      // Re-read the commander record from the store and assert state is still
      // `stopped`. We re-instantiate the store so the assertion comes from
      // disk, not from any stale in-memory snapshot.
      const verifyStore = new CommanderSessionStore(storePath)
      const refreshed = await verifyStore.get(COMMANDER_A)
      expect(refreshed?.state).toBe('stopped')
    } finally {
      await server.close()
    }
  })
})
