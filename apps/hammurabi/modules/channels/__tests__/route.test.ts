import express from 'express'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { CommanderSessionStore } from '../../commanders/store'
import { createCommanderChannelsRouter } from '../route'
import type { CommanderChannelBindingStore } from '../store'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempServers: RunningServer[] = []

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-03-18T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['commanders:read', 'commanders:write'],
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

async function startServer(options: {
  store: CommanderChannelBindingStore
  sessionStore: Pick<CommanderSessionStore, 'get'>
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/commanders', createCommanderChannelsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store: options.store,
    sessionStore: options.sessionStore,
  }))

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  const server = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
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
  tempServers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(tempServers.splice(0).map((server) => server.close()))
})

describe('commander channels route', () => {
  it('rejects channel binding creation for unknown commander', async () => {
    const create = vi.fn()
    const sessionGet = vi.fn().mockResolvedValue(null)
    const server = await startServer({
      store: { create } as unknown as CommanderChannelBindingStore,
      sessionStore: { get: sessionGet },
    })

    const response = await fetch(`${server.baseUrl}/api/commanders/fake-commander/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'whatsapp',
        accountId: 'acct-1',
        displayName: 'PMI WhatsApp',
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Commander "fake-commander" not found',
    })
    expect(sessionGet).toHaveBeenCalledWith('fake-commander')
    expect(create).not.toHaveBeenCalled()
  })
})
