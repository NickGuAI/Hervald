import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  API_KEY_SCOPES,
  ApiKeyJsonStore,
} from '../../api-keys/store'

// Every API key scope EXCEPT agents:admin. Used to construct a "scoped non-admin"
// caller fixture below — distinct from the bootstrap master key, which now
// includes agents:admin. The two regression tests below assert that:
//   1. (issue/1221) — a non-admin caller with services:write can save the
//      OpenAI transcription key,
//   2. agents:admin is still required for /keys management — a non-admin
//      caller cannot create or list API keys.
const SCOPED_NON_ADMIN_PERMISSIONS: readonly string[] = API_KEY_SCOPES.filter(
  (scope) => scope !== 'agents:admin',
)
import { ProviderSecretsStore } from '../../api-keys/provider-secrets-store'
import { createApiKeysRouter } from '../api-keys'
import { createTelemetryRouterWithHub } from '../../../modules/telemetry/routes'

interface RunningServer {
  baseUrl: string
  apiKeyStore: ApiKeyJsonStore
  close: () => Promise<void>
}

interface StartServerOptions {
  now?: () => Date
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

async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const directory = await createTestDirectory()
  const apiKeyStore = new ApiKeyJsonStore(path.join(directory, 'api-keys.json'))
  const providerSecretsStore = new ProviderSecretsStore({
    filePath: path.join(directory, 'provider-secrets.json'),
    keyFilePath: path.join(directory, 'provider-secrets.key'),
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
    // Scoped-non-admin caller: every API_KEY_SCOPES entry EXCEPT `agents:admin`.
    // Used to test that master-key management routes (`/keys`) still require
    // `agents:admin` while operator transcription routes
    // (`/transcription/openai`) accept this caller. Distinct from the
    // bootstrap master key, which is the founder's full-admin key and
    // includes `agents:admin`.
    ['valid-auth0-bootstrap-admin-token', {
      id: 'auth0|bootstrap-admin',
      email: 'bootstrap@example.com',
      metadata: {
        permissions: [...SCOPED_NON_ADMIN_PERMISSIONS],
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
      providerSecretsStore,
      verifyToken: verifyAuth0Token,
      now: options.now,
    }),
  )
  app.use(
    '/api/telemetry',
    createTelemetryRouterWithHub({
      dataFilePath: telemetryStorePath,
      apiKeyStore,
      verifyAuth0Token,
      now: options.now,
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
    apiKeyStore,
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

  it('creates mobile pairing credentials with narrow scopes and one-time key visibility', async () => {
    const server = await startServer()

    const denied = await fetch(`${server.baseUrl}/api/auth/mobile/pairing`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-telemetry-write-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Should Fail' }),
    })
    expect(denied.status).toBe(403)

    const response = await fetch(`${server.baseUrl}/api/auth/mobile/pairing`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'iPhone Pairing',
        expiresInSeconds: 300,
      }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as {
      id: string
      key: string
      scopes: string[]
      expiresAt: string
    }
    expect(created.key.startsWith('hmrb_')).toBe(true)
    expect(typeof created.expiresAt).toBe('string')
    expect(created.scopes).toEqual([
      'agents:read',
      'agents:write',
      'commanders:read',
      'commanders:write',
      'services:read',
      'services:write',
      'skills:read',
      'telemetry:read',
    ])
    expect(created.scopes).not.toContain('agents:admin')
    expect(created.scopes).not.toContain('skills:write')

    const listResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as Array<{
      id: string
      key?: string
      expiresAt: string | null
    }>
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(created.id)
    expect(listed[0]?.expiresAt).toBe(created.expiresAt)
    expect(listed[0]).not.toHaveProperty('key')

    const manageKeysWithMobileCredential = await fetch(`${server.baseUrl}/api/auth/keys`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(manageKeysWithMobileCredential.status).toBe(403)

    const verifyMobileCredential = await fetch(`${server.baseUrl}/api/auth/mobile/verify`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(verifyMobileCredential.status).toBe(200)
    expect(await verifyMobileCredential.json()).toEqual({
      ok: true,
      requiredScopes: [
        'agents:read',
        'agents:write',
        'commanders:read',
        'commanders:write',
        'services:read',
        'services:write',
        'skills:read',
        'telemetry:read',
      ],
    })

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

    const verificationAfterRevoke = await server.apiKeyStore.verifyKey(created.key, {
      requiredScopes: ['agents:read'],
    })
    expect(verificationAfterRevoke).toEqual({
      ok: false,
      reason: 'not_found',
    })

    await server.close()
  })

  it('rejects valid API keys that are missing mobile access scopes before native storage', async () => {
    const server = await startServer()

    const createResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Telemetry Only',
        scopes: ['telemetry:write'],
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { key: string }

    const verifyResponse = await fetch(`${server.baseUrl}/api/auth/mobile/verify`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(verifyResponse.status).toBe(403)
    expect(await verifyResponse.json()).toEqual({
      error: 'Insufficient API key scope',
    })

    await server.close()
  })

  it('verifies narrowed mobile pairing credentials created by the pairing route', async () => {
    const server = await startServer()

    const response = await fetch(`${server.baseUrl}/api/auth/mobile/pairing`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Narrow iPhone Pairing',
        scopes: ['agents:read'],
      }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as {
      key: string
      scopes: string[]
    }
    expect(created.scopes).toEqual(['agents:read'])

    const verifyResponse = await fetch(`${server.baseUrl}/api/auth/mobile/verify`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })

    expect(verifyResponse.status).toBe(200)
    expect(await verifyResponse.json()).toEqual({
      ok: true,
      requiredScopes: ['agents:read'],
    })

    await server.close()
  })

  it('rejects mobile pairing scope escalation', async () => {
    const server = await startServer()

    const response = await fetch(`${server.baseUrl}/api/auth/mobile/pairing`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        scopes: ['agents:read', 'agents:admin'],
      }),
    })

    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('mobile pairing scopes')
    expect(await server.apiKeyStore.listKeys()).toEqual([])

    await server.close()
  })

  it('expires mobile pairing credentials during store and route verification', async () => {
    let currentNow = new Date('2026-06-01T00:00:00.000Z')
    const server = await startServer({
      now: () => currentNow,
    })

    const response = await fetch(`${server.baseUrl}/api/auth/mobile/pairing`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expiresInSeconds: 1,
      }),
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as {
      key: string
      expiresAt: string
    }
    expect(created.expiresAt).toBe('2026-06-01T00:00:01.000Z')

    const storeBeforeExpiry = await server.apiKeyStore.verifyKey(created.key, {
      requiredScopes: ['services:read'],
      now: currentNow,
    })
    expect(storeBeforeExpiry).toMatchObject({ ok: true })

    const routeBeforeExpiry = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(routeBeforeExpiry.status).toBe(200)

    const mobileVerifyBeforeExpiry = await fetch(`${server.baseUrl}/api/auth/mobile/verify`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(mobileVerifyBeforeExpiry.status).toBe(200)

    currentNow = new Date('2026-06-01T00:00:02.000Z')

    const storeAfterExpiry = await server.apiKeyStore.verifyKey(created.key, {
      requiredScopes: ['services:read'],
      now: currentNow,
    })
    expect(storeAfterExpiry).toEqual({
      ok: false,
      reason: 'expired',
    })

    const routeAfterExpiry = await fetch(`${server.baseUrl}/api/auth/transcription/openai`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(routeAfterExpiry.status).toBe(401)
    expect(await routeAfterExpiry.json()).toEqual({
      error: 'Unauthorized',
    })

    const mobileVerifyAfterExpiry = await fetch(`${server.baseUrl}/api/auth/mobile/verify`, {
      headers: {
        authorization: `Bearer ${created.key}`,
      },
    })
    expect(mobileVerifyAfterExpiry.status).toBe(401)

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
  // every external caller to hold every known scope — including
  // `agents:admin`, which historically the bootstrap master key was missing.
  // That produced a paradox: a non-admin caller (the previous bootstrap
  // shape) couldn't save the OpenAI transcription key.
  //
  // After #1221 the routes split per-scope:
  //   POST/GET/DELETE /keys                   → agents:admin
  //   GET    /transcription/openai            → services:read
  //   PUT/DELETE /transcription/openai        → services:write
  //
  // The bootstrap master key now (post-this-PR-series) includes
  // agents:admin too, but the regression test still uses
  // `SCOPED_NON_ADMIN_PERMISSIONS` to verify the per-route split holds for
  // any non-admin caller shape.
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

  it('accepts API-key auth on transcription routes — non-admin caller (no agents:admin) saves OpenAI key successfully', async () => {
    const server = await startServer()

    // First create a scoped non-admin API key (every scope EXCEPT agents:admin)
    // via admin auth. This shape exercises the regression path for issue/1221:
    // a non-admin caller with services:write must still be able to save the
    // transcription key. Distinct from the bootstrap master key (which is the
    // founder's full-admin key and DOES include agents:admin).
    const createResponse = await fetch(`${server.baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Scoped non-admin API key',
        scopes: [...SCOPED_NON_ADMIN_PERMISSIONS],
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

  it('stores Gemini image generation key without exposing plaintext on read', async () => {
    const server = await startServer()

    const initialStatus = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(initialStatus.status).toBe(200)
    expect(await initialStatus.json()).toEqual({
      configured: false,
      updatedAt: null,
    })

    const storeResponse = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'AIza-test-gemini-image' }),
    })
    expect(storeResponse.status).toBe(204)

    const afterStoreStatus = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
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

    const clearResponse = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer valid-auth0-admin-token',
      },
    })
    expect(clearResponse.status).toBe(204)

    const afterClearStatus = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
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

  it('enforces services:write specifically for Gemini image-generation PUT/DELETE — services:read alone is not enough', async () => {
    const server = await startServer()

    const getResponse = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
      },
    })
    expect(getResponse.status).toBe(200)

    const putResponse = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: 'AIza-test' }),
    })
    expect(putResponse.status).toBe(403)

    const deleteResponse = await fetch(`${server.baseUrl}/api/auth/image-generation/gemini`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer valid-auth0-services-read-token',
      },
    })
    expect(deleteResponse.status).toBe(403)

    await server.close()
  })
})
