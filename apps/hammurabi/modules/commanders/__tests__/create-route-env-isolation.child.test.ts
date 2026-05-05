import { describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter } from '../routes'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const describeIfChild = process.env.HAMMURABI_TEST_ISOLATION_CHILD === '1'
  ? describe
  : describe.skip

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-04-24T00:00:00.000Z',
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

async function startServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const app = express()
  app.use(express.json())
  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
  })
  app.use('/api/commanders', commanders.router)

  const httpServer: Server = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address')
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

describeIfChild('commander env isolation child', () => {
  it('overrides inherited commander data dirs before default route storage resolves', async () => {
    expect(process.env.HAMMURABI_DATA_DIR).toBeTruthy()
    expect(process.env.HAMMURABI_DATA_DIR).not.toBe(
      process.env.HAMMURABI_TEST_EXPECT_REAL_DATA_DIR,
    )
    expect(process.env.COMMANDER_DATA_DIR).toBeUndefined()
    expect(process.env.HAMMURABI_COMMANDER_MEMORY_DIR).toBeUndefined()

    const server = await startServer()
    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'fixture-env-isolation',
        }),
      })

      const createBodyText = await createResponse.text()
      expect(createResponse.status, createBodyText).toBe(201)
      const created = JSON.parse(createBodyText) as { id: string; host: string }
      expect(created.host).toBe('fixture-env-isolation')
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)
    } finally {
      await server.close()
    }
  })
})
