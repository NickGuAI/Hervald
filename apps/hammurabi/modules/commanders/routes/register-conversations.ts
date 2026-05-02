import {
  parseClaudeAdaptiveThinking,
  parseClaudeEffort,
} from '../../agents/session/input.js'
import type { AgentType } from '../../agents/types.js'
import { createDefaultHeartbeatState } from '../heartbeat.js'
import {
  isObject,
  parseMessage,
  parseSessionId,
  parseTrimmedString,
} from '../route-parsers.js'
import { buildLegacyCommanderConversationId, type CommanderChannelMeta } from '../store.js'
import type { Conversation } from '../conversation-store.js'
import {
  deliverConversationMessage,
  getLiveConversationSession,
  startConversationSession,
  stopConversationSession,
  type ConversationSpawnOptions,
  updateCommanderDerivedState,
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
  return raw === 'claude' || raw === 'codex' || raw === 'gemini'
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

function isLegacyConversation(conversation: Conversation): boolean {
  return conversation.id === buildLegacyCommanderConversationId(conversation.commanderId)
}

function withLiveSession(context: CommanderRoutesContext, conversation: Conversation) {
  const liveSession = getLiveConversationSession(context, conversation)
  return {
    ...conversation,
    liveSession: liveSession ?? null,
  }
}

export function registerConversationRoutes(
  commanderRouter: import('express').Router,
  conversationRouter: import('express').Router,
  context: CommanderRoutesContext,
): void {
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

    const nowIso = context.now().toISOString()
    const created = await context.conversationStore.create({
      ...(requestedId ? { id: requestedId } : {}),
      commanderId: commander.id,
      surface,
      ...(channelMeta ? { channelMeta } : {}),
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: createDefaultHeartbeatState(),
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt: nowIso,
      lastMessageAt: nowIso,
    })

    res.status(201).json(withLiveSession(context, created))
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

    const agentType = parseConversationAgentType(req.body?.agentType)
    if (!agentType) {
      res.status(400).json({ error: 'Invalid agentType. Expected one of: claude, codex, gemini' })
      return
    }

    const parsedEffort = parseClaudeEffort(req.body?.effort)
    if (req.body?.effort !== undefined && parsedEffort === null) {
      res.status(400).json({ error: 'Invalid effort. Expected one of: low, medium, high, max' })
      return
    }
    const effort = parsedEffort ?? undefined

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(req.body?.adaptiveThinking)
    if (req.body?.adaptiveThinking !== undefined && parsedAdaptiveThinking === null) {
      res.status(400).json({ error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' })
      return
    }
    const adaptiveThinking = parsedAdaptiveThinking ?? undefined

    const cwd = req.body?.cwd === undefined ? undefined : parseTrimmedString(req.body?.cwd) ?? null
    if (cwd === null) {
      res.status(400).json({ error: 'cwd must be a non-empty string when provided' })
      return
    }

    const host = req.body?.host === undefined ? undefined : parseTrimmedString(req.body?.host) ?? null
    if (host === null) {
      res.status(400).json({ error: 'host must be a non-empty string when provided' })
      return
    }

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
      ...(effort !== undefined ? { effort } : {}),
      ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(host !== undefined ? { host } : {}),
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
        res.json(withLiveSession(context, updated ?? conversation))
        return
      }

      const liveSession = getLiveConversationSession(context, conversation)
      if (liveSession) {
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
            (updated ?? conversation).heartbeat,
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
    res.json(withLiveSession(context, updated ?? conversation))
  })
}
