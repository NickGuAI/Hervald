import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_MESSAGE,
} from '../heartbeat'

vi.setConfig({ testTimeout: 60_000 })

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
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
      createdAt: '2026-02-16T00:00:00.000Z',
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
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-config-source-of-truth-store-'), 'sessions.json')
  const memoryBasePath = options.memoryBasePath
    ?? join(dirname(sessionStorePath), 'memory')

  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
    sessionStorePath,
    memoryBasePath,
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
    httpServer,
    close: async () => {
      commanders.dispose()
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
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  )
})

describe('commander config source of truth', () => {
  it('persists custom runtime config into sessions.json and keeps COMMANDER.md free of config frontmatter', async () => {
    const dir = await createTempDir('hammurabi-config-source-of-truth-create-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      const response = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-config-source-of-truth',
          heartbeat: {
            intervalMs: 10_800_000,
            messageTemplate: '[HB {{timestamp}}] Follow up.',
          },
          maxTurns: 7,
          contextMode: 'thin',
          contextConfig: {
            fatPinInterval: 5,
          },
          taskSource: { owner: 'NickGuAI', repo: 'example-repo', label: 'commander' },
        }),
      })

      expect(response.status).toBe(201)
      const created = (await response.json()) as { id: string }

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        sessions: Array<Record<string, unknown>>
      }
      const session = persisted.sessions.find((entry) => entry.id === created.id)
      expect(session).toMatchObject({
        heartbeat: {
          intervalMs: 10_800_000,
          messageTemplate: '[HB {{timestamp}}] Follow up.',
          intervalOverridden: true,
        },
        maxTurns: 7,
        contextMode: 'thin',
        contextConfig: {
          fatPinInterval: 5,
        },
      })

      const workflowPath = join(memoryBasePath, created.id, 'COMMANDER.md')
      const workflowMd = await readFile(workflowPath, 'utf8')
      expect(workflowMd).not.toContain('heartbeat.interval')
      expect(workflowMd).not.toContain('heartbeat.message')
      expect(workflowMd).not.toContain('maxTurns:')
      expect(workflowMd).not.toContain('contextMode:')
      expect(workflowMd).not.toContain('fatPinInterval:')
      expect(workflowMd).toContain('runtime settings such as heartbeat cadence')
    } finally {
      await server.close()
    }
  })

  it('migrates arnold-like legacy frontmatter into sessions.json on boot and strips deprecated keys', async () => {
    const dir = await createTempDir('hammurabi-config-source-of-truth-migration-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const commanderId = '72e40eda-4ab1-457a-a91d-e5ab7ac2f5d3'
    const commanderRoot = join(memoryBasePath, commanderId)
    await mkdir(commanderRoot, { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'arnold',
            pid: null,
            state: 'idle',
            created: '2026-04-24T00:00:00.000Z',
            heartbeat: {
              intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
              messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
              lastSentAt: null,
            },
            lastHeartbeat: null,
            heartbeatTickCount: 0,
            taskSource: null,
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )
    await writeFile(
      join(commanderRoot, 'COMMANDER.md'),
      [
        '---',
        'heartbeat.interval: 10800000',
        'heartbeat.message: "[LEGACY HB {{timestamp}}]"',
        'maxTurns: 8',
        'contextMode: thin',
        'fatPinInterval: 2',
        '---',
        '',
        'Legacy commander prompt body.',
      ].join('\n'),
      'utf8',
    )

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      await vi.waitFor(async () => {
        const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
          sessions: Array<Record<string, unknown>>
        }
        const session = persisted.sessions.find((entry) => entry.id === commanderId)
        expect(session).toMatchObject({
          heartbeat: {
            intervalMs: 10_800_000,
            messageTemplate: '[LEGACY HB {{timestamp}}]',
            intervalOverridden: true,
          },
          maxTurns: 8,
          contextMode: 'thin',
          contextConfig: {
            fatPinInterval: 2,
          },
        })
      })

      await vi.waitFor(async () => {
        const workflowMd = await readFile(join(commanderRoot, 'COMMANDER.md'), 'utf8')
        expect(workflowMd).toBe('Legacy commander prompt body.')
      })
    } finally {
      await server.close()
    }
  })
})
