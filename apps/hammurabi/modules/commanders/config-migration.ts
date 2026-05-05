import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createDefaultHeartbeatConfig,
  mergeHeartbeatConfig,
} from './heartbeat.js'
import { resolveCommanderPaths } from './paths.js'
import {
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
  type CommanderContextMode,
  type CommanderSession,
  type CommanderSessionStore,
} from './store.js'
import { COMMANDER_WORKFLOW_FILE } from './workflow.js'

export interface CommanderConfigMigrationResult {
  commanderId: string
  migratedFields: string[]
  removedFrontmatterKeys: string[]
  sessionUpdated: boolean
  workflowUpdated: boolean
}

export interface CommanderConfigMigrationSummary {
  checked: number
  sessionUpdates: number
  workflowUpdates: number
  results: CommanderConfigMigrationResult[]
}

interface CommanderConfigMigrationOptions {
  commanderBasePath?: string
  dryRun?: boolean
  logger?: Pick<Console, 'info' | 'warn'>
}

interface CommanderWorkflowRuntimeConfig {
  heartbeatInterval?: string
  heartbeatMessage?: string
  maxTurns?: number
  contextMode?: CommanderContextMode
  fatPinInterval?: number
}

const REMOVED_COMMANDER_FRONTMATTER_KEYS = new Set([
  'heartbeat.interval',
  'heartbeat.message',
  'maxTurns',
  'contextMode',
  'fatPinInterval',
])

function formatFields(fields: string[]): string {
  return fields.join(', ')
}

function parseQuotedScalar(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }
  return parsed
}

function parseContextMode(raw: string): CommanderContextMode | null {
  const value = parseQuotedScalar(raw)
  return value === 'thin' || value === 'fat'
    ? value
    : null
}

function parseWorkflowHeartbeatIntervalMs(rawInterval: string | undefined): number | undefined {
  if (rawInterval === undefined) {
    return undefined
  }

  const trimmed = rawInterval.trim()
  if (!trimmed) {
    return undefined
  }

  const ms = parsePositiveInt(trimmed)
  return ms !== null ? ms : undefined
}

function applyRemovedFrontmatterKey(
  workflow: CommanderWorkflowRuntimeConfig,
  key: string,
  rawValue: string,
): void {
  const value = parseQuotedScalar(rawValue)
  if (!value) {
    return
  }

  if (key === 'heartbeat.interval') {
    workflow.heartbeatInterval = value
    return
  }

  if (key === 'heartbeat.message') {
    workflow.heartbeatMessage = value
    return
  }

  if (key === 'maxTurns') {
    const parsedTurns = parsePositiveInt(value)
    if (parsedTurns !== null) {
      workflow.maxTurns = Math.min(parsedTurns, DEFAULT_COMMANDER_MAX_TURNS)
    }
    return
  }

  if (key === 'contextMode') {
    const parsedMode = parseContextMode(value)
    if (parsedMode) {
      workflow.contextMode = parsedMode
    }
    return
  }

  if (key === 'fatPinInterval') {
    const parsedInterval = parsePositiveInt(value)
    if (parsedInterval !== null) {
      workflow.fatPinInterval = parsedInterval
    }
  }
}

function extractCommanderWorkflowRuntimeConfig(content: string): {
  workflow: CommanderWorkflowRuntimeConfig
  strippedContent: string
  changed: boolean
  removedKeys: string[]
} {
  const normalized = content.replace(/\r\n/g, '\n')
  const hadTrailingNewline = normalized.endsWith('\n')
  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/)
  if (!frontMatterMatch) {
    return {
      workflow: {},
      strippedContent: normalized,
      changed: false,
      removedKeys: [],
    }
  }

  const [, frontMatter, body] = frontMatterMatch
  const workflow: CommanderWorkflowRuntimeConfig = {}
  const removedKeys: string[] = []
  const keptLines = frontMatter
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        return true
      }

      const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.+)$/)
      if (!match) {
        return true
      }

      const key = match[1]
      if (!REMOVED_COMMANDER_FRONTMATTER_KEYS.has(key)) {
        return true
      }

      removedKeys.push(key)
      applyRemovedFrontmatterKey(workflow, key, match[2] ?? '')
      return false
    })

  if (removedKeys.length === 0) {
    return {
      workflow,
      strippedContent: normalized,
      changed: false,
      removedKeys: [],
    }
  }

  const hasMeaningfulFrontMatter = keptLines.some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#')
  })
  const normalizedBody = body.startsWith('\n') ? body.slice(1) : body
  const nextContent = hasMeaningfulFrontMatter
    ? `---\n${keptLines.join('\n')}\n---${normalizedBody.length > 0 ? '\n' : ''}${normalizedBody}`
    : normalizedBody
  const finalized = hadTrailingNewline && !nextContent.endsWith('\n')
    ? `${nextContent}\n`
    : nextContent

  return {
    workflow,
    strippedContent: finalized,
    changed: finalized !== normalized,
    removedKeys,
  }
}

