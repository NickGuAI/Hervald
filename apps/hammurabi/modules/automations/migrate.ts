import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseProviderId } from '../agents/providers/registry.js'
import type { AgentType } from '../agents/types.js'
import { resolveCommanderDataDir } from '../commanders/paths.js'
import { resolveAutomationsDataDir } from '../data-dir.js'
import { resolveFounderOperatorId } from './resolve-founder-operator.js'
import type {
  Automation,
  AutomationExecutionSource,
  AutomationHistoryEntry,
  AutomationStatus,
} from './types.js'

const AUTOMATION_BOOT_MIGRATION_VERSION = 1
const MANIFEST_FILE = 'manifest.json'

interface LegacyCronTask {
  id: string
  name: string
  description?: string
  schedule: string
  timezone?: string
  machine?: string
  workDir?: string
  agentType?: AgentType
  instruction: string
  model?: string
  enabled?: boolean
  createdAt?: string
  commanderId?: string
  permissionMode?: 'default'
  sessionType?: 'stream' | 'pty'
}

interface LegacyWorkflowRun {
  id: string
  cronTaskId: string
  startedAt: string
  completedAt: string | null
  status: 'running' | 'complete' | 'failed' | 'timeout'
  report: string
  costUsd: number
  sessionId: string
}

interface LegacySentinelHistoryEntry {
  timestamp: string
  action: string
  result: string
  costUsd: number
  durationSec: number
  sessionId?: string
  runFile?: string
  memoryUpdated?: boolean
  source?: 'cron' | 'manual'
}

interface LegacySentinel {
  id: string
  name: string
  instruction: string
  schedule: string
  timezone?: string
  status: AutomationStatus
  agentType?: AgentType
  permissionMode?: 'default'
  model?: string
  parentCommanderId: string
  skills?: string[]
  seedMemory?: string
  memoryPath?: string
  outputDir?: string
  workDir?: string
  maxRuns?: number
  createdAt?: string
  lastRun?: string | null
  totalRuns?: number
  totalCostUsd?: number
  history?: LegacySentinelHistoryEntry[]
  observations?: string[]
}

interface AutomationBootMigrationManifest {
  version: number
  migratedFromCron: boolean
  cronTasksImported: boolean
  cronRunsMerged: boolean
  sentinelsImported: boolean
  commandRoomBackedUp: boolean
}

interface MigrationRoots {
  hammurabiDataDir: string
  singularAutomationDir: string
  commandRoomDir: string
  commandRoomBackupDir: string
  sentinelsFilePath: string
  manifestPath: string
}

export interface MigrateLegacyAutomationsOptions {
  automationsDir?: string
  commanderDataDir?: string
}

export interface MigrateLegacyAutomationsResult {
  migratedIds: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return null
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  return null
}

function asAgentType(value: unknown): AgentType | null {
  return parseProviderId(value)
}

