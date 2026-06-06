import express from 'express'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import {
  ASINA_COMMANDER_AVATAR_URL,
  GAIA_COMMANDER_AVATAR_URL,
  writeCommanderUiProfile,
} from '../../commanders/commander-profile'
import { CommanderSessionStore } from '../../commanders/store'
import { ConversationStore } from '../../commanders/conversation-store'
import { createDefaultHeartbeatConfig } from '../../commanders/heartbeat'
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

interface StartServerOptions {
  realCommanderStores?: boolean
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

async function startServer(
  dataDir: string,
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  const commanderDataDir = join(dataDir, 'commander')
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
    commanderDataDir,
    sessionStore: options.realCommanderStores
      ? new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
      : {
      async list() {
        return []
      },
    },
    conversationStore: options.realCommanderStores
      ? new ConversationStore(commanderDataDir)
      : {
      async listByCommander() {
        return []
      },
    },
    questStore: {
      async list() {
        return []
      },
    },
    profileStore: options.realCommanderStores ? undefined : {
      async getAvatarUrl() {
        return null
      },
      async getProfile() {
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
  it('reports fresh founder setup status without relying on a founder 404', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const response = await fetch(`${server.baseUrl}/api/org/setup-status`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        setupComplete: false,
        defaultValues: {
          orgDisplayName: '',
          founderDisplayName: '',
          founderEmail: '',
        },
        validationErrors: {
          orgDisplayName: 'Org display name is required.',
          founderDisplayName: 'Founder display name is required.',
          founderEmail: 'Founder email is required.',
        },
        nextRoute: '/welcome',
      })
    } finally {
      await server.close()
    }
  })

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

