import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter } from '../routes'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const tempDirs: string[] = []

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-03-10T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
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

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function startServer(
  sessionStorePath: string,
  memoryBasePath: string,
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    sessionStorePath,
    memoryBasePath,
  })
  app.use('/api/commanders', commanders.router)

  const httpServer: Server = createServer(app)
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address')
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

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('remote commander sync routes', () => {
  it('registers remote commander and atomically claims pending quests', async () => {
    const dir = await createTempDir('hammurabi-remote-register-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer(storePath, memoryBasePath)

    try {
      const registerResponse = await fetch(`${server.baseUrl}/api/commanders/remote/register`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          machineId: 'gpu-node-1',
          label: 'GPU Node 1',
        }),
      })
      expect(registerResponse.status).toBe(201)
      const registerBody = (await registerResponse.json()) as {
        commanderId: string
        syncToken: string
      }
      expect(registerBody.commanderId).toBeTruthy()
      expect(registerBody.syncToken).toBeTruthy()

      const createQuestResponse = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/quests`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            source: 'manual',
            instruction: 'Process remote queue item',
            contract: {
              cwd: '/tmp/monorepo-g',
              permissionMode: 'default',
              agentType: 'claude',
              skillsToUse: [],
            },
          }),
        },
      )
      expect(createQuestResponse.status).toBe(201)
      const createdQuest = (await createQuestResponse.json()) as {
        id: string
      }

      const claimOne = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/quests/next`,
        {
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
          },
        },
      )
      expect(claimOne.status).toBe(200)
      const claimOneBody = (await claimOne.json()) as {
        quest: { id: string; status: string } | null
      }
      expect(claimOneBody.quest?.id).toBe(createdQuest.id)
      expect(claimOneBody.quest?.status).toBe('active')

      const claimTwo = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/quests/next`,
        {
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
          },
        },
      )
      expect(claimTwo.status).toBe(200)
      expect(await claimTwo.json()).toEqual({ quest: null })

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        remoteOrigin?: { machineId: string; label: string; syncToken?: string }
      }>
      const registered = sessions.find((session) => session.id === registerBody.commanderId)
      expect(registered?.remoteOrigin?.machineId).toBe('gpu-node-1')
      expect(registered?.remoteOrigin?.label).toBe('GPU Node 1')
      expect(registered?.remoteOrigin?.syncToken).toBeUndefined()
    } finally {
      await server.close()
    }
  })

  it('applies only in-order remote memory snapshots and exports the current revision', async () => {
    const dir = await createTempDir('hammurabi-remote-journal-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer(storePath, memoryBasePath)

    try {
      const registerResponse = await fetch(`${server.baseUrl}/api/commanders/remote/register`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          machineId: 'worker-us-east-1',
          label: 'US-East Worker',
        }),
      })
      const registerBody = (await registerResponse.json()) as {
        commanderId: string
        syncToken: string
      }

      const syncOne = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/sync`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            baseRevision: 0,
            memoryMd: '# Commander Memory\n\n## Discoveries\n\n- richer memory',
          }),
        },
      )
      expect(syncOne.status).toBe(200)
      expect(await syncOne.json()).toEqual({
        appliedRevision: 1,
        memoryUpdated: true,
      })

      const syncTwo = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/sync`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            baseRevision: 1,
            memoryMd: '# Commander Memory\n\n- tiny',
          }),
        },
      )
      expect(syncTwo.status).toBe(200)
      expect(await syncTwo.json()).toEqual({
        appliedRevision: 2,
        memoryUpdated: true,
      })

      const staleSync = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/sync`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            baseRevision: 1,
            memoryMd: '# Commander Memory\n\n- stale overwrite attempt',
          }),
        },
      )
      expect(staleSync.status).toBe(409)
      expect(await staleSync.json()).toEqual({
        error: 'Memory sync conflict: base revision 1 is stale; current revision is 2. Re-run remote init to rebootstrap before syncing again.',
        currentSyncRevision: 2,
      })

      const exportResponse = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/export`,
        {
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
          },
        },
      )
      expect(exportResponse.status).toBe(200)
      const exportBody = (await exportResponse.json()) as {
        syncRevision: number
        memoryMd: string
      }
      expect(exportBody.syncRevision).toBe(2)
      expect(exportBody.memoryMd).toContain('tiny')
    } finally {
      await server.close()
    }
  })

  it('advances sync revision when local memory facts mutate exported memory', async () => {
    const dir = await createTempDir('hammurabi-remote-memory-facts-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer(storePath, memoryBasePath)

    try {
      const registerResponse = await fetch(`${server.baseUrl}/api/commanders/remote/register`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          machineId: 'worker-us-west-2',
          label: 'US-West Worker',
        }),
      })
      const registerBody = (await registerResponse.json()) as {
        commanderId: string
        syncToken: string
      }

      const saveFactsResponse = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/facts`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            facts: ['Use append-only memory writes for durable commander facts'],
          }),
        },
      )
      expect(saveFactsResponse.status).toBe(200)

      const exportResponse = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/export`,
        {
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
          },
        },
      )
      expect(exportResponse.status).toBe(200)
      const exportBody = (await exportResponse.json()) as {
        syncRevision: number
        memoryMd: string
      }
      expect(exportBody.syncRevision).toBe(1)
      expect(exportBody.memoryMd).toContain('append-only memory writes')

      const staleSync = await fetch(
        `${server.baseUrl}/api/commanders/${registerBody.commanderId}/memory/sync`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${registerBody.syncToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            baseRevision: 0,
            memoryMd: '# Commander Memory\n\n- stale overwrite attempt',
          }),
        },
      )
      expect(staleSync.status).toBe(409)
      expect(await staleSync.json()).toEqual({
        error: 'Memory sync conflict: base revision 0 is stale; current revision is 1. Re-run remote init to rebootstrap before syncing again.',
        currentSyncRevision: 1,
      })
    } finally {
      await server.close()
    }
  })
})