function formatSeedMemory(name: string, seedMemory: string): string {
  const normalizedSeedMemory = seedMemory.trim().length > 0
    ? seedMemory.trim()
    : '(No seed memory provided)'

  return [
    `# Automation Memory: ${name}`,
    '',
    '## Seed Context',
    normalizedSeedMemory,
    '',
    '## Learned Facts',
    '- Add durable facts here over time.',
  ].join('\n')
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const nextContent = `${JSON.stringify(payload, null, 2)}\n`
  let currentContent: string | null = null
  try {
    currentContent = await readFile(filePath, 'utf8')
  } catch (error) {
    if (!(isObject(error) && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  if (currentContent === nextContent) {
    return
  }

  if (currentContent !== null) {
    await copyFile(filePath, `${filePath}.bak`)
  }

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, nextContent, 'utf8')
  await rename(tempPath, filePath)
}

function defaultManifest(): AutomationBootMigrationManifest {
  return {
    version: AUTOMATION_BOOT_MIGRATION_VERSION,
    migratedFromCron: false,
    cronTasksImported: false,
    cronRunsMerged: false,
    sentinelsImported: false,
    commandRoomBackedUp: false,
  }
}

async function readManifest(filePath: string): Promise<AutomationBootMigrationManifest> {
  const parsed = await readJsonFile(filePath)
  if (!isObject(parsed)) {
    return defaultManifest()
  }

  return {
    version: parsed.version === AUTOMATION_BOOT_MIGRATION_VERSION
      ? AUTOMATION_BOOT_MIGRATION_VERSION
      : AUTOMATION_BOOT_MIGRATION_VERSION,
    migratedFromCron: parsed.migratedFromCron === true,
    cronTasksImported: parsed.cronTasksImported === true,
    cronRunsMerged: parsed.cronRunsMerged === true,
    sentinelsImported: parsed.sentinelsImported === true,
    commandRoomBackedUp: parsed.commandRoomBackedUp === true,
  }
}

function resolveMigrationRoots(automationsDir: string): MigrationRoots {
  const hammurabiDataDir = path.dirname(automationsDir)
  return {
    hammurabiDataDir,
    singularAutomationDir: path.join(hammurabiDataDir, 'automation'),
    commandRoomDir: path.join(hammurabiDataDir, 'command-room'),
    commandRoomBackupDir: path.join(hammurabiDataDir, 'legacy-backup', 'command-room'),
    sentinelsFilePath: path.join(hammurabiDataDir, 'sentinels', 'sentinels.json'),
    manifestPath: path.join(automationsDir, MANIFEST_FILE),
  }
}

function parseLegacyCronTasks(payload: unknown): LegacyCronTask[] {
  const entries = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.tasks) ? payload.tasks : [])
  const tasks: LegacyCronTask[] = []
  for (const entry of entries) {
    if (!isObject(entry)) {
      continue
    }
    const id = asTrimmedString(entry.id)
    const name = asTrimmedString(entry.name)
    const schedule = asTrimmedString(entry.schedule)
    const instruction = asTrimmedString(entry.instruction)
    if (!id || !name || !schedule || !instruction) {
      continue
    }
    tasks.push({
      id,
      name,
      description: asTrimmedString(entry.description) ?? undefined,
      schedule,
      timezone: asTrimmedString(entry.timezone) ?? undefined,
      machine: asTrimmedString(entry.machine) ?? undefined,
      workDir: asTrimmedString(entry.workDir) ?? undefined,
      agentType: asAgentType(entry.agentType) ?? 'claude',
      instruction,
      model: asTrimmedString(entry.model) ?? undefined,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
      createdAt: asTrimmedString(entry.createdAt) ?? undefined,
      commanderId: asTrimmedString(entry.commanderId) ?? undefined,
      permissionMode: 'default',
      sessionType: entry.sessionType === 'pty'
        ? 'pty'
        : entry.sessionType === 'stream'
          ? 'stream'
          : undefined,
    })
  }
  return tasks
}

function parseLegacyWorkflowRuns(payload: unknown): LegacyWorkflowRun[] {
  const entries = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.runs) ? payload.runs : [])
  const runs: LegacyWorkflowRun[] = []
  for (const entry of entries) {
    if (!isObject(entry)) {
      continue
    }
    const id = asTrimmedString(entry.id)
    const cronTaskId = asTrimmedString(entry.cronTaskId)
    const startedAt = asTrimmedString(entry.startedAt)
    if (!id || !cronTaskId || !startedAt) {
      continue
    }
    const status = entry.status === 'running'
      || entry.status === 'complete'
      || entry.status === 'failed'
      || entry.status === 'timeout'
      ? entry.status
      : 'failed'
    runs.push({
      id,
      cronTaskId,
      startedAt,
      completedAt: entry.completedAt === null ? null : asTrimmedString(entry.completedAt),
      status,
      report: typeof entry.report === 'string' ? entry.report : '',
      costUsd: asNonNegativeNumber(entry.costUsd) ?? 0,
      sessionId: asTrimmedString(entry.sessionId) ?? '',
    })
  }
  return runs
}

