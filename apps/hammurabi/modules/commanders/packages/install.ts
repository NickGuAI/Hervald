import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createDefaultHeartbeatConfig } from '../heartbeat.js'
import { readCommanderDisplayNames, setCommanderDisplayName } from '../names-lock.js'
import { resolveCommanderPaths } from '../paths.js'
import { createDefaultCommanderRuntimeConfig } from '../runtime-config.shared.js'
import {
  type CommanderSession,
  type CommanderSessionStore,
} from '../store.js'
import { writeCommanderUiProfile } from '../commander-profile.js'
import { ensureCommanderVisualProfile } from '../commander-visual-profile.js'
import type { Conversation, ConversationStore } from '../conversation-store.js'
import {
  mergeIdentityOperatingStyleIntoCommanderWorkflow,
  scaffoldCommanderWorkflow,
} from '../templates/workflow.js'
import type {
  CommanderPackageDefinition,
  CommanderPackageInstallState,
} from './types.js'

export interface CommanderPackageInstallOptions {
  sessionStore: Pick<CommanderSessionStore, 'list' | 'create' | 'delete'>
  conversationStore?: Pick<ConversationStore, 'listByCommander' | 'getActiveChatForCommander' | 'ensureDefaultConversation' | 'delete'>
  commanderDataDir: string
  commanderBasePath?: string
  now: () => Date
}

export interface CommanderPackageInstallStateOptions {
  sessionStore: Pick<CommanderSessionStore, 'list'>
  commanderDataDir: string
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function buildUniqueHost(baseHost: string, existingHosts: ReadonlySet<string>): string {
  if (!existingHosts.has(baseHost)) {
    return baseHost
  }

  let suffix = 2
  let candidate = `${baseHost}-${suffix}`
  while (existingHosts.has(candidate)) {
    suffix += 1
    candidate = `${baseHost}-${suffix}`
  }
  return candidate
}

function buildUniqueDisplayName(
  displayName: string,
  existingDisplayNames: ReadonlySet<string>,
): string {
  const normalized = normalizeName(displayName)
  if (!existingDisplayNames.has(normalized)) {
    return displayName
  }

  let suffix = 2
  let candidate = `${displayName} ${suffix}`
  while (existingDisplayNames.has(normalizeName(candidate))) {
    suffix += 1
    candidate = `${displayName} ${suffix}`
  }
  return candidate
}

export async function getCommanderPackageInstallState(
  definition: CommanderPackageDefinition,
  options: CommanderPackageInstallStateOptions,
): Promise<CommanderPackageInstallState> {
  const [sessions, displayNames] = await Promise.all([
    options.sessionStore.list(),
    readCommanderDisplayNames(options.commanderDataDir),
  ])
  const installed = sessions.find((session) => (
    session.archived !== true && session.templateId === definition.id
  ))

  return {
    installed: Boolean(installed),
    commanderId: installed?.id ?? null,
    displayName: installed
      ? (displayNames[installed.id]?.trim() || installed.host)
      : null,
  }
}

async function writeInstalledPackageSnapshot(
  commanderId: string,
  definition: CommanderPackageDefinition,
  commanderBasePath: string,
  now: () => Date,
): Promise<void> {
  const { commanderRoot } = resolveCommanderPaths(commanderId, commanderBasePath)
  const packageRoot = path.join(commanderRoot, '.package')
  await mkdir(path.join(packageRoot, 'examples'), { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    schemaVersion: definition.schemaVersion,
    id: definition.id,
    version: definition.version,
    displayName: definition.displayName,
    role: definition.role,
    installedAt: now().toISOString(),
  }, null, 2), 'utf8')
  await writeFile(path.join(packageRoot, 'skills.manifest.json'), JSON.stringify({
    required: definition.skills.filter((skill) => skill.required),
    optional: definition.skills.filter((skill) => !skill.required),
  }, null, 2), 'utf8')
  await writeFile(path.join(packageRoot, 'onboarding.md'), definition.onboarding, 'utf8')
  await writeFile(path.join(packageRoot, 'memory-seed.md'), definition.memorySeed, 'utf8')
  await Promise.all(definition.examples.map((example) =>
    writeFile(path.join(packageRoot, 'examples', `${example.id}.md`), example.body, 'utf8'),
  ))
}

export async function installCommanderPackage(
  definition: CommanderPackageDefinition,
  options: CommanderPackageInstallOptions,
): Promise<{ created: boolean; commander: CommanderSession; displayName: string }> {
  const sessions = await options.sessionStore.list()
  const installed = sessions.find((session) => (
    session.archived !== true && session.templateId === definition.id
  ))
  const displayNames = await readCommanderDisplayNames(options.commanderDataDir)
  if (installed) {
    return {
      created: false,
      commander: installed,
      displayName: displayNames[installed.id]?.trim() || installed.host,
    }
  }

  const existingHosts = new Set(sessions.map((session) => session.host))
  const existingDisplayNames = new Set(
    sessions.map((session) => normalizeName(displayNames[session.id]?.trim() || session.host)),
  )
  const host = buildUniqueHost(definition.host, existingHosts)
  const displayName = buildUniqueDisplayName(definition.displayName, existingDisplayNames)
  const runtimeConfig = createDefaultCommanderRuntimeConfig()
  const commanderBasePath = options.commanderBasePath ?? options.commanderDataDir
  const session: CommanderSession = {
    id: randomUUID(),
    host,
    state: 'idle',
    created: options.now().toISOString(),
    agentType: definition.agentType,
    effort: definition.effort,
    heartbeat: createDefaultHeartbeatConfig(),
    maxTurns: runtimeConfig.defaults.maxTurns,
    contextMode: definition.contextMode,
    taskSource: null,
    templateId: definition.id,
  }

  const created = await options.sessionStore.create(session)
  let conversationId: string | null = null

  const rollback = async (): Promise<void> => {
    if (conversationId && options.conversationStore) {
      await options.conversationStore.delete(conversationId).catch(() => {})
    }
    await options.sessionStore.delete(created.id).catch(() => {})
    await rm(resolveCommanderPaths(created.id, commanderBasePath).commanderRoot, {
      recursive: true,
      force: true,
    }).catch(() => {})
  }

  try {
    await scaffoldCommanderWorkflow(created.id, {}, commanderBasePath)
    await mergeIdentityOperatingStyleIntoCommanderWorkflow(created.id, definition.commanderMd, {
      basePath: commanderBasePath,
    })
    if (typeof options.conversationStore?.ensureDefaultConversation === 'function') {
      const conversation = await options.conversationStore.ensureDefaultConversation({
        commanderId: created.id,
        surface: 'ui',
        createdAt: created.created,
        currentTask: null,
      }) as Conversation
      conversationId = conversation.id
    }
    await setCommanderDisplayName(options.commanderDataDir, created.id, displayName)
    await writeCommanderUiProfile(created.id, commanderBasePath, ensureCommanderVisualProfile(created.id, {
      ...definition.uiProfile,
    }))
    await writeInstalledPackageSnapshot(created.id, definition, commanderBasePath, options.now)
  } catch (error) {
    await rollback()
    throw error
  }

  return { created: true, commander: created, displayName }
}
