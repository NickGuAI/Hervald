import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../../routes'
import type { CommanderSessionsInterface } from '../../../agents/routes'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../../store'
import { createDefaultHeartbeatConfig } from '../../heartbeat'

const COMMANDER_ID = '00000000-0000-4000-a000-0000000000aa'
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'

const FULL_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'full-scope-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
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
  } satisfies Record<string, import('../../../../server/api-keys/store').ApiKeyRecord>

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

function createRejectingSessionsInterface(message: string): CommanderSessionsInterface {
  return {
    async createCommanderSession() {
      throw new Error(message)
    },
    async replaceCommanderSession() {
      throw new Error('replaceCommanderSession is not used in this test')
    },
    async dispatchWorkerForCommander() {
      return {
        status: 501,
        body: { error: 'dispatchWorkerForCommander is not stubbed for this fixture' },
      }
    },
    async sendToSession() {
      return false
    },
    deleteSession() {},
    getSession() {
      return undefined
    },
    subscribeToEvents() {
      return () => {}
    },
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
    heartbeat: createDefaultHeartbeatConfig(),
  })
}

async function startServer(
  options: Partial<CommandersRouterOptions> & {
    sessionsInterface: CommanderSessionsInterface
  },
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-register-conversations-'), 'sessions.json')
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

async function createConversation(baseUrl: string, commanderId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/commanders/${commanderId}/conversations`, {
    method: 'POST',
    headers: {
      ...FULL_AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: CONVERSATION_ID,
      surface: 'api',
    }),
  })
}

describe('registerConversationRoutes', () => {
  it('returns 503 with providerSpawnFailed when session creation rejects', async () => {
    const dir = await createTempDir('hammurabi-register-conversations-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath, COMMANDER_ID)

    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: createRejectingSessionsInterface(
        'OpenCode runtime failed to start: spawn opencode ENOENT',
      ),
    })

    try {
      const createResponse = await createConversation(server.baseUrl, COMMANDER_ID)
      expect(createResponse.status).toBe(201)

      const startResponse = await fetch(`${server.baseUrl}/api/conversations/${CONVERSATION_ID}/start`, {
        method: 'POST',
        headers: {
          ...FULL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'opencode',
        }),
      })

      expect(startResponse.status).toBe(503)
      expect(await startResponse.json()).toEqual({
        error: 'OpenCode runtime failed to start: spawn opencode ENOENT',
        providerSpawnFailed: true,
      })
    } finally {
      await server.close()
    }
  })
})