function parseLegacySentinelHistoryEntry(entry: unknown): LegacySentinelHistoryEntry | null {
  if (!isObject(entry)) {
    return null
  }

  const timestamp = asTrimmedString(entry.timestamp)
  const action = asTrimmedString(entry.action)
  const result = asTrimmedString(entry.result)
  const costUsd = asNonNegativeNumber(entry.costUsd)
  const durationSec = asNonNegativeNumber(entry.durationSec)
  if (!timestamp || !action || !result || costUsd === null || durationSec === null) {
    return null
  }

  return {
    timestamp,
    action,
    result,
    costUsd,
    durationSec,
    sessionId: asTrimmedString(entry.sessionId) ?? undefined,
    runFile: asTrimmedString(entry.runFile) ?? undefined,
    memoryUpdated: entry.memoryUpdated === true,
    source: entry.source === 'manual' ? 'manual' : 'cron',
  }
}

function parseLegacySentinels(payload: unknown): LegacySentinel[] {
  const entries = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.sentinels) ? payload.sentinels : [])
  const sentinels: LegacySentinel[] = []
  for (const entry of entries) {
    if (!isObject(entry)) {
      continue
    }
    const id = asTrimmedString(entry.id)
    const name = asTrimmedString(entry.name)
    const instruction = asTrimmedString(entry.instruction)
    const schedule = asTrimmedString(entry.schedule)
    const parentCommanderId = asTrimmedString(entry.parentCommanderId)
    if (!id || !name || !instruction || !schedule || !parentCommanderId) {
      continue
    }

    const status = entry.status === 'paused'
      || entry.status === 'completed'
      || entry.status === 'cancelled'
      ? entry.status
      : 'active'
    const history = Array.isArray(entry.history)
      ? entry.history
        .map(parseLegacySentinelHistoryEntry)
        .filter((item): item is LegacySentinelHistoryEntry => item !== null)
      : []

    sentinels.push({
      id,
      name,
      instruction,
      schedule,
      timezone: asTrimmedString(entry.timezone) ?? undefined,
      status,
      agentType: asAgentType(entry.agentType) ?? 'claude',
      permissionMode: 'default',
      model: asTrimmedString(entry.model) ?? undefined,
      parentCommanderId,
      skills: Array.isArray(entry.skills)
        ? entry.skills.map((skill) => asTrimmedString(skill)).filter((skill): skill is string => Boolean(skill))
        : [],
      seedMemory: asTrimmedString(entry.seedMemory) ?? '',
      memoryPath: asTrimmedString(entry.memoryPath) ?? undefined,
      outputDir: asTrimmedString(entry.outputDir) ?? undefined,
      workDir: asTrimmedString(entry.workDir) ?? undefined,
      maxRuns: asPositiveInteger(entry.maxRuns) ?? undefined,
      createdAt: asTrimmedString(entry.createdAt) ?? undefined,
      lastRun: entry.lastRun === null ? null : (asTrimmedString(entry.lastRun) ?? null),
      totalRuns: asNonNegativeNumber(entry.totalRuns) ?? undefined,
      totalCostUsd: asNonNegativeNumber(entry.totalCostUsd) ?? undefined,
      history,
      observations: Array.isArray(entry.observations)
        ? entry.observations.map((value) => asTrimmedString(value)).filter((value): value is string => Boolean(value))
        : undefined,
    })
  }
  return sentinels
}

function mapRunToHistory(run: LegacyWorkflowRun): AutomationHistoryEntry {
  const finishedAt = run.completedAt ?? run.startedAt
  const durationSec = run.completedAt
    ? Math.max(
      0,
      Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000),
    )
    : 0
  const action = run.status === 'complete'
    ? 'Run completed'
    : run.status === 'timeout'
      ? 'Run timed out'
      : 'Run failed'
  return {
    timestamp: finishedAt,
    action,
    result: run.report || action,
    costUsd: run.costUsd,
    durationSec,
    sessionId: run.sessionId || undefined,
    memoryUpdated: false,
    source: 'schedule',
  }
}

function mapSentinelHistory(entry: LegacySentinelHistoryEntry): AutomationHistoryEntry {
  const source: AutomationExecutionSource = entry.source === 'manual' ? 'manual' : 'schedule'
  return {
    timestamp: entry.timestamp,
    action: entry.action,
    result: entry.result,
    costUsd: entry.costUsd,
    durationSec: entry.durationSec,
    sessionId: entry.sessionId,
    runFile: entry.runFile,
    memoryUpdated: entry.memoryUpdated,
    source,
  }
}

