import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function createTestApiKeyStore(
  scopes: readonly string[] = ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: [...scopes],
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

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function startServer(
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-register-quests-'), 'sessions.json')
  const memoryBasePath = options.memoryBasePath
    ?? join(dirname(sessionStorePath), 'memory')

  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
    sessionStorePath,
    memoryBasePath,
  })
  app.use('/api/commanders', commanders.router)

  const httpServer: Server = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

async function createCommander(baseUrl: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/commanders`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      host: 'worker-quest-claim-route',
    }),
  })

  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string }>
}

async function createQuest(baseUrl: string, commanderId: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/commanders/${commanderId}/quests`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source: 'manual',
      instruction: 'Implement atomic claim lock',
      contract: {
        cwd: '/tmp/example-repo',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    }),
  })

  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string }>
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  )
})

describe('registerQuestRoutes claim endpoint', () => {
  it('claims a quest and returns 409 with claimedBy for a conflicting claimant', async () => {
    const server = await startServer()

    try {
      const commander = await createCommander(server.baseUrl)
      const quest = await createQuest(server.baseUrl, commander.id)

      const firstClaimResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${quest.id}/claim`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            conversationId: 'conversation-a',
          }),
        },
      )
      expect(firstClaimResponse.status).toBe(200)
      await expect(firstClaimResponse.json()).resolves.toMatchObject({
        id: quest.id,
        status: 'active',
        claimedByConversationId: 'conversation-a',
      })

      const conflictingClaimResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${quest.id}/claim`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            conversationId: 'conversation-b',
          }),
        },
      )
      expect(conflictingClaimResponse.status).toBe(409)
      await expect(conflictingClaimResponse.json()).resolves.toEqual({
        error: 'Quest already claimed',
        claimedBy: 'conversation-a',
      })
    } finally {
      await server.close()
    }
  })

  it('returns 400 when conversationId is missing', async () => {
    const server = await startServer()

    try {
      const commander = await createCommander(server.baseUrl)
      const quest = await createQuest(server.baseUrl, commander.id)

      const response = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${quest.id}/claim`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: 'conversationId is required',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects claim when the API key is missing commanders:write', async () => {
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(['agents:read', 'agents:write', 'commanders:read']),
    })

    try {
      const commander = await createCommander(server.baseUrl)
      const quest = await createQuest(server.baseUrl, commander.id)

      const response = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${quest.id}/claim`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            conversationId: 'conversation-a',
          }),
        },
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: 'Insufficient API key scope',
      })
    } finally {
      await server.close()
    }
  })
})
