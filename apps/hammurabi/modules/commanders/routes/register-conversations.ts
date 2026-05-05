import { rm } from 'node:fs/promises'
import path from 'node:path'
import { sanitizeTranscriptFileKey } from '../../agents/session/persistence.js'
import {
  parseClaudeAdaptiveThinking,
} from '../../agents/session/input.js'
import { deleteSessionTranscript } from '../../agents/transcript-store.js'
import { parseProviderId } from '../../agents/providers/registry.js'
import type { AgentType } from '../../agents/types.js'
import {
  conversationNamesEqual,
  normalizeConversationName,
} from '../conversation-names.js'
import { resolveCommanderPaths } from '../paths.js'
import {
  isObject,
  parseMessage,
  parseSessionId,
  parseTrimmedString,
} from '../route-parsers.js'
import type { CommanderChannelMeta } from '../store.js'
import { buildDefaultCommanderConversationId } from '../store.js'
import type { Conversation } from '../conversation-store.js'
import {
  ConversationProviderSwapConflictError,
  ConversationProviderSwapUnavailableError,
  deliverConversationMessage,
  getLiveConversationSession,
  startConversationSession,
  stopConversationSession,
  swapConversationProvider,
  type ConversationSpawnOptions,
  updateCommanderDerivedState,
  buildConversationSessionName,
} from './conversation-runtime.js'
import type { CommanderRoutesContext } from './types.js'

type ConversationStatusAction = 'pause' | 'resume' | 'archive'

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseConversationId(raw: unknown): string | null {
  return typeof raw === 'string' && CONVERSATION_ID_PATTERN.test(raw.trim())
    ? raw.trim()
    : null
}

function parseConversationSurface(raw: unknown): Conversation['surface'] | null {
  return raw === 'discord' ||
    raw === 'telegram' ||
    raw === 'whatsapp' ||
    raw === 'ui' ||
    raw === 'cli' ||
    raw === 'api'
    ? raw
    : null
}

function parseConversationAgentType(raw: unknown): AgentType | null {
  return parseProviderId(raw)
}

function parseConversationStatus(raw: unknown): Conversation['status'] | null {
  return raw === 'active' || raw === 'idle' || raw === 'archived'
    ? raw
    : null
}

function parseConversationChannelMeta(raw: unknown): CommanderChannelMeta | undefined {
  if (!isObject(raw)) {
    return undefined
  }

  const provider = raw.provider
  const chatType = raw.chatType
  const accountId = parseTrimmedString(raw.accountId)
  const peerId = parseTrimmedString(raw.peerId)
  const sessionKey = parseTrimmedString(raw.sessionKey)
  const displayName = parseTrimmedString(raw.displayName)
  if (
    (provider !== 'whatsapp' && provider !== 'telegram' && provider !== 'discord') ||
    (chatType !== 'direct' && chatType !== 'group' && chatType !== 'channel' && chatType !== 'forum-topic') ||
    !accountId ||
    !peerId ||
    !sessionKey ||
    !displayName
  ) {
    return undefined
  }

  const optional = (value: unknown): string | undefined => parseTrimmedString(value) ?? undefined
  return {
    provider,
    chatType,
    accountId,
    peerId,
    sessionKey,
    displayName,
    parentPeerId: optional(raw.parentPeerId),
    groupId: optional(raw.groupId),
    threadId: optional(raw.threadId),
    subject: optional(raw.subject),
    space: optional(raw.space),
  }
}

function parseConversationName(raw: unknown): string | null {
  return normalizeConversationName(raw)
}

function withLiveSession(context: CommanderRoutesContext, conversation: Conversation) {
  const liveSession = getLiveConversationSession(context, conversation)
  const defaultConversationId = buildDefaultCommanderConversationId(conversation.commanderId)
  return {
    ...conversation,
    isDefaultConversation: conversation.id === defaultConversationId,
    liveSession: liveSession ?? null,
  }
}

async function archiveConversation(
  context: CommanderRoutesContext,
  conversation: Conversation,
): Promise<Conversation> {
  const updated = getLiveConversationSession(context, conversation)
    ? await stopConversationSession(context, conversation, 'archived')
    : await (async () => {
        context.heartbeatManager.stop(conversation.id)
        return context.conversationStore.update(conversation.id, (current) => ({
          ...current,
          status: 'archived',
          lastMessageAt: new Date().toISOString(),
        }))
      })()
  await updateCommanderDerivedState(context, conversation.commanderId)
  return updated ?? conversation
}

