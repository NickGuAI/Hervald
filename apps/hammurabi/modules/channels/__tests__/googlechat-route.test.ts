import express from 'express'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { Conversation } from '../../commanders/conversation-store'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import type { CommanderSessionStore } from '../../commanders/store'
import {
  registerChannelAdapter,
  resetChannelAdaptersForTests,
} from '../registry'
import { createCommanderChannelsRouter } from '../route'
import { CommanderChannelBindingStore } from '../store'
import type {
  ChannelAdapter,
  ChannelInboundDecision,
  ChannelOutboundPayload,
  ChannelPairingChallenge,
  ChannelRuntime,
  ChannelSendResult,
  CommanderChannelBinding,
} from '../types'
import { googleChatCredentialRef } from '../googlechat/config'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const tempServers: Array<{ close: () => Promise<void> }> = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const scopes = ['commanders:read', 'commanders:write']
      if ((options?.requiredScopes ?? []).some((scope) => !scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }
      return {
        ok: true as const,
        record: {
          id: 'test-key-id',
          name: 'Test Key',
          keyHash: 'hash',
          prefix: 'hmrb_test',
          createdBy: 'test',
          createdAt: '2026-05-20T00:00:00.000Z',
          lastUsedAt: null,
          scopes,
        },
      }
    },
  }
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-googlechat-route-'))
  tempDirs.push(dir)
  return dir
}

function createFakeGoogleChatAdapter(
  handleInteractionEvent = vi.fn(async () => ({ status: 200, body: { accepted: true } })),
): ChannelAdapter & {
  handleInteractionEvent: typeof handleInteractionEvent
} {
  return {
    provider: 'googlechat',
    capabilities: {
      voiceNotes: false,
      media: false,
      threading: true,
      typingIndicators: false,
      presence: false,
      reactions: false,
      markdownDialect: 'plain',
    },
    start: async (): Promise<ChannelRuntime> => ({ provider: 'googlechat', accountId: 'chat-main' }),
    stop: async () => undefined,
    beginPairing: async (): Promise<ChannelPairingChallenge> => ({ provider: 'googlechat' }),
    completePairing: async (): Promise<CommanderChannelBinding> => {
      throw new Error('not implemented')
    },
    send: async (
      _runtime: ChannelRuntime,
      _conversation: Conversation,
      _payload: ChannelOutboundPayload,
    ): Promise<ChannelSendResult> => ({ success: true }),
    checkInboundAllowed: async (): Promise<ChannelInboundDecision> => ({ allowed: true }),
    handleInteractionEvent,
  }
}

async function startServer(dir: string) {
  const app = express()
  const store = new CommanderChannelBindingStore(join(dir, 'channels.json'))
  const secretsStore = new CommanderSecretsStore({
    dataDir: dir,
    keyFilePath: join(dir, 'master.key'),
  })
  app.use(express.json())
  app.use('/api/commanders', createCommanderChannelsRouter({
    apiKeyStore: createTestApiKeyStore(),
    store,
    secretsStore,
    sessionStore: {
      get: async (id: string) => (id === COMMANDER_ID ? { id } : null),
    } as Pick<CommanderSessionStore, 'get'>,
  }))

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve server address')
  }

  const server = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    secretsStore,
    close: async () => {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve())
      })
    },
  }
  tempServers.push(server)
  return server
}

