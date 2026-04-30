import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resetLegacyCommandRoomDataDirWarningForTests } from '../global-store-compat.js'
import { CommandRoomRunStore } from '../run-store.js'
import { CommandRoomTaskStore } from '../task-store.js'
import type { WorkflowRun } from '../run-store.js'

describe('CommandRoomRunStore', () => {
  let tmpDir = ''
  let store: CommandRoomRunStore
  let previousDataDir: string | undefined

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'command-room-run-store-'))
    previousDataDir = process.env.HAMMURABI_DATA_DIR
    resetLegacyCommandRoomDataDirWarningForTests()
    store = new CommandRoomRunStore(join(tmpDir, 'runs.json'))
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

  it('creates runs and filters by task id', async () => {
    const first = await store.createRun({
      cronTaskId: 'task-1',
      startedAt: '2026-03-01T01:00:00.000Z',
      completedAt: '2026-03-01T01:02:00.000Z',
      status: 'complete',
      report: 'Finished',
      costUsd: 0.12,
      sessionId: 'session-1',
    })

    await store.createRun({
      cronTaskId: 'task-2',
      startedAt: '2026-03-01T01:10:00.000Z',
      completedAt: '2026-03-01T01:11:00.000Z',
      status: 'failed',
      report: 'Failure',
      costUsd: 0,
      sessionId: 'session-2',
    })

    const taskRuns = await store.listRunsForTask('task-1')
    expect(taskRuns).toHaveLength(1)
    expect(taskRuns[0]?.id).toBe(first.id)

    const latestByTask = await store.listLatestRunsByTaskIds(['task-1', 'task-2'])
    expect(latestByTask.get('task-1')?.id).toBe(first.id)
    expect(latestByTask.get('task-2')?.status).toBe('failed')
  })

  it('routes commander-owned run records using task ownership lookup', async () => {
    const commanderDataDir = join(tmpDir, 'commanders')
    const taskStore = new CommandRoomTaskStore({
      filePath: join(tmpDir, 'legacy-tasks.json'),
      commanderDataDir,
    })
    const runStore = new CommandRoomRunStore({
      filePath: join(tmpDir, 'legacy-runs.json'),
      commanderDataDir,
      taskStore,
    })

    const commanderTask = await taskStore.createTask({
      name: 'Commander task',
      schedule: '0 2 * * *',
      machine: 'workstation-1',
      workDir: '/tmp/example-repo',
      agentType: 'claude',
      instruction: 'Run commander task',
      enabled: true,
      commanderId: 'commander-run',
    })

    const run = await runStore.createRun({
      cronTaskId: commanderTask.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      completedAt: '2026-03-02T01:01:00.000Z',
      status: 'complete',
      report: 'done',
      costUsd: 0,
      sessionId: 'session-9',
    })

    const commanderRunsPath = join(
      commanderDataDir,
      'commander-run',
      'cron',
      'runs.json',
    )
    const commanderRuns = JSON.parse(await readFile(commanderRunsPath, 'utf8')) as {
      runs?: Array<{ id: string }>
    }

    expect(commanderRuns.runs?.map((entry) => entry.id)).toEqual([run.id])
  })

  it('writes fresh global runs to automation/runs.json by default', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const defaultStore = new CommandRoomRunStore()
    const created = await defaultStore.createRun({
      cronTaskId: 'task-fresh',
      startedAt: '2026-03-05T01:00:00.000Z',
      completedAt: '2026-03-05T01:02:00.000Z',
      status: 'complete',
      report: 'fresh run',
      costUsd: 0,
      sessionId: 'session-fresh',
    })

    const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'runs.json'), 'utf8')) as {
      runs?: Array<{ id: string }>
    }

    expect(automationPayload.runs?.map((run) => run.id)).toEqual([created.id])
    await expect(readFile(join(dataDir, 'command-room', 'runs.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('reads legacy command-room runs and forward-writes them to automation/runs.json', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const legacyRun = buildRun({
      id: 'legacy-run',
      cronTaskId: 'task-legacy',
      startedAt: '2026-03-06T01:00:00.000Z',
    })
    await writeRunCollection(join(dataDir, 'command-room', 'runs.json'), [legacyRun])

    const defaultStore = new CommandRoomRunStore()
    expect((await defaultStore.listRuns()).map((run) => run.id)).toEqual([legacyRun.id])

    const created = await defaultStore.createRun({
      cronTaskId: 'task-new',
      startedAt: '2026-03-06T02:00:00.000Z',
      completedAt: '2026-03-06T02:01:00.000Z',
      status: 'complete',
      report: 'new run',
      costUsd: 0,
      sessionId: 'session-new',
    })

    const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'runs.json'), 'utf8')) as {
      runs?: Array<{ id: string }>
    }
    const legacyPayload = JSON.parse(await readFile(join(dataDir, 'command-room', 'runs.json'), 'utf8')) as {
      runs?: Array<{ id: string }>
    }

    expect((automationPayload.runs ?? []).map((run) => run.id).sort()).toEqual([created.id, legacyRun.id].sort())
    expect(legacyPayload.runs?.map((run) => run.id)).toEqual([legacyRun.id])
  })

  it('prefers automation/runs.json when both automation and legacy files exist', async () => {
    const dataDir = join(tmpDir, 'data')
    process.env.HAMMURABI_DATA_DIR = dataDir

    const legacyRun = buildRun({
      id: 'legacy-run',
      cronTaskId: 'task-legacy',
      startedAt: '2026-03-07T01:00:00.000Z',
    })
    const automationRun = buildRun({
      id: 'automation-run',
      cronTaskId: 'task-automation',
      startedAt: '2026-03-07T02:00:00.000Z',
    })
    await writeRunCollection(join(dataDir, 'command-room', 'runs.json'), [legacyRun])
    await writeRunCollection(join(dataDir, 'automation', 'runs.json'), [automationRun])

    const defaultStore = new CommandRoomRunStore()
    expect((await defaultStore.listRuns()).map((run) => run.id)).toEqual([automationRun.id])

    const created = await defaultStore.createRun({
      cronTaskId: 'task-canonical',
      startedAt: '2026-03-07T03:00:00.000Z',
      completedAt: '2026-03-07T03:01:00.000Z',
      status: 'complete',
      report: 'canonical run',
      costUsd: 0,
      sessionId: 'session-canonical',
    })

    const automationPayload = JSON.parse(await readFile(join(dataDir, 'automation', 'runs.json'), 'utf8')) as {
      runs?: Array<{ id: string }>
    }
    const legacyPayload = JSON.parse(await readFile(join(dataDir, 'command-room', 'runs.json'), 'utf8')) as {
      runs?: Array<{ id: string }>
    }

    expect((automationPayload.runs ?? []).map((run) => run.id).sort()).toEqual([automationRun.id, created.id].sort())
    expect(legacyPayload.runs?.map((run) => run.id)).toEqual([legacyRun.id])
  })
})

function buildRun(input: {
  id: string
  cronTaskId: string
  startedAt: string
}): WorkflowRun {
  return {
    id: input.id,
    cronTaskId: input.cronTaskId,
    startedAt: input.startedAt,
    completedAt: '2026-03-05T01:01:00.000Z',
    status: 'complete',
    report: `${input.id} report`,
    costUsd: 0,
    sessionId: `${input.id}-session`,
  }
}

async function writeRunCollection(filePath: string, runs: WorkflowRun[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify({ runs }, null, 2)}\n`, 'utf8')
}
