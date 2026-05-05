import express from 'express'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
}

const tempDirs: string[] = []

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

async function startServer(
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
  })
  app.use('/api/commanders', commanders.router)

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

async function createCommander(server: RunningServer, host: string): Promise<{ id: string }> {
  const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      host,
      persona: 'Archived runtime guard test commander',
    }),
  })
  expect(createResponse.status).toBe(201)
  return (await createResponse.json()) as { id: string }
}

describe('commanders identity routes', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  it('stores persona on the commander and scaffolds COMMANDER.md only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-identity-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'identity-worker',
          persona: 'Test Commander, generic engineering persona',
          cwd: '/workspace/example-repo',
          taskSource: {
            owner: 'NickGuAI',
            repo: 'example-repo',
            label: 'commander',
          },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; persona?: string }
      expect(created.persona).toBe('Test Commander, generic engineering persona')

      const persistedSessions = JSON.parse(await readFile(storePath, 'utf8')) as {
        sessions: Array<Record<string, unknown>>
      }
      expect(persistedSessions.sessions).toHaveLength(1)
      expect(persistedSessions.sessions[0]?.persona).toBe(
        'Test Commander, generic engineering persona',
      )

      await expect(access(join(memoryBasePath, created.id, '.memory', 'identity.md'))).rejects.toThrow()

      const workflowMdPath = join(memoryBasePath, created.id, 'COMMANDER.md')
      const workflowMdOnDisk = await readFile(workflowMdPath, 'utf8')
      expect(workflowMdOnDisk).toContain(`hammurabi memory save --commander ${created.id} "<fact>"`)
      expect(workflowMdOnDisk).toContain(`hammurabi memory --type=working_memory read --commander ${created.id}`)
      expect(workflowMdOnDisk).not.toContain(`hammurabi memory find --commander ${created.id}`)

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const listed = (await listResponse.json()) as Array<{ id: string; persona?: string }>
      expect(listed.find((entry) => entry.id === created.id)?.persona).toBe(
        'Test Commander, generic engineering persona',
      )

      const detailResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}`, {
        headers: AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      const detail = (await detailResponse.json()) as {
        commanderMd?: string | null
        workflowMd?: string | null
        commanderRoot?: string | null
        memoryRoot?: string | null
      }
      expect(detail.commanderMd).toBe(workflowMdOnDisk)
      expect(detail.workflowMd).toBe(workflowMdOnDisk)
      expect('identityMd' in detail).toBe(false)
      expect(detail.commanderRoot).toBe(join(memoryBasePath, created.id))
      expect(detail.memoryRoot).toBe(join(memoryBasePath, created.id, '.memory'))
    } finally {
      await server.close()
    }
  })

  it('rejects persona longer than 500 characters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-identity-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const response = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'identity-worker-2',
          persona: 'x'.repeat(501),
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'persona must be a string up to 500 characters',
      })
    } finally {
      await server.close()
    }
  })

  it('archives, restores, exports, and imports commander templates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-template-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'template-source',
          displayName: 'Template Source',
          roleKey: 'engineering',
          persona: 'Template export test commander',
          maxTurns: 42,
          contextMode: 'fat',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; displayName?: string }

      const commanderRoot = join(memoryBasePath, created.id)
      await mkdir(join(commanderRoot, '.memory'), { recursive: true })
      await writeFile(join(commanderRoot, 'COMMANDER.md'), '# Exported Commander\n', 'utf8')
      await writeFile(join(commanderRoot, '.memory', 'MEMORY.md'), '# Commander Memory\n\n- exported fact\n', 'utf8')

      const archiveResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/archive`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(archiveResponse.status).toBe(200)
      expect(await archiveResponse.json()).toMatchObject({
        id: created.id,
        archived: true,
      })

      const restoreResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/restore`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(restoreResponse.status).toBe(200)
      expect(await restoreResponse.json()).toMatchObject({
        id: created.id,
        archived: false,
        archivedAt: null,
      })

      const exportResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/export`, {
        headers: AUTH_HEADERS,
      })
      expect(exportResponse.status).toBe(200)
      const exported = (await exportResponse.json()) as {
        schemaVersion: number
        sourceCommanderId: string
        commander: { displayName: string; roleKey?: string; maxTurns?: number }
        commanderMd: string
        memorySnapshot: { memoryMd: string; syncRevision: number }
        skillBindings: unknown[]
      }
      expect(exported).toMatchObject({
        schemaVersion: 1,
        sourceCommanderId: created.id,
        commander: {
          displayName: 'Template Source',
          roleKey: 'engineering',
          maxTurns: 42,
        },
      })
      expect(exported.commanderMd).toBe('# Exported Commander\n')
      expect(exported.memorySnapshot.memoryMd).toContain('exported fact')
      expect(exported.skillBindings).toEqual([])

      const importResponse = await fetch(`${server.baseUrl}/api/commanders/import`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify(exported),
      })
      expect(importResponse.status).toBe(201)
      const imported = (await importResponse.json()) as {
        id: string
        displayName: string
        templateId?: string
        url?: string
      }
      expect(imported.id).not.toBe(created.id)
      expect(imported.displayName).toBe('Template Source Copy')
      expect(imported.templateId).toBe(created.id)
      expect(imported.url).toBe(`/command-room?commander=${imported.id}`)

      await expect(readFile(join(memoryBasePath, imported.id, 'COMMANDER.md'), 'utf8')).resolves.toBe('# Exported Commander\n')
      await expect(readFile(join(memoryBasePath, imported.id, '.memory', 'MEMORY.md'), 'utf8')).resolves.toContain('exported fact')
    } finally {
      await server.close()
    }
  })

  it('rejects POST /:id/start when commander is archived', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-archived-start-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const created = await createCommander(server, 'archived-start-worker')

      const archiveResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/archive`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(archiveResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })

      expect(startResponse.status).toBe(409)
      expect(await startResponse.json()).toEqual({
        error: 'Commander is archived. Restore it first via POST /:id/restore.',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects POST /:id/run-now when commander is archived', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-archived-run-now-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const created = await createCommander(server, 'archived-run-now-worker')

      const archiveResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/archive`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      expect(archiveResponse.status).toBe(200)

      const runNowResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/run-now`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Run this now',
        }),
      })

      expect(runNowResponse.status).toBe(409)
      expect(await runNowResponse.json()).toEqual({
        error: 'Commander is archived. Restore it first via POST /:id/restore.',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects template import with memorySnapshot but missing memoryMd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-import-missing-memory-md-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const response = await fetch(`${server.baseUrl}/api/commanders/import`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: 1,
          commander: {
            displayName: 'Missing Memory Markdown',
          },
          memorySnapshot: { syncRevision: 0 },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'memorySnapshot.memoryMd must be a string when memorySnapshot is present',
      })
    } finally {
      await server.close()
    }
  })

  it('rejects template import with memorySnapshot.memoryMd as non-string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-commanders-import-invalid-memory-md-'))
    tempDirs.push(dir)
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({ sessionStorePath: storePath, memoryBasePath })
    try {
      const response = await fetch(`${server.baseUrl}/api/commanders/import`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          schemaVersion: 1,
          commander: {
            displayName: 'Invalid Memory Markdown',
          },
          memorySnapshot: {
            syncRevision: 0,
            memoryMd: 42,
          },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'memorySnapshot.memoryMd must be a string when memorySnapshot is present',
      })
    } finally {
      await server.close()
    }
  })
})
