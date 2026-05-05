import express from 'express'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createOperatorsRouter } from '../routes'
import { OperatorStore } from '../store'
import type { Operator } from '../types'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const AUTH0_HEADERS = {
  authorization: 'Bearer founder-token',
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const tempDirs: string[] = []

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

function createFounder(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'founder-1',
    kind: 'founder',
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: null,
    createdAt: '2026-05-01T22:30:09.000Z',
    ...overrides,
  }
}

function verifyFounderToken(token: string): Promise<AuthUser> {
  if (token !== 'founder-token') {
    throw new Error('Unauthorized')
  }

  return Promise.resolve({
    id: 'auth0|founder-user',
    email: 'nick@example.com',
    metadata: {
      permissions: ['commanders:read', 'commanders:write'],
      name: 'Nick Gu',
      picture: 'https://example.com/nick.png',
    },
  })
}

async function startServer(options: {
  store: OperatorStore
  dataDir: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/operators', createOperatorsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store: options.store,
    dataDir: options.dataDir,
    verifyAuth0Token: options.verifyAuth0Token,
  }))

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
}

describe('operators routes', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('returns the founder from GET /api/operators/:id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    const founder = createFounder()
    await store.saveFounder(founder)

    const server = await startServer({ store, dataDir })
    try {
      const response = await fetch(`${server.baseUrl}/api/operators/${founder.id}`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(founder)
    } finally {
      await server.close()
    }
  })

  it('bootstraps GET /api/operators/founder from an authenticated human profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    const server = await startServer({
      store,
      dataDir,
      verifyAuth0Token: verifyFounderToken,
    })

    try {
      const response = await fetch(`${server.baseUrl}/api/operators/founder`, {
        headers: AUTH0_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: 'auth0|founder-user',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: 'https://example.com/nick.png',
      })
    } finally {
      await server.close()
    }
  })

  it('updates the founder display name via PATCH /api/operators/founder/profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    const founder = createFounder()
    await store.saveFounder(founder)

    const server = await startServer({
      store,
      dataDir,
      verifyAuth0Token: verifyFounderToken,
    })

    try {
      const response = await fetch(`${server.baseUrl}/api/operators/founder/profile`, {
        method: 'PATCH',
        headers: {
          ...AUTH0_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ displayName: 'Nicholas Gu' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        displayName: 'Nicholas Gu',
      })
      await expect(store.getFounder()).resolves.toMatchObject({
        displayName: 'Nicholas Gu',
      })
    } finally {
      await server.close()
    }
  })

  it('stores and serves founder avatar uploads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    await store.saveFounder(createFounder())

    const server = await startServer({ store, dataDir })

    try {
      const imageBytes = Uint8Array.from([137, 80, 78, 71])
      const formData = new FormData()
      formData.append(
        'avatar',
        new Blob([imageBytes], { type: 'image/png' }),
        'founder.png',
      )

      const uploadResponse = await fetch(`${server.baseUrl}/api/operators/founder/avatar`, {
        method: 'POST',
        headers: API_KEY_HEADERS,
        body: formData,
      })

      expect(uploadResponse.status).toBe(200)
      expect(await uploadResponse.json()).toEqual({
        avatarUrl: '/api/operators/founder/avatar',
      })
      await expect(store.getFounder()).resolves.toMatchObject({
        avatarUrl: '/api/operators/founder/avatar',
      })

      const avatarResponse = await fetch(`${server.baseUrl}/api/operators/founder/avatar`)
      expect(avatarResponse.status).toBe(200)
      expect(avatarResponse.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await avatarResponse.arrayBuffer())).toEqual(imageBytes)
    } finally {
      await server.close()
    }
  })

  it('returns 404 when the founder does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    const server = await startServer({ store, dataDir })

    try {
      const response = await fetch(`${server.baseUrl}/api/operators/missing-founder`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: 'Operator "missing-founder" not found',
      })
    } finally {
      await server.close()
    }
  })

  it('requires a non-empty operator id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-operators-route-'))
    tempDirs.push(dir)
    const dataDir = join(dir, '.hammurabi')
    const store = new OperatorStore(join(dataDir, 'operators.json'))
    const server = await startServer({ store, dataDir })

    try {
      const response = await fetch(`${server.baseUrl}/api/operators/%20%20`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Invalid operator id',
      })
    } finally {
      await server.close()
    }
  })
})
