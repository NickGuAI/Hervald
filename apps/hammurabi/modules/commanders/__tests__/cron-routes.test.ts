import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { CommandRoomRunStore } from '../../command-room/run-store.js'
import { CommandRoomTaskStore } from '../../command-room/task-store.js'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes.js'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}
const BACKFILL_COMMANDER_ID = '00000000-0000-4000-8000-000000000201'
const ALPHA_COMMANDER_ID = '00000000-0000-4000-8000-000000000202'
const BETA_COMMANDER_ID = '00000000-0000-4000-8000-000000000203'
const RUNS_COMMANDER_ID = '00000000-0000-4000-8000-000000000205'
const LEGACY_COMMANDER_ID = '00000000-0000-4000-8000-000000000206'
const SCHEDULER_COMMANDER_ID = '00000000-0000-4000-8000-000000000207'
const BARRIER_COMMANDER_ID = '00000000-0000-4000-8000-000000000208'
const COLLISION_COMMANDER_ID = '00000000-0000-4000-8000-000000000209'

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

const tempDirs: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  const record = {
    id: 'test-key-id',
    name: 'Test Key',
    keyHash: 'hash',
    prefix: 'hmrb_test',
    createdBy: 'test',
    createdAt: '2026-03-11T00:00:00.000Z',
    lastUsedAt: null,
    scopes: ['agents:read', 'agents:write'],
  } satisfies import('../../../server/api-keys/store.js').ApiKeyRecord

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const requiredScopes = options?.requiredScopes ?? []
      if (!requiredScopes.every((scope) => record.scopes.includes(scope))) {
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
    httpServer,
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

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function createCommanderCronTask(baseUrl: string, commanderId: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/commanders/${commanderId}/crons`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      schedule: '*/5 * * * *',
      instruction: `Run cron for ${commanderId}`,
      enabled: true,
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('commander cron route storage', () => {
  it('rejects non-default permissionMode cron tasks', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-dangerous-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'commander-dangerous-cron',
        }),
      })
      expect(createCommanderResponse.status).toBe(201)
      const commander = await createCommanderResponse.json() as { id: string }

      const response = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/crons`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          schedule: '*/5 * * * *',
          instruction: 'Run dangerous cron',
          permissionMode: 'yolo',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'permissionMode must be default when provided',
      })
    } finally {
      await server.close()
    }
  })

  it('does not backfill deleted harness memory maintenance cron tasks for existing commanders', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-backfill-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const commanderId = BACKFILL_COMMANDER_ID
    await writeFile(
      sessionStorePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'backfill-host',
            pid: null,
            state: 'idle',
            created: '2026-03-11T00:00:00.000Z',
            heartbeat: {
              thinIntervalSec: 60,
              fatIntervalSec: 1200,
              pinnedFatPulses: 3,
              idleResetSec: 1800,
              statusWindowSec: 3600,
              checkpointsWindowSec: 2700,
            },
            lastHeartbeat: null,
            taskSource: null,
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      let tasks: Array<{ taskType?: string; schedule?: string; instruction?: string }> = []
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch(`${server.baseUrl}/api/commanders/${commanderId}/crons`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        tasks = await response.json() as Array<{ taskType?: string; schedule?: string; instruction?: string }>
        if (tasks.length === 0) {
          break
        }
        await sleep(25)
      }

      expect(tasks).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('does not create a default harness memory maintenance cron task when a commander is created', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-default-memory-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'commander-memory-default',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as { id: string }

      const cronResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/crons`, {
        headers: AUTH_HEADERS,
      })
      expect(cronResponse.status).toBe(200)
      const tasks = await cronResponse.json() as Array<{ taskType?: string; schedule?: string }>
      expect(tasks).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('persists commander tasks in commander-owned cron store paths', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-storage-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      await createCommanderCronTask(server.baseUrl, ALPHA_COMMANDER_ID)
      await createCommanderCronTask(server.baseUrl, BETA_COMMANDER_ID)

      const alphaTasksPath = join(
        memoryBasePath,
        ALPHA_COMMANDER_ID,
        'cron',
        'tasks.json',
      )
      const betaTasksPath = join(
        memoryBasePath,
        BETA_COMMANDER_ID,
        'cron',
        'tasks.json',
      )

      const alpha = JSON.parse(await readFile(alphaTasksPath, 'utf8')) as {
        tasks?: Array<{ commanderId?: string }>
      }
      const beta = JSON.parse(await readFile(betaTasksPath, 'utf8')) as {
        tasks?: Array<{ commanderId?: string }>
      }

      expect(alpha.tasks).toHaveLength(1)
      expect(alpha.tasks?.[0]?.commanderId).toBe(ALPHA_COMMANDER_ID)
      expect(beta.tasks).toHaveLength(1)
      expect(beta.tasks?.[0]?.commanderId).toBe(BETA_COMMANDER_ID)
    } finally {
      await server.close()
    }
  })

  it('reads and cleans up commander run history from commander-owned run stores', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-runs-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const commanderId = RUNS_COMMANDER_ID

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
    })

    try {
      const created = await createCommanderCronTask(server.baseUrl, commanderId)
      const runsPath = join(
        memoryBasePath,
        commanderId,
        'cron',
        'runs.json',
      )
      const runStore = new CommandRoomRunStore(runsPath)
      await runStore.createRun({
        cronTaskId: created.id,
        startedAt: '2026-03-11T10:00:00.000Z',
        completedAt: '2026-03-11T10:01:00.000Z',
        status: 'complete',
        report: 'done',
        costUsd: 0,
        sessionId: 'session-1',
      })

      const listResponse = await fetch(`${server.baseUrl}/api/commanders/${commanderId}/crons`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const listed = (await listResponse.json()) as Array<{ id: string; lastRun: string | null }>
      expect(listed).toHaveLength(1)
      expect(listed[0]?.id).toBe(created.id)
      expect(listed[0]?.lastRun).toBe('2026-03-11T10:01:00.000Z')

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commanderId}/crons/${created.id}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(deleteResponse.status).toBe(204)
      expect(await runStore.listRunsForTask(created.id)).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('keeps legacy global commander cron tasks manageable through commander routes', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-legacy-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const commanderId = LEGACY_COMMANDER_ID
    const previousCwd = process.cwd()
    const previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.chdir(dir)
    process.env.HAMMURABI_DATA_DIR = join(dir, 'data')

    try {
      const legacyTaskStore = new CommandRoomTaskStore(join(dir, 'data', 'command-room', 'tasks.json'))
      const legacyGlobalRunsPath = join(dir, 'data', 'command-room', 'runs.json')
      const runRoutingStore = new CommandRoomRunStore({
        filePath: legacyGlobalRunsPath,
        commanderDataDir: memoryBasePath,
        taskStore: legacyTaskStore,
      })
      const legacyTask = await legacyTaskStore.createTask({
        name: 'Legacy commander task',
        schedule: '*/15 * * * *',
        machine: 'local',
        workDir: '/tmp/monorepo-g',
        agentType: 'claude',
        instruction: 'Legacy task route test',
        enabled: true,
        commanderId,
      })
      await runRoutingStore.createRun({
        cronTaskId: legacyTask.id,
        startedAt: '2026-03-11T11:00:00.000Z',
        completedAt: '2026-03-11T11:02:00.000Z',
        status: 'complete',
        report: 'legacy run',
        costUsd: 0,
        sessionId: 'legacy-session',
      })

      const server = await startServer({
        memoryBasePath,
        sessionStorePath,
      })

      try {
        const listResponse = await fetch(`${server.baseUrl}/api/commanders/${commanderId}/crons`, {
          headers: AUTH_HEADERS,
        })
        expect(listResponse.status).toBe(200)
        const listed = (await listResponse.json()) as Array<{ id: string; lastRun: string | null }>
        expect(listed).toHaveLength(1)
        expect(listed[0]?.id).toBe(legacyTask.id)
        expect(listed[0]?.lastRun).toBe('2026-03-11T11:02:00.000Z')

        const patchResponse = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/crons/${legacyTask.id}`,
          {
            method: 'PATCH',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              enabled: false,
            }),
          },
        )
        expect(patchResponse.status).toBe(200)
        const canonicalTaskStore = new CommandRoomTaskStore(join(dir, 'data', 'automation', 'tasks.json'))
        expect((await canonicalTaskStore.getTask(legacyTask.id))?.enabled).toBe(false)
        expect((await legacyTaskStore.getTask(legacyTask.id))?.enabled).toBe(true)

        const deleteResponse = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/crons/${legacyTask.id}`,
          {
            method: 'DELETE',
            headers: AUTH_HEADERS,
          },
        )
        expect(deleteResponse.status).toBe(204)
        expect(await canonicalTaskStore.getTask(legacyTask.id)).toBeNull()
        expect(await legacyTaskStore.getTask(legacyTask.id)).not.toBeNull()
        const legacyRunStore = new CommandRoomRunStore(legacyGlobalRunsPath)
        const canonicalRunStore = new CommandRoomRunStore(join(dir, 'data', 'automation', 'runs.json'))
        const commanderRunStore = new CommandRoomRunStore(
          join(memoryBasePath, commanderId, 'cron', 'runs.json'),
        )
        expect(await canonicalRunStore.listRunsForTask(legacyTask.id)).toEqual([])
        expect(await legacyRunStore.listRunsForTask(legacyTask.id)).toEqual([])
        expect(await commanderRunStore.listRunsForTask(legacyTask.id)).toEqual([])
      } finally {
        await server.close()
      }
    } finally {
      process.chdir(previousCwd)
      if (previousDataDir === undefined) {
        delete process.env.HAMMURABI_DATA_DIR
      } else {
        process.env.HAMMURABI_DATA_DIR = previousDataDir
      }
    }
  })

  it('delegates commander cron create/update/delete to injected scheduler', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-scheduler-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const tasksPath = join(dir, 'data', 'command-room', 'tasks.json')
    const runsPath = join(dir, 'data', 'command-room', 'runs.json')
    const taskStore = new CommandRoomTaskStore({
      filePath: tasksPath,
      commanderDataDir: memoryBasePath,
    })
    const runStore = new CommandRoomRunStore({
      filePath: runsPath,
      commanderDataDir: memoryBasePath,
      taskStore,
    })
    const scheduler: NonNullable<CommandersRouterOptions['commandRoomScheduler']> = {
      createTask: vi.fn(async (input) => taskStore.createTask(input)),
      updateTask: vi.fn(async (taskId, update) => taskStore.updateTask(taskId, update)),
      deleteTask: vi.fn(async (taskId) => taskStore.deleteTask(taskId)),
    }

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
      commandRoomTaskStore: taskStore,
      commandRoomRunStore: runStore,
      commandRoomScheduler: scheduler,
    })

    try {
      const commanderId = SCHEDULER_COMMANDER_ID
      const created = await createCommanderCronTask(server.baseUrl, commanderId)
      expect(scheduler.createTask).toHaveBeenCalledTimes(1)
      expect(scheduler.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          commanderId,
          instruction: `Run cron for ${commanderId}`,
        }),
      )

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commanderId}/crons/${created.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ enabled: false }),
        },
      )
      expect(patchResponse.status).toBe(200)
      expect(scheduler.updateTask).toHaveBeenCalledTimes(1)
      expect(scheduler.updateTask).toHaveBeenCalledWith(created.id, { enabled: false })

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commanderId}/crons/${created.id}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(deleteResponse.status).toBe(204)
      expect(scheduler.deleteTask).toHaveBeenCalledTimes(1)
      expect(scheduler.deleteTask).toHaveBeenCalledWith(created.id)
    } finally {
      await server.close()
    }
  })

  it('waits for scheduler initialization before mutating commander cron tasks', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-init-barrier-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const tasksPath = join(dir, 'data', 'command-room', 'tasks.json')
    const taskStore = new CommandRoomTaskStore({
      filePath: tasksPath,
      commanderDataDir: memoryBasePath,
    })

    const existing = await taskStore.createTask({
      name: 'Barrier task',
      schedule: '*/5 * * * *',
      machine: 'local',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'wait for init',
      enabled: true,
      commanderId: BARRIER_COMMANDER_ID,
    })

    let releaseInitialized: (() => void) | null = null
    const initialized = new Promise<void>((resolve) => {
      releaseInitialized = resolve
    })
    const scheduler: NonNullable<CommandersRouterOptions['commandRoomScheduler']> = {
      createTask: vi.fn(async (input) => taskStore.createTask(input)),
      updateTask: vi.fn(async (taskId, update) => taskStore.updateTask(taskId, update)),
      deleteTask: vi.fn(async (taskId) => taskStore.deleteTask(taskId)),
    }

    const server = await startServer({
      memoryBasePath,
      sessionStorePath,
      commandRoomTaskStore: taskStore,
      commandRoomScheduler: scheduler,
      commandRoomSchedulerInitialized: initialized,
    })

    try {
      const patchRequest = fetch(
        `${server.baseUrl}/api/commanders/${BARRIER_COMMANDER_ID}/crons/${existing.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ enabled: false }),
        },
      )

      await Promise.resolve()
      expect(scheduler.updateTask).not.toHaveBeenCalled()

      releaseInitialized?.()

      const patchResponse = await patchRequest
      expect(patchResponse.status).toBe(200)
      expect(scheduler.updateTask).toHaveBeenCalledWith(existing.id, { enabled: false })
    } finally {
      await server.close()
    }
  })

  it('deletes colliding commander cron task ids while preserving the legacy fallback copy', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-delete-collisions-')
    const memoryBasePath = join(dir, 'memory')
    const sessionStorePath = join(dir, 'sessions.json')
    const commanderId = COLLISION_COMMANDER_ID
    const previousCwd = process.cwd()
    const previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.chdir(dir)
    process.env.HAMMURABI_DATA_DIR = join(dir, 'data')

    try {
      const legacyTaskStore = new CommandRoomTaskStore(join(dir, 'data', 'command-room', 'tasks.json'))
      const commanderTaskStore = new CommandRoomTaskStore({
        commanderDataDir: memoryBasePath,
      })

      const created = await commanderTaskStore.createTask({
        name: 'Commander task',
        schedule: '*/5 * * * *',
        machine: 'local',
        workDir: '/tmp/monorepo-g',
        agentType: 'claude',
        instruction: 'commander version',
        enabled: true,
        commanderId,
      })

      await mkdir(join(dir, 'data', 'command-room'), { recursive: true })
      await writeFile(
        join(dir, 'data', 'command-room', 'tasks.json'),
        JSON.stringify({
          tasks: [
            {
              ...created,
              instruction: 'legacy duplicate',
            },
          ],
        }, null, 2),
        'utf8',
      )

      const server = await startServer({
        memoryBasePath,
        sessionStorePath,
      })

      try {
        const deleteResponse = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/crons/${created.id}`,
          {
            method: 'DELETE',
            headers: AUTH_HEADERS,
          },
        )

        expect(deleteResponse.status).toBe(204)
        expect(await commanderTaskStore.getTask(created.id)).toBeNull()
        const canonicalTaskStore = new CommandRoomTaskStore(join(dir, 'data', 'automation', 'tasks.json'))
        expect(await canonicalTaskStore.getTask(created.id)).toBeNull()
        expect(await legacyTaskStore.getTask(created.id)).not.toBeNull()
      } finally {
        await server.close()
      }
    } finally {
      process.chdir(previousCwd)
      if (previousDataDir === undefined) {
        delete process.env.HAMMURABI_DATA_DIR
      } else {
        process.env.HAMMURABI_DATA_DIR = previousDataDir
      }
    }
  })
})
