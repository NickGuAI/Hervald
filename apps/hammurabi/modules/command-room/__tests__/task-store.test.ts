import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resetLegacyCommandRoomDataDirWarningForTests } from '../global-store-compat.js'
import { CommandRoomTaskStore, type CronTask } from '../task-store.js'

describe('CommandRoomTaskStore', () => {
  let tmpDir = ''
  let store: CommandRoomTaskStore
  let previousDataDir: string | undefined

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'command-room-task-store-'))
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    resetLegacyCommandRoomDataDirWarningForTests()
    store = new CommandRoomTaskStore(join(tmpDir, 'tasks.json'))
  })

  afterEach(async () => {
    resetLegacyCommandRoomDataDirWarningForTests()
    if (previousDataDir === undefined) {
      delete process.env.HAMMURABI_DATA_DIR
    } else {
      process.env.HAMMURABI_DATA_DIR = previousDataDir
    }
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates, updates, and deletes cron tasks', async () => {
    const created = await store.createTask({
      name: 'Nightly review',
      schedule: '0 1 * * *',
      timezone: 'America/Los_Angeles',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Summarize open issues.',
      enabled: true,
    })

    expect(created.id).toBeTruthy()
    expect(created.name).toBe('Nightly review')
    expect(created.agentType).toBe('claude')
    expect(created.timezone).toBe('America/Los_Angeles')
    expect(created.createdAt).toBeTruthy()

    const listed = await store.listTasks()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(created.id)

    const updated = await store.updateTask(created.id, {
      name: 'Nightly triage',
      schedule: '0 2 * * *',
      timezone: 'America/New_York',
      enabled: false,
      agentType: 'codex',
    })
    expect(updated).not.toBeNull()
    expect(updated?.name).toBe('Nightly triage')
    expect(updated?.schedule).toBe('0 2 * * *')
    expect(updated?.timezone).toBe('America/New_York')
    expect(updated?.enabled).toBe(false)
    expect(updated?.agentType).toBe('codex')

    const enabled = await store.listEnabledTasks()
    expect(enabled).toEqual([])

    const deleted = await store.deleteTask(created.id)
    expect(deleted).toBe(true)
    expect(await store.listTasks()).toEqual([])
  })

  it('filters tasks by commanderId and preserves unfiltered backward compatibility', async () => {
    const cmdrX = await store.createTask({
      name: 'Commander X task',
      schedule: '0 1 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run X task.',
      enabled: true,
      commanderId: 'x',
    })
    const cmdrY = await store.createTask({
      name: 'Commander Y task',
      schedule: '0 2 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run Y task.',
      enabled: true,
      commanderId: 'y',
    })
    const shared = await store.createTask({
      name: 'Shared task',
      schedule: '0 3 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run shared task.',
      enabled: true,
    })

    const onlyX = await store.listTasks({ commanderId: 'x' })
    expect(onlyX.map((task) => task.id)).toEqual([cmdrX.id])

    const all = await store.listTasks()
    expect(all.map((task) => task.id).sort()).toEqual([cmdrX.id, cmdrY.id, shared.id].sort())
  })

  it('routes commander-owned tasks into commander durability paths when configured', async () => {
    const commanderDataDir = join(tmpDir, 'commanders')
    const routedStore = new CommandRoomTaskStore({
      filePath: join(tmpDir, 'legacy-tasks.json'),
      commanderDataDir,
    })

    const commanderTask = await routedStore.createTask({
      name: 'Commander owned',
      schedule: '0 4 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run commander task.',
      enabled: true,
      commanderId: 'commander-z',
    })

    const sharedTask = await routedStore.createTask({
      name: 'Shared',
      schedule: '0 5 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run shared task.',
      enabled: true,
    })

    const commanderTasksPath = join(
      commanderDataDir,
      'commander-z',
      'cron',
      'tasks.json',
    )
    const legacyTasksPath = join(tmpDir, 'legacy-tasks.json')

    const commanderPayload = JSON.parse(await readFile(commanderTasksPath, 'utf8')) as {
      tasks?: Array<{ id: string }>
    }
    const legacyPayload = JSON.parse(await readFile(legacyTasksPath, 'utf8')) as {
      tasks?: Array<{ id: string }>
    }

    expect(commanderPayload.tasks?.map((task) => task.id)).toEqual([commanderTask.id])
    expect(legacyPayload.tasks?.map((task) => task.id)).toEqual([sharedTask.id])
  })

  it('writes fresh global tasks to automation/tasks.json by default', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const defaultStore = new CommandRoomTaskStore()
    const created = await defaultStore.createTask({
      name: 'Automation task',
      schedule: '0 6 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run automation task.',
      enabled: true,
    })

    const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'tasks.json'), 'utf8')) as {
      tasks?: Array<{ id: string }>
    }

    expect(automationPayload.tasks?.map((task) => task.id)).toEqual([created.id])
    await expect(readFile(join(dataDir, 'command-room', 'tasks.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('reads legacy command-room tasks, warns once, and forward-writes to automation/tasks.json', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const legacyTask = buildTask({
      id: 'legacy-task',
      name: 'Legacy task',
      createdAt: '2026-03-03T00:00:00.000Z',
    })
    await writeTaskCollection(join(dataDir, 'command-room', 'tasks.json'), [legacyTask])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const defaultStore = new CommandRoomTaskStore()
      expect((await defaultStore.listTasks()).map((task) => task.id)).toEqual([legacyTask.id])

      const created = await defaultStore.createTask({
        name: 'Automation cutover',
        schedule: '0 7 * * *',
        machine: 'workstation-1',
        workDir: '/tmp/monorepo-g',
        agentType: 'codex',
        instruction: 'Create automation cutover task.',
        enabled: true,
      })

      const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'tasks.json'), 'utf8')) as {
        tasks?: Array<{ id: string }>
      }
      const legacyPayload = JSON.parse(await readFile(join(dataDir, 'command-room', 'tasks.json'), 'utf8')) as {
        tasks?: Array<{ id: string }>
      }

      expect((automationPayload.tasks ?? []).map((task) => task.id).sort()).toEqual([created.id, legacyTask.id].sort())
      expect(legacyPayload.tasks?.map((task) => task.id)).toEqual([legacyTask.id])

      await defaultStore.listTasks()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('prefers automation/tasks.json when both automation and legacy files exist', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const legacyTask = buildTask({
      id: 'legacy-task',
      name: 'Legacy task',
      createdAt: '2026-03-03T00:00:00.000Z',
    })
    const automationTask = buildTask({
      id: 'automation-task',
      name: 'Automation task',
      createdAt: '2026-03-04T00:00:00.000Z',
    })
    await writeTaskCollection(join(dataDir, 'command-room', 'tasks.json'), [legacyTask])
    await writeTaskCollection(join(dataDir, 'automation', 'tasks.json'), [automationTask])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const defaultStore = new CommandRoomTaskStore()
      expect((await defaultStore.listTasks()).map((task) => task.id)).toEqual([automationTask.id])

      const created = await defaultStore.createTask({
        name: 'Automation canonical task',
        schedule: '0 8 * * *',
        machine: 'workstation-1',
        workDir: '/tmp/monorepo-g',
        agentType: 'gemini',
        instruction: 'Write canonical automation task.',
        enabled: true,
      })

      const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'tasks.json'), 'utf8')) as {
        tasks?: Array<{ id: string }>
      }
      const legacyPayload = JSON.parse(await readFile(join(dataDir, 'command-room', 'tasks.json'), 'utf8')) as {
        tasks?: Array<{ id: string }>
      }

      expect((automationPayload.tasks ?? []).map((task) => task.id).sort()).toEqual([automationTask.id, created.id].sort())
      expect(legacyPayload.tasks?.map((task) => task.id)).toEqual([legacyTask.id])
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  // -----------------------------------------------------------------
  // Legacy permissionMode migration — issue/1222
  //
  // Before #1222, on-disk task entries with deprecated permissionMode
  // literals (bypassPermissions / dangerouslySkipPermissions / acceptEdits)
  // were silently dropped at parse time because the strict parser returns
  // null for those values. Now they normalize to 'default', emit a
  // structured warn, and the upgraded collection is persisted back to disk
  // so subsequent reads are no-ops.
  // -----------------------------------------------------------------

  it('migrates a legacy bypassPermissions task to default and warns once', async () => {
    const filePath = join(tmpDir, 'tasks.json')
    const legacyTask = {
      id: 'task-bypass',
      name: 'Bypass legacy task',
      schedule: '0 1 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/monorepo-g',
      agentType: 'claude',
      instruction: 'Run nightly.',
      enabled: true,
      createdAt: '2026-04-01T00:00:00.000Z',
      permissionMode: 'bypassPermissions',
    }
    await writeFile(filePath, `${JSON.stringify({ tasks: [legacyTask] }, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const tasks = await store.listTasks()
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.permissionMode).toBe('default')

      const warnCalls = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(warnCalls).toHaveLength(1)
      expect(warnCalls[0]?.[1]).toMatchObject({
        taskId: 'task-bypass',
        from: 'bypassPermissions',
        to: 'default',
      })

      // Disk has been rewritten with the upgraded literal.
      const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as { tasks: Array<Record<string, unknown>> }
      expect(onDisk.tasks[0]?.permissionMode).toBe('default')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('also migrates dangerouslySkipPermissions and acceptEdits aliases', async () => {
    const filePath = join(tmpDir, 'tasks.json')
    const tasks = [
      { id: 'a', name: 'A', schedule: '0 1 * * *', machine: '', workDir: '/x', agentType: 'claude', instruction: 'a', enabled: true, createdAt: '2026-04-01T00:00:00.000Z', permissionMode: 'dangerouslySkipPermissions' },
      { id: 'b', name: 'B', schedule: '0 2 * * *', machine: '', workDir: '/x', agentType: 'claude', instruction: 'b', enabled: true, createdAt: '2026-04-01T00:00:00.000Z', permissionMode: 'acceptEdits' },
    ]
    await writeFile(filePath, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const result = await store.listTasks()
      expect(result).toHaveLength(2)
      expect(result.every((t) => t.permissionMode === 'default')).toBe(true)

      const warnCalls = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(warnCalls).toHaveLength(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('is idempotent — second load on already-upgraded file produces zero warns and zero churn', async () => {
    const filePath = join(tmpDir, 'tasks.json')
    const legacyTask = {
      id: 'task-idem',
      name: 'Idempotent',
      schedule: '0 1 * * *',
      machine: '',
      workDir: '/x',
      agentType: 'claude',
      instruction: 'a',
      enabled: true,
      createdAt: '2026-04-01T00:00:00.000Z',
      permissionMode: 'bypassPermissions',
    }
    await writeFile(filePath, `${JSON.stringify({ tasks: [legacyTask] }, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // First load — migration fires once.
      await store.listTasks()
      const firstWarnCount = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(firstWarnCount).toBe(1)

      const afterFirst = await readFile(filePath, 'utf8')

      // Second load — file already upgraded, no warn, no rewrite.
      warnSpy.mockClear()
      await store.listTasks()
      const secondWarnCount = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(secondWarnCount).toBe(0)

      const afterSecond = await readFile(filePath, 'utf8')
      expect(afterSecond).toBe(afterFirst)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('passes through default values without warning', async () => {
    const filePath = join(tmpDir, 'tasks.json')
    const task = {
      id: 'task-default',
      name: 'Already default',
      schedule: '0 1 * * *',
      machine: '',
      workDir: '/x',
      agentType: 'claude',
      instruction: 'a',
      enabled: true,
      createdAt: '2026-04-01T00:00:00.000Z',
      permissionMode: 'default',
    }
    await writeFile(filePath, `${JSON.stringify({ tasks: [task] }, null, 2)}\n`, 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const result = await store.listTasks()
      expect(result).toHaveLength(1)
      expect(result[0]?.permissionMode).toBe('default')

      const migrationWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(migrationWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

function buildTask(input: {
  id: string
  name: string
  createdAt: string
}): CronTask {
  return {
    id: input.id,
    name: input.name,
    schedule: '0 1 * * *',
    machine: 'workstation-1',
    workDir: '/tmp/monorepo-g',
    agentType: 'claude',
    instruction: `Run ${input.name}.`,
    taskType: 'instruction',
    enabled: true,
    createdAt: input.createdAt,
  }
}

async function writeTaskCollection(filePath: string, tasks: CronTask[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8')
}
