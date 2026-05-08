import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../api-keys/store.js'
import { createModules, resolveCommandRoomMonitorOptions } from '../module-registry.js'

const API_KEY_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []
const previousEnv = {
  HAMMURABI_DATA_DIR: process.env.HAMMURABI_DATA_DIR,
  COMMANDER_DATA_DIR: process.env.COMMANDER_DATA_DIR,
}

function restoreEnvVar(key: 'HAMMURABI_DATA_DIR' | 'COMMANDER_DATA_DIR', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
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
  } satisfies Record<string, ApiKeyRecord>

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

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

async function startRegistryServer(): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const { modules } = createModules({
    apiKeyStore: createTestApiKeyStore(),
    initializeAutomationScheduler: false,
    maxAgentSessions: 1,
  })
  for (const module of modules) {
    if (module.name === 'operators' || module.name === 'org') {
      app.use(module.routePrefix, module.router)
    }
  }

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
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
}

afterEach(async () => {
  restoreEnvVar('HAMMURABI_DATA_DIR', previousEnv.HAMMURABI_DATA_DIR)
  restoreEnvVar('COMMANDER_DATA_DIR', previousEnv.COMMANDER_DATA_DIR)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('resolveCommandRoomMonitorOptions', () => {
  it('defaults command-room monitoring to a 30 minute stale-session window', () => {
    expect(resolveCommandRoomMonitorOptions({})).toEqual({
      pollIntervalMs: 5_000,
      maxPollAttempts: 360,
    })
  })

  it('derives max poll attempts from env overrides and ignores invalid values', () => {
    expect(resolveCommandRoomMonitorOptions({
      HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS: '2000',
      HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES: '45',
    })).toEqual({
      pollIntervalMs: 2_000,
      maxPollAttempts: 1_350,
    })

    expect(resolveCommandRoomMonitorOptions({
      HAMMURABI_COMMAND_ROOM_POLL_INTERVAL_MS: '0',
      HAMMURABI_COMMAND_ROOM_STALE_SESSION_TTL_MINUTES: '-1',
    })).toEqual({
      pollIntervalMs: 5_000,
      maxPollAttempts: 360,
    })
  })
})

describe('createModules', () => {
  it('shares founder setup writes with the operators route after an initial missing-founder read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-module-registry-founder-'))
    tempDirs.push(dir)
    const dataDir = join(dir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir
    process.env.COMMANDER_DATA_DIR = join(dataDir, 'commander')

    const server = await startRegistryServer()
    try {
      const initialResponse = await fetch(`${server.baseUrl}/api/operators/founder`, {
        headers: API_KEY_HEADERS,
      })
      expect(initialResponse.status).toBe(404)

      const setupResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_KEY_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Issue 1415 Crosscheck Org',
          founder: {
            displayName: 'Crosscheck Founder',
            email: 'crosscheck@example.com',
          },
        }),
      })
      expect(setupResponse.status).toBe(201)

      const founderResponse = await fetch(`${server.baseUrl}/api/operators/founder`, {
        headers: API_KEY_HEADERS,
      })
      expect(founderResponse.status).toBe(200)
      await expect(founderResponse.json()).resolves.toMatchObject({
        displayName: 'Crosscheck Founder',
        email: 'crosscheck@example.com',
      })
    } finally {
      await server.close()
    }
  })
})