function historyKey(entry: AutomationHistoryEntry): string {
  return [
    entry.timestamp,
    entry.action,
    entry.result,
    String(entry.costUsd),
    String(entry.durationSec),
    entry.sessionId ?? '',
    entry.runFile ?? '',
    entry.memoryUpdated === true ? '1' : '0',
    entry.source ?? '',
  ].join('\u0000')
}

function mergeHistory(
  existing: AutomationHistoryEntry[] | undefined,
  additions: AutomationHistoryEntry[],
): AutomationHistoryEntry[] {
  const merged = new Map<string, AutomationHistoryEntry>()
  for (const entry of existing ?? []) {
    merged.set(historyKey(entry), entry)
  }
  for (const entry of additions) {
    merged.set(historyKey(entry), entry)
  }
  return [...merged.values()].sort((left, right) => right.timestamp.localeCompare(left.timestamp))
}

function buildCronAutomation(
  task: LegacyCronTask,
  operatorId: string,
  automationsDir: string,
  now: string,
): Automation {
  const automationDir = path.join(automationsDir, task.id)
  return {
    id: task.id,
    operatorId,
    parentCommanderId: task.commanderId ?? null,
    name: task.name,
    trigger: 'schedule',
    schedule: task.schedule,
    instruction: task.instruction,
    agentType: task.agentType ?? 'claude',
    permissionMode: task.permissionMode ?? 'default',
    skills: [],
    status: task.enabled === false ? 'paused' : 'active',
    description: task.description,
    timezone: task.timezone,
    machine: task.machine ?? '',
    workDir: task.workDir ?? process.cwd(),
    model: task.model,
    sessionType: task.sessionType,
    createdAt: task.createdAt ?? now,
    lastRun: null,
    totalRuns: 0,
    totalCostUsd: 0,
    history: [],
    seedMemory: '',
    memoryPath: path.join(automationDir, 'memory.md'),
    outputDir: automationDir,
  }
}

function buildSentinelAutomation(
  sentinel: LegacySentinel,
  operatorId: string,
  automationsDir: string,
  now: string,
): Automation {
  const automationDir = path.join(automationsDir, sentinel.id)
  const history = (sentinel.history ?? []).map(mapSentinelHistory)
  return {
    id: sentinel.id,
    operatorId,
    parentCommanderId: sentinel.parentCommanderId,
    name: sentinel.name,
    trigger: 'schedule',
    schedule: sentinel.schedule,
    instruction: sentinel.instruction,
    agentType: sentinel.agentType ?? 'claude',
    permissionMode: sentinel.permissionMode ?? 'default',
    skills: sentinel.skills ?? [],
    status: sentinel.status,
    timezone: sentinel.timezone,
    workDir: sentinel.workDir ?? process.cwd(),
    model: sentinel.model,
    sessionType: 'stream',
    createdAt: sentinel.createdAt ?? now,
    lastRun: sentinel.lastRun ?? history[0]?.timestamp ?? null,
    totalRuns: sentinel.totalRuns ?? history.length,
    totalCostUsd: sentinel.totalCostUsd ?? history.reduce((sum, entry) => sum + entry.costUsd, 0),
    history,
    observations: sentinel.observations,
    seedMemory: sentinel.seedMemory ?? '',
    memoryPath: sentinel.memoryPath ?? path.join(automationDir, 'memory.md'),
    outputDir: sentinel.outputDir ?? automationDir,
    maxRuns: sentinel.maxRuns,
  }
}

function resolveTotals(history: AutomationHistoryEntry[]): {
  lastRun: string | null
  totalRuns: number
  totalCostUsd: number
} {
  return {
    lastRun: history[0]?.timestamp ?? null,
    totalRuns: history.length,
    totalCostUsd: history.reduce((sum, entry) => sum + entry.costUsd, 0),
  }
}

function asAutomationRecord(payload: unknown): Automation | null {
  if (!isObject(payload)) {
    return null
  }
  const id = asTrimmedString(payload.id)
  const operatorId = asTrimmedString(payload.operatorId)
  const name = asTrimmedString(payload.name)
  const trigger = payload.trigger === 'schedule' || payload.trigger === 'quest' || payload.trigger === 'manual'
    ? payload.trigger
    : null
  const instruction = asTrimmedString(payload.instruction)
  const agentType = asAgentType(payload.agentType)
  if (!id || !operatorId || !name || !trigger || !instruction || !agentType) {
    return null
  }

  return payload as unknown as Automation
}