function listCommanderConversationNames(
  conversations: readonly Conversation[],
  conversationId: string,
): string[] {
  return conversations
    .filter((entry) => entry.id !== conversationId)
    .map((entry) => entry.name)
}

function buildConversationTranscriptPaths(
  context: CommanderRoutesContext,
  conversation: Conversation,
): string[] {
  const sessionsRoot = path.join(
    resolveCommanderPaths(conversation.commanderId, context.commanderDataDir).commanderRoot,
    'sessions',
  )
  const transcriptIds = new Set<string>()
  transcriptIds.add(buildConversationSessionName(conversation))
  const providerContext = conversation.providerContext as {
    providerId?: string
    sessionId?: string
    threadId?: string
  } | undefined
  for (const candidate of [
    providerContext?.threadId,
    providerContext?.sessionId,
  ]) {
    const sanitized = candidate ? sanitizeTranscriptFileKey(candidate) : ''
    if (sanitized) {
      transcriptIds.add(sanitized)
    }
  }

  return [...transcriptIds].map((transcriptId) => path.join(sessionsRoot, `${transcriptId}.jsonl`))
}

async function hardDeleteConversation(
  context: CommanderRoutesContext,
  conversation: Conversation,
): Promise<void> {
  await context.conversationStore.delete(conversation.id)
  await deleteSessionTranscript(buildConversationSessionName(conversation))
  await Promise.all(
    buildConversationTranscriptPaths(context, conversation).map((transcriptPath) =>
      rm(transcriptPath, { force: true }),
    ),
  )
  await updateCommanderDerivedState(context, conversation.commanderId)
}

