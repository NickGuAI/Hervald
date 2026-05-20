import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { ProviderAdapter } from '../../agents/providers/provider-adapter'
import { CommanderSessionStore } from '../../commanders/store'
import { ConversationStore } from '../../commanders/conversation-store'
import { OrgIdentityStore } from '../../org-identity/store'
import { createOnboardingRouter } from '../route'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function apiKeyStore(): ApiKeyStoreLike {
  const record: ApiKeyRecord = {
    id: 'test-key',
    name: 'Test',
    keyHash: 'hash',
    prefix: 'test',
    createdBy: 'test',
    createdAt: '2026-05-20T00:00:00.000Z',
    lastUsedAt: null,
    scopes: ['commanders:read', 'commanders:write'],
  }
  return {
    async hasAnyKeys() {
      return true
    },
    async verifyKey(rawKey, options) {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' }
      }
      const requiredScopes = options?.requiredScopes ?? []
      if (!requiredScopes.every((scope) => record.scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' }
      }
      return { ok: true, record }
    },
  }
}

function testProvider(): ProviderAdapter {
  return {
    id: 'codex',
    label: 'Codex',
    eventProvider: 'codex',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
      supportsMessageImages: true,
    },
    uiCapabilities: {
      supportsEffort: true,
      supportsAdaptiveThinking: false,
      supportsMaxThinkingTokens: false,
      supportsSkills: true,
      supportsLoginMode: true,
      permissionModes: [],
    },
    availableModels: [],
    supportedTransports: ['stream'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: null,
      effort: 'high',
    },
    disabledReason: null,
    machineAuth: {
      id: 'codex',
      label: 'Codex',
      cliBinaryName: 'codex',
      authEnvKeys: ['CODEX_API_KEY'],
      loginStatusCommand: 'codex auth status',
      supportedAuthModes: ['api-key', 'device-auth'],
      modeRequiresSecret: (mode: string) => mode === 'api-key',
      classifyAuthMethod: ({
        envSourceKey,
        loginConfigured,
      }: {
        envSourceKey: string | null
        loginConfigured: boolean
      }) => (
        envSourceKey ? 'api-key' : loginConfigured ? 'login' : 'missing'
      ),
      computeAuthSetupUpdates: () => ({}),
    },
  } as unknown as ProviderAdapter
}

async function startServer(dataDir: string): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  const commanderDataDir = join(dataDir, 'commander')
  app.use('/api/onboarding', createOnboardingRouter({
    apiKeyStore: apiKeyStore(),
    operatorStore: {
      async getFounder() {
        return {
          id: 'founder-1',
          kind: 'founder',
          displayName: 'Nick Gu',
          email: 'nick@example.com',
          avatarUrl: null,
          createdAt: '2026-05-20T00:00:00.000Z',
        }
      },
    },
    orgIdentityStore: new OrgIdentityStore(join(dataDir, 'org.json')),
    sessionStore: new CommanderSessionStore(join(commanderDataDir, 'sessions.json')),
    conversationStore: new ConversationStore(commanderDataDir),
    commanderDataDir,
    providerRegistry: {
      listProviders: () => [testProvider()],
    },
    env: {
      ...process.env,
      HAMMURABI_DATA_DIR: dataDir,
      CODEX_API_KEY: 'test-secret',
    },
    shellRunner: async (_command, args) => ({
      ok: args.join(' ').includes('command -v'),
      stdout: '',
    }),
  }))

  const server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('onboarding route', () => {
  it('returns backend-owned provider and machine readiness', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-onboarding-route-'))
    tempDirs.push(dataDir)
    const server = await startServer(dataDir)
    try {
      const response = await fetch(`${server.baseUrl}/api/onboarding/status`, {
        headers: AUTH_HEADERS,
      })
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        currentStepId: string
        providers: Array<{ id: string; state: string; authMode: string }>
        machines: Array<{ id: string; state: string }>
      }
      expect(payload.currentStepId).toBe('gaia')
      expect(payload.providers).toContainEqual(expect.objectContaining({
        id: 'codex',
        state: 'ready',
        authMode: 'env',
      }))
      expect(payload.machines).toContainEqual(expect.objectContaining({
        id: 'local',
        state: 'ready',
      }))
    } finally {
      await server.close()
    }
  })

  it('builds onboarding receipt URL from the public request origin', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-onboarding-route-'))
    tempDirs.push(dataDir)
    const server = await startServer(dataDir)
    try {
      const response = await fetch(`${server.baseUrl}/api/onboarding/status`, {
        headers: {
          ...AUTH_HEADERS,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'hervald.example.com',
        },
      })
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        receipt: { url: string }
      }
      expect(payload.receipt.url).toBe('https://hervald.example.com/org')
    } finally {
      await server.close()
    }
  })

  it('seeds Gaia idempotently through the onboarding action', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-onboarding-route-'))
    tempDirs.push(dataDir)
    const server = await startServer(dataDir)
    try {
      const first = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-gaia`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(first.status).toBe(201)
      const firstPayload = await first.json() as { gaia: { exists: boolean; commanderId: string | null } }
      expect(firstPayload.gaia.exists).toBe(true)
      expect(firstPayload.gaia.commanderId).toEqual(expect.any(String))

      const second = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-gaia`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      const secondPayload = await second.json() as { gaia: { commanderId: string | null } }
      expect(second.status).toBe(200)
      expect(secondPayload.gaia.commanderId).toBe(firstPayload.gaia.commanderId)
    } finally {
      await server.close()
    }
  })
})
