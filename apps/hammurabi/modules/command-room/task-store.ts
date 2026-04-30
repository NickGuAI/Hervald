import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  migrateLegacyPermissionMode,
  parseOptionalClaudePermissionMode,
} from '../agents/session/input.js'
import { resolveCommanderDataDir } from '../commanders/paths.js'
import { resolveAutomationDataDir, resolveLegacyCommandRoomDataDir } from '../data-dir.js'
import {
  resolveLegacyCompatibleGlobalReadPath,
  resolveLegacyCompatibleGlobalWritePath,
  type LegacyCompatibleGlobalStore,
} from './global-store-compat.js'

export type CommandRoomAgentType = 'claude' | 'codex' | 'gemini'
export type CommandRoomTaskType = 'instruction'

export interface CronTask {
  id: string
  name: string
  description?: string
  schedule: string
  timezone?: string
  machine: string
  workDir: string
  agentType: CommandRoomAgentType
  instruction: string
  taskType?: CommandRoomTaskType
  model?: string
  enabled: boolean
  createdAt: string
  commanderId?: string
  permissionMode?: 'default'
  sessionType?: 'stream' | 'pty'
}

interface PersistedTaskCollection {
  tasks: CronTask[]
}

export interface CreateCronTaskInput {
  name: string
  description?: string
  schedule: string
  timezone?: string
  machine: string
  workDir: string
  agentType: CommandRoomAgentType
  instruction: string
  taskType?: CommandRoomTaskType
  model?: string
  enabled: boolean
  commanderId?: string
  permissionMode?: 'default'
  sessionType?: 'stream' | 'pty'
}

export interface UpdateCronTaskInput {
  name?: string
  description?: string
  schedule?: string
  timezone?: string
  machine?: string
  workDir?: string
  agentType?: CommandRoomAgentType
  instruction?: string
  taskType?: CommandRoomTaskType
  model?: string
  enabled?: boolean
  permissionMode?: 'default'
  sessionType?: 'stream' | 'pty'
}

export interface CommandRoomTaskStoreOptions {
  filePath?: string
  commanderDataDir?: string | null
}

interface TaskLocation {
  task: CronTask
  filePath: string
}

const AGENT_TYPES = new Set<CommandRoomAgentType>(['claude', 'codex', 'gemini'])
const TASK_TYPES = new Set<CommandRoomTaskType>(['instruction'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asAgentType(value: unknown): CommandRoomAgentType | null {
  if (value === 'claude' || value === 'codex' || value === 'gemini') {
    return value
  }
  return null
}

function asTaskType(value: unknown): CommandRoomTaskType | null {
  if (value === 'instruction') {
    return value
  }
  return null
}

function normalizeCronTask(task: CronTask): CronTask {
  const permissionMode = parseOptionalClaudePermissionMode(task.permissionMode)
  return {
    ...task,
    ...(permissionMode ? { permissionMode } : {}),
  }
}

function isCronTask(value: unknown): value is CronTask {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.description === undefined || typeof value.description === 'string') &&
    typeof value.schedule === 'string' &&
    (value.timezone === undefined || typeof value.timezone === 'string') &&
    typeof value.machine === 'string' &&
    typeof value.workDir === 'string' &&
    AGENT_TYPES.has(value.agentType as CommandRoomAgentType) &&
    typeof value.instruction === 'string' &&
    (value.taskType === undefined || TASK_TYPES.has(value.taskType as CommandRoomTaskType)) &&
    (value.model === undefined || typeof value.model === 'string') &&
    typeof value.enabled === 'boolean' &&
    typeof value.createdAt === 'string' &&
    (value.commanderId === undefined || typeof value.commanderId === 'string') &&
    parseOptionalClaudePermissionMode(value.permissionMode) !== null &&
    (value.sessionType === undefined || value.sessionType === 'stream' || value.sessionType === 'pty')
  )
}

interface TaskMigrationRecord {
  id: string
  name: string
  legacyLiteral: string
}

interface ParsedTaskCollection extends PersistedTaskCollection {
  migrationsApplied: TaskMigrationRecord[]
}

function parseTaskCollection(raw: unknown): ParsedTaskCollection {
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : (isObject(raw) && Array.isArray(raw.tasks) ? raw.tasks : [])

  const tasks: CronTask[] = []
  const migrationsApplied: TaskMigrationRecord[] = []
  for (const candidate of candidates) {
    if (!isObject(candidate)) {
      continue
    }
    // Migrate deprecated `permissionMode` literals (bypassPermissions /
    // dangerouslySkipPermissions / acceptEdits) to 'default' BEFORE the strict
    // schema validation. Tracked entries get rewritten on disk by the caller +
    // a structured warn. See migrateLegacyPermissionMode + monorepo-g#1222.
    const migration = migrateLegacyPermissionMode(candidate.permissionMode)
    if (migration.changed) {
      candidate.permissionMode = 'default'
    }
    if (!isCronTask(candidate)) {
      continue
    }
    if (migration.changed && migration.legacyLiteral !== undefined) {
      migrationsApplied.push({
        id: candidate.id,
        name: candidate.name,
        legacyLiteral: migration.legacyLiteral,
      })
    }
    tasks.push(normalizeCronTask(candidate))
  }

  return { tasks, migrationsApplied }
}

