import express from 'express'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createOrgRouter } from '../route'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const AUTH0_HEADERS = {
  authorization: 'Bearer test-token',
}

const tempDirs: string[] = []
const previousEnv = {
  HAMMURABI_DATA_DIR: process.env.HAMMURABI_DATA_DIR,
  COMMANDER_DATA_DIR: process.env.COMMANDER_DATA_DIR,
  HAMMURABI_COMMANDER_MEMORY_DIR: process.env.HAMMURABI_COMMANDER_MEMORY_DIR,
}

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
      scopes: ['commanders:read', 'org:write'],
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

function restoreEnvVar(key: 'HAMMURABI_DATA_DIR' | 'COMMANDER_DATA_DIR' | 'HAMMURABI_COMMANDER_MEMORY_DIR', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

async function startServer(dataDir: string): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  app.use('/api/org', createOrgRouter({
    apiKeyStore: createTestApiKeyStore(),
    verifyAuth0Token: async (token) => {
      if (token !== 'test-token') {
        throw new Error('Unauthorized')
      }

      return {
        id: 'auth0|founder-user',
        email: 'nick.gu@example.com',
        metadata: {
          permissions: ['commanders:read'],
          name: 'Nick Gu',
          picture: 'https://example.com/nick.png',
        },
      }
    },
    commanderDataDir: join(dataDir, 'commander'),
    sessionStore: {
      async list() {
        return []
      },
    },
    conversationStore: {
      async listByCommander() {
        return []
      },
    },
    questStore: {
      async list() {
        return []
      },
    },
    profileStore: {
      async getAvatarUrl() {
        return null
      },
    },
    automationStore: {
      async list() {
        return []
      },
    },
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

beforeEach(() => {
  delete process.env.COMMANDER_DATA_DIR
  delete process.env.HAMMURABI_COMMANDER_MEMORY_DIR
})

afterEach(async () => {
  restoreEnvVar('HAMMURABI_DATA_DIR', previousEnv.HAMMURABI_DATA_DIR)
  restoreEnvVar('COMMANDER_DATA_DIR', previousEnv.COMMANDER_DATA_DIR)
  restoreEnvVar('HAMMURABI_COMMANDER_MEMORY_DIR', previousEnv.HAMMURABI_COMMANDER_MEMORY_DIR)
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('org route', () => {
  it('updates org identity through the mounted org identity route', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const updateResponse = await fetch(`${server.baseUrl}/api/org/identity`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Gehirn Inc.' }),
      })

      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toMatchObject({ name: 'Gehirn Inc.' })

      const readResponse = await fetch(`${server.baseUrl}/api/org/identity`, {
        headers: API_KEY_HEADERS,
      })
      expect(readResponse.status).toBe(200)
      expect(await readResponse.json()).toMatchObject({ name: 'Gehirn Inc.' })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid org identity names', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const response = await fetch(`${server.baseUrl}/api/org/identity`, {
        method: 'PATCH',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: '<bad>' }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'name contains unsupported characters',
      })
    } finally {
      await server.close()
    }
  })

  it('bootstraps the founder operator from an authenticated human when operators.json is missing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const response = await fetch(`${server.baseUrl}/api/org`, {
        headers: AUTH0_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.operator).toMatchObject({
        id: 'auth0|founder-user',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick.gu@example.com',
        avatarUrl: 'https://example.com/nick.png',
      })
      expect(Array.isArray(payload.commanders)).toBe(true)
      expect(Array.isArray(payload.automations)).toBe(true)

      const operatorStorePath = join(dataDir, 'operators.json')
      const persisted = JSON.parse(await readFile(operatorStorePath, 'utf8')) as Record<string, unknown>
      expect(persisted).toMatchObject({
        id: 'auth0|founder-user',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick.gu@example.com',
        avatarUrl: 'https://example.com/nick.png',
      })
      expect(typeof persisted.createdAt).toBe('string')
    } finally {
      await server.close()
    }
  })

  it('preserves the 404 when no human bootstrap candidate is available', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const response = await fetch(`${server.baseUrl}/api/org`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: 'Founder operator not found',
      })
    } finally {
      await server.close()
    }
  })
})