  it('backfills a missing founder avatar from the authenticated human on org read', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick.gu@example.com',
          },
        }),
      })

      expect(createResponse.status).toBe(201)
      expect((await createResponse.json()).operator.avatarUrl).toBeNull()

      const readResponse = await fetch(`${server.baseUrl}/api/org`, {
        headers: AUTH0_HEADERS,
      })

      expect(readResponse.status).toBe(200)
      const payload = await readResponse.json()
      expect(payload.operator).toMatchObject({
        displayName: 'Nick Gu',
        avatarUrl: 'https://example.com/nick.png',
      })

      const persisted = JSON.parse(await readFile(join(dataDir, 'operators.json'), 'utf8')) as Record<string, unknown>
      expect(persisted.avatarUrl).toBe('https://example.com/nick.png')
    } finally {
      await server.close()
    }
  })

  it('does not backfill a missing founder avatar from a non-founder org reader', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick@example.com',
          },
        }),
      })

      expect(createResponse.status).toBe(201)

      const readResponse = await fetch(`${server.baseUrl}/api/org`, {
        headers: AUTH0_HEADERS,
      })

      expect(readResponse.status).toBe(200)
      const payload = await readResponse.json()
      expect(payload.operator).toMatchObject({
        displayName: 'Nick Gu',
        avatarUrl: null,
      })

      const persisted = JSON.parse(await readFile(join(dataDir, 'operators.json'), 'utf8')) as Record<string, unknown>
      expect(persisted.avatarUrl).toBeNull()
    } finally {
      await server.close()
    }
  })

  it('creates the founder and org identity via POST /api/org for bootstrap API-key sessions', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick@example.com',
          },
        }),
      })

      expect(createResponse.status).toBe(201)
      const created = await createResponse.json()
      expect(created).toMatchObject({
        operator: {
          kind: 'founder',
          displayName: 'Nick Gu',
          email: 'nick@example.com',
        },
        orgIdentity: {
          name: 'Gehirn Inc.',
        },
        nextRoute: '/org',
      })
      expect(created.operator.id).toMatch(/^founder-/)

      const retryResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick@example.com',
          },
        }),
      })

      expect(retryResponse.status).toBe(200)
      const retried = await retryResponse.json()
      expect(retried.operator.id).toBe(created.operator.id)

      const orgReadResponse = await fetch(`${server.baseUrl}/api/org`, {
        headers: API_KEY_HEADERS,
      })

      expect(orgReadResponse.status).toBe(200)
      expect(await orgReadResponse.json()).toMatchObject({
        operator: {
          id: created.operator.id,
          displayName: 'Nick Gu',
          email: 'nick@example.com',
        },
        orgIdentity: {
          name: 'Gehirn Inc.',
        },
      })

      const completedSetupResponse = await fetch(`${server.baseUrl}/api/org/setup-status`, {
        headers: API_KEY_HEADERS,
      })
      expect(completedSetupResponse.status).toBe(200)
      expect(await completedSetupResponse.json()).toMatchObject({
        setupComplete: true,
        nextRoute: '/org',
        defaultValues: {
          orgDisplayName: 'Gehirn Inc.',
          founderDisplayName: 'Nick Gu',
          founderEmail: 'nick@example.com',
        },
      })

      const persistedOperator = JSON.parse(await readFile(join(dataDir, 'operators.json'), 'utf8')) as Record<string, unknown>
      expect(persistedOperator).toMatchObject({
        id: created.operator.id,
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
      })

      const persistedOrg = JSON.parse(await readFile(join(dataDir, 'org.json'), 'utf8')) as Record<string, unknown>
      expect(persistedOrg).toMatchObject({
        name: 'Gehirn Inc.',
      })
    } finally {
      await server.close()
    }
  })

  it('seeds Gaia once for a fresh org with no commanders', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir, { realCommanderStores: true })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick@example.com',
          },
        }),
      })
      expect(createResponse.status).toBe(201)

      const firstRead = await fetch(`${server.baseUrl}/api/org`, {
        headers: API_KEY_HEADERS,
      })
      expect(firstRead.status).toBe(200)
      const firstPayload = await firstRead.json()
      expect(firstPayload.commanders).toHaveLength(1)
      expect(firstPayload.commanders[0]).toMatchObject({
        displayName: 'Gaia',
        status: 'idle',
        templateId: 'gaia-onboarding',
        avatarUrl: GAIA_COMMANDER_AVATAR_URL,
        profile: {
          portraitStyleId: expect.any(String),
          speakingTone: 'Mother-of-all onboarding',
        },
      })
      expect(firstPayload.commanders[0].profile).not.toHaveProperty('borderColor')
      expect(firstPayload.commanders[0].profile).not.toHaveProperty('accentColor')

      const secondRead = await fetch(`${server.baseUrl}/api/org`, {
        headers: API_KEY_HEADERS,
      })
      expect(secondRead.status).toBe(200)
      const secondPayload = await secondRead.json()
      expect(secondPayload.commanders).toHaveLength(1)
      expect(secondPayload.commanders[0].id).toBe(firstPayload.commanders[0].id)

      const sessionState = JSON.parse(
        await readFile(join(dataDir, 'commander', 'sessions.json'), 'utf8'),
      ) as { sessions: Array<Record<string, unknown>> }
      const sessions = sessionState.sessions
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        host: 'gaia',
        contextMode: 'thin',
        templateId: 'gaia-onboarding',
      })

      const names = JSON.parse(
        await readFile(join(dataDir, 'commander', 'names.json'), 'utf8'),
      ) as Record<string, string>
      expect(names[firstPayload.commanders[0].id as string]).toBe('Gaia')
    } finally {
      await server.close()
    }
  })

  it('normalizes legacy commander profiles in GET /api/org without color identity', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const commanderDataDir = join(dataDir, 'commander')
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    await sessionStore.create({
      id: '00000000-0000-4000-a000-000000000123',
      host: 'legacy-no-profile',
      state: 'idle',
      created: '2026-05-08T00:00:00.000Z',
      agentType: 'claude',
      effort: 'medium',
      heartbeat: createDefaultHeartbeatConfig(),
      maxTurns: 20,
      contextMode: 'thin',
      taskSource: null,
    })

    const server = await startServer(dataDir, { realCommanderStores: true })

    try {
      const response = await fetch(`${server.baseUrl}/api/org`, {
        headers: AUTH0_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.commanders).toHaveLength(1)
      expect(payload.commanders[0]).toMatchObject({
        id: '00000000-0000-4000-a000-000000000123',
        profile: {
          portraitStyleId: expect.any(String),
        },
      })
      expect(payload.commanders[0].profile).not.toHaveProperty('borderColor')
      expect(payload.commanders[0].profile).not.toHaveProperty('accentColor')
    } finally {
      await server.close()
    }
  })

  it('uses the bundled stock avatar fallback on org surfaces for legacy installed package commanders', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const commanderDataDir = join(dataDir, 'commander')
    const commanderId = '00000000-0000-4000-a000-000000000124'
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    await sessionStore.create({
      id: commanderId,
      host: 'asina',
      state: 'idle',
      created: '2026-05-08T00:00:00.000Z',
      agentType: 'claude',
      effort: 'medium',
      heartbeat: createDefaultHeartbeatConfig(),
      maxTurns: 20,
      contextMode: 'thin',
      taskSource: null,
      templateId: 'engineering-manager',
    })
    await writeCommanderUiProfile(commanderId, commanderDataDir, {
      speakingTone: 'Strategic',
    })

    const server = await startServer(dataDir, { realCommanderStores: true })

    try {
      const response = await fetch(`${server.baseUrl}/api/org`, {
        headers: AUTH0_HEADERS,
      })

      expect(response.status).toBe(200)
      const payload = await response.json() as {
        commanders: Array<{
          id: string
          templateId?: string | null
          avatarUrl?: string | null
        }>
      }
      expect(payload.commanders).toHaveLength(1)
      expect(payload.commanders[0]).toMatchObject({
        id: commanderId,
        templateId: 'engineering-manager',
        avatarUrl: ASINA_COMMANDER_AVATAR_URL,
      })
    } finally {
      await server.close()
    }
  })

  it('rejects invalid founder setup payloads', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const server = await startServer(dataDir)

    try {
      const response = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn Inc.',
          founder: {
            displayName: 'Nick Gu',
            email: 'not-an-email',
          },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'founder.email must be a valid email address',
      })
    } finally {
      await server.close()
    }
  })

  it('returns the canonical org check-on command-room target with the active conversation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'hammurabi-org-route-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir

    const commanderDataDir = join(dataDir, 'commander')
    const commanderId = '00000000-0000-4000-a000-000000000123'
    const sessionStore = new CommanderSessionStore(join(commanderDataDir, 'sessions.json'))
    await sessionStore.create({
      id: commanderId,
      host: 'atlas',
      state: 'running',
      created: '2026-05-08T00:00:00.000Z',
      agentType: 'claude',
      effort: 'medium',
      heartbeat: createDefaultHeartbeatConfig(),
      maxTurns: 20,
      contextMode: 'thin',
      taskSource: null,
    })
    const conversationStore = new ConversationStore(commanderDataDir)
    const conversation = await conversationStore.create({
      commanderId,
      surface: 'ui',
      status: 'active',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: 'ui',
      createdByKind: 'human',
      createdAt: '2026-05-08T00:01:00.000Z',
      lastMessageAt: '2026-05-08T00:02:00.000Z',
    })

    const server = await startServer(dataDir, { realCommanderStores: true })

    try {
      const response = await fetch(`${server.baseUrl}/api/org/commanders/${commanderId}/check-on-target`, {
        headers: API_KEY_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        target: {
          routeId: 'command-room.ui',
          path: `/command-room?commander=${commanderId}&conversation=${conversation.id}`,
          commanderId,
          conversationId: conversation.id,
        },
      })
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