export function defaultCommandRoomTaskStorePath(): string {
  return path.join(resolveAutomationDataDir(), 'tasks.json')
}

function legacyCommandRoomTaskStorePath(): string {
  return path.join(resolveLegacyCommandRoomDataDir(), 'tasks.json')
}

function resolveCommanderCronTasksPath(commanderDataDir: string, commanderId: string): string {
  return path.join(path.resolve(commanderDataDir), commanderId, 'cron', 'tasks.json')
}

function resolveLegacyCommanderCronTasksPath(commanderDataDir: string, commanderId: string): string {
  return path.join(path.resolve(commanderDataDir), commanderId, '.memory', 'cron', 'tasks.json')
}

export class CommandRoomTaskStore {
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly filePath: string
  private readonly commanderDataDir: string | null
  private readonly globalStore: LegacyCompatibleGlobalStore

  constructor(config: string | CommandRoomTaskStoreOptions = {}) {
    const defaultFilePath = defaultCommandRoomTaskStorePath()
    if (typeof config === 'string') {
      this.filePath = path.resolve(config)
      this.commanderDataDir = null
      this.globalStore = {
        canonicalPath: this.filePath,
        legacyPath: legacyCommandRoomTaskStorePath(),
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
    this.globalStore = {
      canonicalPath: this.filePath,
      legacyPath: legacyCommandRoomTaskStorePath(),
      fallbackEnabled: this.filePath === path.resolve(defaultFilePath),
    }
  }

  async listTasks(filter: { commanderId?: string } = {}): Promise<CronTask[]> {
    await this.mutationQueue
    const locations = await this.readTaskLocations()
    const tasks = [...locations.values()].map((entry) => entry.task)
    const sorted = tasks.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
    )
    const commanderId = asTrimmedString(filter.commanderId)
    if (!commanderId) {
      return sorted
    }
    return sorted.filter((task) => task.commanderId === commanderId)
  }

  async listEnabledTasks(): Promise<CronTask[]> {
    const tasks = await this.listTasks()
    return tasks.filter((task) => task.enabled)
  }

  async getTask(taskId: string): Promise<CronTask | null> {
    const tasks = await this.listTasks()
    return tasks.find((task) => task.id === taskId) ?? null
  }

  async createTask(input: CreateCronTaskInput): Promise<CronTask> {
    const commanderId = asTrimmedString(input.commanderId)
    const description = asTrimmedString(input.description)
    const model = asTrimmedString(input.model)
    const nextTask: CronTask = {
      id: randomUUID(),
      name: input.name,
      ...(description ? { description } : {}),
      schedule: input.schedule,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      machine: input.machine,
      workDir: input.workDir,
      agentType: input.agentType,
      instruction: input.instruction,
      taskType: asTaskType(input.taskType) ?? 'instruction',
      ...(model ? { model } : {}),
      enabled: input.enabled,
      createdAt: new Date().toISOString(),
      ...(commanderId ? { commanderId } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.sessionType ? { sessionType: input.sessionType } : {}),
    }

    return this.withMutationLock(async () => {
      const { readPath, writePath } = await this.resolveCreatePaths(commanderId)
      const tasks = await this.readTasksFromFile(readPath)
      tasks.push(nextTask)
      await this.writeTasksToFile(writePath, tasks)
      return nextTask
    })
  }

  async updateTask(taskId: string, update: UpdateCronTaskInput): Promise<CronTask | null> {
    return this.withMutationLock(async () => {
      const location = (await this.readTaskLocations()).get(taskId)
      if (!location) {
        return null
      }
      const tasks = await this.readTasksFromFile(location.filePath)
      const index = tasks.findIndex((task) => task.id === taskId)
      if (index < 0) {
        return null
      }

      const current = tasks[index]
      if (!current) {
        return null
      }

      const nextTask: CronTask = { ...current }
      const name = asTrimmedString(update.name)
      if (name) {
        nextTask.name = name
      }
      if (Object.prototype.hasOwnProperty.call(update, 'description')) {
        const description = asTrimmedString(update.description)
        if (description) {
          nextTask.description = description
        } else {
          delete nextTask.description
        }
      }
      const schedule = asTrimmedString(update.schedule)
      if (schedule) {
        nextTask.schedule = schedule
      }
      const timezone = asTrimmedString(update.timezone)
      if (timezone) {
        nextTask.timezone = timezone
      }
      const machine = asTrimmedString(update.machine)
      if (machine) {
        nextTask.machine = machine
      }
      const workDir = asTrimmedString(update.workDir)
      if (workDir) {
        nextTask.workDir = workDir
      }
      const agentType = asAgentType(update.agentType)
      if (agentType) {
        nextTask.agentType = agentType
      }
      const instruction = asTrimmedString(update.instruction)
      if (instruction) {
        nextTask.instruction = instruction
      }
      if (Object.prototype.hasOwnProperty.call(update, 'taskType')) {
        const taskType = asTaskType(update.taskType)
        if (taskType) {
          nextTask.taskType = taskType
        } else {
          delete nextTask.taskType
        }
      }
      if (Object.prototype.hasOwnProperty.call(update, 'model')) {
        const model = asTrimmedString(update.model)
        if (model) {
          nextTask.model = model
        } else {
          delete nextTask.model
        }
      }
      if (typeof update.enabled === 'boolean') {
        nextTask.enabled = update.enabled
      }
      if (Object.prototype.hasOwnProperty.call(update, 'permissionMode')) {
        if (update.permissionMode) {
          nextTask.permissionMode = update.permissionMode
        } else {
          delete nextTask.permissionMode
        }
      }
      if (Object.prototype.hasOwnProperty.call(update, 'sessionType')) {
        if (update.sessionType === 'pty' || update.sessionType === 'stream') {
          nextTask.sessionType = update.sessionType
        } else {
          delete nextTask.sessionType
        }
      }

      tasks[index] = nextTask
      await this.writeTasksToFile(this.resolveWritePath(location.filePath), tasks)
      return nextTask
    })
  }

  async deleteTask(taskId: string): Promise<boolean> {
    return this.withMutationLock(async () => {
      const location = (await this.readTaskLocations()).get(taskId)
      if (!location) {
        return false
      }
      const tasks = await this.readTasksFromFile(location.filePath)
      const nextTasks = tasks.filter((task) => task.id !== taskId)
      if (nextTasks.length === tasks.length) {
        return false
      }

      await this.writeTasksToFile(this.resolveWritePath(location.filePath), nextTasks)
      return true
    })
  }

  async deleteTaskEverywhere(taskId: string, commanderId?: string): Promise<number> {
    return this.withMutationLock(async () => {
      let deletedCount = 0

      for (const sourcePath of await this.listTaskSourcePaths()) {
        const tasks = await this.readTasksFromFile(sourcePath)
        const nextTasks = tasks.filter((task) => {
          const matchesCommander = commanderId === undefined || task.commanderId === commanderId
          const shouldDelete = task.id === taskId && matchesCommander
          if (shouldDelete) {
            deletedCount += 1
          }
          return !shouldDelete
        })

        if (nextTasks.length !== tasks.length) {
          await this.writeTasksToFile(this.resolveWritePath(sourcePath), nextTasks)
        }
      }

      return deletedCount
    })
  }

  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async resolveCreatePaths(commanderId: string | null): Promise<{
    readPath: string
    writePath: string
  }> {
    if (commanderId && this.commanderDataDir) {
      const commanderPath = resolveCommanderCronTasksPath(this.commanderDataDir, commanderId)
      return {
        readPath: commanderPath,
        writePath: commanderPath,
      }
    }

    return {
      readPath: await resolveLegacyCompatibleGlobalReadPath(this.globalStore),
      writePath: this.filePath,
    }
  }

  private async readTaskLocations(): Promise<Map<string, TaskLocation>> {
    const locations = new Map<string, TaskLocation>()
    for (const sourcePath of await this.listTaskSourcePaths()) {
      const tasks = await this.readTasksFromFile(sourcePath)
      for (const task of tasks) {
        // Commander-owned entries override legacy global copies when IDs collide.
        locations.set(task.id, {
          task,
          filePath: sourcePath,
        })
      }
    }
    return locations
  }

  private async listTaskSourcePaths(): Promise<string[]> {
    const sourcePaths = [await resolveLegacyCompatibleGlobalReadPath(this.globalStore)]
    if (!this.commanderDataDir) {
      return sourcePaths
    }

    const commanderIds = await this.listCommanderIds()
    for (const commanderId of commanderIds) {
      sourcePaths.push(resolveLegacyCommanderCronTasksPath(this.commanderDataDir, commanderId))
      sourcePaths.push(resolveCommanderCronTasksPath(this.commanderDataDir, commanderId))
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

  private async readTasksFromFile(filePath: string): Promise<CronTask[]> {
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

    const { tasks, migrationsApplied } = parseTaskCollection(parsed)

    // One-time, idempotent on-disk backfill of deprecated permissionMode
    // literals. Emit a structured warn per migrated row, then persist the
    // upgraded collection so subsequent reads are a no-op. See #1222.
    if (migrationsApplied.length > 0) {
      for (const migration of migrationsApplied) {
        console.warn(
          '[command-room/task-store] migrated legacy permissionMode',
          {
            taskId: migration.id,
            taskName: migration.name,
            filePath,
            from: migration.legacyLiteral,
            to: 'default',
          },
        )
      }
      try {
        await this.writeTasksToFile(filePath, tasks)
      } catch (error) {
        // Backfill failure is non-fatal — the in-memory tasks are still usable;
        // we'll retry on the next read. Log so it's visible.
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          '[command-room/task-store] failed to persist permissionMode migration',
          { filePath, error: message },
        )
      }
    }

    return tasks
  }

  private async writeTasksToFile(filePath: string, tasks: CronTask[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    const payload: PersistedTaskCollection = { tasks }
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}
