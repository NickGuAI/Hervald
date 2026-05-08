import express from 'express'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { createOrgRouter } from '../../org/route.js'
import { OperatorStore } from '../../operators/store.js'
import { createAutomationsRouter } from '../routes.js'
import {
  AutomationScheduler,
  type CronScheduler,
} from '../scheduler.js'
import { AutomationStore } from '../store.js'

const API_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const previousEnv = {
  HAMMURABI_DATA_DIR: process.env.HAMMURABI_DATA_DIR,
  COMMANDER_DATA_DIR: process.env.COMMANDER_DATA_DIR,
  HAMMURABI_COMMANDER_MEMORY_DIR: process.env.HAMMURABI_COMMANDER_MEMORY_DIR,
}

const tempDirs: string[] = []

interface RunningServer {
  baseUrl: string
  initialized: Promise<void>
  scheduledJobs: ScheduledJob[]
  close: () => Promise<void>
}

interface ScheduledJob {
  expression: string
  name?: string
  timezone?: string
}

function restoreEnvVar(
  key: 'HAMMURABI_DATA_DIR' | 'COMMANDER_DATA_DIR' | 'HAMMURABI_COMMANDER_MEMORY_DIR',
  value: string | undefined,
): void {
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
      scopes: ['commanders:read', 'commanders:write', 'org:write'],
    },
  } satisfies Record<string, ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' }
      }

      return { ok: true, record }
    },
  }
}

function createTestCronScheduler(scheduledJobs: ScheduledJob[]): CronScheduler {
  return {
    schedule(expression, _task, options) {
      scheduledJobs.push({
        expression,
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.timezone ? { timezone: options.timezone } : {}),
      })
      return {
        stop: vi.fn(),
        destroy: vi.fn(),
        getNextRun: () => null,
      }
    },
    validate(expression) {
      return expression.trim().length > 0
    },
  }
}

async function startServer(dataDir: string): Promise<RunningServer> {
  const app = express()
  const apiKeyStore = createTestApiKeyStore()
  const commanderDataDir = path.join(dataDir, 'commander')
  const automationStore = new AutomationStore({
    dirPath: path.join(dataDir, 'automations'),
    commanderDataDir,
  })
  const scheduledJobs: ScheduledJob[] = []
  const automationScheduler = new AutomationScheduler({
    store: automationStore,
    scheduler: createTestCronScheduler(scheduledJobs),
    commanderStore: {
      async get() {
        return null
      },
    },
  })
  const initialized = automationScheduler.initialize()

  app.use(express.json())
  app.use('/api/org', createOrgRouter({
    apiKeyStore,
    commanderDataDir,
    sessionStore: {
      async list() {
        return []
      },
    },
    conversationStore: {
      async listByCommander() {
        return []
      },
    },
    questStore: {
      async list() {
        return []
      },
    },
    profileStore: {
      async getAvatarUrl() {
        return null
      },
      async getProfile() {
        return null
      },
    },
    automationStore,
  }))
  app.use('/api/automations', createAutomationsRouter({
    apiKeyStore,
    store: automationStore,
    scheduler: automationScheduler,
    schedulerInitialized: initialized,
  }).router)

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
    initialized,
    scheduledJobs,
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

describe('automations first boot', () => {
  it('keeps automations usable when the scheduler starts before founder setup', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-first-boot-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = await startServer(dataDir)

    try {
      await expect(server.initialized).resolves.toBeUndefined()
      expect(consoleError).not.toHaveBeenCalled()

      const firstListResponse = await fetch(`${server.baseUrl}/api/automations`, {
        headers: API_HEADERS,
      })
      expect(firstListResponse.status).toBe(200)
      expect(await firstListResponse.json()).toEqual([])

      const orgResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick.gu@example.com',
          },
        }),
      })
      expect(orgResponse.status).toBe(201)

      const createResponse = await fetch(`${server.baseUrl}/api/automations`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'First boot schedule',
          trigger: 'schedule',
          schedule: '* * * * *',
          instruction: 'Confirm automations still work after founder setup.',
          agentType: 'claude',
          status: 'active',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as Record<string, unknown>
      expect(created.operatorId).toEqual(expect.stringMatching(/^founder-/))
      expect(server.scheduledJobs).toEqual([
        {
          expression: '* * * * *',
          name: `automation-${created.id}`,
        },
      ])

      const secondListResponse = await fetch(`${server.baseUrl}/api/automations`, {
        headers: API_HEADERS,
      })
      expect(secondListResponse.status).toBe(200)
      const automations = await secondListResponse.json() as Array<Record<string, unknown>>
      expect(automations).toHaveLength(1)
      expect(automations[0]).toMatchObject({
        id: created.id,
        name: 'First boot schedule',
        operatorId: created.operatorId,
      })
    } finally {
      consoleError.mockRestore()
      await server.close()
    }
  })

  it('defers legacy automation migration until a founder exists', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-legacy-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    await mkdir(path.join(dataDir, 'automation'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'automation', 'tasks.json'),
      `${JSON.stringify({
        tasks: [
          {
            id: 'legacy-task',
            name: 'Legacy task',
            schedule: '* * * * *',
            instruction: 'Run the legacy task.',
          },
        ],
      })}\n`,
      'utf8',
    )
    const store = new AutomationStore({
      dirPath: path.join(dataDir, 'automations'),
      commanderDataDir: path.join(dataDir, 'commander'),
    })

    await expect(store.ensureLoaded()).resolves.toBeUndefined()
    expect(await store.list()).toEqual([])

    await new OperatorStore(path.join(dataDir, 'operators.json')).saveFounder({
      id: 'founder-test',
      kind: 'founder',
      displayName: 'Founder Test',
      email: 'founder@example.com',
      avatarUrl: null,
      createdAt: '2026-05-07T00:00:00.000Z',
    })

    const automations = await store.list()
    expect(automations).toHaveLength(1)
    expect(automations[0]).toMatchObject({
      id: 'legacy-task',
      operatorId: 'founder-test',
      name: 'Legacy task',
      trigger: 'schedule',
      schedule: '* * * * *',
    })
  })

  it('does not suppress corrupted operator stores when migration needs a founder', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-corrupt-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    await mkdir(path.join(dataDir, 'automation'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'automation', 'tasks.json'),
      `${JSON.stringify({
        tasks: [
          {
            id: 'legacy-task',
            name: 'Legacy task',
            schedule: '* * * * *',
            instruction: 'Run the legacy task.',
          },
        ],
      })}\n`,
      'utf8',
    )
    await writeFile(path.join(dataDir, 'operators.json'), '{bad json', 'utf8')
    const store = new AutomationStore({
      dirPath: path.join(dataDir, 'automations'),
      commanderDataDir: path.join(dataDir, 'commander'),
    })

    await expect(store.ensureLoaded()).rejects.toThrow('Invalid operator store JSON')
  })
})