async function readWorkflowFile(
  commanderId: string,
  commanderBasePath?: string,
): Promise<{ content: string; filePath: string } | null> {
  const workflowPath = path.join(
    resolveCommanderPaths(commanderId, commanderBasePath).commanderRoot,
    COMMANDER_WORKFLOW_FILE,
  )

  try {
    return {
      content: await readFile(workflowPath, 'utf8'),
      filePath: workflowPath,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function migrateLegacyCommanderConfigForSession(
  sessionStore: CommanderSessionStore,
  session: CommanderSession,
  options: CommanderConfigMigrationOptions = {},
): Promise<CommanderConfigMigrationResult> {
  const logger = options.logger ?? console
  const workflowFile = await readWorkflowFile(session.id, options.commanderBasePath)
  if (!workflowFile) {
    return {
      commanderId: session.id,
      migratedFields: [],
      removedFrontmatterKeys: [],
      sessionUpdated: false,
      workflowUpdated: false,
    }
  }

  const workflowUpdate = extractCommanderWorkflowRuntimeConfig(workflowFile.content)
  const workflow = workflowUpdate.workflow
  const defaultHeartbeat = createDefaultHeartbeatConfig()
  const migratedFields: string[] = []

  let nextHeartbeat = session.heartbeat
  const workflowIntervalMs = parseWorkflowHeartbeatIntervalMs(workflow.heartbeatInterval)
  if (workflow.heartbeatInterval !== undefined && workflowIntervalMs === undefined) {
    logger.warn(
      `[commanders][migration] Invalid COMMANDER.md heartbeat.interval "${workflow.heartbeatInterval}" for "${session.id}"; keeping sessions.json interval.`,
    )
  }

  if (
    workflowIntervalMs !== undefined &&
    session.heartbeat.intervalMs === defaultHeartbeat.intervalMs &&
    workflowIntervalMs !== defaultHeartbeat.intervalMs
  ) {
    nextHeartbeat = mergeHeartbeatConfig(nextHeartbeat, { intervalMs: workflowIntervalMs })
    migratedFields.push('heartbeat.intervalMs')
  }

  const workflowMessage = workflow.heartbeatMessage?.trim()
  if (
    workflowMessage &&
    session.heartbeat.messageTemplate.trim() === defaultHeartbeat.messageTemplate.trim() &&
    workflowMessage !== defaultHeartbeat.messageTemplate.trim()
  ) {
    nextHeartbeat = mergeHeartbeatConfig(nextHeartbeat, { messageTemplate: workflowMessage })
    migratedFields.push('heartbeat.messageTemplate')
  }

  let nextMaxTurns = session.maxTurns
  if (
    workflow.maxTurns !== undefined &&
    session.maxTurns === DEFAULT_COMMANDER_MAX_TURNS &&
    workflow.maxTurns !== DEFAULT_COMMANDER_MAX_TURNS
  ) {
    nextMaxTurns = workflow.maxTurns
    migratedFields.push('maxTurns')
  }

  let nextContextMode = session.contextMode
  if (
    workflow.contextMode !== undefined &&
    session.contextMode === DEFAULT_COMMANDER_CONTEXT_MODE &&
    workflow.contextMode !== DEFAULT_COMMANDER_CONTEXT_MODE
  ) {
    nextContextMode = workflow.contextMode
    migratedFields.push('contextMode')
  }

  let nextContextConfig = session.contextConfig
  if (
    workflow.fatPinInterval !== undefined &&
    session.contextConfig?.fatPinInterval === undefined
  ) {
    nextContextConfig = {
      ...(session.contextConfig ?? {}),
      fatPinInterval: workflow.fatPinInterval,
    }
    migratedFields.push('contextConfig.fatPinInterval')
  }

  if (migratedFields.length > 0) {
    logger.info(
      `[commanders][migration] Commander "${session.id}" adopted COMMANDER.md runtime config into sessions.json: ${formatFields(migratedFields)}`,
    )
    if (!options.dryRun) {
      await sessionStore.update(session.id, (current) => ({
        ...current,
        heartbeat: nextHeartbeat,
        maxTurns: nextMaxTurns,
        contextMode: nextContextMode,
        contextConfig: nextContextConfig,
      }))
    }
  }

  if (workflowUpdate.changed) {
    logger.info(
      `[commanders][migration] Commander "${session.id}" removed COMMANDER.md runtime frontmatter keys: ${formatFields(workflowUpdate.removedKeys)}`,
    )
    if (!options.dryRun) {
      await writeFile(workflowFile.filePath, workflowUpdate.strippedContent, 'utf8')
    }
  }

  return {
    commanderId: session.id,
    migratedFields,
    removedFrontmatterKeys: workflowUpdate.removedKeys,
    sessionUpdated: migratedFields.length > 0,
    workflowUpdated: workflowUpdate.changed,
  }
}

export async function migrateLegacyCommanderConfig(
  sessionStore: CommanderSessionStore,
  options: CommanderConfigMigrationOptions = {},
): Promise<CommanderConfigMigrationSummary> {
  const sessions = await sessionStore.list()
  const results: CommanderConfigMigrationResult[] = []

  for (const session of sessions) {
    results.push(await migrateLegacyCommanderConfigForSession(sessionStore, session, options))
  }

  return {
    checked: sessions.length,
    sessionUpdates: results.filter((result) => result.sessionUpdated).length,
    workflowUpdates: results.filter((result) => result.workflowUpdated).length,
    results,
  }
}
