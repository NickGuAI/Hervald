import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WebSocket } from 'ws'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import {
  appendTranscriptEvent,
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
} from '../../agents/transcript-store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'
import type { CommanderSessionsInterface } from '../../agents/routes'
import type { AgentType, SessionSendPayload } from '../../agents/types'
import type { QueuedMessageImage } from '../../agents/message-queue'
import { MAX_MESSAGE_IMAGE_COUNT } from '../../agents/message-images'
import { buildConversationSessionName } from '../routes/conversation-runtime'
import { resetConversationRuntimeOverlays } from '../routes/conversation-runtime-state'
import { CommanderChannelBindingStore, CommanderChannelBindingConflictError } from '../../channels/store'
import {
  buildDefaultCommanderConversationId,
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../store'
import { createDefaultHeartbeatConfig } from '../heartbeat'
import { STARTUP_PROMPT } from '../routes/context'
import type { WorkspaceResolverCapability } from '../../workspace/capability'
import { resolveWorkspaceRoot } from '../../workspace/resolver'

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

const FRESH_OPERATOR_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'fresh-operator-key',
}

function assistantTextEvent(index: number, text: string) {
  return {
    type: 'assistant',
    timestamp: new Date(Date.UTC(2026, 4, 1, 0, 0, index)).toISOString(),
    message: {
      id: `assistant-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  }
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

interface ActiveSessionState {
  kind?: 'stream' | 'pty'
  agentType: AgentType
  model?: string
  conversationId?: string
  providerContext?: {
    providerId: AgentType
    sessionId?: string
    threadId?: string
    maxThinkingTokens?: number
  }
  events: Array<Record<string, unknown>>
  conversationEntryCount: number
  lastTurnCompleted: boolean
  pendingDirectSendMessages: Array<Record<string, unknown>>
  codexTurnWatchdogTimer?: NodeJS.Timeout
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
}

interface MockSessionsFixture {
  iface: CommanderSessionsInterface
  createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]>
  activeSessions: Map<string, ActiveSessionState>
  sendCalls: Array<{
    name: string
    text: string
    images?: QueuedMessageImage[]
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }>
  dispose: () => void
}

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  resetConversationRuntimeOverlays()
  resetTranscriptStoreRoot()
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
      scopes: [
        'agents:read',
        'agents:write',
        'commanders:read',
        'commanders:write',
        'commanders:channels:write',
      ],
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
    'fresh-operator-key': {
      id: 'fresh-operator-key-id',
      name: 'Fresh Operator Key',
      keyHash: 'hash-fresh-operator',
      prefix: 'hmrb_fresh',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
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

function createMockSessionsInterface(
  options: { attachCodexWatchdogTimer?: boolean } = {},
): MockSessionsFixture {
  const createCalls: Array<Parameters<CommanderSessionsInterface['createCommanderSession']>[0]> = []
  const sendCalls: Array<{
    name: string
    text: string
    images?: QueuedMessageImage[]
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }> = []
  const activeSessions = new Map<string, ActiveSessionState>()
  const timers: NodeJS.Timeout[] = []

  function buildSessionState(
    params: Parameters<CommanderSessionsInterface['createCommanderSession']>[0],
    previous?: ActiveSessionState,
  ): ActiveSessionState {
    const codexTurnWatchdogTimer = options.attachCodexWatchdogTimer && params.agentType === 'codex'
      ? setTimeout(() => {}, 30_000)
      : undefined
    codexTurnWatchdogTimer?.unref()
    if (codexTurnWatchdogTimer) {
      timers.push(codexTurnWatchdogTimer)
    }

    return {
      kind: 'stream',
      agentType: params.agentType,
      model: params.model,
      conversationId: params.conversationId,
      providerContext: params.agentType === 'claude'
        ? {
          providerId: 'claude',
          sessionId: `claude-${params.conversationId ?? params.name}`,
          ...(params.maxThinkingTokens ? { maxThinkingTokens: params.maxThinkingTokens } : {}),
        }
        : params.agentType === 'codex'
          ? {
            providerId: 'codex',
            threadId: `codex-${params.conversationId ?? params.name}`,
          }
          : params.agentType === 'gemini'
            ? {
              providerId: 'gemini',
              sessionId: `gemini-${params.conversationId ?? params.name}`,
            }
            : previous?.providerContext,
      events: previous?.events ? [...previous.events] : [],
      conversationEntryCount: previous?.conversationEntryCount ?? 0,
      lastTurnCompleted: true,
      pendingDirectSendMessages: [],
      codexTurnWatchdogTimer,
      usage: {
        inputTokens: previous?.usage.inputTokens ?? 10,
        outputTokens: previous?.usage.outputTokens ?? 20,
        costUsd: previous?.usage.costUsd ?? 0.25,
      },
    }
  }

  const iface: CommanderSessionsInterface = {
    async createCommanderSession(params) {
      createCalls.push(params)
      const next = buildSessionState(params)
      activeSessions.set(params.name, next)
      return {
        kind: 'stream',
        name: params.name,
        agentType: params.agentType,
        model: params.model,
        conversationId: params.conversationId,
        providerContext: next.providerContext,
        usage: { ...next.usage },
        events: [...next.events],
        conversationEntryCount: next.conversationEntryCount,
        lastTurnCompleted: true,
        pendingDirectSendMessages: [],
        clients: new Set(),
      } as unknown as Awaited<ReturnType<CommanderSessionsInterface['createCommanderSession']>>
    },
    async replaceCommanderSession(params) {
      createCalls.push(params)
      const previous = activeSessions.get(params.name)
      const next = buildSessionState(params, previous)
      activeSessions.set(params.name, next)
      return {
        kind: 'stream',
        name: params.name,
        agentType: params.agentType,
        model: params.model,
        conversationId: params.conversationId,
        providerContext: next.providerContext,
        usage: { ...next.usage },
        events: [...next.events],
        conversationEntryCount: next.conversationEntryCount,
        lastTurnCompleted: true,
        pendingDirectSendMessages: [],
        clients: new Set(),
      } as unknown as Awaited<ReturnType<CommanderSessionsInterface['replaceCommanderSession']>>
    },
    async dispatchWorkerForCommander() {
      return {
        status: 501,
        body: { error: 'dispatchWorkerForCommander is not stubbed for this fixture' },
      }
    },
    async sendToSession(name, payload, options) {
      const normalized: SessionSendPayload = typeof payload === 'string'
        ? { text: payload }
        : payload
      const images = normalized.images && normalized.images.length > 0 ? [...normalized.images] : undefined
      sendCalls.push(options
        ? { name, text: normalized.text, images, options }
        : { name, text: normalized.text, images })
      const active = activeSessions.get(name)
      if (active) {
        active.events.push({
          type: 'user',
          message: {
            role: 'user',
            content: images
              ? [
                  ...(normalized.text ? [{ type: 'text', text: normalized.text }] : []),
                  ...images.map((image) => ({
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: image.mediaType,
                      data: image.data,
                    },
                  })),
                ]
              : normalized.text,
          },
        })
        active.conversationEntryCount += 1
      }
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
      if (active.kind === 'pty') {
        return {
          kind: 'pty',
          name,
          agentType: active.agentType,
          model: active.model,
          conversationId: active.conversationId,
          createdAt: '2026-05-01T00:00:00.000Z',
          lastEventAt: '2026-05-01T00:00:00.000Z',
        } as unknown as ReturnType<CommanderSessionsInterface['getSession']>
      }
      return {
        kind: 'stream',
        name,
        agentType: active.agentType,
        model: active.model,
        conversationId: active.conversationId,
        providerContext: active.providerContext,
        usage: { ...active.usage },
        events: [...active.events],
        conversationEntryCount: active.conversationEntryCount,
        lastTurnCompleted: active.lastTurnCompleted,
        pendingDirectSendMessages: [...active.pendingDirectSendMessages],
        codexTurnWatchdogTimer: active.codexTurnWatchdogTimer,
        currentQueuedMessage: undefined,
        clients: new Set(),
      } as unknown as ReturnType<CommanderSessionsInterface['getSession']>
    },
    subscribeToEvents() {
      return () => {}
    },
  }

  return {
    iface,
    activeSessions,
    createCalls,
    sendCalls,
    dispose: () => {
      for (const timer of timers.splice(0)) {
        clearTimeout(timer)
      }
    },
  }
}

async function seedCommander(
  storePath: string,
  commanderId: string,
  options: { agentType?: AgentType; model?: string | null } = {},
): Promise<void> {
  const store = new CommanderSessionStore(storePath)
  await store.create({
    id: commanderId,
    host: `host-${commanderId.slice(-4)}`,
    state: 'idle',
    created: '2026-05-01T00:00:00.000Z',
    agentType: options.agentType ?? 'claude',
    ...(options.model !== undefined ? { model: options.model } : {}),
    cwd: '/tmp',
    maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
    contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
    taskSource: null,
  })
}

async function seedOpenChannelBindings(storePath: string): Promise<CommanderChannelBindingStore> {
  const dataDir = dirname(storePath)
  const channelStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
  const commanderStore = new CommanderSessionStore(storePath)
  const commanders = await commanderStore.list()

  for (const commander of commanders) {
    for (const provider of ['whatsapp', 'telegram', 'discord'] as const) {
      const accountIds = provider === 'whatsapp'
        ? ['default', 'work', 'acct-autostart', 'acct-collect', 'acct-orphan']
        : ['default']
      for (const accountId of accountIds) {
        try {
          await channelStore.create({
            commanderId: commander.id,
            provider,
            accountId,
            displayName: `${provider} ${accountId}`,
            config: { dmPolicy: 'open', groupPolicy: 'open' },
          })
        } catch (error) {
          if (!(error instanceof CommanderChannelBindingConflictError)) {
            throw error
          }
        }
      }
    }
  }

  return channelStore
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
  const channelBindingStore = options.channelBindingStore
    ?? await seedOpenChannelBindings(sessionStorePath)

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
    sessionStorePath,
    memoryBasePath,
    channelBindingStore,
  })
  app.use('/api/commanders', commanders.router)
  app.use('/api/conversations', commanders.conversationRouter)

  const httpServer = createServer(app)
  if (commanders.handleConversationUpgrade) {
    httpServer.on('upgrade', commanders.handleConversationUpgrade)
  }
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
    agentType?: AgentType
    model?: string | null
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
    agentType?: AgentType
    model?: string | null
    effort?: 'low' | 'medium' | 'high' | 'max'
    adaptiveThinking?: 'enabled' | 'disabled'
    maxThinkingTokens?: number
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
  it('allows fresh operator write scopes to create conversations', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-create-auth-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const server = await startServer({ sessionStorePath: storePath })

    try {
      const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`, {
        method: 'POST',
        headers: {
          ...FRESH_OPERATOR_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: CONVERSATION_A,
          surface: 'cli',
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
        surface: 'cli',
      }))
    } finally {
      await server.close()
    }
  })

  it('records API-key creation provenance on allowed conversation creation', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-provenance-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const server = await startServer({ sessionStorePath: storePath })

    try {
      const response = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        creationSource: 'api',
        createdByKind: 'api-key',
        createdById: 'full-scope-key-id',
      }))
    } finally {
      await server.close()
    }
  })

  it('returns transcript-backed conversation messages with default last-ten paging', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-messages-')
    const storePath = join(dir, 'sessions.json')
    setTranscriptStoreRoot(join(dir, 'transcripts'))
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'ui',
      })
      expect(createResponse.status).toBe(201)
      const conversation = await createResponse.json() as {
        id: string
        commanderId: string
      }
      const sessionName = buildConversationSessionName(conversation as Parameters<typeof buildConversationSessionName>[0])

      for (let index = 0; index < 12; index += 1) {
        await appendTranscriptEvent(sessionName, assistantTextEvent(index, `history ${index}`))
      }

      const response = await fetch(
        `${server.baseUrl}/api/conversations/${CONVERSATION_A}/messages`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        source: string
        limit: number
        nextBefore: string | null
        hasMore: boolean
        totalMessages: number
        messages: Array<{ kind: string; text: string }>
      }
      expect(payload.source).toBe('transcript')
      expect(payload.limit).toBe(10)
      expect(payload.nextBefore).toBe('2')
      expect(payload.hasMore).toBe(true)
      expect(payload.totalMessages).toBe(12)
      expect(payload.messages.map((message) => message.text)).toEqual([
        'history 2',
        'history 3',
        'history 4',
        'history 5',
        'history 6',
        'history 7',
        'history 8',
        'history 9',
        'history 10',
        'history 11',
      ])

      const olderResponse = await fetch(
        `${server.baseUrl}/api/conversations/${CONVERSATION_A}/messages?before=2`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(olderResponse.status).toBe(200)
      const olderPayload = await olderResponse.json() as {
        nextBefore: string | null
        hasMore: boolean
        messages: Array<{ text: string }>
      }
      expect(olderPayload.nextBefore).toBeNull()
      expect(olderPayload.hasMore).toBe(false)
      expect(olderPayload.messages.map((message) => message.text)).toEqual([
        'history 0',
        'history 1',
      ])
    } finally {
      sessions.dispose()
      await server.close()
    }
  })

  it('uses the live session buffer when it is fresher than the transcript store', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-live-messages-')
    const storePath = join(dir, 'sessions.json')
    setTranscriptStoreRoot(join(dir, 'transcripts'))
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'ui',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)

      const sessionName = buildConversationSessionName({
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
      } as Parameters<typeof buildConversationSessionName>[0])
      const activeSession = sessions.activeSessions.get(sessionName)
      if (!activeSession) {
        throw new Error('Expected active conversation session')
      }
      activeSession.events = Array.from(
        { length: 12 },
        (_, index) => assistantTextEvent(index, `live ${index}`),
      )

      const response = await fetch(
        `${server.baseUrl}/api/conversations/${CONVERSATION_A}/messages`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        source: string
        messages: Array<{ text: string }>
      }
      expect(payload.source).toBe('live')
      expect(payload.messages.map((message) => message.text)).toEqual([
        'live 2',
        'live 3',
        'live 4',
        'live 5',
        'live 6',
        'live 7',
        'live 8',
        'live 9',
        'live 10',
        'live 11',
      ])
    } finally {
      sessions.dispose()
      await server.close()
    }
  })

  it('returns the backend-selected default chat for a commander', async () => {
    const dir = await createTempDir('hammurabi-commanders-active-chat-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const emptyActiveResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(emptyActiveResponse.status).toBe(200)
      expect(await emptyActiveResponse.json()).toBeNull()

      const defaultConversationId = buildDefaultCommanderConversationId(COMMANDER_A)
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: defaultConversationId,
        surface: 'ui',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, defaultConversationId, {
        agentType: 'claude',
      })).status).toBe(200)

      const defaultOnlyActiveResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(defaultOnlyActiveResponse.status).toBe(200)
      expect(await defaultOnlyActiveResponse.json()).toBeNull()

      const defaultListResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(defaultListResponse.status).toBe(200)
      expect(await defaultListResponse.json()).toEqual([
        expect.objectContaining({
          id: defaultConversationId,
          isDefaultConversation: true,
          liveSession: expect.objectContaining({
            name: expect.stringContaining(`-conversation-${defaultConversationId}`),
          }),
        }),
      ])

      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)

      const firstActiveResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(firstActiveResponse.status).toBe(200)
      expect(await firstActiveResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        isDefaultConversation: false,
        status: 'active',
        liveSession: expect.objectContaining({
          name: expect.stringContaining(`-conversation-${CONVERSATION_A}`),
        }),
      }))

      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_B,
        surface: 'ui',
      })).status).toBe(201)
      const renameIdleResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}`, {
        method: 'PATCH',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'recent idle chat' }),
      })
      expect(renameIdleResponse.status).toBe(200)

      // Per #1362 corrected contract: active > idle in selection priority,
      // regardless of which row was most recently touched. The renamed idle
      // chat (CONVERSATION_B) bumps lastMessageAt but must NOT outrank an
      // already-active chat (CONVERSATION_A).
      const activeStillWinsResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(activeStillWinsResponse.status).toBe(200)
      expect(await activeStillWinsResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        isDefaultConversation: false,
        status: 'active',
      }))

      // Pause the active conversation so only idles remain. Newest createdAt
      // wins among idle rows (CONVERSATION_B was created after CONVERSATION_A).
      const pauseResponse = await fetch(
        `${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`,
        { method: 'POST', headers: FULL_AUTH_HEADERS },
      )
      expect(pauseResponse.status).toBe(200)

      const idleOnlyResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(idleOnlyResponse.status).toBe(200)
      expect(await idleOnlyResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_B,
        isDefaultConversation: false,
        status: 'idle',
        liveSession: null,
      }))
    } finally {
      await server.close()
    }
  })

  it('supports the explicit conversation CRUD flow including start, message reuse, and archive aliases', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-crud-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const workspaceDir = await createTempDir('hammurabi-commanders-conversation-workspace-')
    await writeFile(join(workspaceDir, 'README.md'), '# Workspace context\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-conversation',
        label: 'local',
      },
    })
    const workspaceResolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-conversation',
        conversationId: CONVERSATION_A,
        label: 'local',
        host: 'local',
        rootPath: workspaceDir,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => ({
        target: {
          targetId,
          conversationId: CONVERSATION_A,
          label: 'local',
          host: 'local',
          rootPath: workspaceDir,
          readOnly: false,
        },
        workspace,
        host: 'local',
        rootPath: workspace.rootPath,
        readOnly: false,
      }),
    }
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
      getWorkspaceResolver: () => workspaceResolver,
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
        isDefaultConversation: false,
        status: 'idle',
        liveSession: null,
      }))

      const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      expect(await detailResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        isDefaultConversation: false,
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
            name?: string
          } | null
        }
      }
      expect(started.conversation).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'active',
        agentType: 'claude',
      }))
      expect(started.conversation.liveSession?.name).toContain(`-conversation-${CONVERSATION_A}`)
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
            name?: string
          } | null
        }
      }
      expect(firstMessage.accepted).toBe(true)
      expect(firstMessage.createdSession).toBe(false)
      expect(firstMessage.conversation.liveSession?.name).toContain(`-conversation-${CONVERSATION_A}`)
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

      const workspaceContextResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Use this context.',
          workspaceContext: {
            targetId: 'wt-conversation',
            conversationId: CONVERSATION_A,
            filePaths: ['README.md'],
            fileAnnotations: [{
              path: 'README.md',
              body: 'Explain the workspace heading.',
            }],
          },
        }),
      })
      expect(workspaceContextResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)?.text).toContain('<workspace-files>')
      expect(sessions.sendCalls.at(-1)?.text).toContain('@README.md')
      expect(sessions.sendCalls.at(-1)?.text).toContain('Explain the workspace heading.')
      expect(sessions.sendCalls.at(-1)?.text).toContain('Use this context.')

      const missingTargetContextResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Use fallback context.',
          workspaceContext: {
            filePaths: ['docs/no-target.md'],
            fileAnnotations: [{
              path: 'docs/note.md',
              body: 'Fallback annotation body.',
            }],
          },
        }),
      })
      expect(missingTargetContextResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)?.text).toContain('@docs/no-target.md')
      expect(sessions.sendCalls.at(-1)?.text).toContain('Fallback annotation body.')
      expect(sessions.sendCalls.at(-1)?.text).toContain('Use fallback context.')

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

      const image = { mediaType: 'image/png', data: Buffer.from('image-bytes').toString('base64') }
      const imageMessageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Inspect this screenshot.',
          images: [image],
        }),
      })
      expect(imageMessageResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)).toEqual(expect.objectContaining({
        text: 'Inspect this screenshot.',
        images: [image],
      }))

      const imageOnlyMessageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: '',
          images: [image],
        }),
      })
      expect(imageOnlyMessageResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)).toEqual(expect.objectContaining({
        text: '',
        images: [image],
      }))

      const imageOnlyQueueResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: '',
          images: [image],
          queue: true,
        }),
      })
      expect(imageOnlyQueueResponse.status).toBe(200)
      expect(sessions.sendCalls.at(-1)).toEqual(expect.objectContaining({
        text: '',
        images: [image],
        options: {
          queue: true,
          priority: 'normal',
        },
      }))

      const sendCallCountBeforeInvalidImage = sessions.sendCalls.length
      const unsupportedImageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: '',
          images: [{ mediaType: 'image/svg+xml', data: 'abc' }],
        }),
      })
      expect(unsupportedImageResponse.status).toBe(400)
      expect(await unsupportedImageResponse.json()).toEqual({
        error: 'Unsupported image type. Use PNG, JPEG, GIF, or WebP.',
      })
      expect(sessions.sendCalls).toHaveLength(sendCallCountBeforeInvalidImage)

      const tooManyImagesResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: '',
          images: Array.from({ length: MAX_MESSAGE_IMAGE_COUNT + 1 }, () => image),
        }),
      })
      expect(tooManyImagesResponse.status).toBe(413)
      expect(await tooManyImagesResponse.json()).toEqual({
        error: `At most ${MAX_MESSAGE_IMAGE_COUNT} images can be sent at once`,
      })
      expect(sessions.sendCalls).toHaveLength(sendCallCountBeforeInvalidImage)

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
          name?: string
        } | null
      }
      expect(resumed.id).toBe(CONVERSATION_A)
      expect(resumed.status).toBe('active')
      expect(resumed.liveSession?.name).toContain(`-conversation-${CONVERSATION_A}`)
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

  it('patches a stopped conversation name, provider, and model without starting it', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-patch-')
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

      const messageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Carry this transcript forward.',
        }),
      })
      expect(messageResponse.status).toBe(200)

      const pauseResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pauseResponse.status).toBe(200)

      const patchResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        method: 'PATCH',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'quiet-falcon',
          agentType: 'codex',
          model: 'gpt-5.5',
        }),
      })
      expect(patchResponse.status).toBe(200)
      expect(await patchResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        name: 'quiet-falcon',
        status: 'idle',
        agentType: 'codex',
        model: 'gpt-5.5',
        providerContext: expect.objectContaining({
          providerId: 'claude',
          sessionId: `claude-${CONVERSATION_A}`,
        }),
        liveSession: null,
      }))

      expect(sessions.createCalls).toHaveLength(1)
      expect(sessions.activeSessions.size).toBe(0)

      const restartResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'codex',
      })
      expect(restartResponse.status).toBe(200)
      expect(sessions.createCalls).toHaveLength(2)
      expect(sessions.createCalls[1]).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.5',
        resumeProviderContext: expect.objectContaining({
          providerId: 'claude',
          sessionId: `claude-${CONVERSATION_A}`,
        }),
      }))
    } finally {
      await server.close()
    }
  })

  it('patches conversation agentType and model together with registry validation', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-patch-model-')
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
        agentType: 'claude',
      })
      expect(createResponse.status).toBe(201)

      const patchResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        method: 'PATCH',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'codex',
          model: 'gpt-5.5',
        }),
      })
      expect(patchResponse.status).toBe(200)
      expect(await patchResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        agentType: 'codex',
        model: 'gpt-5.5',
      }))

      const invalidPatchResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        method: 'PATCH',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'codex',
          model: 'claude-opus-4-6',
        }),
      })
      expect(invalidPatchResponse.status).toBe(400)
      expect(await invalidPatchResponse.json()).toEqual({
        error: expect.stringContaining('not valid'),
        validIds: expect.arrayContaining(['gpt-5.5']),
      })
    } finally {
      await server.close()
    }
  })

  it('rejects provider and model changes while a conversation is active', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-swap-cost-')
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

      const sessionName = Array.from(sessions.activeSessions.keys())[0]
      expect(sessionName).toBeDefined()
      if (!sessionName) {
        throw new Error('Expected an active conversation session after start')
      }

      const liveSession = sessions.activeSessions.get(sessionName)
      expect(liveSession).toBeDefined()
      if (!liveSession) {
        throw new Error('Expected active session state for provider swap test')
      }
      liveSession.usage = {
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 5,
      }

      const patchResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        method: 'PATCH',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'codex',
          model: 'gpt-5.5',
        }),
      })
      expect(patchResponse.status).toBe(409)
      expect(await patchResponse.json()).toEqual({
        error: `Conversation "${CONVERSATION_A}" is active; stop it before changing provider or model`,
      })
      expect(sessions.activeSessions.get(sessionName)?.usage.costUsd).toBe(5)

      const pauseResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pauseResponse.status).toBe(200)
      expect(await pauseResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        agentType: 'claude',
        totalCostUsd: 5,
        liveSession: null,
      }))
    } finally {
      await server.close()
    }
  })

  it('hard deletes the conversation row and transcript artifacts when hard=true', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-hard-delete-')
    const transcriptRoot = await createTempDir('hammurabi-commanders-conversation-transcripts-')
    setTranscriptStoreRoot(transcriptRoot)
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

      const sessionName = buildConversationSessionName({
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
        surface: 'api',
        name: 'hard-delete-chat',
        status: 'active',
        currentTask: null,
        lastHeartbeat: null,
        heartbeat: createDefaultHeartbeatConfig(),
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
        lastMessageAt: '2026-05-01T00:00:00.000Z',
      })
      const conversationPath = join(dir, COMMANDER_A, 'conversations', `${CONVERSATION_A}.json`)
      const commanderTranscriptPath = join(dir, COMMANDER_A, 'sessions', `claude-${CONVERSATION_A}.jsonl`)
      const sharedTranscriptPath = join(transcriptRoot, sessionName, 'transcript.v1.jsonl')
      await mkdir(join(dir, COMMANDER_A, 'sessions'), { recursive: true })
      await mkdir(join(transcriptRoot, sessionName), { recursive: true })
      await writeFile(commanderTranscriptPath, '{"type":"message","text":"persist me"}\n', 'utf8')
      await writeFile(sharedTranscriptPath, '{"type":"message","text":"persist me"}\n', 'utf8')

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/conversations/${CONVERSATION_A}?hard=true`,
        {
          method: 'DELETE',
          headers: FULL_AUTH_HEADERS,
        },
      )
      expect(deleteResponse.status).toBe(200)
      expect(await deleteResponse.json()).toEqual({
        deleted: true,
        hard: true,
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
      })

      await expect(access(conversationPath)).rejects.toThrow()
      await expect(access(commanderTranscriptPath)).rejects.toThrow()
      await expect(access(sharedTranscriptPath)).rejects.toThrow()

      const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('persists agentType at create time and never auto-starts the conversation (#1362)', async () => {
    const dir = await createTempDir('hammurabi-commanders-create-agentType-')
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
        surface: 'ui',
        agentType: 'codex',
        model: 'gpt-5.5',
      })
      expect(createResponse.status).toBe(201)
      expect(await createResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        agentType: 'codex',
        model: 'gpt-5.5',
        liveSession: null,
      }))
      // Per #1362 contract: creation must NEVER spawn a session.
      expect(sessions.createCalls).toHaveLength(0)

      const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      expect(await detailResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        status: 'idle',
        agentType: 'codex',
        model: 'gpt-5.5',
        liveSession: null,
      }))
    } finally {
      await server.close()
    }
  })

  it('rejects an invalid agentType on create with 400', async () => {
    const dir = await createTempDir('hammurabi-commanders-create-invalid-agentType-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        {
          method: 'POST',
          headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({ id: CONVERSATION_A, surface: 'ui', agentType: 'not-a-provider' }),
        },
      )
      expect(createResponse.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('rejects a cross-provider model on create with valid model ids', async () => {
    const dir = await createTempDir('hammurabi-commanders-create-invalid-model-')
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
        surface: 'ui',
        agentType: 'codex',
        model: 'claude-opus-4-6',
      })
      expect(createResponse.status).toBe(400)
      expect(await createResponse.json()).toEqual({
        error: expect.stringContaining('not valid'),
        validIds: expect.arrayContaining(['gpt-5.5']),
      })
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
            name: expect.stringContaining(`-conversation-${CONVERSATION_A}`),
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

  it('reports starting conversations until provider bootstrap is websocket-ready', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-starting-state-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const createCommanderSession = sessions.iface.createCommanderSession.bind(sessions.iface)
    let releaseCreate: (() => void) | null = null
    let createStarted = false
    sessions.iface.createCommanderSession = vi.fn(async (params) => {
      createStarted = true
      await new Promise<void>((resolve) => {
        releaseCreate = resolve
      })
      return createCommanderSession(params)
    }) as CommanderSessionsInterface['createCommanderSession']

    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })).status).toBe(201)

      const startPromise = startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      await vi.waitFor(() => expect(createStarted).toBe(true))
      const startResponse = await startPromise
      expect(startResponse.status).toBe(202)
      expect(await startResponse.json()).toEqual({
        conversation: expect.objectContaining({
          id: CONVERSATION_A,
          status: 'idle',
          runtimeState: 'starting',
          websocketReady: false,
          liveSession: null,
          allowedActions: expect.objectContaining({
            start: false,
            pause: true,
            resume: false,
            send: false,
          }),
          displayState: expect.objectContaining({
            runtimeState: 'starting',
            websocketReady: false,
            hasLiveSession: false,
          }),
        }),
      })

      const startingDetailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(startingDetailResponse.status).toBe(200)
      expect(await startingDetailResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        runtimeState: 'starting',
        websocketReady: false,
      }))

      releaseCreate?.()

      await vi.waitFor(async () => {
        const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
          headers: READ_ONLY_AUTH_HEADERS,
        })
        expect(detailResponse.status).toBe(200)
        expect(await detailResponse.json()).toEqual(expect.objectContaining({
          id: CONVERSATION_A,
          status: 'active',
          runtimeState: 'active',
          websocketReady: true,
          liveSession: expect.objectContaining({
            name: expect.stringContaining(`-conversation-${CONVERSATION_A}`),
          }),
          displayState: expect.objectContaining({
            runtimeState: 'active',
            websocketReady: true,
            hasLiveSession: true,
          }),
        }))
      })
    } finally {
      releaseCreate?.()
      sessions.dispose()
      await server.close()
    }
  })

  it('cancels a starting conversation deterministically when paused before bootstrap completes', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-cancel-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const createCommanderSession = sessions.iface.createCommanderSession.bind(sessions.iface)
    let releaseCreate: (() => void) | null = null
    let createStarted = false
    sessions.iface.createCommanderSession = vi.fn(async (params) => {
      createStarted = true
      await new Promise<void>((resolve) => {
        releaseCreate = resolve
      })
      return createCommanderSession(params)
    }) as CommanderSessionsInterface['createCommanderSession']

    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })).status).toBe(201)

      const startPromise = startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })
      await vi.waitFor(() => expect(createStarted).toBe(true))
      expect((await startPromise).status).toBe(202)

      const pauseResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/pause`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(pauseResponse.status).toBe(202)
      expect(await pauseResponse.json()).toEqual(expect.objectContaining({
        id: CONVERSATION_A,
        runtimeState: 'starting',
        websocketReady: false,
      }))

      releaseCreate?.()

      await vi.waitFor(async () => {
        const detailResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
          headers: READ_ONLY_AUTH_HEADERS,
        })
        expect(detailResponse.status).toBe(200)
        expect(await detailResponse.json()).toEqual(expect.objectContaining({
          id: CONVERSATION_A,
          status: 'idle',
          runtimeState: 'idle',
          websocketReady: false,
          liveSession: null,
        }))
      })
      expect(sessions.activeSessions.size).toBe(0)
    } finally {
      releaseCreate?.()
      sessions.dispose()
      await server.close()
    }
  })

  it('starts an idle conversation using the backend provider fallback when agentType is omitted', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-default-provider-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, { agentType: 'codex', model: 'gpt-5.4' })

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

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {})
      expect(startResponse.status).toBe(200)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.4',
        conversationId: CONVERSATION_A,
      }))
    } finally {
      await server.close()
    }
  })

  it('uses the commander default model when starting a conversation on the same provider', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-model-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, {
      agentType: 'codex',
      model: 'gpt-5.4',
    })

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
        agentType: 'codex',
      })
      expect(createResponse.status).toBe(201)

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'codex',
      })
      expect(startResponse.status).toBe(200)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.4',
        conversationId: CONVERSATION_A,
      }))
    } finally {
      await server.close()
    }
  })

  it('prefers the stored conversation model over the commander default when starting', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-stored-model-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, {
      agentType: 'codex',
      model: 'gpt-5.4',
    })

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
        agentType: 'codex',
        model: 'gpt-5.5',
      })
      expect(createResponse.status).toBe(201)

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'codex',
      })
      expect(startResponse.status).toBe(200)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.5',
        conversationId: CONVERSATION_A,
      }))
    } finally {
      await server.close()
    }
  })

  it('accepts and validates an explicit model at conversation start', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-explicit-model-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, {
      agentType: 'codex',
      model: 'gpt-5.4',
    })

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
        agentType: 'codex',
      })
      expect(createResponse.status).toBe(201)

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'codex',
        model: 'gpt-5.5',
      })
      expect(startResponse.status).toBe(200)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.5',
        conversationId: CONVERSATION_A,
      }))

      const invalidStartResponse = await startConversation(server.baseUrl, CONVERSATION_B, {
        agentType: 'codex',
        model: 'claude-opus-4-6',
      })
      expect(invalidStartResponse.status).toBe(400)
      expect(await invalidStartResponse.json()).toEqual({
        error: expect.stringContaining('not valid'),
        validIds: expect.arrayContaining(['gpt-5.5']),
      })
    } finally {
      await server.close()
    }
  })

  it('validates and propagates maxThinkingTokens at conversation start', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-start-max-thinking-tokens-')
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
        surface: 'ui',
      })).status).toBe(201)

      for (const invalid of [-1, 500, 999999, 1.5]) {
        const response = await startConversation(server.baseUrl, CONVERSATION_A, {
          agentType: 'claude',
          maxThinkingTokens: invalid,
        })
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          error: 'Invalid maxThinkingTokens. Expected integer 1024..256000',
        })
      }

      const validResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
        maxThinkingTokens: 64000,
      })
      expect(validResponse.status).toBe(200)
      expect(sessions.createCalls).toHaveLength(1)
      expect(sessions.createCalls[0]).toEqual(expect.objectContaining({
        maxThinkingTokens: 64000,
      }))
    } finally {
      sessions.dispose()
      await server.close()
    }
  })

  it('starts and lists Codex conversations when the live session has a watchdog timer', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-codex-timer-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A, {
      agentType: 'codex',
      model: 'gpt-5.4',
    })

    const sessions = createMockSessionsInterface({ attachCodexWatchdogTimer: true })
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
        agentType: 'codex',
      })
      expect(createResponse.status).toBe(201)

      const startResponse = await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'codex',
      })
      expect(startResponse.status).toBe(200)
      const startPayload = await startResponse.json() as {
        conversation: {
          liveSession: Record<string, unknown> | null
        }
      }
      expect(startPayload.conversation.liveSession).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.4',
        name: expect.stringContaining(`-conversation-${CONVERSATION_A}`),
      }))
      expect(startPayload.conversation.liveSession).not.toHaveProperty('codexTurnWatchdogTimer')
      expect(startPayload.conversation.liveSession).not.toHaveProperty('queuedMessageRetryTimer')
      expect(startPayload.conversation.liveSession).not.toHaveProperty('process')

      const activeResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations/active`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(activeResponse.status).toBe(200)
      const activePayload = await activeResponse.json() as {
        liveSession: Record<string, unknown> | null
      }
      expect(activePayload.liveSession).toEqual(expect.objectContaining({
        agentType: 'codex',
        model: 'gpt-5.4',
      }))
      expect(activePayload.liveSession).not.toHaveProperty('codexTurnWatchdogTimer')

      const listResponse = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_A}/conversations`,
        { headers: READ_ONLY_AUTH_HEADERS },
      )
      expect(listResponse.status).toBe(200)
      const listPayload = await listResponse.json() as Array<{
        id: string
        liveSession: Record<string, unknown> | null
      }>
      expect(listPayload).toEqual([
        expect.objectContaining({
          id: CONVERSATION_A,
          liveSession: expect.objectContaining({
            agentType: 'codex',
            model: 'gpt-5.4',
          }),
        }),
      ])
      expect(listPayload[0]?.liveSession).not.toHaveProperty('codexTurnWatchdogTimer')
    } finally {
      sessions.dispose()
      await server.close()
    }
  })

  it('returns conversation read-model actions for active stream, idle, archived, and pty live sessions', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-read-model-')
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
        surface: 'ui',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)

      const activeResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(activeResponse.status).toBe(200)
      const active = await activeResponse.json() as {
        canonicalOrder: number
        displayState: {
          hasLiveSession: boolean
          isSendable: boolean
          isQueueable: boolean
          isMediaSendable: boolean
          disabledReasons: Record<string, string | null>
        }
        sendTarget: {
          sessionName: string
          transportType: string | null
          queue: { supported: boolean; reason: string | null }
          media: { supported: boolean; reason: string | null }
        } | null
        allowedActions: Record<string, boolean>
      }
      expect(active).toEqual(expect.objectContaining({
        canonicalOrder: 0,
        allowedActions: expect.objectContaining({
          send: true,
          queue: true,
          media: true,
          pause: true,
          updateProvider: false,
        }),
      }))
      expect(active.displayState).toEqual(expect.objectContaining({
        hasLiveSession: true,
        isSendable: true,
        isQueueable: true,
        isMediaSendable: true,
      }))
      expect(active.displayState.disabledReasons.send).toBeNull()
      expect(active.displayState.disabledReasons.queue).toBeNull()
      expect(active.displayState.disabledReasons.media).toBeNull()
      expect(active.sendTarget).toEqual(expect.objectContaining({
        sessionName: buildConversationSessionName({
          id: CONVERSATION_A,
          commanderId: COMMANDER_A,
        } as Parameters<typeof buildConversationSessionName>[0]),
        transportType: 'stream',
        queue: { supported: true, reason: null },
        media: { supported: true, reason: null },
      }))

      expect((await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_B,
        surface: 'api',
      })).status).toBe(201)
      const idleResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(idleResponse.status).toBe(200)
      const idle = await idleResponse.json() as {
        sendTarget: {
          sessionName: string
          transportType: string | null
        } | null
        displayState: {
          hasLiveSession: boolean
          disabledReasons: Record<string, string | null>
        }
        allowedActions: Record<string, boolean>
      }
      expect(idle.sendTarget).toEqual(expect.objectContaining({
        sessionName: buildConversationSessionName({
          id: CONVERSATION_B,
          commanderId: COMMANDER_A,
        } as Parameters<typeof buildConversationSessionName>[0]),
        transportType: null,
      }))
      expect(idle.displayState.hasLiveSession).toBe(false)
      expect(idle.allowedActions).toEqual(expect.objectContaining({
        send: false,
        queue: false,
        media: false,
        start: true,
        resume: true,
        updateProvider: true,
        archive: true,
        delete: true,
      }))
      expect(idle.displayState.disabledReasons.send).toContain('active')
      expect(idle.displayState.disabledReasons.media).toContain('active stream session')

      const archiveResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_B}/archive`, {
        method: 'POST',
        headers: FULL_AUTH_HEADERS,
      })
      expect(archiveResponse.status).toBe(200)
      const archived = await archiveResponse.json() as {
        displayState: {
          isVisible: boolean
          disabledReasons: Record<string, string | null>
        }
        allowedActions: Record<string, boolean>
      }
      expect(archived.displayState.isVisible).toBe(false)
      expect(archived.allowedActions).toEqual(expect.objectContaining({
        send: false,
        queue: false,
        media: false,
        start: false,
        pause: false,
        resume: false,
        archive: true,
        delete: true,
        updateProvider: false,
      }))
      expect(archived.displayState.disabledReasons.send).toContain('archived')

      const liveSessionName = buildConversationSessionName({
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
      } as Parameters<typeof buildConversationSessionName>[0])
      const liveSession = sessions.activeSessions.get(liveSessionName)
      if (!liveSession) {
        throw new Error('Expected active live session for pty read-model case')
      }
      liveSession.kind = 'pty'

      const ptyResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(ptyResponse.status).toBe(200)
      const pty = await ptyResponse.json() as {
        sendTarget: {
          transportType: string | null
          queue: { supported: boolean; reason: string | null }
          media: { supported: boolean; reason: string | null }
        } | null
        displayState: {
          isSendable: boolean
          isQueueable: boolean
          isMediaSendable: boolean
          disabledReasons: Record<string, string | null>
        }
        allowedActions: Record<string, boolean>
      }
      expect(pty.sendTarget).toEqual(expect.objectContaining({
        transportType: 'pty',
        queue: {
          supported: false,
          reason: expect.stringContaining('not stream-sendable'),
        },
        media: {
          supported: false,
          reason: expect.stringContaining('active stream session'),
        },
      }))
      expect(pty.displayState).toEqual(expect.objectContaining({
        isSendable: false,
        isQueueable: false,
        isMediaSendable: false,
      }))
      expect(pty.allowedActions).toEqual(expect.objectContaining({
        send: false,
        queue: false,
        media: false,
        pause: true,
      }))
    } finally {
      await server.close()
    }
  })

  it('projects media sendability from provider capabilities', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-read-model-provider-media-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
    })

    const cases: Array<{ id: string; agentType: AgentType; supportsMedia: boolean }> = [
      { id: '33333333-3333-4333-8333-333333333331', agentType: 'codex', supportsMedia: true },
      { id: '33333333-3333-4333-8333-333333333332', agentType: 'gemini', supportsMedia: false },
      { id: '33333333-3333-4333-8333-333333333333', agentType: 'opencode', supportsMedia: false },
    ]

    try {
      for (const entry of cases) {
        expect((await createConversation(server.baseUrl, COMMANDER_A, {
          id: entry.id,
          surface: 'ui',
        })).status).toBe(201)
        expect((await startConversation(server.baseUrl, entry.id, {
          agentType: entry.agentType,
        })).status).toBe(200)

        const response = await fetch(`${server.baseUrl}/api/conversations/${entry.id}`, {
          headers: READ_ONLY_AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          displayState: {
            isSendable: boolean
            isQueueable: boolean
            isMediaSendable: boolean
            disabledReasons: Record<string, string | null>
          }
          sendTarget: {
            agentType: AgentType | null
            media: { supported: boolean; reason: string | null }
          } | null
          allowedActions: Record<string, boolean>
        }

        expect(payload.displayState).toEqual(expect.objectContaining({
          isSendable: true,
          isQueueable: true,
          isMediaSendable: entry.supportsMedia,
        }))
        expect(payload.allowedActions).toEqual(expect.objectContaining({
          send: true,
          queue: true,
          media: entry.supportsMedia,
        }))
        expect(payload.sendTarget).toEqual(expect.objectContaining({
          agentType: entry.agentType,
          media: {
            supported: entry.supportsMedia,
            reason: entry.supportsMedia ? null : 'Conversation provider does not support image attachments',
          },
        }))
        expect(payload.displayState.disabledReasons.media).toBe(
          entry.supportsMedia ? null : 'Conversation provider does not support image attachments',
        )
      }
    } finally {
      await server.close()
    }
  })

  it('marks active conversations without a live session as non-sendable', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-read-model-no-live-')
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
        surface: 'ui',
      })).status).toBe(201)
      expect((await startConversation(server.baseUrl, CONVERSATION_A, {
        agentType: 'claude',
      })).status).toBe(200)

      const liveSessionName = buildConversationSessionName({
        id: CONVERSATION_A,
        commanderId: COMMANDER_A,
      } as Parameters<typeof buildConversationSessionName>[0])
      sessions.activeSessions.delete(liveSessionName)

      const response = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        sendTarget: {
          sessionName: string
          transportType: string | null
        } | null
        displayState: {
          hasLiveSession: boolean
          disabledReasons: Record<string, string | null>
        }
        allowedActions: Record<string, boolean>
      }
      expect(payload.sendTarget).toEqual(expect.objectContaining({
        sessionName: liveSessionName,
        transportType: null,
      }))
      expect(payload.displayState.hasLiveSession).toBe(false)
      expect(payload.allowedActions).toEqual(expect.objectContaining({
        send: false,
        queue: false,
        media: false,
        pause: true,
      }))
      expect(payload.displayState.disabledReasons.send).toContain('no live session')
      expect(payload.displayState.disabledReasons.media).toContain('active stream session')
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

  it('maps a selected-conversation image send to one canonical historical user message', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-image-history-')
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
        agentType: 'codex',
      })
      expect(startResponse.status).toBe(200)

      const image = { mediaType: 'image/png', data: Buffer.from('image-bytes').toString('base64') }
      const messageResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/message`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Review this image.',
          images: [image],
        }),
      })
      expect(messageResponse.status).toBe(200)

      const historyResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_A}/messages`, {
        headers: READ_ONLY_AUTH_HEADERS,
      })
      expect(historyResponse.status).toBe(200)
      const history = await historyResponse.json() as {
        messages: Array<{ kind: string; text: string; images?: QueuedMessageImage[] }>
      }
      const imageMessages = history.messages.filter((message) => (
        message.kind === 'user'
        && message.text === 'Review this image.'
        && message.images?.[0]?.data === image.data
      ))
      expect(imageMessages).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  it('rejects conversation websocket upgrades for stale conversation live-session state without delegating raw session names', async () => {
    const dir = await createTempDir('hammurabi-commanders-conversation-ws-stale-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_A)

    const sessions = createMockSessionsInterface()
    const rawSessionUpgrade = vi.fn()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: sessions.iface,
      conversationSessionWebSocket: rawSessionUpgrade,
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_A, {
        id: CONVERSATION_A,
        surface: 'api',
      })
      expect(createResponse.status).toBe(201)

      const ws = new WebSocket(
        `${server.baseUrl.replace('http://', 'ws://')}/api/conversations/${CONVERSATION_A}/ws?api_key=full-scope-key`,
      )
      const status = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out')), 3_000)
        ws.on('open', () => {
          clearTimeout(timeout)
          reject(new Error('WebSocket unexpectedly opened'))
        })
        ws.on('error', reject)
        ws.on('unexpected-response', (_req, res) => {
          clearTimeout(timeout)
          resolve(res.statusCode ?? 0)
        })
      })

      expect(status).toBe(404)
      expect(rawSessionUpgrade).not.toHaveBeenCalled()
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
          name: expect.stringContaining(`-conversation-${CONVERSATION_B}`),
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
          displayName: 'peer-autostart',
          message: 'Hello, atlas.',
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
      // Auto-start must create the same commander-seeded runtime as a normal
      // Start click, then queue the inbound channel text behind that seed turn.
      expect(sessions.createCalls.length).toBe(1)
      expect(sessions.sendCalls[0]).toEqual(expect.objectContaining({
        text: STARTUP_PROMPT,
      }))
      expect(sessions.sendCalls[1]).toEqual(expect.objectContaining({
        text: 'Hello, atlas.',
        options: { queue: true, priority: 'normal' },
      }))
      expect(sessions.createCalls[0]?.systemPrompt).toContain('## Commander Memory')
    } finally {
      await server.close()
    }
  }, 15_000)

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
      // First inbound prime: starts the conversation and queues the channel
      // message behind the commander startup seed.
      expect((await fetch(`${server.baseUrl}/api/commanders/channel-message`, {
        method: 'POST',
        headers: { ...FULL_AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'whatsapp',
          accountId: 'acct-collect',
          chatType: 'direct',
          peerId: 'peer-collect',
          displayName: 'peer-collect',
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
          displayName: 'peer-collect',
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
          displayName: 'peer-orphan',
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
          displayName: 'peer-orphan',
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
