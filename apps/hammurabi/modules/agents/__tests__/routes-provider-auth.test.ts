import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderAuthStore } from '../provider-auth'
import {
  AUTH_HEADERS,
  startServer,
} from './routes-test-harness'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('provider auth routes', () => {
  it('starts OAuth flows with the server-reachable callback route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-provider-auth-routes-'))
    tempDirs.push(dir)
    const providerAuthStore = new ProviderAuthStore(join(dir, 'provider-secrets.json'))
    const server = await startServer({ providerAuthStore })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/provider-auth/codex/reauth/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scopeId: 'commander-remote',
          host: 'home-mac',
        }),
      })

      expect(response.status).toBe(200)
      const payload = await response.json() as { authorizationUrl: string; callbackUrl: string }
      const expectedCallbackUrl = `${server.baseUrl}/api/agents/provider-auth/oauth/callback`
      expect(payload.callbackUrl).toBe(expectedCallbackUrl)
      expect(new URL(payload.authorizationUrl).searchParams.get('redirect_uri')).toBe(expectedCallbackUrl)
    } finally {
      await server.close()
    }
  })

  it('does not expose Hammurabi OAuth start for Claude Code native auth', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-provider-auth-routes-'))
    tempDirs.push(dir)
    const providerAuthStore = new ProviderAuthStore(join(dir, 'provider-secrets.json'))
    const server = await startServer({ providerAuthStore })

    try {
      const response = await fetch(`${server.baseUrl}/api/agents/provider-auth/claude/reauth/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scopeId: 'commander-remote',
          host: 'home-mac',
        }),
      })

      expect(response.status).toBe(400)
      const payload = await response.json() as { error: string }
      expect(payload.error).toContain('claude auth login')
    } finally {
      await server.close()
    }
  })
})
