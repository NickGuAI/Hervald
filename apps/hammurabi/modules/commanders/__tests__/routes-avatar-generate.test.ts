import express from 'express'
import { createServer } from 'node:http'
import { access, mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSecretsStoreLike } from '../../../server/api-keys/provider-secrets-store'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'

const WRITE_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'write-key',
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const tempDirs: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'write-key': {
      id: 'write-key-id',
      name: 'Write Key',
      keyHash: 'hash',
      prefix: 'hmrb_write',
      createdBy: 'test',
      createdAt: '2026-05-05T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
    },
    'read-key': {
      id: 'read-key-id',
      name: 'Read Key',
      keyHash: 'hash',
      prefix: 'hmrb_read',
      createdBy: 'test',
      createdAt: '2026-05-05T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read'],
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

function createProviderSecretsStore(apiKey: string | null): ProviderSecretsStoreLike {
  return {
    getSecretStatus: async () => ({
      configured: Boolean(apiKey),
      updatedAt: apiKey ? '2026-05-05T00:00:00.000Z' : null,
    }),
    getSecret: async () => apiKey,
    setSecret: async () => undefined,
    deleteSecret: async () => undefined,
    listSecrets: async () => [],
  }
}

async function startServer(
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
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

async function createCommander(server: RunningServer, host = 'atlas'): Promise<{ id: string }> {
  const response = await fetch(`${server.baseUrl}/api/commanders`, {
    method: 'POST',
    headers: {
      ...WRITE_AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      host,
      persona: 'Avatar generation test commander',
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}

describe('commanders avatar generate route', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('generates and persists avatar.png for a commander', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-avatar-generate-'))
    tempDirs.push(dir)
    const memoryBasePath = join(dir, 'memory')
    const generateGeminiImage = vi.fn(async () => Buffer.from('generated-png'))
    const server = await startServer({
      sessionStorePath: join(dir, 'sessions.json'),
      memoryBasePath,
      providerSecretsStore: createProviderSecretsStore('AIza-test'),
      generateGeminiImage,
    })

    try {
      const created = await createCommander(server)
      const response = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
        headers: WRITE_AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        avatarUrl: `/api/commanders/${created.id}/avatar`,
      })
      expect(generateGeminiImage).toHaveBeenCalledTimes(1)

      const avatarPath = join(memoryBasePath, created.id, 'avatar.png')
      expect(await readFile(avatarPath, 'utf8')).toBe('generated-png')

      const avatarResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar`)
      expect(avatarResponse.status).toBe(200)
      expect(await avatarResponse.text()).toBe('generated-png')
      expect(avatarResponse.headers.get('content-type')).toContain('image/png')

      const profilePath = join(memoryBasePath, created.id, '.memory', 'profile.json')
      expect(await readFile(profilePath, 'utf8')).toContain('"avatar": "avatar.png"')
    } finally {
      await server.close()
    }
  })

  it('returns 412 when the Gemini image generation key is not configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-avatar-generate-'))
    tempDirs.push(dir)
    const server = await startServer({
      sessionStorePath: join(dir, 'sessions.json'),
      memoryBasePath: join(dir, 'memory'),
      providerSecretsStore: createProviderSecretsStore(null),
    })

    try {
      const created = await createCommander(server)
      const response = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
        headers: WRITE_AUTH_HEADERS,
      })

      expect(response.status).toBe(412)
      expect(await response.json()).toEqual({
        error: 'Configure Gemini API key in Settings → Image Generation',
      })
    } finally {
      await server.close()
    }
  })

  it('returns 412 when COMMANDER.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-avatar-generate-'))
    tempDirs.push(dir)
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer({
      sessionStorePath: join(dir, 'sessions.json'),
      memoryBasePath,
      providerSecretsStore: createProviderSecretsStore('AIza-test'),
    })

    try {
      const created = await createCommander(server)
      await unlink(join(memoryBasePath, created.id, 'COMMANDER.md'))
      await expect(access(join(memoryBasePath, created.id, 'COMMANDER.md'))).rejects.toThrow()

      const response = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
        headers: WRITE_AUTH_HEADERS,
      })

      expect(response.status).toBe(412)
      expect(await response.json()).toEqual({
        error: 'Commander has no COMMANDER.md — initialize first',
      })
    } finally {
      await server.close()
    }
  })

  it('returns 502 when Gemini image generation fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-avatar-generate-'))
    tempDirs.push(dir)
    const server = await startServer({
      sessionStorePath: join(dir, 'sessions.json'),
      memoryBasePath: join(dir, 'memory'),
      providerSecretsStore: createProviderSecretsStore('AIza-test'),
      generateGeminiImage: vi.fn(async () => {
        throw new Error('Gemini image generation failed (429): Rate limit exceeded')
      }),
    })

    try {
      const created = await createCommander(server)
      const response = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
        headers: WRITE_AUTH_HEADERS,
      })

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: 'Gemini image generation failed (429): Rate limit exceeded',
      })
    } finally {
      await server.close()
    }
  })

  it('requires write access for avatar generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-avatar-generate-'))
    tempDirs.push(dir)
    const server = await startServer({
      sessionStorePath: join(dir, 'sessions.json'),
      memoryBasePath: join(dir, 'memory'),
      providerSecretsStore: createProviderSecretsStore('AIza-test'),
      generateGeminiImage: vi.fn(async () => Buffer.from('generated-png')),
    })

    try {
      const created = await createCommander(server)

      const unauthorizedResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
      })
      expect(unauthorizedResponse.status).toBe(401)

      const forbiddenResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/avatar/generate`, {
        method: 'POST',
        headers: {
          'x-hammurabi-api-key': 'read-key',
        },
      })
      expect(forbiddenResponse.status).toBe(403)
      expect(await forbiddenResponse.json()).toEqual({
        error: 'Insufficient API key scope',
      })
    } finally {
      await server.close()
    }
  })
})
