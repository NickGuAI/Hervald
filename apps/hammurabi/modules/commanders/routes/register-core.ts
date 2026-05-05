import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_CLAUDE_EFFORT_LEVEL } from '../../claude-effort.js'
import {
  mimeTypeForAvatarFile,
  readCommanderUiProfile,
  resolveCommanderAvatarPath,
  writeCommanderUiProfile,
  type CommanderUiProfile,
} from '../commander-profile.js'
import {
  createDefaultHeartbeatConfig,
  mergeHeartbeatConfig,
  parseHeartbeatPatch,
} from '../heartbeat.js'
import { CommanderManager } from '../manager.js'
import {
  deleteCommanderDisplayName,
  withNamesLock,
} from '../names-lock.js'
import { resolveCommanderNamesPath, resolveCommanderPaths } from '../paths.js'
import { MAX_PERSONA_LENGTH } from '../persona.js'
import {
  parseHost,
  parseMessage,
  parseMessageMode,
  parseOptionalCommanderAgentType,
  parseOptionalCommanderContextMode,
  parseOptionalCommanderEffort,
  parseOptionalCommanderMaxTurns,
  parseOptionalCurrentTask,
  parseOptionalHeartbeatContextConfig,
  parseOptionalPersona,
  parseSessionId,
  parseTaskSource,
} from '../route-parsers.js'
import {
  DEFAULT_COMMANDER_CONTEXT_MODE,
  type CommanderContextMode,
  type CommanderSession,
  type CommanderTaskSource,
  type HeartbeatContextConfig,
} from '../store.js'
import {
  COMMANDER_WIZARD_START_MESSAGE,
  buildCommanderWizardSystemPrompt,
} from '../templates/wizard-prompt.js'
import {
  readCommanderWorkflowMarkdown,
  scaffoldCommanderWorkflow,
} from '../templates/workflow.js'
import {
  STARTUP_PROMPT,
  buildConversationSessionName,
  consumeInternalUserMessage,
  createContextPressureBridge,
  isInputTokenContextPressureEvent,
  isContextPressureSubtypeEvent,
  listSubAgentEntries,
  queueInternalUserMessage,
  resolveCommanderAgentType,
  resolveCommanderTerminalState,
  resolveEffectiveHeartbeat,
  toCommanderSessionName,
  toCommanderSessionResponse,
} from './context.js'
import {
  applyRemoteMemorySnapshot,
  buildCommanderSessionSeedFromResolvedWorkflow,
  exportRemoteMemorySnapshot,
} from '../memory/module.js'
import type { CommanderRoutesContext, CommanderRuntime, StreamEvent } from './types.js'
import { resolveCommanderWorkflow } from '../workflow-resolution.js'
import { COMMANDER_WORKFLOW_FILE } from '../workflow.js'
import { getLiveConversationSession, stopConversationSession } from './conversation-runtime.js'
import type { OrgCommanderRoleKey } from '../../org/types.js'
import type { AgentType } from '../../agents/types.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'

const WIZARD_SESSION_PREFIX = 'commander-wizard-'
const WIZARD_SESSION_NAME_PATTERN = /^commander-wizard-[a-zA-Z0-9_-]+$/
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ARCHIVED_COMMANDER_RUNTIME_ERROR = 'Commander is archived. Restore it first via POST /:id/restore.'

class DuplicateCommanderDisplayNameError extends Error {
  constructor(displayName: string) {
    super(`Commander displayName "${displayName}" already exists`)
    this.name = 'DuplicateCommanderDisplayNameError'
  }
}

interface CommanderTemplatePackage {
  schemaVersion: 1
  exportedAt: string
  sourceCommanderId?: string
  commander: {
    id?: string
    host?: string
    displayName: string
    roleKey?: OrgCommanderRoleKey
    persona?: string
    agentType?: AgentType
    effort?: ClaudeEffortLevel
    maxTurns?: number
    contextMode?: CommanderContextMode
    contextConfig?: HeartbeatContextConfig
    cwd?: string
    taskSource?: CommanderTaskSource | null
  }
  commanderMd: string | null
  memorySnapshot: {
    memoryMd: string
    syncRevision: number
  }
  skillBindings: Array<{
    skillId: string
    version?: string
  }>
}

function parseOptionalCommanderRoleKey(
  raw: unknown,
): OrgCommanderRoleKey | undefined | null {
  if (
    raw === undefined
    || raw === null
    || (typeof raw === 'string' && raw.trim().length === 0)
  ) {
    return undefined
  }

  return raw === 'engineering'
    || raw === 'research'
    || raw === 'ops'
    || raw === 'content'
    || raw === 'validator'
    || raw === 'ea'
    ? raw
    : null
}

function parseConversationId(raw: unknown): string | null {
  return typeof raw === 'string' && CONVERSATION_ID_PATTERN.test(raw.trim())
    ? raw.trim()
    : null
}

function normalizeUserMessageText(content: unknown): string | null {
  if (typeof content === 'string') {
    const normalized = content.trim()
    return normalized.length > 0 ? normalized : null
  }

  if (!Array.isArray(content)) {
    return null
  }

  const textBlocks = content
    .flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return []
      }

      const record = entry as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text.trim()]
        : []
    })
    .filter((entry) => entry.length > 0)

  if (textBlocks.length === 0) {
    return null
  }

  return textBlocks.join('\n\n')
}

function extractRawUserMessage(event: StreamEvent): string | null {
  if (event.type !== 'user') {
    return null
  }

  const message = (event as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) {
    return null
  }

  if ((message as { role?: unknown }).role !== 'user') {
    return null
  }

  return normalizeUserMessageText((message as { content?: unknown }).content)
}

