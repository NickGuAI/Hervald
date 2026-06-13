import { describe, expect, it } from 'vitest'
import express from 'express'
import type { ApiKeyStoreLike } from '../../api-keys/store'
import { combinedAuth } from '../combined-auth'
import { authUserHasRequiredPermissions } from '../auth0'

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

async function startServer(
  middleware: ReturnType<typeof combinedAuth>,
): Promise<RunningServer> {
  const app = express()
  app.use('/protected', middleware, (req, res) => {
    res.json({
      authMode: req.authMode ?? null,
      userId: req.user?.id ?? null,
    })
  })

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve server address')
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

function createManagedKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey) => {
      if (rawKey === 'managed-key') {
        return {
          ok: true,
          record: {
            id: 'key-1',
            name: 'Managed',
            keyHash: 'hash',
            prefix: 'hmrb_abcd',
            createdBy: 'ops@gehirn.ai',
            createdAt: '2026-02-16T00:00:00.000Z',
            lastUsedAt: '2026-02-16T00:01:00.000Z',
            scopes: ['services:write'],
          },
        }
      }

      return {
        ok: false,
        reason: 'not_found',
      }
    },
  }
}

describe('combinedAuth', () => {
  it('prioritizes Auth0 when both Auth0 and API key credentials are present', async () => {
    const middleware = combinedAuth({
      apiKeyStore: createManagedKeyStore(),
      verifyToken: async (token) => {
        if (token !== 'auth0-token') {
          throw new Error('invalid')
        }

        return {
          id: 'auth0|user-1',
          email: 'user@example.com',
        }
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer auth0-token',
        'x-hammurabi-api-key': 'managed-key',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authMode: 'auth0',
      userId: 'auth0|user-1',
    })

    await server.close()
  })

  it('allows Auth0 users that carry the required permissions', async () => {
    const middleware = combinedAuth({
      requiredApiKeyScopes: ['services:write'],
      verifyToken: async (token) => {
        if (token !== 'auth0-token') {
          throw new Error('invalid')
        }

        return {
          id: 'auth0|user-allowed',
          email: 'user@example.com',
          metadata: {
            permissions: ['services:write'],
          },
        }
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer auth0-token',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authMode: 'auth0',
      userId: 'auth0|user-allowed',
    })

    await server.close()
  })

  it('does not promote access_token query parameters into bearer credentials', async () => {
    const middleware = combinedAuth({
      verifyToken: async (token) => {
        if (token !== 'auth0-token') {
          throw new Error('invalid')
        }

        return {
          id: 'auth0|query-user',
          email: 'user@example.com',
        }
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected?access_token=auth0-token`)
    expect(response.status).not.toBe(200)

    await server.close()
  })

  it('can use broader Auth0 permissions without broadening API-key scopes', async () => {
    const apiKeyStore: ApiKeyStoreLike = {
      hasAnyKeys: async () => true,
      verifyKey: async (_rawKey, options) => {
        const record = {
          id: 'key-1',
          name: 'Commander Read Key',
          keyHash: 'hash',
          prefix: 'hmrb_cmdr',
          createdBy: 'ops@gehirn.ai',
          createdAt: '2026-05-18T00:00:00.000Z',
          lastUsedAt: null,
          scopes: ['commanders:read'],
        }
        const requiredScopes = options?.requiredScopes ?? []
        if (!requiredScopes.every((scope) => record.scopes.includes(scope))) {
          return { ok: false, reason: 'insufficient_scope' as const }
        }
        return { ok: true, record }
      },
    }
    const middleware = combinedAuth({
      apiKeyStore,
      requiredApiKeyScopes: ['skills:read'],
      requiredAuth0Permissions: ['skills:read', 'commanders:read'],
      auth0PermissionMode: 'any',
      verifyToken: async (token) => {
        if (token !== 'auth0-token') {
          throw new Error('invalid')
        }

        return {
          id: 'auth0|commander-user',
          email: 'user@example.com',
          metadata: {
            permissions: ['commanders:read'],
          },
        }
      },
    })
    const server = await startServer(middleware)

    const auth0Response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer auth0-token',
      },
    })
    expect(auth0Response.status).toBe(200)
    expect(await auth0Response.json()).toEqual({
      authMode: 'auth0',
      userId: 'auth0|commander-user',
    })

    const apiKeyResponse = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        'x-hammurabi-api-key': 'managed-key',
      },
    })
    expect(apiKeyResponse.status).toBe(403)
    expect(await apiKeyResponse.json()).toEqual({
      error: 'Insufficient API key scope',
    })

    await server.close()
  })

  it('returns 403 when a valid Auth0 user lacks the required permissions', async () => {
    const middleware = combinedAuth({
      apiKeyStore: createManagedKeyStore(),
      requiredApiKeyScopes: ['services:write'],
      verifyToken: async (token) => {
        if (token !== 'auth0-token') {
          throw new Error('invalid')
        }

        return {
          id: 'auth0|user-denied',
          email: 'user@example.com',
          metadata: {
            permissions: ['services:read'],
          },
        }
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer auth0-token',
        'x-hammurabi-api-key': 'managed-key',
      },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Insufficient permissions',
    })

    await server.close()
  })

  it('falls back to API key auth when Auth0 verification fails', async () => {
    const middleware = combinedAuth({
      apiKeyStore: createManagedKeyStore(),
      requiredApiKeyScopes: ['services:write'],
      verifyToken: async () => {
        throw new Error('invalid token')
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer managed-key',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authMode: 'api-key',
      userId: 'api-key',
    })

    await server.close()
  })

  it('accepts valid internal token via x-hammurabi-internal-token header', async () => {
    const middleware = combinedAuth({
      internalToken: 'server-secret-abc',
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        'x-hammurabi-internal-token': 'server-secret-abc',
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authMode: 'api-key',
      userId: 'internal',
    })

    await server.close()
  })

  it('does not treat internal/system as an unconditional permission pass', () => {
    expect(authUserHasRequiredPermissions(
      { id: 'internal', email: 'system' },
      ['agents:write'],
    )).toBe(false)
  })

  it('rejects invalid internal token and falls through to other auth', async () => {
    const middleware = combinedAuth({
      internalToken: 'server-secret-abc',
      apiKeyStore: createManagedKeyStore(),
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        'x-hammurabi-internal-token': 'wrong-token',
      },
    })
    expect(response.status).toBe(401)

    await server.close()
  })

  it('returns API key scope errors when bearer credentials fail both paths', async () => {
    const apiKeyStore: ApiKeyStoreLike = {
      hasAnyKeys: async () => true,
      verifyKey: async () => ({
        ok: false,
        reason: 'insufficient_scope',
      }),
    }

    const middleware = combinedAuth({
      apiKeyStore,
      requiredApiKeyScopes: ['services:write'],
      verifyToken: async () => {
        throw new Error('invalid token')
      },
    })
    const server = await startServer(middleware)

    const response = await fetch(`${server.baseUrl}/protected`, {
      headers: {
        authorization: 'Bearer managed-key',
      },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Insufficient API key scope',
    })

    await server.close()
  })
})
