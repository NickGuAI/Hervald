import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { CommanderSessionsInterface } from '../../agents/routes'
import {
  createCommandersRouter,
  type CommanderChannelReplyDispatchInput,
  type CommandersRouterOptions,
} from '../routes'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../store'

vi.setConfig({ testTimeout: 60_000 })

const COMMANDER_A = '00000000-0000-4000-a000-0000000000aa'
const COMMANDER_B = '00000000-0000-4000-a000-0000000000bb'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
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
  geminiSessionId?: string
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
}

interface MockSessionsInterface {
  interface: CommanderSessionsInterface
  createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]>
  sendCalls: Array<{ name: string; text: string }>
}

interface MockChannelReplyDispatchers {
  dispatchers: NonNullable<CommandersRouterOptions['channelReplyDispatchers']>
  calls: CommanderChannelReplyDispatchInput[]
}

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

afterEach(async () => {
  await sleep(75)
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  )
})

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-03-01T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
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

function createMockSessionsInterface(): MockSessionsInterface {
  const createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]> = []
  const sendCalls: Array<{ name: string; text: string }> = []
  const activeSessions = new Map<string, ActiveSessionState>()

  const sessionsInterface: CommanderSessionsInterface = {
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
        geminiSessionId: params.agentType === 'gemini'
          ? `gemini-${params.conversationId ?? params.name}`
          : undefined,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        },
      })
      return { kind: 'stream', name: params.name } as unknown as Awaited<ReturnType<
        CommanderSessionsInterface['createCommanderSession']
      >>
    },
    async dispatchWorkerForCommander() {
      return {
        status: 501,
        body: { error: 'dispatchWorkerForCommander not stubbed in this fixture' },
      }
    },
    async sendToSession(name, text) {
      sendCalls.push({ name, text })
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
        geminiSessionId: active.geminiSessionId,
        usage: { ...active.usage },
      } as unknown as ReturnType<CommanderSessionsInterface['getSession']>
    },
    subscribeToEvents() {
      return () => {}
    },
  }

  return {
    interface: sessionsInterface,
    createCalls,
    sendCalls,
  }
}

function createMockChannelReplyDispatchers(): MockChannelReplyDispatchers {
  const calls: CommanderChannelReplyDispatchInput[] = []
  const capture = async (input: CommanderChannelReplyDispatchInput): Promise<void> => {
    calls.push({
      commanderId: input.commanderId,
      message: input.message,
      channelMeta: { ...input.channelMeta },
      lastRoute: { ...input.lastRoute },
    })
  }

  return {
    dispatchers: {
      whatsapp: capture,
      telegram: capture,
      discord: capture,
    },
    calls,
  }
}

async function seedCommander(
  storePath: string,
  commanderId: string,
  options: {
    host?: string
  } = {},
): Promise<void> {
  const store = new CommanderSessionStore(storePath)
  await store.create({
    id: commanderId,
    host: options.host ?? `host-${commanderId.slice(-4)}`,
    state: 'idle',
    created: '2026-05-01T00:00:00.000Z',
    agentType: 'claude',
    cwd: '/tmp',
    maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
    contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
    taskSource: null,
  })
}

async function startServer(options: {
  sessionStorePath: string
  sessionsInterface: CommanderSessionsInterface
  channelReplyDispatchers?: NonNullable<CommandersRouterOptions['channelReplyDispatchers']>
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const memoryBasePath = join(dirname(options.sessionStorePath), 'memory')
  await mkdir(memoryBasePath, { recursive: true })

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    sessionStorePath: options.sessionStorePath,
    memoryBasePath,
    sessionsInterface: options.sessionsInterface,
    channelReplyDispatchers: options.channelReplyDispatchers,
  })
  app.use('/api/commanders', commanders.router)

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

async function postChannelMessage(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/commanders/channel-message`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function postChannelReply(
  baseUrl: string,
  commanderId: string,
  message: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/commanders/${encodeURIComponent(commanderId)}/channel-reply`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message }),
  })
}

