import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  API_KEY_SCOPES,
  ApiKeyJsonStore,
  DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES,
} from '../../api-keys/store'
import { OpenAITranscriptionKeyStore } from '../../api-keys/transcription-store'
import { createApiKeysRouter } from '../api-keys'
import { createTelemetryRouterWithHub } from '../../../modules/telemetry/routes'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const testDirectories: string[] = []

async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-auth-routes-'))
  testDirectories.push(directory)
  return directory
}

async function removeDirectoryWithRetry(directory: string): Promise<void> {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') {
        throw error
      }
      if (attempt === maxAttempts) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
    }
  }
}

async function startServer(): Promise<RunningServer> {
  const directory = await createTestDirectory()
  const apiKeyStore = new ApiKeyJsonStore(path.join(directory, 'api-keys.json'))
  const transcriptionKeyStore = new OpenAITranscriptionKeyStore({
    filePath: path.join(directory, 'transcription-secrets.json'),
    keyFilePath: path.join(directory, 'transcription-secrets.key'),
    encryptionKey: 'test-encryption-key',
  })
  const telemetryStorePath = path.join(directory, 'telemetry.jsonl')

  const auth0UsersByToken = new Map<string, {
    id: string
    email: string
    metadata?: {
      permissions?: string[]
    }
  }>([
    ['valid-auth0-admin-token', {
      id: 'auth0|admin',
      email: 'admin@example.com',
      metadata: {
        permissions: [...API_KEY_SCOPES],
      },
    }],
    ['valid-auth0-telemetry-write-token', {
      id: 'auth0|telemetry-writer',
      email: 'writer@example.com',
      metadata: {
        permissions: ['telemetry:write'],
      },
    }],
    ['valid-auth0-telemetry-read-token', {
      id: 'auth0|telemetry-reader',
      email: 'reader@example.com',
      metadata: {
        permissions: ['telemetry:read'],
      },
    }],
    // Bootstrap admin: every API_KEY_SCOPES entry EXCEPT `agents:admin`.
    // Mirrors the actual bootstrap master key shape per
    // `DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES`. Used to test that master-key
    // management routes (`/keys`) still require `agents:admin` while operator
    // transcription routes (`/transcription/openai`) accept this caller.
    ['valid-auth0-bootstrap-admin-token', {
      id: 'auth0|bootstrap-admin',
      email: 'bootstrap@example.com',
      metadata: {
        permissions: [...DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES],
      },
    }],
    // Services-read only — should pass GET /transcription/openai but fail PUT/DELETE.
    ['valid-auth0-services-read-token', {
      id: 'auth0|services-reader',
      email: 'svc-read@example.com',
      metadata: {
        permissions: ['services:read'],
      },
    }],
  ])

  const verifyAuth0Token = async (token: string) => {
    const user = auth0UsersByToken.get(token)
    if (!user) {
      throw new Error('invalid auth0 token')
    }

    return user
  }

  const app = express()
  app.use(express.json())
  app.use(
    '/api/auth',
    createApiKeysRouter({
      store: apiKeyStore,
      transcriptionKeyStore,
      verifyToken: verifyAuth0Token,
    }),
  )
  app.use(
    '/api/telemetry',
    createTelemetryRouterWithHub({
      dataFilePath: telemetryStorePath,
      apiKeyStore,
      verifyAuth0Token,
    }).router,
  )

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
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

afterEach(async () => {
  for (const directory of testDirectories.splice(0)) {
    await removeDirectoryWithRetry(directory)
  }
})

describe('api key auth routes', () => {
  it('supports create/list/use/revoke API key lifecycle', async () => {
    const server = await startServer()

    const createResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Telemetry Key',
        scopes: ['telemetry:write'],
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      id: string
      key: string
      scopes: string[]
      prefix: string
    }
    expect(created.key.startsWith('hmrb_')).toBe(true)
    expect(created.scopes).toEqual(['telemetry:write'])
    expect(created.prefix).toMatch(/^hmrb_[a-z0-9]{4}$/)

    const listResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as Array<{
      id: string
      scopes: string[]
      key?: string
    }>
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(created.id)
    expect(listed[0]?.scopes).toEqual(['telemetry:write'])
    expect(listed[0]).not.toHaveProperty('key')

    const ingestByApiKey = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-api-key': created.key,
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(ingestByApiKey.status).toBe(200)

    const ingestByAuth0 = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(ingestByAuth0.status).toBe(200)

    const revokeResponse = await fetch(
      `${server.baseUrl}/api/auth/keys/${encodeURIComponent(created.id)}`,
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer valid-auth0-admin-token',
        },
      },
    )
    expect(revokeResponse.status).toBe(204)

    const ingestAfterRevoke = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-api-key': created.key,
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(ingestAfterRevoke.status).toBe(401)

    await server.close()
  })

  it('rejects API key creation when scopes are outside the allow-list', async () => {
    const server = await startServer()

    const response = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Invalid Scope Key',
        scopes: ['admin:all'],
      }),
    })

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('telemetry:write')
    expect(payload.error).toContain('agents:read')
    expect(payload.error).toContain('agents:write')
    expect(payload.error).toContain('agents:admin')
    expect(payload.error).toContain('services:read')

    await server.close()
  })

  it('accepts org:write as a valid API key scope', async () => {
    const server = await startServer()

    const response = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Org Identity Key',
        scopes: ['org:write'],
      }),
    })

    expect(response.status).toBe(201)
    const created = (await response.json()) as { scopes: string[] }
    expect(created.scopes).toEqual(['org:write'])

    await server.close()
  })

  it('requires full admin permissions to manage API keys', async () => {
    const server = await startServer()

    const response = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: 'Bearer valid-auth0-telemetry-write-token',
      },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Insufficient permissions',
    })

    await server.close()
  })

  it('enforces telemetry write permission for Auth0 callers at the route level', async () => {
    const server = await startServer()

    const denied = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-telemetry-read-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({
      error: 'Insufficient permissions',
    })

    const allowed = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-telemetry-write-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(allowed.status).toBe(200)

    await server.close()
  })

  it('stores transcription OpenAI key without exposing plaintext on read', async () => {
    const server = await startServer()

    const initialStatus = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(initialStatus.status).toBe(200)
    expect(await initialStatus.json()).toEqual({
      configured: false,
      updatedAt: null,
    })

    const storeResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'sk-openai-transcription' }),
    })
    expect(storeResponse.status).toBe(204)

    const afterStoreStatus = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(afterStoreStatus.status).toBe(200)
    const afterStorePayload = (await afterStoreStatus.json()) as {
      configured: boolean
      updatedAt: string | null
      apiKey?: string
    }
    expect(afterStorePayload.configured).toBe(true)
    expect(typeof afterStorePayload.updatedAt).toBe('string')
    expect(afterStorePayload).not.toHaveProperty('apiKey')

    const clearResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(clearResponse.status).toBe(204)

    const afterClearStatus = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(afterClearStatus.status).toBe(200)
    expect(await afterClearStatus.json()).toEqual({
      configured: false,
      updatedAt: null,
    })

    await server.close()
  })

  // -----------------------------------------------------------------
  // Per-route scope contract — issue/1221
  //
  // Before #1221 the entire /api/auth/* router was gated behind
  // `auth0Middleware({ requiredPermissions: API_KEY_SCOPES })` which forced
  // every external caller to hold every known scope — including `agents:admin`,
  // which `DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES` intentionally excludes. That
  // produced a paradox: the bootstrap master key (the ostensibly-most-
  // privileged caller) couldn't save the OpenAI transcription key.
  //
  // After #1221 the routes split:
  //   POST/GET/DELETE /keys                   → agents:admin
  //   GET    /transcription/openai            → services:read
  //   PUT/DELETE /transcription/openai        → services:write
  // -----------------------------------------------------------------

  it('lets a bootstrap-admin caller (10 scopes, no agents:admin) save the OpenAI transcription key — issue/1221 regression', async () => {
    const server = await startServer()

    const putResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer valid-auth0-bootstrap-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'sk-test-bootstrap' }),
    })
    expect(putResponse.status).toBe(204)

    const getResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: 'Bearer valid-auth0-bootstrap-admin-token',
      },
    })
    expect(getResponse.status).toBe(200)
    const status = (await getResponse.json()) as { configured: boolean }
    expect(status.configured).toBe(true)

    const deleteResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer valid-auth0-bootstrap-admin-token',
      },
    })
    expect(deleteResponse.status).toBe(204)

    await server.close()
  })

  it('still requires agents:admin for /keys management — bootstrap-admin (no agents:admin) cannot create or list keys', async () => {
    const server = await startServer()

    const createResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-bootstrap-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'should-fail', scopes: ['telemetry:write'] }),
    })
    expect(createResponse.status).toBe(403)

    const listResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: 'Bearer valid-auth0-bootstrap-admin-token',
      },
    })
    expect(listResponse.status).toBe(403)

    await server.close()
  })

  it('enforces services:write specifically for transcription PUT/DELETE — services:read alone is not enough', async () => {
    const server = await startServer()

    const getResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
      },
    })
    expect(getResponse.status).toBe(200)

    const putResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'sk-test' }),
    })
    expect(putResponse.status).toBe(403)

    const deleteResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
      },
    })
    expect(deleteResponse.status).toBe(403)

    await server.close()
  })

  it('accepts API-key auth on transcription routes — bootstrap master key (no agents:admin) saves OpenAI key successfully', async () => {
    const server = await startServer()

    // First create a master-key-shaped API key via admin auth.
    const createResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Bootstrap-shape API key',
        scopes: [...DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES],
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { key: string; scopes: string[] }
    expect(created.scopes).not.toContain('agents:admin')
    expect(created.key.startsWith('hmrb_')).toBe(true)

    // The API key (without agents:admin) saves the transcription key successfully —
    // that's the bug fix in action.
    const putResponse = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${created.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'sk-test-via-api-key' }),
    })
    expect(putResponse.status).toBe(204)

    // But the same key cannot manage /keys (master-key tier still requires agents:admin).
    const listResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(listResponse.status).toBe(403)

    await server.close()
  })
})