function buildReplicatedHost(
  sourceHost: string,
  existingHosts: ReadonlySet<string>,
): string {
  const base = `${sourceHost}-copy`
  if (!existingHosts.has(base)) {
    return base
  }

  let suffix = 2
  let candidate = `${base}-${suffix}`
  while (existingHosts.has(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }

  return candidate
}

function buildUniqueHost(baseHost: string, existingHosts: ReadonlySet<string>): string {
  if (!existingHosts.has(baseHost)) {
    return baseHost
  }

  let suffix = 2
  let candidate = `${baseHost}-copy`
  while (existingHosts.has(candidate)) {
    candidate = `${baseHost}-copy-${suffix}`
    suffix += 1
  }

  return candidate
}

function buildHostFromDisplayName(displayName: string): string {
  const normalized = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `commander-${randomUUID().slice(0, 8)}`
}

function buildUniqueDisplayName(
  displayName: string,
  existingDisplayNames: ReadonlySet<string>,
): string {
  const normalized = normalizeCommanderDisplayName(displayName)
  if (!existingDisplayNames.has(normalized)) {
    return displayName
  }

  let suffix = 2
  let candidate = `${displayName} Copy`
  while (existingDisplayNames.has(normalizeCommanderDisplayName(candidate))) {
    candidate = `${displayName} Copy ${suffix}`
    suffix += 1
  }

  return candidate
}

function normalizeCommanderDisplayName(displayName: string): string {
  return displayName.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rejectArchivedCommanderRuntime(
  session: CommanderSession,
  res: import('express').Response,
): boolean {
  if (session.archived !== true) {
    return false
  }

  res.status(409).json({ error: ARCHIVED_COMMANDER_RUNTIME_ERROR })
  return true
}

function parseNonNegativeInteger(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
    ? raw
    : null
}

async function readCommanderDisplayNames(dataDir: string): Promise<Record<string, string>> {
  try {
    const namesPath = resolveCommanderNamesPath(dataDir)
    return JSON.parse(await readFile(namesPath, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

async function upsertCommanderDisplayName(
  dataDir: string,
  commanderId: string,
  displayName: string,
): Promise<void> {
  const normalizedDisplayName = normalizeCommanderDisplayName(displayName)
  await withNamesLock(dataDir, (names) => {
    const duplicateEntry = Object.entries(names).find(([existingCommanderId, existingDisplayName]) => (
      existingCommanderId !== commanderId
      && normalizeCommanderDisplayName(existingDisplayName) === normalizedDisplayName
    ))
    if (duplicateEntry) {
      throw new DuplicateCommanderDisplayNameError(displayName)
    }
    names[commanderId] = displayName
  })
}

export function registerCoreRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  /**
   * Manually fire the heartbeat loop for one conversation. When `conversationId`
   * is omitted from the request body, the most recently active conversation for
   * the commander is targeted.
   */
  const triggerHeartbeatRoute = async (
    req: import('express').Request,
    res: import('express').Response,
  ) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }
    if (rejectArchivedCommanderRuntime(session, res)) {
      return
    }

    if (session.state !== 'running') {
      res.status(409).json({
        error: `Commander "${commanderId}" is not running (state: ${session.state})`,
      })
      return
    }

    const parsedConversationId = req.body?.conversationId === undefined
      ? undefined
      : parseConversationId(req.body?.conversationId)
    if (req.body?.conversationId !== undefined && !parsedConversationId) {
      res.status(400).json({ error: 'conversationId must be a UUID when provided' })
      return
    }
    const requestedConversationId = parsedConversationId ?? undefined

    const conversation = await context.resolveHeartbeatConversation(
      commanderId,
      requestedConversationId,
    )
    if (!conversation) {
      res.status(404).json({
        error: requestedConversationId
          ? `Conversation "${requestedConversationId}" not found for commander "${commanderId}"`
          : `Commander "${commanderId}" has no conversation available for heartbeat`,
      })
      return
    }

    const sessionName = buildConversationSessionName(conversation)
    if (!context.heartbeatManager.isRunning(conversation.id)) {
      const liveSession = context.sessionsInterface?.getSession(sessionName)
      if (liveSession) {
        context.heartbeatManager.start(
          conversation.id,
          commanderId,
          resolveEffectiveHeartbeat(session),
        )
        // fall through to fire manual heartbeat below
      } else {
        res.status(409).json({
          error: `Conversation "${conversation.id}" has no live session to restart heartbeat against`,
        })
        return
      }
    }

    if (context.heartbeatManager.isInFlight(conversation.id)) {
      res.status(409).json({
        error: `Conversation "${conversation.id}" heartbeat is already in flight`,
      })
      return
    }

    const timestamp = context.now().toISOString()
    const triggered = context.heartbeatManager.fireManual(conversation.id, timestamp)
    if (!triggered) {
      res.status(409).json({
        error: `Conversation "${conversation.id}" heartbeat could not be triggered`,
      })
      return
    }

    res.json({
      runId: timestamp,
      timestamp,
      sessionName,
      conversationId: conversation.id,
      triggered: true,
    })
  }

  const resolveWizardApiBaseUrl = (req: import('express').Request): string => {
    const localPort = req.socket.localPort
    if (typeof localPort === 'number' && Number.isFinite(localPort) && localPort > 0) {
      return `http://127.0.0.1:${localPort}`
    }

    const host = req.get('host')?.split(',')[0]?.trim()
    if (host) {
      return `http://${host.replace(/\/+$/, '')}`
    }
    return 'http://127.0.0.1:3000'
  }

  const resolveWizardAuthHeaders = (
    req: import('express').Request,
  ): {
    authorizationHeader?: string
    apiKeyHeaderName?: 'x-hammurabi-api-key' | 'x-api-key'
    apiKeyHeaderValue?: string
  } => {
    const authorizationHeader = parseMessage(req.get('authorization')) ?? undefined
    const hammurabiApiKey = parseMessage(req.get('x-hammurabi-api-key'))
    if (hammurabiApiKey) {
      return {
        authorizationHeader,
        apiKeyHeaderName: 'x-hammurabi-api-key',
        apiKeyHeaderValue: hammurabiApiKey,
      }
    }

    const apiKey = parseMessage(req.get('x-api-key'))
    if (apiKey) {
      return {
        authorizationHeader,
        apiKeyHeaderName: 'x-api-key',
        apiKeyHeaderValue: apiKey,
      }
    }

    return { authorizationHeader }
  }

  const assertUniqueCommanderDisplayName = async (
    displayName: string,
    excludeCommanderId?: string,
  ): Promise<void> => {
    const normalizedDisplayName = normalizeCommanderDisplayName(displayName)
    const sessions = await context.sessionStore.list()
    const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
    const duplicateSession = sessions.find((session) => {
      if (session.id === excludeCommanderId) {
        return false
      }

      const resolvedDisplayName = displayNames[session.id]?.trim() || session.host
      return normalizeCommanderDisplayName(resolvedDisplayName) === normalizedDisplayName
    })

    if (duplicateSession) {
      throw new DuplicateCommanderDisplayNameError(displayName)
    }
  }

  const persistCreatedCommander = async (
    session: CommanderSession,
    displayName: string,
    heartbeat = session.heartbeat,
  ) => {
    const created = await context.sessionStore.create({
      ...session,
      heartbeat,
    })
    let defaultConversationId: string | null = null

    const rollbackCreatedCommander = async (): Promise<void> => {
      if (defaultConversationId) {
        await context.conversationStore.delete(defaultConversationId).catch(() => {})
      }
      await context.sessionStore.delete(created.id).catch(() => {})
      const { commanderRoot } = resolveCommanderPaths(created.id, context.commanderBasePath)
      await rm(commanderRoot, { recursive: true, force: true }).catch(() => {})
    }

    try {
      const defaultConversation = await context.ensureDefaultConversation(created, {
        surface: 'ui',
        currentTask: null,
      })
      defaultConversationId = defaultConversation.id

      await scaffoldCommanderWorkflow(
        created.id,
        {
          cwd: created.cwd,
        },
        context.commanderBasePath,
      )

      await upsertCommanderDisplayName(context.commanderDataDir, created.id, displayName)
    } catch (error) {
      await rollbackCreatedCommander()
      throw error
    }

    const stats = await context.getCommanderSessionStats(created.id)
    const base = await toCommanderSessionResponse(created, context.conversationStore, undefined, stats)
    return await context.attachCommanderPublicUi(created.id, base)
  }

  const parseWizardSessionName = (raw: unknown): string | null => {
    if (typeof raw !== 'string') {
      return null
    }
    const trimmed = raw.trim()
    return WIZARD_SESSION_NAME_PATTERN.test(trimmed) ? trimmed : null
  }

  router.get('/', context.requireReadAccess, async (_req, res) => {
    const sessions = await context.sessionStore.list()
    const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
    const response = await Promise.all(
      sessions.map(async (session) => {
        const stats = await context.getCommanderSessionStats(session.id)
        const base = await toCommanderSessionResponse(session, context.conversationStore, undefined, stats)
        const withUi = await context.attachCommanderPublicUi(session.id, base)
        const displayName = displayNames[session.id]
        return displayName && displayName !== session.host
          ? { ...withUi, displayName }
          : withUi
      }),
    )
    res.json(response)
  })

  router.get('/runtime-config', context.requireReadAccess, async (_req, res) => {
    res.json(context.runtimeConfig)
  })

  // No auth on avatar — <img src> cannot send bearer headers, and the URL
  // is already keyed on a non-guessable UUID.
  router.get('/:id/avatar', async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const profile = await readCommanderUiProfile(commanderId, context.commanderBasePath)
    const avatarPath = await resolveCommanderAvatarPath(commanderId, context.commanderBasePath, profile)
    if (!avatarPath) {
      res.status(404).json({ error: 'Avatar not configured' })
      return
    }

    try {
      const buf = await readFile(avatarPath)
      res.setHeader('Content-Type', mimeTypeForAvatarFile(avatarPath))
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.send(buf)
    } catch {
      res.status(404).json({ error: 'Avatar file missing' })
    }
  })

  router.post('/:id/avatar', context.requireWriteAccess, context.avatarUpload.single('avatar'), async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'No avatar file uploaded' })
      return
    }

    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    }
    const ext = extMap[file.mimetype] ?? '.bin'
    const avatarFileName = `avatar${ext}`

    const { commanderRoot } = resolveCommanderPaths(commanderId, context.commanderBasePath)
    await mkdir(commanderRoot, { recursive: true })
    await writeFile(path.join(commanderRoot, avatarFileName), file.buffer)

    const existing = await readCommanderUiProfile(commanderId, context.commanderBasePath)
    await writeCommanderUiProfile(commanderId, context.commanderBasePath, {
      ...(existing ?? {}),
      avatar: avatarFileName,
    } satisfies CommanderUiProfile)

    res.json({ avatarUrl: `/api/commanders/${encodeURIComponent(commanderId)}/avatar` })
  })

  router.patch('/:id/profile', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const parseField = (value: unknown): string | undefined =>
      typeof value === 'string' ? value.trim() || undefined : undefined

    const persona = parseField(req.body?.persona)
    const borderColor = parseField(req.body?.borderColor)
    const accentColor = parseField(req.body?.accentColor)
    const speakingTone = parseField(req.body?.speakingTone)
    const parsedEffort = parseOptionalCommanderEffort(req.body?.effort)

    if (persona !== undefined && persona.length > MAX_PERSONA_LENGTH) {
      res.status(400).json({ error: `persona must be a string up to ${MAX_PERSONA_LENGTH} characters` })
      return
    }
    if (parsedEffort === null) {
      res.status(400).json({ error: 'effort must be one of: low, medium, high, max' })
      return
    }

    const existing = await readCommanderUiProfile(commanderId, context.commanderBasePath)
    const merged: CommanderUiProfile = {
      ...(existing ?? {}),
      ...(req.body?.borderColor !== undefined ? { borderColor } : {}),
      ...(req.body?.accentColor !== undefined ? { accentColor } : {}),
      ...(req.body?.speakingTone !== undefined ? { speakingTone } : {}),
    }
    await writeCommanderUiProfile(commanderId, context.commanderBasePath, merged)

    if (req.body?.persona !== undefined || req.body?.effort !== undefined) {
      await context.sessionStore.update(commanderId, (current) => ({
        ...current,
        ...(req.body?.persona !== undefined ? { persona } : {}),
        ...(req.body?.effort !== undefined ? { effort: parsedEffort ?? DEFAULT_CLAUDE_EFFORT_LEVEL } : {}),
      }))
    }

    res.json({ ok: true })
  })

  router.get('/:id', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const runtime = context.runtimes.get(commanderId)
    const commanderMd = await readCommanderWorkflowMarkdown(commanderId, context.commanderBasePath)
    const { commanderRoot, memoryRoot } = resolveCommanderPaths(commanderId, context.commanderBasePath)
    const stats = await context.getCommanderSessionStats(commanderId)
    const base = await toCommanderSessionResponse(session, context.conversationStore, runtime, stats)
    const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
    res.json({
      ...(await context.attachCommanderPublicUi(commanderId, base)),
      displayName: displayNames[commanderId]?.trim() || session.host,
      subAgents: listSubAgentEntries(runtime),
      commanderMd,
      workflowMd: commanderMd,
      commanderRoot,
      memoryRoot,
      runtimeConfig: context.runtimeConfig,
    })
  })

  router.get('/:id/heartbeat-log', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const entries = (await context.heartbeatLog.read(commanderId, 50))
      .slice()
      .sort((left, right) => right.firedAt.localeCompare(left.firedAt))
    res.json({ entries })
  })

  router.post('/wizard/start', context.requireWriteAccess, async (req, res) => {
    if (!context.sessionsInterface) {
      res.status(503).json({ error: 'sessionsInterface not configured — agents router bridge missing' })
      return
    }

    const parsedAgentType = parseOptionalCommanderAgentType(req.body?.agentType)
    if (parsedAgentType === null) {
      res.status(400).json({ error: 'agentType must be a registered provider id' })
      return
    }

    const parsedEffort = parseOptionalCommanderEffort(req.body?.effort)
    if (parsedEffort === null) {
      res.status(400).json({ error: 'effort must be one of: low, medium, high, max' })
      return
    }

    const selectedAgentType = parsedAgentType ?? 'claude'
    const selectedEffort = selectedAgentType === 'claude'
      ? (parsedEffort ?? 'low')
      : undefined
    const sessionName = `${WIZARD_SESSION_PREFIX}${randomUUID().split('-').join('')}`
    const cwd = parseMessage(req.body?.cwd) ?? undefined
    const wizardAuthHeaders = resolveWizardAuthHeaders(req)
    const systemPrompt = buildCommanderWizardSystemPrompt({
      apiBaseUrl: resolveWizardApiBaseUrl(req),
      ...wizardAuthHeaders,
    })

    try {
      await context.sessionsInterface.createCommanderSession({
        name: sessionName,
        systemPrompt,
        agentType: selectedAgentType,
        effort: selectedEffort,
        cwd,
        maxTurns: context.runtimeConfig.defaults.maxTurns,
      })
      const sent = await context.sessionsInterface.sendToSession(
        sessionName,
        COMMANDER_WIZARD_START_MESSAGE,
      )
      if (!sent) {
        context.sessionsInterface.deleteSession(sessionName)
        res.status(503).json({
          error: 'Wizard startup message could not be delivered. Please retry.',
        })
        return
      }

      res.status(201).json({
        sessionName,
        agentType: selectedAgentType,
        created: true,
      })
    } catch (error) {
      context.sessionsInterface.deleteSession(sessionName)
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start commander wizard',
      })
    }
  })

  router.post('/', context.requireWriteAccess, async (req, res) => {
    const host = parseHost(req.body?.host)
    if (!host) {
      res.status(400).json({ error: 'Invalid host' })
      return
    }

    const taskSource = req.body?.taskSource != null
      ? parseTaskSource(req.body.taskSource)
      : null
    if (req.body?.taskSource != null && !taskSource) {
      res.status(400).json({ error: 'Invalid taskSource' })
      return
    }

    const parsedContextConfig = parseOptionalHeartbeatContextConfig(req.body?.contextConfig)
    if (!parsedContextConfig.valid) {
      res.status(400).json({ error: 'Invalid contextConfig' })
      return
    }

    const parsedMaxTurns = parseOptionalCommanderMaxTurns(
      req.body?.maxTurns,
      { max: context.runtimeConfig.limits.maxTurns },
    )
    if (!parsedMaxTurns.valid) {
      res.status(400).json({
        error: `maxTurns must be an integer between 1 and ${context.runtimeConfig.limits.maxTurns}`,
      })
      return
    }

    const parsedContextMode = parseOptionalCommanderContextMode(req.body?.contextMode)
    if (!parsedContextMode.valid) {
      res.status(400).json({ error: 'contextMode must be either "thin" or "fat"' })
      return
    }

    const existing = await context.sessionStore.list()
    if (existing.some((session) => session.host === host)) {
      res.status(409).json({ error: `Commander for host "${host}" already exists` })
      return
    }

    const displayName = parseMessage(req.body?.displayName) ?? host
    try {
      await assertUniqueCommanderDisplayName(displayName)
    } catch (error) {
      if (error instanceof DuplicateCommanderDisplayNameError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }
    const cwd = parseMessage(req.body?.cwd) ?? undefined
    const avatarSeed = parseMessage(req.body?.avatarSeed) ?? undefined
    const roleKey = parseOptionalCommanderRoleKey(req.body?.roleKey)
    if (roleKey === null) {
      res.status(400).json({
        error: 'roleKey must be one of: engineering, research, ops, content, validator, ea',
      })
      return
    }
    const templateId = req.body?.templateId === null
      ? null
      : (parseMessage(req.body?.templateId) ?? undefined)
    const replicatedFromCommanderId = req.body?.replicatedFromCommanderId === null
      ? null
      : (parseSessionId(req.body?.replicatedFromCommanderId) ?? undefined)
    if (
      req.body?.replicatedFromCommanderId !== undefined
      && req.body?.replicatedFromCommanderId !== null
      && !replicatedFromCommanderId
    ) {
      res.status(400).json({ error: 'replicatedFromCommanderId must be a valid commander id when provided' })
      return
    }
    const parsedPersona = parseOptionalPersona(req.body?.persona)
    if (!parsedPersona.valid) {
      res.status(400).json({ error: `persona must be a string up to ${MAX_PERSONA_LENGTH} characters` })
      return
    }
    const persona = parsedPersona.value
    const defaultHeartbeat = createDefaultHeartbeatConfig()
    let heartbeat = defaultHeartbeat

    if (req.body?.heartbeat !== undefined) {
      const parsedHeartbeat = parseHeartbeatPatch(req.body.heartbeat)
      if (!parsedHeartbeat.ok) {
        res.status(400).json({ error: parsedHeartbeat.error })
        return
      }
      heartbeat = mergeHeartbeatConfig(defaultHeartbeat, parsedHeartbeat.value)
    }

    const parsedAgentTypeCreate = parseOptionalCommanderAgentType(req.body?.agentType)
    if (parsedAgentTypeCreate === null) {
      res.status(400).json({ error: 'agentType must be a registered provider id' })
      return
    }
    const parsedEffortCreate = parseOptionalCommanderEffort(req.body?.effort)
    if (parsedEffortCreate === null) {
      res.status(400).json({ error: 'effort must be one of: low, medium, high, max' })
      return
    }

    const session: CommanderSession = {
      id: randomUUID(),
      host,
      avatarSeed,
      persona,
      state: 'idle',
      created: context.now().toISOString(),
      agentType: parsedAgentTypeCreate ?? 'claude',
      effort: parsedEffortCreate ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
      maxTurns: parsedMaxTurns.value ?? context.runtimeConfig.defaults.maxTurns,
      contextMode: parsedContextMode.value ?? DEFAULT_COMMANDER_CONTEXT_MODE,
      contextConfig: parsedContextConfig.value,
      heartbeat,
      taskSource,
      cwd,
      ...(roleKey ? { roleKey } : {}),
      ...(templateId !== undefined ? { templateId } : {}),
      ...(replicatedFromCommanderId !== undefined ? { replicatedFromCommanderId } : {}),
    }

    try {
      const created = await persistCreatedCommander(session, displayName, heartbeat)
      res.status(201).json(
        displayName !== created.host
          ? { ...created, displayName }
          : created,
      )
    } catch (error) {
      if (error instanceof DuplicateCommanderDisplayNameError) {
        res.status(409).json({ error: error.message })
        return
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create commander session',
      })
    }
  })

  router.get('/:id/export', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    try {
      const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
      const displayName = displayNames[commanderId]?.trim() || session.host
      const [commanderMd, memorySnapshot] = await Promise.all([
        readCommanderWorkflowMarkdown(commanderId, context.commanderBasePath),
        exportRemoteMemorySnapshot(commanderId, context.commanderBasePath),
      ])

      const payload: CommanderTemplatePackage = {
        schemaVersion: 1,
        exportedAt: context.now().toISOString(),
        sourceCommanderId: session.id,
        commander: {
          id: session.id,
          host: session.host,
          displayName,
          ...(session.roleKey ? { roleKey: session.roleKey } : {}),
          ...(session.persona ? { persona: session.persona } : {}),
          ...(session.agentType ? { agentType: session.agentType } : {}),
          ...(session.effort ? { effort: session.effort } : {}),
          maxTurns: session.maxTurns,
          contextMode: session.contextMode,
          ...(session.contextConfig ? { contextConfig: { ...session.contextConfig } } : {}),
          ...(session.cwd ? { cwd: session.cwd } : {}),
          taskSource: session.taskSource ? { ...session.taskSource } : null,
        },
        commanderMd,
        memorySnapshot,
        skillBindings: [],
      }

      res.json(payload)
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to export commander template',
      })
    }
  })

  router.post('/import', context.requireWriteAccess, async (req, res) => {
    const payload = req.body
    if (!isRecord(payload) || payload.schemaVersion !== 1) {
      res.status(400).json({ error: 'schemaVersion must be 1' })
      return
    }

    const commander = isRecord(payload.commander) ? payload.commander : null
    if (!commander) {
      res.status(400).json({ error: 'commander template is required' })
      return
    }

    const sourceDisplayName = parseMessage(commander.displayName)
    if (!sourceDisplayName) {
      res.status(400).json({ error: 'commander.displayName is required' })
      return
    }

    const roleKey = parseOptionalCommanderRoleKey(commander.roleKey)
    if (roleKey === null) {
      res.status(400).json({
        error: 'roleKey must be one of: engineering, research, ops, content, validator, ea',
      })
      return
    }

    const parsedPersona = parseOptionalPersona(commander.persona)
    if (!parsedPersona.valid) {
      res.status(400).json({ error: `persona must be a string up to ${MAX_PERSONA_LENGTH} characters` })
      return
    }

    const parsedAgentType = parseOptionalCommanderAgentType(commander.agentType)
    if (parsedAgentType === null) {
      res.status(400).json({ error: 'agentType must be a registered provider id' })
      return
    }

    const parsedEffort = parseOptionalCommanderEffort(commander.effort)
    if (parsedEffort === null) {
      res.status(400).json({ error: 'effort must be one of: low, medium, high, max' })
      return
    }

    const parsedMaxTurns = parseOptionalCommanderMaxTurns(
      commander.maxTurns,
      { max: context.runtimeConfig.limits.maxTurns },
    )
    if (!parsedMaxTurns.valid) {
      res.status(400).json({
        error: `maxTurns must be an integer between 1 and ${context.runtimeConfig.limits.maxTurns}`,
      })
      return
    }

    const parsedContextMode = parseOptionalCommanderContextMode(commander.contextMode)
    if (!parsedContextMode.valid) {
      res.status(400).json({ error: 'contextMode must be either "thin" or "fat"' })
      return
    }

    const parsedContextConfig = parseOptionalHeartbeatContextConfig(commander.contextConfig)
    if (!parsedContextConfig.valid) {
      res.status(400).json({ error: 'Invalid contextConfig' })
      return
    }

    const taskSource = commander.taskSource === null || commander.taskSource === undefined
      ? null
      : parseTaskSource(commander.taskSource)
    if (commander.taskSource !== null && commander.taskSource !== undefined && !taskSource) {
      res.status(400).json({ error: 'Invalid taskSource' })
      return
    }

    const existing = await context.sessionStore.list()
    const displayNames = await readCommanderDisplayNames(context.commanderDataDir)
    const existingDisplayNames = new Set(
      existing.map((session) =>
        normalizeCommanderDisplayName(displayNames[session.id]?.trim() || session.host)),
    )
    const displayName = buildUniqueDisplayName(sourceDisplayName, existingDisplayNames)
    const requestedHost = parseHost(commander.host)
    const baseHost = requestedHost ?? buildHostFromDisplayName(sourceDisplayName)
    const host = buildUniqueHost(baseHost, new Set(existing.map((session) => session.host)))
    const sourceCommanderId = parseMessage(payload.sourceCommanderId)
      ?? parseMessage(commander.id)
      ?? undefined
    const commanderMd = typeof payload.commanderMd === 'string'
      ? payload.commanderMd
      : null
    const memorySnapshotProvided = payload.memorySnapshot !== undefined
    const memorySnapshot = memorySnapshotProvided && isRecord(payload.memorySnapshot)
      ? payload.memorySnapshot
      : null
    if (memorySnapshotProvided && typeof memorySnapshot?.memoryMd !== 'string') {
      res.status(400).json({ error: 'memorySnapshot.memoryMd must be a string when memorySnapshot is present' })
      return
    }
    if (memorySnapshot && parseNonNegativeInteger(memorySnapshot.syncRevision) === null) {
      res.status(400).json({ error: 'memorySnapshot.syncRevision must be a non-negative integer' })
      return
    }
    const memoryMd = memorySnapshot
      ? (memorySnapshot.memoryMd as string)
      : undefined

    const session: CommanderSession = {
      id: randomUUID(),
      host,
      persona: parsedPersona.value,
      state: 'idle',
      created: context.now().toISOString(),
      agentType: parsedAgentType ?? 'claude',
      effort: parsedEffort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
      maxTurns: parsedMaxTurns.value ?? context.runtimeConfig.defaults.maxTurns,
      contextMode: parsedContextMode.value ?? DEFAULT_COMMANDER_CONTEXT_MODE,
      contextConfig: parsedContextConfig.value,
      heartbeat: createDefaultHeartbeatConfig(),
      taskSource,
      ...(roleKey ? { roleKey } : {}),
      ...(sourceCommanderId ? { templateId: sourceCommanderId } : {}),
    }

    try {
      const created = await persistCreatedCommander(session, displayName)
      if (commanderMd !== null) {
        const { commanderRoot } = resolveCommanderPaths(session.id, context.commanderBasePath)
        await mkdir(commanderRoot, { recursive: true })
        await writeFile(
          path.join(commanderRoot, COMMANDER_WORKFLOW_FILE),
          `${commanderMd.trimEnd()}\n`,
          'utf8',
        )
      }

      if (memoryMd !== undefined) {
        const applied = await applyRemoteMemorySnapshot(
          session.id,
          0,
          memoryMd,
          context.commanderBasePath,
        )
        if (applied.status !== 'applied') {
          throw new Error('Memory snapshot could not be applied to imported commander')
        }
      }

      res.status(201).json({
        ...created,
        displayName,
        url: `/command-room?commander=${encodeURIComponent(session.id)}`,
      })
    } catch (error) {
      await context.sessionStore.delete(session.id).catch(() => {})
      await deleteCommanderDisplayName(context.commanderDataDir, session.id).catch(() => {})
      const { commanderRoot } = resolveCommanderPaths(session.id, context.commanderBasePath)
      await rm(commanderRoot, { recursive: true, force: true }).catch(() => {})
      if (error instanceof DuplicateCommanderDisplayNameError) {
        res.status(409).json({ error: error.message })
        return
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to import commander template',
      })
    }
  })

  router.post('/:id/replicate', context.requireWriteAccess, async (req, res) => {
    const sourceCommanderId = parseSessionId(req.params.id)
    if (!sourceCommanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const source = await context.sessionStore.get(sourceCommanderId)
    if (!source) {
      res.status(404).json({ error: `Commander "${sourceCommanderId}" not found` })
      return
    }

    const displayName = parseMessage(req.body?.displayName)
    if (!displayName) {
      res.status(400).json({ error: 'displayName is required' })
      return
    }
    try {
      await assertUniqueCommanderDisplayName(displayName)
    } catch (error) {
      if (error instanceof DuplicateCommanderDisplayNameError) {
        res.status(409).json({ error: error.message })
        return
      }
      throw error
    }

    const existing = await context.sessionStore.list()
    const host = buildReplicatedHost(
      source.host,
      new Set(existing.map((session) => session.host)),
    )

    const session: CommanderSession = {
      id: randomUUID(),
      host,
      avatarSeed: source.avatarSeed,
      persona: source.persona,
      state: 'idle',
      created: context.now().toISOString(),
      agentType: source.agentType ?? 'claude',
      effort: source.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
      cwd: source.cwd,
      maxTurns: source.maxTurns,
      contextMode: source.contextMode,
      contextConfig: source.contextConfig ? { ...source.contextConfig } : undefined,
      heartbeat: { ...source.heartbeat },
      taskSource: source.taskSource ? { ...source.taskSource } : null,
      ...(source.roleKey ? { roleKey: source.roleKey } : {}),
      ...(source.templateId !== undefined ? { templateId: source.templateId } : {}),
      replicatedFromCommanderId: source.id,
    }

    try {
      const created = await persistCreatedCommander(session, displayName)
      res.status(201).json(
        displayName !== created.host
          ? { ...created, displayName }
          : created,
      )
    } catch (error) {
      if (error instanceof DuplicateCommanderDisplayNameError) {
        res.status(409).json({ error: error.message })
        return
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to replicate commander session',
      })
    }
  })

  router.patch('/:id', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const displayNameProvided = req.body?.displayName !== undefined
    const roleKeyProvided = req.body?.roleKey !== undefined
    const personaProvided = req.body?.persona !== undefined
    const agentTypeProvided = req.body?.agentType !== undefined
    const effortProvided = req.body?.effort !== undefined
    const cwdProvided = req.body?.cwd !== undefined
    const maxTurnsProvided = req.body?.maxTurns !== undefined
    const contextModeProvided = req.body?.contextMode !== undefined

    if (
      !displayNameProvided
      && !roleKeyProvided
      && !personaProvided
      && !agentTypeProvided
      && !effortProvided
      && !cwdProvided
      && !maxTurnsProvided
      && !contextModeProvided
    ) {
      res.status(400).json({ error: 'At least one editable field must be provided' })
      return
    }

    const displayName = displayNameProvided
      ? parseMessage(req.body?.displayName)
      : undefined
    if (displayNameProvided && !displayName) {
      res.status(400).json({ error: 'displayName must be a non-empty string' })
      return
    }

    const roleKey = parseOptionalCommanderRoleKey(req.body?.roleKey)
    if (roleKeyProvided && roleKey === null) {
      res.status(400).json({
        error: 'roleKey must be one of: engineering, research, ops, content, validator, ea',
      })
      return
    }

    const parsedPersona = parseOptionalPersona(req.body?.persona)
    if (!parsedPersona.valid) {
      res.status(400).json({ error: `persona must be a string up to ${MAX_PERSONA_LENGTH} characters` })
      return
    }

    const parsedAgentType = parseOptionalCommanderAgentType(req.body?.agentType)
    if (agentTypeProvided && (req.body?.agentType === null || parsedAgentType === null)) {
      res.status(400).json({ error: 'agentType must be a supported provider' })
      return
    }

    const parsedEffort = parseOptionalCommanderEffort(req.body?.effort)
    if (effortProvided && (req.body?.effort === null || parsedEffort === null)) {
      res.status(400).json({ error: 'effort must be one of: low, medium, high, max' })
      return
    }

    if (maxTurnsProvided && req.body?.maxTurns === null) {
      res.status(400).json({
        error: `maxTurns must be an integer between 1 and ${context.runtimeConfig.limits.maxTurns}`,
      })
      return
    }
    const parsedMaxTurns = parseOptionalCommanderMaxTurns(
      req.body?.maxTurns,
      { max: context.runtimeConfig.limits.maxTurns },
    )
    if (!parsedMaxTurns.valid) {
      res.status(400).json({
        error: `maxTurns must be an integer between 1 and ${context.runtimeConfig.limits.maxTurns}`,
      })
      return
    }

    if (contextModeProvided && req.body?.contextMode === null) {
      res.status(400).json({ error: 'contextMode must be either "thin" or "fat"' })
      return
    }
    const parsedContextMode = parseOptionalCommanderContextMode(req.body?.contextMode)
    if (!parsedContextMode.valid) {
      res.status(400).json({ error: 'contextMode must be either "thin" or "fat"' })
      return
    }

    const cwd = !cwdProvided
      ? undefined
      : req.body?.cwd === null
        ? undefined
        : parseMessage(req.body?.cwd) ?? undefined
    if (
      cwdProvided
      && req.body?.cwd !== null
      && typeof req.body?.cwd !== 'string'
    ) {
      res.status(400).json({ error: 'cwd must be a string when provided' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const existingDisplayNames = await readCommanderDisplayNames(context.commanderDataDir)
    const previousDisplayName = existingDisplayNames[commanderId] ?? session.host
    const nextDisplayName = displayName ?? previousDisplayName
    if (displayNameProvided && displayName && displayName !== previousDisplayName) {
      try {
        await assertUniqueCommanderDisplayName(displayName, commanderId)
      } catch (error) {
        if (error instanceof DuplicateCommanderDisplayNameError) {
          res.status(409).json({ error: error.message })
          return
        }
        throw error
      }
    }

    const updated = await context.sessionStore.update(commanderId, (current) => {
      const nextContextMode = parsedContextMode.value ?? current.contextMode
      const nextAgentType = parsedAgentType ?? current.agentType
      const nextEffort = parsedEffort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      return {
        ...current,
        ...(roleKeyProvided
          ? (roleKey ? { roleKey } : { roleKey: undefined })
          : {}),
        ...(personaProvided ? { persona: parsedPersona.value } : {}),
        ...(agentTypeProvided
          ? (nextAgentType ? { agentType: nextAgentType } : { agentType: undefined })
          : {}),
        ...(effortProvided ? { effort: nextEffort } : {}),
        ...(cwdProvided ? { cwd } : {}),
        ...(maxTurnsProvided && parsedMaxTurns.value !== undefined ? { maxTurns: parsedMaxTurns.value } : {}),
        ...(contextModeProvided && parsedContextMode.value !== undefined ? { contextMode: parsedContextMode.value } : {}),
        ...(contextModeProvided && nextContextMode === 'thin' ? { contextConfig: undefined } : {}),
      }
    })

    if (!updated) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    if (displayNameProvided && displayName && displayName !== previousDisplayName) {
      try {
        await upsertCommanderDisplayName(context.commanderDataDir, commanderId, displayName)
      } catch (error) {
        await context.sessionStore.update(commanderId, () => session).catch(() => {})
        if (error instanceof DuplicateCommanderDisplayNameError) {
          res.status(409).json({ error: error.message })
          return
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to update commander display name',
        })
        return
      }
    }

    const liveSessionName = context.activeCommanderSessions.get(commanderId)?.sessionName
      ?? toCommanderSessionName(commanderId)
    const liveSession = context.sessionsInterface?.getSession(liveSessionName)
    if (liveSession) {
      liveSession.maxTurns = updated.maxTurns
    }

    res.json({
      ...updated,
      displayName: nextDisplayName,
    })
  })

  const startCommanderRoute = async (
    req: import('express').Request,
    res: import('express').Response,
  ) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    await context.migrateCommanderConfigSource(commanderId)

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }
    if (rejectArchivedCommanderRuntime(session, res)) {
      return
    }
    if (session.state === 'running') {
      res.status(409).json({ error: `Commander "${commanderId}" is already running` })
      return
    }

    const parsedCurrentTask = parseOptionalCurrentTask(req.body?.currentTask, context.now().toISOString())
    if (!parsedCurrentTask.valid) {
      res.status(400).json({ error: 'Invalid currentTask payload' })
      return
    }
    const parsedAgentType = parseOptionalCommanderAgentType(req.body?.agentType)
    if (parsedAgentType === null) {
      res.status(400).json({ error: 'agentType must be a registered provider id' })
      return
    }
    const selectedAgentType = parsedAgentType ?? resolveCommanderAgentType(session)
    const previousState = session.state
    const defaultConversation = await context.ensureDefaultConversation(session, { surface: 'ui' })
    const sessionName = buildConversationSessionName(defaultConversation)
    const legacySessionName = toCommanderSessionName(commanderId)
    let runtime: CommanderRuntime | null = null
    let startStateUpdated = false

    const rollbackCommanderStart = async (): Promise<void> => {
      context.heartbeatManager.stopForCommander(commanderId)

      if (runtime?.collectTimer) {
        clearTimeout(runtime.collectTimer)
        runtime.collectTimer = null
      }
      if (runtime) {
        runtime.pendingCollect = []
        runtime.unsubscribeEvents?.()
        context.runtimes.delete(commanderId)
      }

      context.activeCommanderSessions.delete(commanderId)
      context.sessionsInterface?.deleteSession(sessionName)
      context.sessionsInterface?.deleteSession(legacySessionName)

      if (!startStateUpdated) {
        return
      }

      await context.sessionStore.update(commanderId, (current) => ({
        ...current,
        state: previousState,
      }))
      await context.conversationStore.update(defaultConversation.id, (current) => ({
        ...current,
        status: defaultConversation.status,
        currentTask: defaultConversation.currentTask,
        lastHeartbeat: defaultConversation.lastHeartbeat,
        heartbeatTickCount: defaultConversation.heartbeatTickCount,
      }))
    }

    try {
      await context.questStore.resetActiveToPending(commanderId)

      const manager = new CommanderManager(
        commanderId,
        context.commanderBasePath,
        {
          onSubagentLifecycleEvent: (event) => context.onSubagentLifecycleEvent(commanderId, event),
        },
      )
      await manager.init()
      const contextPressureBridge = createContextPressureBridge()
      const workflow = await resolveCommanderWorkflow(
        commanderId,
        session.cwd,
        context.commanderBasePath,
      )
      const started = await context.sessionStore.update(commanderId, (current) => ({
        ...current,
        state: 'running',
        agentType: selectedAgentType,
      }))

      if (!started) {
        res.status(404).json({ error: `Commander "${commanderId}" not found` })
        return
      }
      startStateUpdated = true

      const activeConversation = await context.conversationStore.update(defaultConversation.id, (current) => ({
        ...current,
        status: 'active',
        currentTask: parsedCurrentTask.value ?? current.currentTask,
        lastHeartbeat: null,
        heartbeatTickCount: 0,
      }))
      const effectiveHeartbeat = resolveEffectiveHeartbeat(started)
      const built = await buildCommanderSessionSeedFromResolvedWorkflow(
        {
          commanderId,
          cwd: started.cwd ?? undefined,
          persona: started.persona,
          currentTask: activeConversation?.currentTask ?? defaultConversation.currentTask,
          taskSource: started.taskSource,
          maxTurns: started.maxTurns,
          memoryBasePath: context.commanderBasePath,
        },
        workflow,
      )

      if (!context.sessionsInterface) {
        throw new Error('sessionsInterface not configured — agents router bridge missing')
      }

      context.sessionsInterface.deleteSession(sessionName)
      context.sessionsInterface.deleteSession(legacySessionName)
      await context.sessionsInterface.createCommanderSession({
        name: sessionName,
        commanderId,
        conversationId: activeConversation?.id ?? defaultConversation.id,
        systemPrompt: built.systemPrompt,
        agentType: selectedAgentType,
        effort: selectedAgentType === 'claude'
          ? started.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
          : undefined,
        cwd: started.cwd ?? undefined,
        maxTurns: built.maxTurns,
      })

      const initialStreamSession = context.sessionsInterface.getSession(sessionName)
      const initialInputTokens = (
        typeof initialStreamSession?.usage.inputTokens === 'number' &&
        Number.isFinite(initialStreamSession.usage.inputTokens)
      )
        ? initialStreamSession.usage.inputTokens
        : 0

      const explicitStartMessage = parseMessage(req.body?.message)
      const startPrompt = explicitStartMessage ?? STARTUP_PROMPT
      runtime = {
        manager,
        contextPressureBridge,
        lastTaskState: 'Commander started',
        heartbeatCount: 0,
        lastKnownInputTokens: initialInputTokens,
        forceNextFatHeartbeat: false,
        pendingCollect: [],
        pendingInternalUserMessages: new Map(),
        collectTimer: null,
        subAgents: new Map(),
        terminalState: null,
      }

      let contextPressureTriggeredForTurn = false
      const unsubscribeEvents = context.sessionsInterface.subscribeToEvents(sessionName, (event) => {
        const eventType = typeof event.type === 'string' ? event.type : ''
        if (eventType === 'message_start') {
          contextPressureTriggeredForTurn = false
          if (runtime) {
            runtime.terminalState = null
          }
        }

        const rawUserMessage = extractRawUserMessage(event)
        if (rawUserMessage && runtime) {
          consumeInternalUserMessage(runtime, rawUserMessage)
        }

        const streamSession = context.sessionsInterface?.getSession(sessionName)
        const sessionInputTokens = (
          typeof streamSession?.usage.inputTokens === 'number' &&
          Number.isFinite(streamSession.usage.inputTokens)
        )
          ? streamSession.usage.inputTokens
          : 0

        if (
          runtime &&
          !contextPressureTriggeredForTurn &&
          (
            isContextPressureSubtypeEvent(event) ||
            isInputTokenContextPressureEvent(
              event,
              sessionInputTokens,
              context.contextPressureInputTokenThreshold,
            )
          )
        ) {
          contextPressureTriggeredForTurn = true
          void contextPressureBridge.trigger()
        }

        if (eventType === 'result' && runtime) {
          runtime.terminalState = resolveCommanderTerminalState(event)
          const observedPostCompactionBoundary = (
            runtime.lastKnownInputTokens > 0 &&
            sessionInputTokens > 0 &&
            sessionInputTokens < runtime.lastKnownInputTokens * 0.5
          )

          if (observedPostCompactionBoundary) {
            runtime.forceNextFatHeartbeat = true
          }
          runtime.lastKnownInputTokens = sessionInputTokens
          contextPressureTriggeredForTurn = false
        }
      })

      runtime.unsubscribeEvents = unsubscribeEvents

      context.runtimes.set(commanderId, runtime)
      context.activeCommanderSessions.set(commanderId, {
        sessionName,
        startedAt: context.now().toISOString(),
      })
      context.heartbeatManager.start(
        activeConversation?.id ?? defaultConversation.id,
        commanderId,
        effectiveHeartbeat,
      )
      if (explicitStartMessage == null) {
        queueInternalUserMessage(runtime, startPrompt)
      }
      const startupSent = await context.sessionsInterface.sendToSession(sessionName, startPrompt)
      if (!startupSent) {
        console.warn(
          `[commanders] Startup message failed for "${commanderId}" (${selectedAgentType}); resetting runtime state`,
        )
        await rollbackCommanderStart()

        res.status(503).json({
          error: 'Commander startup message could not be delivered. Please retry start.',
        })
        return
      }

      res.json({
        id: started.id,
        state: started.state,
        started: true,
      })
    } catch (error) {
      try {
        await rollbackCommanderStart()
      } catch (rollbackError) {
        console.error(`[commanders] Failed to roll back start for "${commanderId}":`, rollbackError)
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start commander',
      })
    }
  }

  router.post('/:id/start', context.requireWriteAccess, startCommanderRoute)

  router.post('/:id/heartbeat', context.requireWriteAccess, triggerHeartbeatRoute)
  router.post('/:id/heartbeat/trigger', context.requireWriteAccess, triggerHeartbeatRoute)

  router.post('/:id/stop', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    context.heartbeatManager.stopForCommander(commanderId)
    const activeSession = context.activeCommanderSessions.get(commanderId)
    const commanderSessionName = activeSession?.sessionName ?? toCommanderSessionName(commanderId)

    // Sweep every conversation owned by this commander, not just the default
    // single-session path. Per #1216 phase 1 each conversation can have its
    // own per-conversation stream session under
    // `commander-${commanderId}-conversation-${convId}`; stopping only the
    // commander session would leave those orphaned and report `stopped` while live
    // agent runtimes kept consuming budget. See codex-review P1 on PR #1279
    // (comment 3174778566).
    const conversations = await context.conversationStore.listByCommander(commanderId)
    for (const conversation of conversations) {
      if (conversation.status === 'archived') {
        continue
      }
      try {
        await stopConversationSession(context, conversation, 'idle')
      } catch (error) {
        console.warn(
          `[commanders] Failed to stop conversation "${conversation.id}" during commander stop "${commanderId}":`,
          error,
        )
      }
    }

    const runtime = context.runtimes.get(commanderId)
    if (runtime) {
      if (runtime.collectTimer) {
        clearTimeout(runtime.collectTimer)
        runtime.collectTimer = null
      }
      runtime.pendingCollect = []
      const stopState = parseMessage(req.body?.state) ?? 'Commander stop requested'
      runtime.lastTaskState = stopState
      runtime.unsubscribeEvents?.()
      context.runtimes.delete(commanderId)
    }

    context.activeCommanderSessions.delete(commanderId)
    // Defensive cleanup of the commander session name in case nothing
    // referenced the default conversation. The sweep above already covers all
    // real per-conversation sessions through `stopConversationSession`.
    context.sessionsInterface?.deleteSession(commanderSessionName)

    const stopped = await context.sessionStore.update(commanderId, (current) => ({
      ...current,
      state: 'stopped',
    }))

    if (!stopped) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    res.json({
      id: stopped.id,
      state: stopped.state,
      stopped: true,
    })
  })

  router.delete('/wizard/:sessionName', context.requireWriteAccess, (req, res) => {
    const sessionName = parseWizardSessionName(req.params.sessionName)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid wizard session name' })
      return
    }

    context.sessionsInterface?.deleteSession(sessionName)
    res.status(204).send()
  })

  router.post('/:id/archive', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const liveWorkerSession = context.sessionsInterface?.getSession(toCommanderSessionName(commanderId))
    if (session.state === 'running' || liveWorkerSession) {
      res.status(409).json({
        error: `Commander "${commanderId}" has a live worker session. Stop it before archiving.`,
      })
      return
    }

    const conversations = await context.conversationStore.listByCommander(commanderId)
    const activeLiveConversation = conversations.find((conversation) => (
      conversation.status === 'active'
      && Boolean(getLiveConversationSession(context, conversation))
    ))
    if (activeLiveConversation) {
      res.status(409).json({
        error: `Commander "${commanderId}" has an active live conversation "${activeLiveConversation.id}". Stop it before archiving.`,
      })
      return
    }

    const archivedAt = session.archivedAt ?? context.now().toISOString()
    const archived = await context.sessionStore.update(commanderId, (current) => ({
      ...current,
      archived: true,
      archivedAt,
    }))

    if (!archived) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    res.json({
      id: archived.id,
      archived: archived.archived === true,
      archivedAt: archived.archivedAt,
    })
  })

  router.post('/:id/restore', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const restored = await context.sessionStore.update(commanderId, (current) => ({
      ...current,
      archived: false,
      archivedAt: undefined,
    }))

    if (!restored) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    res.json({
      id: restored.id,
      archived: restored.archived === true,
      archivedAt: restored.archivedAt ?? null,
    })
  })

  router.delete('/:id', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const liveWorkerSession = context.sessionsInterface?.getSession(toCommanderSessionName(commanderId))
    if (session.state === 'running' || liveWorkerSession) {
      res.status(409).json({
        error: `Commander "${commanderId}" has a live worker session. Stop it before deleting.`,
      })
      return
    }

    const conversations = await context.conversationStore.listByCommander(commanderId)
    const activeLiveConversation = conversations.find((conversation) => (
      conversation.status === 'active'
      && Boolean(getLiveConversationSession(context, conversation))
    ))
    if (activeLiveConversation) {
      res.status(409).json({
        error: `Commander "${commanderId}" has an active live conversation "${activeLiveConversation.id}". Stop it before deleting.`,
      })
      return
    }

    context.heartbeatManager.stopForCommander(commanderId)

    // Cascade-archive every conversation owned by this commander BEFORE the
    // commander row itself is removed. Otherwise inbound channel webhooks can
    // hit the orphan conversation later and crash on the missing-commander
    // path. See codex-review P1 on PR #1279 (comment 3174814198).
    for (const conversation of conversations) {
      try {
        await stopConversationSession(context, conversation, 'archived')
      } catch (error) {
        console.warn(
          `[commanders] Failed to archive conversation "${conversation.id}" during commander delete "${commanderId}":`,
          error,
        )
      }
    }

    const runtime = context.runtimes.get(commanderId)
    if (runtime) {
      if (runtime.collectTimer) {
        clearTimeout(runtime.collectTimer)
        runtime.collectTimer = null
      }
      runtime.pendingCollect = []
      runtime.unsubscribeEvents?.()
      context.runtimes.delete(commanderId)
    }
    context.activeCommanderSessions.delete(commanderId)
    context.sessionsInterface?.deleteSession(toCommanderSessionName(commanderId))

    await context.sessionStore.delete(commanderId)
    try {
      await deleteCommanderDisplayName(context.commanderDataDir, commanderId)
    } catch (error) {
      console.warn(
        `[commanders] Failed to remove display name for "${commanderId}":`,
        error,
      )
    }
    try {
      const { commanderRoot } = resolveCommanderPaths(commanderId, context.commanderBasePath)
      await rm(commanderRoot, { recursive: true, force: true })
    } catch (error) {
      console.warn(
        `[commanders] Failed to remove commander root for "${commanderId}":`,
        error,
      )
    }
    res.status(204).send()
  })

  router.patch('/:id/heartbeat', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const parsed = parseHeartbeatPatch(req.body)
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error })
      return
    }

    const updatedCommander = await context.sessionStore.update(commanderId, (current) => ({
      ...current,
      heartbeat: mergeHeartbeatConfig(current.heartbeat, parsed.value),
    }))

    if (!updatedCommander) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const conversations = (await context.conversationStore.listByCommander(commanderId))
      .filter((conversation) => conversation.status !== 'archived')
    const effectiveHeartbeat = resolveEffectiveHeartbeat(updatedCommander)
    for (const conversation of conversations) {
      context.heartbeatManager.start(conversation.id, commanderId, effectiveHeartbeat)
    }

    res.json({
      id: updatedCommander.id,
      heartbeat: { ...updatedCommander.heartbeat },
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        lastHeartbeat: conversation.lastHeartbeat,
      })),
    })
  })

  router.patch('/:id/runtime', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const parsedMaxTurns = parseOptionalCommanderMaxTurns(
      req.body?.maxTurns,
      { max: context.runtimeConfig.limits.maxTurns },
    )
    if (!parsedMaxTurns.valid) {
      res.status(400).json({
        error: `maxTurns must be an integer between 1 and ${context.runtimeConfig.limits.maxTurns}`,
      })
      return
    }

    const parsedContextMode = parseOptionalCommanderContextMode(req.body?.contextMode)
    if (!parsedContextMode.valid) {
      res.status(400).json({ error: 'contextMode must be either "thin" or "fat"' })
      return
    }

    const parsedContextConfig = parseOptionalHeartbeatContextConfig(req.body?.contextConfig)
    if (!parsedContextConfig.valid) {
      res.status(400).json({ error: 'Invalid contextConfig' })
      return
    }

    if (
      parsedMaxTurns.value === undefined
      && parsedContextMode.value === undefined
      && parsedContextConfig.value === undefined
    ) {
      res.status(400).json({ error: 'At least one runtime field must be provided' })
      return
    }

    const updated = await context.sessionStore.update(commanderId, (current) => {
      const nextContextMode = parsedContextMode.value ?? current.contextMode
      const nextContextConfig = nextContextMode === 'thin'
        ? undefined
        : parsedContextConfig.value !== undefined
          ? parsedContextConfig.value
          : current.contextConfig

      return {
        ...current,
        ...(parsedMaxTurns.value !== undefined ? { maxTurns: parsedMaxTurns.value } : {}),
        ...(parsedContextMode.value !== undefined ? { contextMode: parsedContextMode.value } : {}),
        ...(
          nextContextMode === 'thin' || parsedContextConfig.value !== undefined
            ? { contextConfig: nextContextConfig }
            : {}
        ),
      }
    })

    if (!updated) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const sessionName = context.activeCommanderSessions.get(commanderId)?.sessionName
      ?? toCommanderSessionName(commanderId)
    const liveSession = context.sessionsInterface?.getSession(sessionName)
    if (liveSession) {
      liveSession.maxTurns = updated.maxTurns
    }

    res.json({
      id: updated.id,
      maxTurns: updated.maxTurns,
      contextMode: updated.contextMode,
      contextConfig: updated.contextConfig ?? null,
    })
  })

  const deliverCommanderMessageRoute = async (
    req: import('express').Request,
    res: import('express').Response,
    modeOverride?: 'collect' | 'followup',
  ) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const message = parseMessage(req.body?.message)
    if (!message) {
      res.status(400).json({ error: 'Message must be a non-empty string' })
      return
    }
    const mode = modeOverride ?? parseMessageMode(req.query.mode)
    if (!mode) {
      res.status(400).json({ error: 'mode must be either "collect" or "followup"' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }
    if (rejectArchivedCommanderRuntime(session, res)) {
      return
    }

    const runtime = context.runtimes.get(commanderId)
    if (!runtime || session.state !== 'running') {
      res.status(409).json({ error: `Commander "${commanderId}" is not running` })
      return
    }

    const delivered = await context.dispatchCommanderMessage({
      commanderId,
      message,
      mode,
      session,
      runtime,
    })
    if (!delivered.ok) {
      if (delivered.status === 409) {
        res.status(409).json({ error: `Commander "${commanderId}" is not running` })
        return
      }
      res.status(delivered.status).json({ error: delivered.error })
      return
    }

    res.json({ accepted: true })
  }

  router.post('/:id/run-now', context.requireWriteAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const message = parseMessage(req.body?.message)
    if (!message) {
      res.status(400).json({ error: 'message must be a non-empty string' })
      return
    }

    const session = await context.sessionStore.get(commanderId)
    if (!session) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }
    if (rejectArchivedCommanderRuntime(session, res)) {
      return
    }

    if (session.state === 'running') {
      if (req.body?.agentType !== undefined || req.body?.currentTask !== undefined) {
        res.status(400).json({
          error: 'agentType and currentTask are only supported when run-now starts a stopped commander',
        })
        return
      }
      await deliverCommanderMessageRoute(req, res, 'followup')
      return
    }

    await startCommanderRoute(req, res)
  })

  router.post('/:id/message', context.requireWriteAccess, async (req, res) => {
    await deliverCommanderMessageRoute(req, res)
  })
}
