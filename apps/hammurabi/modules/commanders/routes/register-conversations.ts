import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { Request, Response } from 'express'
import { parseMessageImagesForRequest } from '../../agents/message-images.js'
import { sanitizeTranscriptFileKey } from '../../agents/session/persistence.js'
import {
  parseClaudeEffort,
  parseClaudeAdaptiveThinking,
  parseClaudeMaxThinkingTokens,
} from '../../agents/session/input.js'
import { deleteSessionTranscript } from '../../agents/transcript-store.js'
import { getProvider, parseProviderId } from '../../agents/providers/registry.js'
import { createProviderContextForAgentType } from '../../agents/providers/provider-session-context.js'
import { validateModelForAgentType } from '../../agents/providers/validate-model.js'
import {
  applyWorkspaceContextToText,
  hasWorkspaceContextPayload,
  readWorkspaceContextPayload,
} from '../../workspace/context.js'
import { toWorkspaceError } from '../../workspace/resolver.js'
import type { AgentType } from '../../agents/types.js'
import {
  conversationNamesEqual,
  normalizeConversationName,
} from '../conversation-names.js'
import { resolveCommanderPaths } from '../paths.js'
import {
  isObject,
  parseSessionId,
  parseTrimmedString,
} from '../route-parsers.js'
import type { CommanderChannelMeta } from '../store.js'
import type { Conversation } from '../conversation-store.js'
import {
  ConversationProviderSwapConflictError,
  ConversationProviderSwapUnavailableError,
  deliverConversationMessage,
  getConversationMessagesPage,
  getLiveConversationSession,
  startConversationSession,
  stopConversationSession,
  swapConversationProvider,
  type ConversationSpawnOptions,
  updateCommanderDerivedState,
  buildConversationSessionName,
} from './conversation-runtime.js'
import { buildConversationSummaryDTO } from './conversation-read-model.js'
import {
  beginConversationBootstrap,
  completeConversationBootstrap,
  conversationBootstrapCancelRequested,
  failConversationBootstrap,
  getConversationBootstrapCancelStatus,
  getConversationRuntimeOverlay,
  requestConversationBootstrapCancel,
} from './conversation-runtime-state.js'
import type { CommanderRoutesContext } from './types.js'

type ConversationStatusAction = 'pause' | 'resume' | 'archive'

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_CONVERSATION_MESSAGES_LIMIT = 10
const MAX_CONVERSATION_MESSAGES_LIMIT = 50
const CONVERSATION_BOOTSTRAP_FAST_PATH_MS = 25

function parseConversationId(raw: unknown): string | null {
  return typeof raw === 'string' && CONVERSATION_ID_PATTERN.test(raw.trim())
    ? raw.trim()
    : null
}

function parseConversationMessagesLimit(raw: unknown): number | null {
  if (raw === undefined) {
    return DEFAULT_CONVERSATION_MESSAGES_LIMIT
  }
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return null
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null
  }
  return Math.min(parsed, MAX_CONVERSATION_MESSAGES_LIMIT)
}

function parseConversationMessagesBefore(raw: unknown): number | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return null
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

function parseConversationSurface(raw: unknown): Conversation['surface'] | null {
  if (typeof raw !== 'string') {
    return null
  }
  const normalized = raw.trim()
  return /^[a-z][a-z0-9_-]{1,63}$/i.test(normalized)
    ? normalized as Conversation['surface']
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

function parseConversationModel(
  raw: unknown,
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) {
    return { ok: true, value: undefined }
  }
  if (raw === null) {
    return { ok: true, value: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false }
  }

  const trimmed = raw.trim()
  return { ok: true, value: trimmed.length > 0 ? trimmed : null }
}

function requestActorKind(req: import('express').Request): Conversation['createdByKind'] {
  if (req.authMode === 'auth0') {
    return 'human'
  }
  return 'api-key'
}