export function registerConversationRoutes(
  commanderRouter: import('express').Router,
  conversationRouter: import('express').Router,
  context: CommanderRoutesContext,
): void {
  commanderRouter.get('/:id/conversations/active', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    if (!(await context.sessionStore.get(commanderId))) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const activeChat = await context.conversationStore.getActiveChatForCommander(commanderId)
    res.json(activeChat ? withLiveSession(context, activeChat) : null)
  })

  commanderRouter.get('/:id/conversations', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    if (!(await context.sessionStore.get(commanderId))) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const conversations = await context.conversationStore.listByCommander(commanderId)
    res.json(conversations.map((conversation) => withLiveSession(context, conversation)))
  })

  commanderRouter.post('/:id/conversations', context.requireWorkerDispatchAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const commander = await context.sessionStore.get(commanderId)
    if (!commander) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const surface = parseConversationSurface(req.body?.surface)
    if (!surface) {
      res.status(400).json({ error: 'surface is required' })
      return
    }

    const requestedId = req.body?.id === undefined ? undefined : parseConversationId(req.body?.id)
    if (req.body?.id !== undefined && !requestedId) {
      res.status(400).json({ error: 'id must be a UUID when provided' })
      return
    }

    if (requestedId) {
      const collision = await context.conversationStore.get(requestedId)
      if (collision) {
        if (collision.commanderId !== commanderId) {
          res.status(409).json({
            error: `Conversation "${requestedId}" already belongs to commander "${collision.commanderId}"`,
          })
          return
        }
        res.status(409).json({ error: `Conversation "${requestedId}" already exists` })
        return
      }
    }

    const channelMeta = req.body?.channelMeta === undefined
      ? undefined
      : parseConversationChannelMeta(req.body?.channelMeta)
    if (req.body?.channelMeta !== undefined && !channelMeta) {
      res.status(400).json({ error: 'channelMeta is invalid' })
      return
    }

    const requestedAgentType = req.body?.agentType === undefined
      ? undefined
      : parseConversationAgentType(req.body?.agentType)
    if (req.body?.agentType !== undefined && !requestedAgentType) {
      res.status(400).json({ error: 'Invalid agentType. Expected a supported provider.' })
      return
    }

    const nowIso = context.now().toISOString()
    const created = await context.conversationStore.create({
      ...(requestedId ? { id: requestedId } : {}),
      commanderId: commander.id,
      surface,
      ...(channelMeta ? { channelMeta } : {}),
      ...(requestedAgentType ? { agentType: requestedAgentType } : {}),
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: nowIso,
      lastMessageAt: nowIso,
    })

    res.status(201).json(withLiveSession(context, created))
  })

  conversationRouter.patch('/:convId', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const conversation = await context.conversationStore.get(conversationId)
    if (!conversation) {
      res.status(404).json({ error: `Conversation "${conversationId}" not found` })
      return
    }

    const requestedName = req.body?.name === undefined
      ? undefined
      : parseConversationName(req.body?.name)
    if (req.body?.name !== undefined && !requestedName) {
      res.status(400).json({ error: 'name must be a trimmed string between 1 and 64 characters' })
      return
    }

    const requestedAgentType = req.body?.agentType === undefined
      ? undefined
      : parseConversationAgentType(req.body?.agentType)
    if (req.body?.agentType !== undefined && !requestedAgentType) {
      res.status(400).json({ error: 'Invalid agentType. Expected a supported provider.' })
      return
    }

    const requestedStatus = req.body?.status === undefined
      ? undefined
      : parseConversationStatus(req.body?.status)
    if (req.body?.status !== undefined && requestedStatus !== 'archived') {
      res.status(400).json({ error: 'status only supports "archived" on this route' })
      return
    }

    if (
      requestedName === undefined
      && requestedAgentType === undefined
      && requestedStatus === undefined
    ) {
      res.status(400).json({ error: 'At least one of name, agentType, or status is required' })
      return
    }

    if (requestedName && !conversationNamesEqual(requestedName, conversation.name)) {
      const commanderConversations = await context.conversationStore.listByCommander(conversation.commanderId)
      const collision = listCommanderConversationNames(commanderConversations, conversation.id)
        .some((existingName) => conversationNamesEqual(existingName, requestedName))
      if (collision) {
        res.status(409).json({
          error: `Conversation name "${requestedName}" already exists for commander "${conversation.commanderId}"`,
        })
        return
      }
    }

    let updated = conversation
    if (requestedAgentType && requestedAgentType !== conversation.agentType) {
      try {
        updated = await swapConversationProvider(context, updated, requestedAgentType)
      } catch (error) {
        if (error instanceof ConversationProviderSwapConflictError) {
          res.status(409).json({ error: error.message })
          return
        }
        if (error instanceof ConversationProviderSwapUnavailableError) {
          res.status(503).json({ error: error.message })
          return
        }
        throw error
      }
    }

    if (requestedStatus === 'archived' && updated.status !== 'archived') {
      updated = await archiveConversation(context, updated)
    }

    if (requestedName && !conversationNamesEqual(requestedName, updated.name)) {
      updated = await context.conversationStore.update(updated.id, (current) => ({
        ...current,
        name: requestedName,
        lastMessageAt: new Date().toISOString(),
      })) ?? updated
    }

    res.json(withLiveSession(context, updated))
  })

  conversationRouter.get('/:convId', context.requireReadAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const conversation = await context.conversationStore.get(conversationId)
    if (!conversation) {
      res.status(404).json({ error: `Conversation "${conversationId}" not found` })
      return
    }

    res.json(withLiveSession(context, conversation))
  })

  conversationRouter.post('/:convId/start', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const body = isObject(req.body) ? req.body : {}
    if (
      Object.prototype.hasOwnProperty.call(body, 'effort') ||
      Object.prototype.hasOwnProperty.call(body, 'cwd') ||
      Object.prototype.hasOwnProperty.call(body, 'host')
    ) {
      res.status(400).json({
        error: 'effort, cwd, and host are configured on the commander; remove from body',
      })
      return
    }

    const agentType = parseConversationAgentType(body.agentType)
    if (!agentType) {
      res.status(400).json({ error: 'Invalid agentType. Expected a registered provider id.' })
      return
    }

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(body.adaptiveThinking)
    if (body.adaptiveThinking !== undefined && parsedAdaptiveThinking === null) {
      res.status(400).json({ error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' })
      return
    }
    const adaptiveThinking = parsedAdaptiveThinking ?? undefined

    try {
      const conversation = await context.conversationStore.get(conversationId)
      if (!conversation) {
        res.status(404).json({ error: `Conversation "${conversationId}" not found` })
        return
      }
      if (conversation.status !== 'idle') {
        res.status(409).json({ error: `Conversation "${conversationId}" is not idle` })
        return
      }

      const spawnOptions: ConversationSpawnOptions = {
        agentType,
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
      }
      const started = await startConversationSession(
        context,
        conversation.commanderId,
        conversation,
        null,
        spawnOptions,
      )
      if (!started.sent) {
        res.status(503).json({ error: 'Conversation session could not be started' })
        return
      }

      const updated = await context.conversationStore.update(conversation.id, (current) => ({
        ...current,
        status: 'active',
      }))
      res.status(200).json({
        conversation: withLiveSession(context, updated ?? started.conversation),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      res.status(503).json({ error: detail, providerSpawnFailed: true })
    }
  })

  conversationRouter.post('/:convId/message', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const message = parseMessage(req.body?.message)
    if (!message) {
      res.status(400).json({ error: 'message must be a non-empty string' })
      return
    }
    const queue = req.body?.queue === true

    const conversation = await context.conversationStore.get(conversationId)
    if (!conversation) {
      res.status(404).json({ error: `Conversation "${conversationId}" not found` })
      return
    }
    if (conversation.status === 'archived') {
      res.status(409).json({ error: `Conversation "${conversationId}" is archived` })
      return
    }

    const delivered = await deliverConversationMessage(
      context,
      conversation,
      message,
      queue ? { queue: true, priority: 'normal' } : undefined,
    )
    if (!delivered.ok) {
      res.status(delivered.status).json({ error: delivered.error })
      return
    }
    res.json({
      accepted: true,
      createdSession: delivered.createdSession,
      conversation: withLiveSession(context, delivered.conversation),
    })
  })

  const handleStatusAction = (action: ConversationStatusAction) =>
    async (req: import('express').Request, res: import('express').Response): Promise<void> => {
      const conversationId = parseConversationId(req.params.convId)
      if (!conversationId) {
        res.status(400).json({ error: 'Invalid conversation id' })
        return
      }

      const conversation = await context.conversationStore.get(conversationId)
      if (!conversation) {
        res.status(404).json({ error: `Conversation "${conversationId}" not found` })
        return
      }

      if (action === 'pause') {
        // Archived conversations are terminal — pause must not silently
        // unarchive them. Return 409 so callers explicitly resume/archive
        // through the right path. See codex-review P2 on PR #1279
        // (comment 3175274914).
        if (conversation.status === 'archived') {
          res.status(409).json({
            error: `Conversation "${conversationId}" is archived`,
          })
          return
        }
        const updated = await stopConversationSession(context, conversation, 'idle')
        res.json(withLiveSession(context, updated ?? conversation))
        return
      }

      if (action === 'archive') {
        res.json(withLiveSession(context, await archiveConversation(context, conversation)))
        return
      }

      const liveSession = getLiveConversationSession(context, conversation)
      if (liveSession) {
        const commander = await context.sessionStore.get(conversation.commanderId)
        if (!commander) {
          res.status(404).json({ error: `Commander "${conversation.commanderId}" not found` })
          return
        }
        const updated = await context.conversationStore.update(conversation.id, (current) => ({
          ...current,
          status: 'active',
          lastMessageAt: new Date().toISOString(),
        }))
        await updateCommanderDerivedState(context, conversation.commanderId)
        if (!context.heartbeatManager.isRunning(conversation.id)) {
          context.heartbeatManager.start(
            conversation.id,
            conversation.commanderId,
            commander.heartbeat,
          )
        }
        res.json(withLiveSession(context, updated ?? conversation))
        return
      }

      const resumed = await startConversationSession(context, conversation.commanderId, {
        ...conversation,
        status: 'idle',
      })
      if (!resumed.sent) {
        res.status(503).json({ error: 'Conversation session could not be resumed' })
        return
      }

      const refreshed = await context.conversationStore.get(conversation.id)
      res.json(withLiveSession(context, refreshed ?? resumed.conversation))
    }

  conversationRouter.post('/:convId/pause', context.requireWorkerDispatchAccess, handleStatusAction('pause'))
  conversationRouter.post('/:convId/resume', context.requireWorkerDispatchAccess, handleStatusAction('resume'))
  conversationRouter.post('/:convId/archive', context.requireWorkerDispatchAccess, handleStatusAction('archive'))

  conversationRouter.delete('/:convId', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const conversation = await context.conversationStore.get(conversationId)
    if (!conversation) {
      res.status(404).json({ error: `Conversation "${conversationId}" not found` })
      return
    }

    if (req.query.hard === 'true') {
      const archived = getLiveConversationSession(context, conversation)
        ? await stopConversationSession(context, conversation, 'archived')
        : conversation
      context.heartbeatManager.stop(conversation.id)
      await hardDeleteConversation(context, archived ?? conversation)
      res.json({
        deleted: true,
        hard: true,
        id: conversation.id,
        commanderId: conversation.commanderId,
      })
      return
    }

    res.json(withLiveSession(context, await archiveConversation(context, conversation)))
  })
}
