import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveCommanderDataDir } from '../commanders/paths.js'
import { resolveAutomationDataDir, resolveLegacyCommandRoomDataDir } from '../data-dir.js'
import {
  resolveLegacyCompatibleGlobalReadPath,
  resolveLegacyCompatibleGlobalWritePath,
  type LegacyCompatibleGlobalStore,
} from './global-store-compat.js'

export type WorkflowRunStatus = 'running' | 'complete' | 'failed' | 'timeout'

export interface WorkflowRun {
  id: string
  cronTaskId: string
  startedAt: string
  completedAt: string | null
  status: WorkflowRunStatus
  report: string
  costUsd: number
  sessionId: string
}

interface PersistedRunCollection {
  runs: WorkflowRun[]
}

export interface CreateWorkflowRunInput {
  cronTaskId: string
  startedAt: string
  completedAt: string | null
  status: WorkflowRunStatus
  report: string
  costUsd: number
  sessionId: string
}

export interface UpdateWorkflowRunInput {
  completedAt?: string | null
  status?: WorkflowRunStatus
  report?: string
  costUsd?: number
  sessionId?: string
}

interface CommandRoomTaskLookup {
  getTask(taskId: string): Promise<{ commanderId?: string } | null>
}

export interface CommandRoomRunStoreOptions {
  filePath?: string
  commanderDataDir?: string | null
  taskStore?: CommandRoomTaskLookup
}

interface RunLocation {
  run: WorkflowRun
  filePath: string
}

const WORKFLOW_STATUSES = new Set<WorkflowRunStatus>([
  'running',
  'complete',
  'failed',
  'timeout',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return typeof value === 'string' && WORKFLOW_STATUSES.has(value as WorkflowRunStatus)
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.cronTaskId === 'string' &&
    typeof value.startedAt === 'string' &&
    (value.completedAt === null || typeof value.completedAt === 'string') &&
    isWorkflowRunStatus(value.status) &&
    typeof value.report === 'string' &&
    typeof value.costUsd === 'number' &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0 &&
    typeof value.sessionId === 'string'
  )
}

function parseRunCollection(raw: unknown): PersistedRunCollection {
  if (Array.isArray(raw)) {
    return {
      runs: raw.filter((entry): entry is WorkflowRun => isWorkflowRun(entry)),
    }
  }

  if (isObject(raw) && Array.isArray(raw.runs)) {
    return {
      runs: raw.runs.filter((entry): entry is WorkflowRun => isWorkflowRun(entry)),
    }
  }

  return { runs: [] }
}

export function defaultCommandRoomRunStorePath(): string {
  return path.join(resolveAutomationDataDir(), 'runs.json')
}