function requestActorId(req: import('express').Request): string | undefined {
  const metadata = req.user?.metadata
  if (metadata && typeof metadata === 'object') {
    const keyId = (metadata as Record<string, unknown>).keyId
    if (typeof keyId === 'string' && keyId.trim().length > 0) {
      return keyId.trim()
    }
  }

  const id = req.user?.id
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
}

function requestId(req: import('express').Request): string | undefined {
  const value = req.get('x-request-id')
  return value && value.trim().length > 0 ? value.trim() : undefined
}

function requestAbortSignal(req: Request, res: Response): AbortSignal {
  const controller = new AbortController()
  let responseFinished = false
  const abort = () => {
    if (!responseFinished && !controller.signal.aborted) {
      controller.abort(new Error('HTTP request closed before response finished'))
    }
  }
  res.once('finish', () => {
    responseFinished = true
    req.off('aborted', abort)
    req.off('close', abort)
  })
  req.once('aborted', abort)
  req.once('close', abort)
  return controller.signal
}

function withLiveSession(
  context: CommanderRoutesContext,
  conversation: Conversation,
  canonicalOrder = 0,
) {
  return buildConversationSummaryDTO(context, conversation, canonicalOrder)
}

type ConversationBootstrapResult =
  | {
    ok: true
    conversation: Conversation
  }
  | {
    ok: false
    error: string
  }

interface ConversationBootstrapLaunch {
  generation: number
  completion: Promise<ConversationBootstrapResult>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wait(ms: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), ms)
  })
}

async function awaitBootstrapFastPath(
  completion: Promise<ConversationBootstrapResult>,
): Promise<ConversationBootstrapResult | null> {
  return Promise.race([
    completion,
    wait(CONVERSATION_BOOTSTRAP_FAST_PATH_MS),
  ])
}

function launchConversationBootstrap(
  context: CommanderRoutesContext,
  conversation: Conversation,
  operation: 'start' | 'resume',
  spawnOptions?: ConversationSpawnOptions,
): ConversationBootstrapLaunch {
  const overlay = beginConversationBootstrap(
    conversation.id,
    operation,
    context.now().toISOString(),
  )
  const generation = overlay.generation
  const completion = (async (): Promise<ConversationBootstrapResult> => {
    try {
      const started = await startConversationSession(
        context,
        conversation.commanderId,
        {
          ...conversation,
          status: 'idle',
        },
        null,
        spawnOptions,
        undefined,
        false,
        0,
        {
          onConversationActivated: () => {
            if (!conversationBootstrapCancelRequested(conversation.id, generation)) {
              completeConversationBootstrap(conversation.id, generation)
            }
          },
        },
      )
      if (!started.sent) {
        failConversationBootstrap(
          conversation.id,
          generation,
          'Conversation session could not be started',
          context.now().toISOString(),
        )
        return { ok: false, error: 'Conversation session could not be started' }
      }

      if (conversationBootstrapCancelRequested(conversation.id, generation)) {
        const cancelStatus = getConversationBootstrapCancelStatus(conversation.id, generation) ?? 'idle'
        const stopped = await stopConversationSession(context, started.conversation, cancelStatus)
        completeConversationBootstrap(conversation.id, generation)
        return {
          ok: true,
          conversation: stopped ?? started.conversation,
        }
      }

      completeConversationBootstrap(conversation.id, generation)
      const refreshed = await context.conversationStore.get(conversation.id)
      return {
        ok: true,
        conversation: refreshed ?? started.conversation,
      }
    } catch (error) {
      const detail = errorMessage(error)
      try {
        if (getLiveConversationSession(context, conversation)) {
          await stopConversationSession(context, conversation, 'idle')
        } else {
          await context.conversationStore.update(conversation.id, (current) => (
            current.status === 'archived'
              ? current
              : {
                  ...current,
                  status: 'idle',
                }
          ))
          await updateCommanderDerivedState(context, conversation.commanderId)
        }
      } catch (cleanupError) {
        console.warn(
          `[conversations] Failed to clean up bootstrap failure for "${conversation.id}":`,
          cleanupError,
        )
      }
      failConversationBootstrap(
        conversation.id,
        generation,
        detail,
        context.now().toISOString(),
      )
      return { ok: false, error: detail }
    }
  })()

  return { generation, completion }
}