describe('POST /api/commanders/channel-message', () => {
  it('upserts WhatsApp conversations under one commander instead of forking identities', async () => {
    const dir = await createTempDir('hammurabi-channel-whatsapp-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const firstResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'whatsapp',
        accountId: 'default',
        chatType: 'direct',
        peerId: '15551234567',
        displayName: '+1 555 123 4567',
        message: 'hello one',
      })
      expect(firstResponse.status).toBe(201)
      const firstBody = await firstResponse.json() as {
        accepted: boolean
        delivered: boolean
        created: boolean
        createdSession: boolean
        commanderId: string
        conversationId: string
        sessionKey: string
      }
      expect(firstBody.accepted).toBe(true)
      expect(firstBody.delivered).toBe(true)
      expect(firstBody.created).toBe(true)
      expect(firstBody.createdSession).toBe(true)
      expect(firstBody.commanderId).toBe(COMMANDER_A)
      expect(firstBody.sessionKey).toBe('whatsapp:default:direct:15551234567')

      const secondResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'whatsapp',
        accountId: 'default',
        chatType: 'direct',
        peerId: '15551234567',
        displayName: '+1 555 123 4567',
        message: 'hello two',
      })
      expect(secondResponse.status).toBe(200)
      const secondBody = await secondResponse.json() as {
        accepted: boolean
        delivered: boolean
        created: boolean
        createdSession: boolean
        commanderId: string
        conversationId: string
      }
      expect(secondBody.accepted).toBe(true)
      expect(secondBody.delivered).toBe(true)
      expect(secondBody.created).toBe(false)
      expect(secondBody.createdSession).toBe(false)
      expect(secondBody.commanderId).toBe(firstBody.commanderId)
      expect(secondBody.conversationId).toBe(firstBody.conversationId)

      const thirdResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'whatsapp',
        accountId: 'work',
        chatType: 'direct',
        peerId: '15551234567',
        displayName: '+1 555 123 4567',
        message: 'hello three',
      })
      expect(thirdResponse.status).toBe(201)
      const thirdBody = await thirdResponse.json() as {
        accepted: boolean
        delivered: boolean
        created: boolean
        commanderId: string
        conversationId: string
        sessionKey: string
      }
      expect(thirdBody.accepted).toBe(true)
      expect(thirdBody.delivered).toBe(true)
      expect(thirdBody.created).toBe(true)
      expect(thirdBody.commanderId).toBe(firstBody.commanderId)
      expect(thirdBody.conversationId).not.toBe(firstBody.conversationId)
      expect(thirdBody.sessionKey).toBe('whatsapp:work:direct:15551234567')

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const sessions = await listResponse.json() as Array<{ id: string }>
      expect(sessions.map((session) => session.id)).toEqual([COMMANDER_A])

      const conversationsResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        { headers: AUTH_HEADERS },
      )
      expect(conversationsResponse.status).toBe(200)
      const conversations = await conversationsResponse.json() as Array<{
        id: string
        channelMeta?: { sessionKey?: string }
      }>
      expect(conversations).toHaveLength(2)
      expect(conversations.map((conversation) => conversation.channelMeta?.sessionKey).sort()).toEqual([
        'whatsapp:default:direct:15551234567',
        'whatsapp:work:direct:15551234567',
      ])
      expect(mock.createCalls.map((call) => call.conversationId).sort()).toEqual(
        [firstBody.conversationId, thirdBody.conversationId].sort(),
      )
    } finally {
      await server.close()
    }
  })

  it('upserts Telegram groups and forum topics as separate conversations under the same commander', async () => {
    const dir = await createTempDir('hammurabi-channel-telegram-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const groupResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'telegram',
        accountId: 'default',
        chatType: 'group',
        peerId: 'supergroup-9876543',
        displayName: 'Ops Group',
        message: 'group ping',
      })
      expect(groupResponse.status).toBe(201)

      const topicOne = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'telegram',
        accountId: 'default',
        chatType: 'forum-topic',
        peerId: 'supergroup-9876543',
        threadId: '42',
        displayName: 'Ops Group / Deploys',
        message: 'topic one',
      })
      expect(topicOne.status).toBe(201)
      const topicOneBody = await topicOne.json() as {
        created: boolean
        commanderId: string
        conversationId: string
        sessionKey: string
      }
      expect(topicOneBody.created).toBe(true)
      expect(topicOneBody.commanderId).toBe(COMMANDER_A)
      expect(topicOneBody.sessionKey).toBe('telegram:default:forum-topic:supergroup-9876543:thread:42')

      const topicOneRepeat = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'telegram',
        accountId: 'default',
        chatType: 'forum-topic',
        peerId: 'supergroup-9876543',
        threadId: '42',
        displayName: 'Ops Group / Deploys',
        message: 'topic one repeat',
      })
      expect(topicOneRepeat.status).toBe(200)
      const topicOneRepeatBody = await topicOneRepeat.json() as {
        created: boolean
        commanderId: string
        conversationId: string
      }
      expect(topicOneRepeatBody.created).toBe(false)
      expect(topicOneRepeatBody.commanderId).toBe(topicOneBody.commanderId)
      expect(topicOneRepeatBody.conversationId).toBe(topicOneBody.conversationId)

      const topicTwo = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'telegram',
        accountId: 'default',
        chatType: 'forum-topic',
        peerId: 'supergroup-9876543',
        threadId: '43',
        displayName: 'Ops Group / Incidents',
        message: 'topic two',
      })
      expect(topicTwo.status).toBe(201)
      const topicTwoBody = await topicTwo.json() as { created: boolean; sessionKey: string }
      expect(topicTwoBody.created).toBe(true)
      expect(topicTwoBody.sessionKey).toBe('telegram:default:forum-topic:supergroup-9876543:thread:43')

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = await listResponse.json() as Array<{ id: string }>
      expect(sessions.map((session) => session.id)).toEqual([COMMANDER_A])

      const conversationsResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        { headers: AUTH_HEADERS },
      )
      const conversations = await conversationsResponse.json() as Array<{
        channelMeta?: { sessionKey?: string }
      }>
      expect(conversations).toHaveLength(3)
      expect(conversations.map((conversation) => conversation.channelMeta?.sessionKey).sort()).toEqual([
        'telegram:default:forum-topic:supergroup-9876543:thread:42',
        'telegram:default:forum-topic:supergroup-9876543:thread:43',
        'telegram:default:group:supergroup-9876543',
      ])
    } finally {
      await server.close()
    }
  })

  it('upserts Discord threads as distinct conversations under the same commander', async () => {
    const dir = await createTempDir('hammurabi-channel-discord-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const threadOneResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-111',
        parentPeerId: 'chan-ops',
        threadId: 'thread-111',
        displayName: '#partner-support / Engineering',
        message: 'thread one message',
      })
      expect(threadOneResponse.status).toBe(201)
      const threadOneBody = await threadOneResponse.json() as {
        created: boolean
        delivered: boolean
        commanderId: string
        conversationId: string
        sessionKey: string
      }
      expect(threadOneBody.created).toBe(true)
      expect(threadOneBody.delivered).toBe(true)
      expect(threadOneBody.commanderId).toBe(COMMANDER_A)
      expect(threadOneBody.sessionKey).toBe('discord:default:channel:chan-ops:thread:thread-111')

      const threadOneRepeat = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-111',
        parentPeerId: 'chan-ops',
        threadId: 'thread-111',
        displayName: '#partner-support / Engineering',
        message: 'thread one repeat',
      })
      expect(threadOneRepeat.status).toBe(200)
      const threadOneRepeatBody = await threadOneRepeat.json() as {
        created: boolean
        conversationId: string
      }
      expect(threadOneRepeatBody.created).toBe(false)
      expect(threadOneRepeatBody.conversationId).toBe(threadOneBody.conversationId)

      const threadTwoResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-222',
        parentPeerId: 'chan-ops',
        threadId: 'thread-222',
        displayName: '#partner-support / Engineering',
        message: 'thread two message',
      })
      expect(threadTwoResponse.status).toBe(201)
      const threadTwoBody = await threadTwoResponse.json() as {
        created: boolean
        commanderId: string
        conversationId: string
        sessionKey: string
      }
      expect(threadTwoBody.created).toBe(true)
      expect(threadTwoBody.commanderId).toBe(COMMANDER_A)
      expect(threadTwoBody.conversationId).not.toBe(threadOneBody.conversationId)
      expect(threadTwoBody.sessionKey).toBe('discord:default:channel:chan-ops:thread:thread-222')

      const conversationsResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        { headers: AUTH_HEADERS },
      )
      expect(conversationsResponse.status).toBe(200)
      const conversations = await conversationsResponse.json() as Array<{
        channelMeta?: { sessionKey?: string }
      }>
      expect(conversations).toHaveLength(2)
      expect(conversations.map((conversation) => conversation.channelMeta?.sessionKey).sort()).toEqual([
        'discord:default:channel:chan-ops:thread:thread-111',
        'discord:default:channel:chan-ops:thread:thread-222',
      ])
    } finally {
      await server.close()
    }
  })

  it('resolves a new channel conversation by commander name when exactly one commander matches', async () => {
    const dir = await createTempDir('hammurabi-channel-name-match-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, { host: 'athena' })

    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const response = await postChannelMessage(server.baseUrl, {
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-333',
        parentPeerId: 'chan-ops',
        threadId: 'thread-333',
        displayName: '#partner-support / Engineering',
        message: '@athena please take this thread',
      })
      expect(response.status).toBe(201)
      const body = await response.json() as { commanderId: string; created: boolean }
      expect(body.created).toBe(true)
      expect(body.commanderId).toBe(COMMANDER_A)
    } finally {
      await server.close()
    }
  })

  it('returns 409 when a new channel conversation matches multiple commanders', async () => {
    const dir = await createTempDir('hammurabi-channel-name-ambiguous-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, { host: 'athena' })
    await seedCommander(storePath, COMMANDER_B, { host: 'athena' })

    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const response = await postChannelMessage(server.baseUrl, {
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-444',
        parentPeerId: 'chan-ops',
        threadId: 'thread-444',
        displayName: '#partner-support / Engineering',
        message: '@athena please take this thread',
      })
      expect(response.status).toBe(409)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('specify commanderId')
    } finally {
      await server.close()
    }
  })
})