function legacyCommandRoomRunStorePath(): string {
  return path.join(resolveLegacyCommandRoomDataDir(), 'runs.json')
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveCommanderCronRunsPath(commanderDataDir: string, commanderId: string): string {
  return path.join(path.resolve(commanderDataDir), commanderId, 'cron', 'runs.json')
}

function resolveLegacyCommanderCronRunsPath(commanderDataDir: string, commanderId: string): string {
  return path.join(path.resolve(commanderDataDir), commanderId, '.memory', 'cron', 'runs.json')
}

export class CommandRoomRunStore {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly filePath: string
  private readonly commanderDataDir: string | null
  private readonly taskStore?: CommandRoomTaskLookup
  private readonly globalStore: LegacyCompatibleGlobalStore

  constructor(config: string | CommandRoomRunStoreOptions = {}) {
    const defaultFilePath = defaultCommandRoomRunStorePath()
    if (typeof config === 'string') {
      this.filePath = path.resolve(config)
      this.commanderDataDir = null
      this.taskStore = undefined
      this.globalStore = {
        canonicalPath: this.filePath,
        legacyPath: legacyCommandRoomRunStorePath(),
        fallbackEnabled: this.filePath === path.resolve(defaultFilePath),
      }
      return
    }

    const configuredFilePath = config.filePath ?? defaultFilePath
    this.filePath = path.resolve(configuredFilePath)
    const commanderDataDir = config.commanderDataDir === null
      ? null
      : path.resolve(config.commanderDataDir ?? resolveCommanderDataDir())
    this.commanderDataDir = commanderDataDir
    this.taskStore = config.taskStore
    this.globalStore = {
      canonicalPath: this.filePath,
      legacyPath: legacyCommandRoomRunStorePath(),
      fallbackEnabled: this.filePath === path.resolve(defaultFilePath),
    }
  }

  async listRuns(): Promise<WorkflowRun[]> {
    await this.mutationQueue
    const locations = await this.readRunLocations()
    const runs = [...locations.values()].map((entry) => entry.run)
    return this.sortRuns(runs)
  }

  async listRunsForTask(cronTaskId: string): Promise<WorkflowRun[]> {
    const runs = await this.listRuns()
    return runs.filter((run) => run.cronTaskId === cronTaskId)
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const runs = await this.listRuns()
    return runs.find((run) => run.id === runId) ?? null
  }

  async createRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    const nextRun: WorkflowRun = {
      id: randomUUID(),
      cronTaskId: input.cronTaskId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      status: input.status,
      report: input.report,
      costUsd: Math.max(0, input.costUsd),
      sessionId: input.sessionId,
    }

    return this.withMutationLock(async () => {
      const { readPath, writePath } = await this.resolveCreatePaths(input.cronTaskId)
      const runs = await this.readRunsFromFile(readPath)
      runs.push(nextRun)
      await this.writeRunsToFile(writePath, runs)
      return nextRun
    })
  }

  async updateRun(runId: string, update: UpdateWorkflowRunInput): Promise<WorkflowRun | null> {
    return this.withMutationLock(async () => {
      const location = (await this.readRunLocations()).get(runId)
      if (!location) {
        return null
      }

      const runs = await this.readRunsFromFile(location.filePath)
      const index = runs.findIndex((run) => run.id === runId)
      if (index < 0) {
        return null
      }

      const current = runs[index]
      if (!current) {
        return null
      }

      const nextRun: WorkflowRun = { ...current }
      if (update.completedAt !== undefined) {
        nextRun.completedAt = update.completedAt
      }
      if (update.status && isWorkflowRunStatus(update.status)) {
        nextRun.status = update.status
      }
      if (typeof update.report === 'string') {
        nextRun.report = update.report
      }
      if (typeof update.costUsd === 'number' && Number.isFinite(update.costUsd)) {
        nextRun.costUsd = Math.max(0, update.costUsd)
      }
      if (typeof update.sessionId === 'string') {
        nextRun.sessionId = update.sessionId
      }

      runs[index] = nextRun
      await this.writeRunsToFile(this.resolveWritePath(location.filePath), runs)
      return nextRun
    })
  }

  async deleteRunsForTask(cronTaskId: string): Promise<void> {
    await this.withMutationLock(async () => {
      for (const sourcePath of await this.listRunSourcePaths()) {
        const runs = await this.readRunsFromFile(sourcePath)
        const nextRuns = runs.filter((run) => run.cronTaskId !== cronTaskId)
        if (nextRuns.length === runs.length) {
          continue
        }
        await this.writeRunsToFile(this.resolveWritePath(sourcePath), nextRuns)
      }
    })
  }

  async listLatestRunsByTaskIds(taskIds: readonly string[]): Promise<Map<string, WorkflowRun>> {
    if (taskIds.length === 0) {
      return new Map()
    }

    const taskIdSet = new Set(taskIds)
    const runs = await this.listRuns()
    const latest = new Map<string, WorkflowRun>()
    for (const run of runs) {
      if (!taskIdSet.has(run.cronTaskId)) {
        continue
      }
      if (!latest.has(run.cronTaskId)) {
        latest.set(run.cronTaskId, run)
      }
    }
    return latest
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private sortRuns(runs: WorkflowRun[]): WorkflowRun[] {
    return [...runs].sort(
      (left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id),
    )
  }

  private async resolveCreatePaths(cronTaskId: string): Promise<{
    readPath: string
    writePath: string
  }> {
    if (!this.commanderDataDir || !this.taskStore) {
      return {
        readPath: await resolveLegacyCompatibleGlobalReadPath(this.globalStore),
        writePath: this.filePath,
      }
    }

    const task = await this.taskStore.getTask(cronTaskId)
    const commanderId = asTrimmedString(task?.commanderId)
    if (!commanderId) {
      return {
        readPath: await resolveLegacyCompatibleGlobalReadPath(this.globalStore),
        writePath: this.filePath,
      }
    }

    const commanderPath = resolveCommanderCronRunsPath(this.commanderDataDir, commanderId)
    return {
      readPath: commanderPath,
      writePath: commanderPath,
    }
  }

  private async readRunLocations(): Promise<Map<string, RunLocation>> {
    const locations = new Map<string, RunLocation>()
    for (const sourcePath of await this.listRunSourcePaths()) {
      const runs = await this.readRunsFromFile(sourcePath)
      for (const run of runs) {
        // Commander-owned entries override legacy global copies when IDs collide.
        locations.set(run.id, {
          run,
          filePath: sourcePath,
        })
      }
    }
    return locations
  }

  private async listRunSourcePaths(): Promise<string[]> {
    const sourcePaths = [await resolveLegacyCompatibleGlobalReadPath(this.globalStore)]
    if (!this.commanderDataDir) {
      return sourcePaths
    }

    const commanderIds = await this.listCommanderIds()
    for (const commanderId of commanderIds) {
      sourcePaths.push(resolveLegacyCommanderCronRunsPath(this.commanderDataDir, commanderId))
      sourcePaths.push(resolveCommanderCronRunsPath(this.commanderDataDir, commanderId))
    }
    return sourcePaths
  }

  private async listCommanderIds(): Promise<string[]> {
    if (!this.commanderDataDir) {
      return []
    }

    try {
      const entries = await readdir(this.commanderDataDir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right))
    } catch (error) {
      if (
        isObject(error) &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === 'ENOENT'
      ) {
        return []
      }
      throw error
    }
  }

  private resolveWritePath(filePath: string): string {
    return resolveLegacyCompatibleGlobalWritePath(this.globalStore, filePath)
  }

  private async readRunsFromFile(filePath: string): Promise<WorkflowRun[]> {
    let contents: string
    try {
      contents = await readFile(filePath, 'utf8')
    } catch (error) {
      if (
        isObject(error) &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === 'ENOENT'
      ) {
        return []
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(contents) as unknown
    } catch {
      return []
    }

    return parseRunCollection(parsed).runs
  }

  private async writeRunsToFile(filePath: string, runs: WorkflowRun[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    const payload: PersistedRunCollection = { runs }
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}