function conversationStatusPriority(status: Conversation['status']): number {
  switch (status) {
    case 'active':
      return 0
    case 'idle':
      return 1
    case 'archived':
      return 3
    default:
      return 4
  }
}

function buildConversationCanonicalOrder(conversations: readonly Conversation[]): Map<string, number> {
  const ordered = [...conversations].sort((left, right) => {
    const statusDelta = conversationStatusPriority(left.status) - conversationStatusPriority(right.status)
    if (statusDelta !== 0) {
      return statusDelta
    }

    const lastMessageDelta = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt)
    if (Number.isFinite(lastMessageDelta) && lastMessageDelta !== 0) {
      return lastMessageDelta
    }

    const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (Number.isFinite(createdDelta) && createdDelta !== 0) {
      return createdDelta
    }

    return left.id.localeCompare(right.id)
  })

  return new Map(ordered.map((conversation, index) => [conversation.id, index]))
}

function sendConversationListSerializationFailure(res: Response, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  res.status(500).json({
    error: 'Conversation list serialization failed',
    detail,
  })
}

async function archiveConversation(
  context: CommanderRoutesContext,
  conversation: Conversation,
): Promise<Conversation> {
  requestConversationBootstrapCancel(conversation.id, context.now().toISOString(), 'archived')
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
    try {
      res.json(activeChat ? withLiveSession(context, activeChat) : null)
    } catch (error) {
      sendConversationListSerializationFailure(res, error)
    }
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
    try {
      const canonicalOrder = buildConversationCanonicalOrder(conversations)
      res.json(conversations.map((conversation) => (
        withLiveSession(context, conversation, canonicalOrder.get(conversation.id) ?? 0)
      )))
    } catch (error) {
      sendConversationListSerializationFailure(res, error)
    }
  })

  commanderRouter.post('/:id/conversations', context.requireConversationCreateAccess, async (req, res) => {
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

    const requestedModel = parseConversationModel(req.body?.model)
    if (!requestedModel.ok) {
      res.status(400).json({ error: 'model must be a string or null when provided' })
      return
    }
    const selectedAgentType = requestedAgentType ?? commander.agentType ?? 'claude'
    const modelValidation = validateModelForAgentType(selectedAgentType, requestedModel.value ?? null)
    if (!modelValidation.ok) {
      res.status(400).json({ error: modelValidation.error, validIds: modelValidation.validIds })
      return
    }
    const selectedProvider = getProvider(selectedAgentType)

    const parsedEffort = parseClaudeEffort(req.body?.effort)
    if (req.body?.effort !== undefined && parsedEffort === null) {
      res.status(400).json({ error: 'Invalid effort. Expected one of: low, medium, high, max' })
      return
    }
    if (req.body?.effort !== undefined && !selectedProvider?.uiCapabilities.supportsEffort) {
      res.status(400).json({ error: `Provider "${selectedAgentType}" does not support effort` })
      return
    }
    const effort = parsedEffort ?? undefined

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(req.body?.adaptiveThinking)
    if (req.body?.adaptiveThinking !== undefined && parsedAdaptiveThinking === null) {
      res.status(400).json({ error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' })
      return
    }
    if (req.body?.adaptiveThinking !== undefined && !selectedProvider?.uiCapabilities.supportsAdaptiveThinking) {
      res.status(400).json({ error: `Provider "${selectedAgentType}" does not support adaptiveThinking` })
      return
    }
    const adaptiveThinking = parsedAdaptiveThinking ?? undefined

    const parsedMaxThinkingTokens = parseClaudeMaxThinkingTokens(req.body?.maxThinkingTokens)
    if (req.body?.maxThinkingTokens !== undefined && parsedMaxThinkingTokens === null) {
      res.status(400).json({ error: 'Invalid maxThinkingTokens. Expected integer 1024..256000' })
      return
    }
    if (req.body?.maxThinkingTokens !== undefined && !selectedProvider?.uiCapabilities.supportsMaxThinkingTokens) {
      res.status(400).json({ error: `Provider "${selectedAgentType}" does not support maxThinkingTokens` })
      return
    }
    const maxThinkingTokens = parsedMaxThinkingTokens ?? undefined

    const providerContext = (
      effort !== undefined ||
      adaptiveThinking !== undefined ||
      maxThinkingTokens !== undefined
    )
      ? createProviderContextForAgentType(selectedAgentType, {
          effort,
          adaptiveThinking,
          maxThinkingTokens,
        })
      : undefined

    const nowIso = context.now().toISOString()
    const created = await context.conversationStore.create({
      ...(requestedId ? { id: requestedId } : {}),
      commanderId: commander.id,
      surface,
      ...(channelMeta ? { channelMeta } : {}),
      ...(
        requestedAgentType || requestedModel.value !== undefined || providerContext
          ? { agentType: selectedAgentType }
          : {}
      ),
      ...(requestedModel.value !== undefined ? { model: requestedModel.value } : {}),
      ...(providerContext ? { providerContext } : {}),
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      creationSource: surface === 'cli' ? 'cli' : surface === 'api' ? 'api' : 'ui',
      createdByKind: requestActorKind(req),
      ...(requestActorId(req) ? { createdById: requestActorId(req) } : {}),
      ...(requestId(req) ? { requestId: requestId(req) } : {}),
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

    const requestedModel = parseConversationModel(req.body?.model)
    if (!requestedModel.ok) {
      res.status(400).json({ error: 'model must be a string or null when provided' })
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
      && requestedModel.value === undefined
      && requestedStatus === undefined
    ) {
      res.status(400).json({ error: 'At least one of name, agentType, model, or status is required' })
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

    const commander = await context.sessionStore.get(conversation.commanderId)
    const nextAgentType = requestedAgentType ?? conversation.agentType ?? commander?.agentType ?? 'claude'
    const providerChanged = Boolean(requestedAgentType && requestedAgentType !== conversation.agentType)
    const nextModel = requestedModel.value !== undefined
      ? requestedModel.value
      : providerChanged
        ? null
        : conversation.model ?? null
    if (providerChanged || requestedModel.value !== undefined) {
      const modelValidation = validateModelForAgentType(nextAgentType, nextModel)
      if (!modelValidation.ok) {
        res.status(400).json({ error: modelValidation.error, validIds: modelValidation.validIds })
        return
      }
    }
    if (
      (requestedAgentType !== undefined || requestedModel.value !== undefined)
      && (
        conversation.status === 'active'
        || getLiveConversationSession(context, conversation)
        || getConversationRuntimeOverlay(conversation.id)?.state === 'starting'
      )
    ) {
      res.status(409).json({
        error: `Conversation "${conversation.id}" is active; stop it before changing provider or model`,
      })
      return
    }

    let updated = conversation
    if (providerChanged || requestedModel.value !== undefined) {
      try {
        updated = await swapConversationProvider(context, updated, nextAgentType, {
          model: nextModel,
        })
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

  conversationRouter.get('/:convId/messages', context.requireReadAccess, async (req, res) => {
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

    const limit = parseConversationMessagesLimit(req.query.limit)
    if (limit === null) {
      res.status(400).json({ error: 'limit must be a positive integer' })
      return
    }

    const before = parseConversationMessagesBefore(req.query.before)
    if (before === null) {
      res.status(400).json({ error: 'before must be a non-negative integer cursor' })
      return
    }

    try {
      res.json(await getConversationMessagesPage(context, conversation, { limit, before }))
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load conversation messages',
      })
    }
  })

  conversationRouter.post('/:convId/start', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const body = isObject(req.body) ? req.body : {}
    if (
      Object.prototype.hasOwnProperty.call(body, 'cwd') ||
      Object.prototype.hasOwnProperty.call(body, 'host')
    ) {
      res.status(400).json({
        error: 'cwd and host are configured on the commander; remove from body',
      })
      return
    }

    const requestedAgentType = body.agentType === undefined
      ? undefined
      : parseConversationAgentType(body.agentType)
    if (body.agentType !== undefined && !requestedAgentType) {
      res.status(400).json({ error: 'Invalid agentType. Expected a registered provider id.' })
      return
    }

    const requestedModel = parseConversationModel(body.model)
    if (!requestedModel.ok) {
      res.status(400).json({ error: 'model must be a string or null when provided' })
      return
    }
    if (requestedAgentType) {
      const modelValidation = validateModelForAgentType(requestedAgentType, requestedModel.value ?? null)
      if (!modelValidation.ok) {
        res.status(400).json({ error: modelValidation.error, validIds: modelValidation.validIds })
        return
      }
    }

    const parsedEffort = parseClaudeEffort(body.effort)
    if (body.effort !== undefined && parsedEffort === null) {
      res.status(400).json({ error: 'Invalid effort. Expected one of: low, medium, high, max' })
      return
    }
    const effort = parsedEffort ?? undefined

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(body.adaptiveThinking)
    if (body.adaptiveThinking !== undefined && parsedAdaptiveThinking === null) {
      res.status(400).json({ error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' })
      return
    }
    const adaptiveThinking = parsedAdaptiveThinking ?? undefined

    const parsedMaxThinkingTokens = parseClaudeMaxThinkingTokens(body.maxThinkingTokens)
    if (body.maxThinkingTokens !== undefined && parsedMaxThinkingTokens === null) {
      res.status(400).json({ error: 'Invalid maxThinkingTokens. Expected integer 1024..256000' })
      return
    }
    const maxThinkingTokens = parsedMaxThinkingTokens ?? undefined

    try {
      const conversation = await context.conversationStore.get(conversationId)
      if (!conversation) {
        res.status(404).json({ error: `Conversation "${conversationId}" not found` })
        return
      }
      if (getConversationRuntimeOverlay(conversation.id)?.state === 'starting') {
        res.status(202).json({
          conversation: withLiveSession(context, conversation),
        })
        return
      }
      if (conversation.status !== 'idle') {
        res.status(409).json({ error: `Conversation "${conversationId}" is not idle` })
        return
      }

      const commander = await context.sessionStore.get(conversation.commanderId)
      const agentType = requestedAgentType ?? conversation.agentType ?? commander?.agentType ?? 'claude'
      const provider = getProvider(agentType)
      if (effort !== undefined && !provider?.uiCapabilities.supportsEffort) {
        res.status(400).json({ error: `Provider "${agentType}" does not support effort` })
        return
      }
      if (adaptiveThinking !== undefined && !provider?.uiCapabilities.supportsAdaptiveThinking) {
        res.status(400).json({ error: `Provider "${agentType}" does not support adaptiveThinking` })
        return
      }
      if (maxThinkingTokens !== undefined && !provider?.uiCapabilities.supportsMaxThinkingTokens) {
        res.status(400).json({ error: `Provider "${agentType}" does not support maxThinkingTokens` })
        return
      }
      if (!requestedAgentType) {
        const modelValidation = validateModelForAgentType(agentType, requestedModel.value ?? null)
        if (!modelValidation.ok) {
          res.status(400).json({ error: modelValidation.error, validIds: modelValidation.validIds })
          return
        }
      }

      const spawnOptions: ConversationSpawnOptions = {
        ...(requestedAgentType ? { agentType: requestedAgentType } : {}),
        ...(requestedModel.value !== undefined ? { model: requestedModel.value } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
      }

      const launch = launchConversationBootstrap(context, conversation, 'start', spawnOptions)
      const fastResult = await awaitBootstrapFastPath(launch.completion)
      if (!fastResult) {
        const latest = await context.conversationStore.get(conversation.id)
        res.status(202).json({
          conversation: withLiveSession(context, latest ?? conversation),
        })
        return
      }
      if (!fastResult.ok) {
        res.status(503).json({ error: fastResult.error })
        return
      }

      res.status(200).json({
        conversation: withLiveSession(context, fastResult.conversation),
      })
    } catch (error) {
      res.status(503).json({ error: errorMessage(error) })
    }
  })

  conversationRouter.post('/:convId/message', context.requireWorkerDispatchAccess, async (req, res) => {
    const conversationId = parseConversationId(req.params.convId)
    if (!conversationId) {
      res.status(400).json({ error: 'Invalid conversation id' })
      return
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const parsedImages = parseMessageImagesForRequest(req.body?.images)
    if (!parsedImages.ok) {
      res.status(parsedImages.status).json({ error: parsedImages.error })
      return
    }
    const images = parsedImages.images
    const workspaceContext = readWorkspaceContextPayload(req.body?.workspaceContext)
    const rawClientSendId = typeof req.body?.clientSendId === 'string'
      ? req.body.clientSendId.trim()
      : ''
    const clientSendId = rawClientSendId.length > 0 ? rawClientSendId : undefined
    if (!message && images.length === 0 && !hasWorkspaceContextPayload(workspaceContext)) {
      res.status(400).json({ error: 'message must be a non-empty string or images must be provided' })
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
    if (getConversationRuntimeOverlay(conversation.id)?.state === 'starting') {
      res.status(409).json({ error: `Conversation "${conversationId}" is starting` })
      return
    }

    let messageWithContext: string
    try {
      messageWithContext = await applyWorkspaceContextToText({
        text: message,
        resolver: workspaceContext?.targetId ? context.getWorkspaceResolver?.() : undefined,
        context: workspaceContext,
      })
    } catch (error) {
      const workspaceError = toWorkspaceError(error)
      res.status(workspaceError.statusCode).json({ error: workspaceError.message })
      return
    }
    if (!messageWithContext && images.length === 0) {
      res.status(400).json({ error: 'message must be a non-empty string or images must be provided' })
      return
    }

    const delivered = await deliverConversationMessage(
      context,
      conversation,
      { message: messageWithContext, displayMessage: message, images, clientSendId },
      {
        ...(queue ? { queue: true, priority: 'normal' as const } : {}),
        abortSignal: requestAbortSignal(req, res),
      },
    )
    if (!delivered.ok) {
      res.status(delivered.status).json({ error: delivered.error })
      return
    }
    let messagePage: Awaited<ReturnType<typeof getConversationMessagesPage>> | undefined
    try {
      messagePage = await getConversationMessagesPage(context, delivered.conversation)
    } catch (error) {
      console.warn(
        `[conversations] Failed to build post-send message page for "${conversation.id}":`,
        error,
      )
    }
    res.json({
      accepted: true,
      createdSession: delivered.createdSession,
      conversation: withLiveSession(context, delivered.conversation),
      ...(delivered.operationId ? { operationId: delivered.operationId } : {}),
      ...(messagePage ? { messagePage } : {}),
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
        if (
          getConversationRuntimeOverlay(conversation.id)?.state === 'starting'
          && requestConversationBootstrapCancel(conversation.id, context.now().toISOString(), 'idle')
        ) {
          res.status(202).json(withLiveSession(context, conversation))
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

      if (getConversationRuntimeOverlay(conversation.id)?.state === 'starting') {
        res.status(202).json(withLiveSession(context, conversation))
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

      const launch = launchConversationBootstrap(context, conversation, 'resume')
      const fastResult = await awaitBootstrapFastPath(launch.completion)
      if (!fastResult) {
        const latest = await context.conversationStore.get(conversation.id)
        res.status(202).json(withLiveSession(context, latest ?? conversation))
        return
      }
      if (!fastResult.ok) {
        res.status(503).json({ error: fastResult.error })
        return
      }

      res.json(withLiveSession(context, fastResult.conversation))
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
      requestConversationBootstrapCancel(conversation.id, context.now().toISOString(), 'archived')
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