async function ensureAutomationArtifacts(
  automationDir: string,
  automation: Pick<Automation, 'name' | 'seedMemory' | 'memoryPath' | 'outputDir'>,
): Promise<void> {
  const outputDir = automation.outputDir ?? path.join(automationDir, 'artifacts')
  const memoryPath = automation.memoryPath ?? path.join(automationDir, 'memory.md')
  await mkdir(path.join(outputDir, 'runs'), { recursive: true })
  await mkdir(path.join(outputDir, 'artifacts'), { recursive: true })
  try {
    await readFile(memoryPath, 'utf8')
  } catch (error) {
    if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
      await mkdir(path.dirname(memoryPath), { recursive: true })
      await writeFile(memoryPath, formatSeedMemory(automation.name, automation.seedMemory ?? ''), 'utf8')
      return
    }
    throw error
  }
}

async function listCommanderIds(commanderDataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(commanderDataDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function loadLegacyCronTasks(
  roots: MigrationRoots,
  commanderDataDir: string,
): Promise<LegacyCronTask[]> {
  const tasks: LegacyCronTask[] = []
  tasks.push(...parseLegacyCronTasks(await readJsonFile(path.join(roots.singularAutomationDir, 'tasks.json'))))
  tasks.push(...parseLegacyCronTasks(await readJsonFile(path.join(roots.commandRoomDir, 'tasks.json'))))

  for (const commanderId of await listCommanderIds(commanderDataDir)) {
    tasks.push(...parseLegacyCronTasks(
      await readJsonFile(path.join(commanderDataDir, commanderId, 'cron', 'tasks.json')),
    ))
    tasks.push(...parseLegacyCronTasks(
      await readJsonFile(path.join(commanderDataDir, commanderId, '.memory', 'cron', 'tasks.json')),
    ))
  }

  const deduped = new Map<string, LegacyCronTask>()
  for (const task of tasks) {
    deduped.set(task.id, task)
  }
  return [...deduped.values()]
}

async function loadLegacyRuns(
  roots: MigrationRoots,
  commanderDataDir: string,
): Promise<Map<string, LegacyWorkflowRun[]>> {
  const runs: LegacyWorkflowRun[] = []
  runs.push(...parseLegacyWorkflowRuns(await readJsonFile(path.join(roots.singularAutomationDir, 'runs.json'))))
  runs.push(...parseLegacyWorkflowRuns(await readJsonFile(path.join(roots.commandRoomDir, 'runs.json'))))

  for (const commanderId of await listCommanderIds(commanderDataDir)) {
    runs.push(...parseLegacyWorkflowRuns(
      await readJsonFile(path.join(commanderDataDir, commanderId, 'cron', 'runs.json')),
    ))
    runs.push(...parseLegacyWorkflowRuns(
      await readJsonFile(path.join(commanderDataDir, commanderId, '.memory', 'cron', 'runs.json')),
    ))
  }

  const grouped = new Map<string, LegacyWorkflowRun[]>()
  for (const run of runs) {
    const existing = grouped.get(run.cronTaskId) ?? []
    existing.push(run)
    grouped.set(run.cronTaskId, existing)
  }
  for (const [taskId, taskRuns] of grouped) {
    taskRuns.sort((left, right) =>
      (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    )
    grouped.set(taskId, taskRuns)
  }
  return grouped
}

async function loadLegacySentinels(roots: MigrationRoots): Promise<LegacySentinel[]> {
  return parseLegacySentinels(await readJsonFile(roots.sentinelsFilePath))
}

async function moveCommandRoomToBackup(roots: MigrationRoots): Promise<void> {
  try {
    await readdir(roots.commandRoomDir)
  } catch (error) {
    if (isObject(error) && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  try {
    await readdir(roots.commandRoomBackupDir)
    return
  } catch (error) {
    if (!(isObject(error) && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  await mkdir(path.dirname(roots.commandRoomBackupDir), { recursive: true })
  await rename(roots.commandRoomDir, roots.commandRoomBackupDir)
}

export async function migrateLegacyAutomations(
  options: MigrateLegacyAutomationsOptions = {},
): Promise<MigrateLegacyAutomationsResult> {
  const automationsDir = path.resolve(options.automationsDir ?? resolveAutomationsDataDir())
  const commanderDataDir = path.resolve(options.commanderDataDir ?? resolveCommanderDataDir())
  const roots = resolveMigrationRoots(automationsDir)
  await mkdir(automationsDir, { recursive: true })

  const operatorId = await resolveFounderOperatorId()
  const manifest = await readManifest(roots.manifestPath)
  const migratedIds = new Set<string>()
  const now = new Date().toISOString()

  if (!manifest.cronTasksImported || !manifest.cronRunsMerged) {
    const tasks = await loadLegacyCronTasks(roots, commanderDataDir)
    const runsByTaskId = await loadLegacyRuns(roots, commanderDataDir)

    if (!manifest.cronTasksImported) {
      for (const task of tasks) {
        const filePath = path.join(automationsDir, `${task.id}.json`)
        const existing = asAutomationRecord(await readJsonFile(filePath))
        if (existing) {
          continue
        }

        const automation = buildCronAutomation(task, operatorId, automationsDir, now)
        await ensureAutomationArtifacts(path.join(automationsDir, task.id), automation)
        await writeJsonFileAtomic(filePath, automation)
        migratedIds.add(task.id)
      }

      manifest.cronTasksImported = true
      manifest.migratedFromCron = true
      await writeJsonFileAtomic(roots.manifestPath, manifest)
    }

    if (!manifest.cronRunsMerged) {
      for (const task of tasks) {
        const additions = (runsByTaskId.get(task.id) ?? []).map(mapRunToHistory)
        if (additions.length === 0) {
          continue
        }

        const filePath = path.join(automationsDir, `${task.id}.json`)
        const existing = asAutomationRecord(await readJsonFile(filePath))
        const base = existing ?? buildCronAutomation(task, operatorId, automationsDir, now)
        const history = mergeHistory(base.history, additions)
        const totals = resolveTotals(history)
        const nextAutomation: Automation = {
          ...base,
          history,
          lastRun: totals.lastRun,
          totalRuns: totals.totalRuns,
          totalCostUsd: totals.totalCostUsd,
        }

        await ensureAutomationArtifacts(path.join(automationsDir, task.id), nextAutomation)
        await writeJsonFileAtomic(filePath, nextAutomation)
        migratedIds.add(task.id)
      }

      manifest.cronRunsMerged = true
      manifest.migratedFromCron = true
      await writeJsonFileAtomic(roots.manifestPath, manifest)
    }
  }

  if (!manifest.sentinelsImported) {
    for (const sentinel of await loadLegacySentinels(roots)) {
      const filePath = path.join(automationsDir, `${sentinel.id}.json`)
      const existing = asAutomationRecord(await readJsonFile(filePath))
      const base = existing ?? buildSentinelAutomation(sentinel, operatorId, automationsDir, now)
      const history = mergeHistory(base.history, (sentinel.history ?? []).map(mapSentinelHistory))
      const totals = resolveTotals(history)
      const nextAutomation: Automation = {
        ...base,
        history,
        lastRun: sentinel.lastRun ?? totals.lastRun,
        totalRuns: sentinel.totalRuns ?? totals.totalRuns,
        totalCostUsd: sentinel.totalCostUsd ?? totals.totalCostUsd,
      }

      await ensureAutomationArtifacts(path.join(automationsDir, sentinel.id), nextAutomation)
      await writeJsonFileAtomic(filePath, nextAutomation)
      migratedIds.add(sentinel.id)
    }

    manifest.sentinelsImported = true
    manifest.migratedFromCron = true
    await writeJsonFileAtomic(roots.manifestPath, manifest)
  }

  if (!manifest.commandRoomBackedUp && manifest.cronTasksImported && manifest.cronRunsMerged) {
    await moveCommandRoomToBackup(roots)
    manifest.commandRoomBackedUp = true
    manifest.migratedFromCron = true
    await writeJsonFileAtomic(roots.manifestPath, manifest)
  }

  return {
    migratedIds: [...migratedIds].sort((left, right) => left.localeCompare(right)),
  }
}