afterEach(async () => {
  resetChannelAdaptersForTests()
  await Promise.all(tempServers.splice(0).map((server) => server.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Google Chat channel route', () => {
  it('creates Google Chat bindings through the generic API and stores service-account JSON encrypted', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)
    const serviceAccountJson = JSON.stringify({
      client_email: 'bot@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
    })

    const response = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'googlechat',
        accountId: 'chat-main',
        displayName: 'Google Chat',
        enabled: true,
        config: {
          serviceAccountJson,
          webhookAudience: 'https://example.com/api/commanders/channels/googlechat/events',
          webhookAudienceType: 'url',
          dmPolicy: 'allowlist',
          groupPolicy: 'open',
          dmAllowlist: ['nick@example.com'],
          groupAllowlist: ['spaces/AAA'],
          requireMention: true,
        },
      }),
    })

    expect(response.status).toBe(201)
    const created = await response.json() as {
      id: string
      config: Record<string, unknown>
    }
    const credentialRef = googleChatCredentialRef('chat-main')
    expect(created.config).toMatchObject({
      provider: 'googlechat',
      webhookAudience: 'https://example.com/api/commanders/channels/googlechat/events',
      webhookAudienceType: 'url',
      credentialRef,
      credentialConfigured: true,
      dmPolicy: 'allowlist',
      groupPolicy: 'open',
      dmAllowlist: ['nick@example.com'],
      groupAllowlist: ['spaces/AAA'],
      requireMention: true,
    })
    expect(created.config).not.toHaveProperty('serviceAccountJson')
    expect(created.config).not.toHaveProperty('serviceAccountKey')
    expect(created.config).not.toHaveProperty('credential')
    expect(created.config).not.toHaveProperty('accessToken')

    await expect(server.secretsStore.getSecret(COMMANDER_ID, credentialRef))
      .resolves.toBe(serviceAccountJson)
    const encryptedFile = await readFile(join(dir, COMMANDER_ID, 'secrets.enc'), 'utf8')
    expect(encryptedFile).not.toContain('bot@example.iam.gserviceaccount.com')

    const patchResponse = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels/${created.id}`, {
      method: 'PATCH',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          groupPolicy: 'disabled',
        },
      }),
    })
    expect(patchResponse.status).toBe(200)
    const patched = await patchResponse.json() as { config: Record<string, unknown> }
    expect(patched.config).toMatchObject({
      credentialRef,
      credentialConfigured: true,
      groupPolicy: 'disabled',
      dmAllowlist: ['nick@example.com'],
    })
  })

  it('rejects invalid Google Chat config before writing credentials', async () => {
    const dir = await createTempDir()
    const server = await startServer(dir)

    const missingCredential = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'googlechat',
        accountId: 'chat-main',
        displayName: 'Google Chat',
        enabled: true,
        config: {
          webhookAudience: 'https://example.com/api/commanders/channels/googlechat/events',
        },
      }),
    })
    expect(missingCredential.status).toBe(400)
    await expect(missingCredential.json()).resolves.toEqual({
      error: 'Service Account JSON is required for an enabled Google Chat channel.',
    })

    const invalidAllowlist = await fetch(`${server.baseUrl}/api/commanders/${COMMANDER_ID}/channels`, {
      method: 'POST',
      headers: {
        ...API_KEY_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'googlechat',
        accountId: 'chat-main',
        displayName: 'Google Chat',
        enabled: true,
        config: {
          serviceAccountJson: JSON.stringify({
            client_email: 'bot@example.iam.gserviceaccount.com',
            private_key: 'fake',
          }),
          webhookAudience: 'https://example.com/api/commanders/channels/googlechat/events',
          dmAllowlist: 'nick@example.com',
        },
      }),
    })
    expect(invalidAllowlist.status).toBe(400)
    await expect(invalidAllowlist.json()).resolves.toEqual({
      error: 'DM Allowlist must be an array',
    })
    await expect(server.secretsStore.getSecret(COMMANDER_ID, googleChatCredentialRef('chat-main')))
      .resolves.toBeNull()
  })

  it('mounts the channel-owned Google Chat webhook without API-key auth', async () => {
    const dir = await createTempDir()
    const handleInteractionEvent = vi.fn(async () => ({
      status: 200,
      body: { accepted: true, delivered: true },
    }))
    registerChannelAdapter(createFakeGoogleChatAdapter(handleInteractionEvent))
    const server = await startServer(dir)

    const response = await fetch(`${server.baseUrl}/api/commanders/channels/googlechat/events?accountId=chat-main&commanderId=${COMMANDER_ID}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'MESSAGE' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ accepted: true, delivered: true })
    expect(handleInteractionEvent).toHaveBeenCalledWith({
      authorization: 'Bearer valid-token',
      body: { type: 'MESSAGE' },
      accountId: 'chat-main',
      commanderId: COMMANDER_ID,
    })
  })
})
