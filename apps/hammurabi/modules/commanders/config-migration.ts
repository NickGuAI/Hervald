import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createDefaultHeartbeatState,
  mergeHeartbeatState,
} from './heartbeat.js'
import { resolveCommanderPaths } from './paths.js'
import { resolveWorkflowHeartbeatIntervalMs } from './route-parsers.js'
import {
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
  type CommanderSession,
  type CommanderSessionStore,
} from './store.js'
import {
  COMMANDER_WORKFLOW_FILE,
  parseCommanderWorkflowContent,
  stripDeprecatedCommanderWorkflowFrontmatter,
} from './workflow.js'

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

function formatFields(fields: string[]): string {
  return fields.join(', ')
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

  const workflow = parseCommanderWorkflowContent(workflowFile.content)
  const strippedFrontmatter = stripDeprecatedCommanderWorkflowFrontmatter(workflowFile.content)
  const defaultHeartbeat = createDefaultHeartbeatState()
  const migratedFields: string[] = []

  let nextHeartbeat = session.heartbeat
  const legacyIntervalMs = resolveWorkflowHeartbeatIntervalMs(workflow.heartbeatInterval)
  if (workflow.heartbeatInterval !== undefined && legacyIntervalMs === undefined) {
    logger.warn(
      `[commanders][migration] Invalid COMMANDER.md heartbeat.interval "${workflow.heartbeatInterval}" for "${session.id}"; keeping sessions.json interval.`,
    )
  }

  if (
    legacyIntervalMs !== undefined &&
    session.heartbeat.intervalMs === defaultHeartbeat.intervalMs &&
    legacyIntervalMs !== defaultHeartbeat.intervalMs
  ) {
    nextHeartbeat = mergeHeartbeatState(nextHeartbeat, { intervalMs: legacyIntervalMs })
    migratedFields.push('heartbeat.intervalMs')
  }

  const legacyMessage = workflow.heartbeatMessage?.trim()
  if (
    legacyMessage &&
    session.heartbeat.messageTemplate.trim() === defaultHeartbeat.messageTemplate.trim() &&
    legacyMessage !== defaultHeartbeat.messageTemplate.trim()
  ) {
    nextHeartbeat = mergeHeartbeatState(nextHeartbeat, { messageTemplate: legacyMessage })
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
      `[commanders][migration] Commander "${session.id}" adopted legacy COMMANDER.md config into sessions.json: ${formatFields(migratedFields)}`,
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

  if (strippedFrontmatter.changed) {
    logger.info(
      `[commanders][migration] Commander "${session.id}" stripped deprecated COMMANDER.md frontmatter keys: ${formatFields(strippedFrontmatter.removedKeys)}`,
    )
    if (!options.dryRun) {
      await writeFile(workflowFile.filePath, strippedFrontmatter.content, 'utf8')
    }
  }

  return {
    commanderId: session.id,
    migratedFields,
    removedFrontmatterKeys: strippedFrontmatter.removedKeys,
    sessionUpdated: migratedFields.length > 0,
    workflowUpdated: strippedFrontmatter.changed,
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