describe('POST /api/commanders/:id/channel-reply', () => {
  it('delivers replies using the persisted conversation route after restart', async () => {
    const dir = await createTempDir('hammurabi-channel-reply-restart-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const initialSessions = createMockSessionsInterface()
    const outbound = createMockChannelReplyDispatchers()
    const firstServer = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: initialSessions.interface,
      channelReplyDispatchers: outbound.dispatchers,
    })

    try {
      const inbound = await postChannelMessage(firstServer.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'telegram',
        accountId: 'default',
        chatType: 'group',
        peerId: 'supergroup-9876543',
        displayName: 'Ops Group',
        message: 'inbound before restart',
      })
      expect(inbound.status).toBe(201)
    } finally {
      await firstServer.close()
    }

    const restartedSessions = createMockSessionsInterface()
    const restartedServer = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: restartedSessions.interface,
      channelReplyDispatchers: outbound.dispatchers,
    })

    try {
      const reply = await postChannelReply(
        restartedServer.baseUrl,
        COMMANDER_A,
        'reply after restart',
      )
      expect(reply.status).toBe(200)
      const replyBody = await reply.json() as {
        delivered: boolean
        provider: string
        sessionKey: string
      }
      expect(replyBody.delivered).toBe(true)
      expect(replyBody.provider).toBe('telegram')
      expect(replyBody.sessionKey).toBe('telegram:default:group:supergroup-9876543')

      expect(outbound.calls).toHaveLength(1)
      expect(outbound.calls[0]).toEqual({
        commanderId: COMMANDER_A,
        message: 'reply after restart',
        channelMeta: {
          provider: 'telegram',
          chatType: 'group',
          accountId: 'default',
          peerId: 'supergroup-9876543',
          sessionKey: 'telegram:default:group:supergroup-9876543',
          displayName: 'Ops Group',
        },
        lastRoute: {
          channel: 'telegram',
          to: 'supergroup-9876543',
          accountId: 'default',
        },
      })
    } finally {
      await restartedServer.close()
    }
  })

  it('routes replies to the most recent Discord thread conversation', async () => {
    const dir = await createTempDir('hammurabi-channel-reply-discord-thread-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const mock = createMockSessionsInterface()
    const outbound = createMockChannelReplyDispatchers()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
      channelReplyDispatchers: outbound.dispatchers,
    })

    try {
      const threadOneResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-111',
        parentPeerId: 'chan-ops',
        threadId: 'thread-111',
        displayName: '#partner-support / Engineering',
        message: 'thread one message',
      })
      expect(threadOneResponse.status).toBe(201)

      const threadTwoResponse = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'discord',
        accountId: 'default',
        chatType: 'channel',
        peerId: 'thread-222',
        parentPeerId: 'chan-ops',
        threadId: 'thread-222',
        displayName: '#partner-support / Engineering',
        message: 'thread two message',
      })
      expect(threadTwoResponse.status).toBe(201)

      const replyResponse = await postChannelReply(
        server.baseUrl,
        COMMANDER_A,
        'threaded reply',
      )
      expect(replyResponse.status).toBe(200)

      expect(outbound.calls).toHaveLength(1)
      expect(outbound.calls[0]?.lastRoute).toEqual({
        channel: 'discord',
        to: 'chan-ops',
        accountId: 'default',
        threadId: 'thread-222',
      })
    } finally {
      await server.close()
    }
  })

  it('routes replies to WhatsApp groups using the conversation channel binding', async () => {
    const dir = await createTempDir('hammurabi-channel-reply-whatsapp-group-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const mock = createMockSessionsInterface()
    const outbound = createMockChannelReplyDispatchers()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
      channelReplyDispatchers: outbound.dispatchers,
    })

    try {
      const inbound = await postChannelMessage(server.baseUrl, {
        commanderId: COMMANDER_A,
        provider: 'whatsapp',
        accountId: 'default',
        chatType: 'group',
        peerId: '120363012345@g.us',
        displayName: 'Ops Alerts',
        message: 'group inbound',
      })
      expect(inbound.status).toBe(201)

      const reply = await postChannelReply(
        server.baseUrl,
        COMMANDER_A,
        'group reply',
      )
      expect(reply.status).toBe(200)

      expect(outbound.calls).toHaveLength(1)
      expect(outbound.calls[0]?.lastRoute).toEqual({
        channel: 'whatsapp',
        to: '120363012345@g.us',
        accountId: 'default',
      })
      expect(outbound.calls[0]?.channelMeta.sessionKey).toBe('whatsapp:default:group:120363012345@g.us')
    } finally {
      await server.close()
    }
  })
})
