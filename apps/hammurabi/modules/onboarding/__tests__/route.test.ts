import express from 'express'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { ProviderAdapter } from '../../agents/providers/provider-adapter'
import { AutomationStore } from '../../automations/store'
import { CommanderSessionStore } from '../../commanders/store'
import { ConversationStore } from '../../commanders/conversation-store'
import { GAIA_COMMANDER_AVATAR_URL } from '../../commanders/commander-profile'
import { OrgIdentityStore } from '../../org-identity/store'
import { OperatorStore } from '../../operators/store'
import { createOnboardingRouter } from '../route'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const previousHammurabiDataDir = process.env.HAMMURABI_DATA_DIR

interface RunningServer {
  baseUrl: string
  automationStore: AutomationStore
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
  process.env.HAMMURABI_DATA_DIR = dataDir
  const operatorStore = new OperatorStore(join(dataDir, 'operators.json'))
  await operatorStore.saveFounder({
    id: 'founder-1',
    kind: 'founder',
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: null,
    createdAt: '2026-05-20T00:00:00.000Z',
  })
  const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
  const conversationStore = new ConversationStore(commanderDataDir)
  const automationStore = new AutomationStore({
    dirPath: join(dataDir, 'automations'),
    commanderDataDir,
  })
  app.use('/api/onboarding', createOnboardingRouter({
    apiKeyStore: apiKeyStore(),
    operatorStore,
    orgIdentityStore: new OrgIdentityStore(join(dataDir, 'org.json')),
    sessionStore,
    conversationStore,
    automationStore,
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
    automationStore,
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
  if (previousHammurabiDataDir === undefined) {
    delete process.env.HAMMURABI_DATA_DIR
  } else {
    process.env.HAMMURABI_DATA_DIR = previousHammurabiDataDir
  }
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
        gaia: { avatarUrl: string }
        providers: Array<{ id: string; state: string; authMode: string }>
        machines: Array<{ id: string; state: string }>
      }
      expect(payload.currentStepId).toBe('gaia')
      expect(payload.gaia.avatarUrl).toBe(GAIA_COMMANDER_AVATAR_URL)
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
      const firstPayload = await first.json() as { gaia: { exists: boolean; commanderId: string | null; avatarUrl: string } }
      expect(firstPayload.gaia.exists).toBe(true)
      expect(firstPayload.gaia.commanderId).toEqual(expect.any(String))
      expect(firstPayload.gaia.avatarUrl).toBe(GAIA_COMMANDER_AVATAR_URL)
      const profile = JSON.parse(
        await readFile(join(dataDir, 'commander', firstPayload.gaia.commanderId as string, '.memory', 'profile.json'), 'utf8'),
      ) as Record<string, unknown>
      expect(profile).toMatchObject({
        avatar: GAIA_COMMANDER_AVATAR_URL,
        speakingTone: 'Mother-of-all onboarding',
      })

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

  it('seeds the starter workforce idempotently through the onboarding action', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-onboarding-route-'))
    tempDirs.push(dataDir)
    const server = await startServer(dataDir)
    try {
      const first = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-starter-workforce`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(first.status).toBe(201)
      const firstPayload = await first.json() as {
        starterWorkforce: { complete: boolean; installedCount: number; totalCount: number }
      }
      expect(firstPayload.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 3,
        totalCount: 3,
        skipped: false,
      })
      expect((await server.automationStore.list()).map((automation) => automation.templateId).sort()).toEqual([
        'engineering-manager:issue-triage-sweep',
        'engineering-manager:release-drift-review',
        'general-assistant:daily-briefing',
        'general-assistant:weekly-follow-up-review',
        'research-intelligence-analyst:monthly-research-backlog-review',
        'research-intelligence-analyst:weekly-research-distill',
      ])

      const second = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-starter-workforce`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      const secondPayload = await second.json() as {
        starterWorkforce: { complete: boolean; installedCount: number; totalCount: number }
      }
      expect(second.status).toBe(200)
      expect(secondPayload.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 3,
        totalCount: 3,
        skipped: false,
      })
      expect(await server.automationStore.list()).toHaveLength(6)
    } finally {
      await server.close()
    }
  })

  it('skips starter workforce installation without creating bundled commanders', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-onboarding-route-'))
    tempDirs.push(dataDir)
    const server = await startServer(dataDir)
    try {
      const gaia = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-gaia`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(gaia.status).toBe(201)

      const skipped = await fetch(`${server.baseUrl}/api/onboarding/actions/skip-starter-workforce`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(skipped.status).toBe(200)
      const skippedPayload = await skipped.json() as {
        currentStepId?: string
        starterWorkforce: { complete: boolean; installedCount: number; totalCount: number; skipped: boolean }
        status: { currentStepId: string; starterWorkforce: { complete: boolean; installedCount: number; totalCount: number; skipped: boolean } }
      }
      expect(skippedPayload.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 0,
        totalCount: 3,
        skipped: true,
      })
      expect(skippedPayload.status.currentStepId).toBe('launch')
      expect(skippedPayload.status.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 0,
        totalCount: 3,
        skipped: true,
      })

      const status = await fetch(`${server.baseUrl}/api/onboarding/status`, {
        headers: AUTH_HEADERS,
      })
      expect(status.status).toBe(200)
      const statusPayload = await status.json() as {
        starterWorkforce: { complete: boolean; installedCount: number; totalCount: number; skipped: boolean }
      }
      expect(statusPayload.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 0,
        totalCount: 3,
        skipped: true,
      })

      const seededAfterSkip = await fetch(`${server.baseUrl}/api/onboarding/actions/seed-starter-workforce`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(seededAfterSkip.status).toBe(201)
      const seededAfterSkipPayload = await seededAfterSkip.json() as {
        starterWorkforce: { complete: boolean; installedCount: number; totalCount: number; skipped: boolean }
      }
      expect(seededAfterSkipPayload.starterWorkforce).toMatchObject({
        complete: true,
        installedCount: 3,
        totalCount: 3,
        skipped: false,
      })
    } finally {
      await server.close()
    }
  })
})
