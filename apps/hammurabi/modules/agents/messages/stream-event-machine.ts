import type { AskQuestion, StreamEvent } from '@/types'
import {
  isTranscriptEnvelope,
  type TranscriptEnvelope,
  type TranscriptMessageRole,
} from '../../../src/types/transcript-envelope.js'
import {
  capMessages,
  createUserMessage,
  SUBAGENT_WORKING_LABEL,
  type MessageImageAttachment,
  type MsgItem,
} from './model.js'
import {
  extractAgentMessageText,
  extractSubagentDescription,
  extractToolDetails,
  extractToolResultOutput,
} from './extractors.js'
import {
  isPlanningToolName,
  parsePlanningPayload,
  parsePlanningToolResult,
  toPlanningMessage,
  type PlanningToolName,
} from './planning.js'

export type CurrentBlock = {
  type: 'text' | 'thinking' | 'tool_use' | 'planning_tool_use'
  msgId: string
  toolName?: string
  toolId?: string
  inputJsonParts?: string[]
}

export type MutableStreamProcessorState = {
  currentBlock: CurrentBlock | null
  activeAgentMessageIds: string[]
  activeEnvelopeMessages: Record<string, { msgId: string; role: TranscriptMessageRole; ended?: boolean }>
  activeEnvelopeSubagents: Record<string, string>
  planningToolNames: Record<string, PlanningToolName>
}

export type StreamEventProcessorContext = {
  state: MutableStreamProcessorState
  nextId: () => string
  setMessages: (updater: (prev: MsgItem[]) => MsgItem[]) => void
  setIsStreaming: (value: boolean) => void
  capMessages?: (msgs: MsgItem[]) => MsgItem[]
  onWorkspaceMutation?: () => void
}

const FILE_MUTATING_TOOLS = new Set(['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const ALLOWED_MESSAGE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_PAYLOAD_COLLECTION_KEYS = new Set([
  'attachments',
  'artifact',
  'artifacts',
  'content',
  'data',
  'images',
  'item',
  'message',
  'messages',
  'output',
  'part',
  'payload',
  'response',
  'result',
])
const IMAGE_PAYLOAD_HINT_KEYS = new Set(['attachments', 'artifact', 'artifacts', 'images'])
const IMAGE_PAYLOAD_MAX_DEPTH = 5

export function createStreamProcessorState(): MutableStreamProcessorState {
  return {
    currentBlock: null,
    activeAgentMessageIds: [],
    activeEnvelopeMessages: {},
    activeEnvelopeSubagents: {},
    planningToolNames: {},
  }
}

export function resetStreamProcessorState(state: MutableStreamProcessorState) {
  state.currentBlock = null
  state.activeAgentMessageIds = []
  state.activeEnvelopeMessages = {}
  state.activeEnvelopeSubagents = {}
  state.planningToolNames = {}
}

export function markAskAnsweredMessages(messages: MsgItem[], toolId: string): MsgItem[] {
  return messages.map((message) =>
    message.kind === 'ask' && message.toolId === toolId
      ? { ...message, askAnswered: true }
      : message,
  )
}

function normalizeDescription(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function pushActiveAgentMessageId(state: MutableStreamProcessorState, messageId: string) {
  if (!messageId || state.activeAgentMessageIds.includes(messageId)) {
    return
  }
  state.activeAgentMessageIds.push(messageId)
}

function removeActiveAgentMessageId(state: MutableStreamProcessorState, messageId: string) {
  if (!messageId) {
    return
  }
  state.activeAgentMessageIds = state.activeAgentMessageIds.filter((id) => id !== messageId)
}

function clearActiveAgentMessageIds(state: MutableStreamProcessorState) {
  state.activeAgentMessageIds = []
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === undefined || value === null) {
    return ''
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildTranscriptMeta(
  envelope: TranscriptEnvelope,
  extra: Partial<NonNullable<MsgItem['transcript']>> = {},
): NonNullable<MsgItem['transcript']> {
  return {
    envelopeId: envelope.id,
    time: envelope.time,
    source: envelope.source,
    turnId: envelope.turnId,
    itemId: envelope.itemId,
    parentId: envelope.parentId,
    subagentId: envelope.subagentId,
    providerEventType: envelope.source.rawEventType,
    providerEventId: envelope.source.rawEventId,
    ...extra,
  }
}

function getEnvelopeMessageKey(envelope: TranscriptEnvelope, role: TranscriptMessageRole): string {
  return [
    role,
    envelope.source.provider,
    envelope.itemId ?? '',
    envelope.turnId ?? '',
    envelope.parentId ?? '',
    envelope.subagentId ?? '',
  ].join(':')
}

function hasDurableEnvelopeMessageIdentity(envelope: TranscriptEnvelope): boolean {
  return Boolean(envelope.itemId || envelope.turnId || envelope.parentId || envelope.subagentId)
}

function getEnvelopeSubagentParentId(
  state: MutableStreamProcessorState,
  envelope: TranscriptEnvelope,
): string | undefined {
  if (!envelope.subagentId) {
    return undefined
  }
  return state.activeEnvelopeSubagents[envelope.subagentId]
}

function appendMessageWithOptionalParent(
  context: StreamEventProcessorContext,
  message: MsgItem,
  parentMessageId?: string,
) {
  context.setMessages((prev) => {
    return appendMessageWithOptionalParentToList(
      prev,
      message,
      parentMessageId,
      context.capMessages ?? capMessages,
    )
  })
}

function appendMessageWithOptionalParentToList(
  prev: MsgItem[],
  message: MsgItem,
  parentMessageId: string | undefined,
  limitMessages: (msgs: MsgItem[]) => MsgItem[],
): MsgItem[] {
  if (!parentMessageId) {
    return limitMessages([...prev, message])
  }

  const index = prev.findIndex((candidate) => candidate.id === parentMessageId)
  if (index === -1) {
    return limitMessages([...prev, message])
  }

  const updated = [...prev]
  const parent = updated[index]
  updated[index] = {
    ...parent,
    children: [...(parent.children ?? []), message],
  }
  return limitMessages(updated)
}

function updateMessageOrChild(
  prev: MsgItem[],
  targetId: string,
  updater: (message: MsgItem) => MsgItem,
): MsgItem[] {
  return prev.map((message) => {
    if (message.id === targetId) {
      return updater(message)
    }
    if (!message.children?.length) {
      return message
    }
    let changed = false
    const children = message.children.map((child) => {
      if (child.id !== targetId) {
        return child
      }
      changed = true
      return updater(child)
    })
    return changed ? { ...message, children } : message
  })
}

function removeMessageOrChild(prev: MsgItem[], targetId: string): MsgItem[] {
  const next = prev
    .filter((message) => message.id !== targetId)
    .map((message) => (
      message.children?.length
        ? { ...message, children: message.children.filter((child) => child.id !== targetId) }
        : message
    ))
  return next
}

function findMessageId(
  messages: MsgItem[],
  predicate: (message: MsgItem) => boolean,
): string | undefined {
  for (const message of messages) {
    if (predicate(message)) {
      return message.id
    }
    for (const child of message.children ?? []) {
      if (predicate(child)) {
        return child.id
      }
    }
  }
  return undefined
}

function formatPlanText(plan: unknown): string {
  if (typeof plan === 'string') {
    return plan.trim()
  }
  if (Array.isArray(plan)) {
    return plan.map((entry) => stringifyUnknown(entry)).filter(Boolean).join('\n')
  }
  return stringifyUnknown(plan)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readImageMediaType(
  record: Record<string, unknown>,
  source: Record<string, unknown> | null,
): string | undefined {
  const mediaType = (
    readTrimmedString(source?.media_type)
    ?? readTrimmedString(source?.mediaType)
    ?? readTrimmedString(source?.mime_type)
    ?? readTrimmedString(source?.mimeType)
    ?? readTrimmedString(record.mediaType)
    ?? readTrimmedString(record.media_type)
    ?? readTrimmedString(record.mimeType)
    ?? readTrimmedString(record.mime_type)
  )?.toLowerCase()
  return mediaType
}

function normalizeImageRecord(
  record: Record<string, unknown>,
  allowInferredImage: boolean,
): MessageImageAttachment | null {
  const blockType = readTrimmedString(record.type)?.toLowerCase()
  const isExplicitImageType =
    blockType === 'image'
    || blockType === 'image_url'
    || blockType === 'input_image'
    || blockType === 'output_image'
  const source = asRecord(record.source)
  const imageUrl = asRecord(record.image_url) ?? asRecord(record.imageUrl)
  const mediaType = readImageMediaType(record, source)
  const data = readTrimmedString(source?.data) ?? readTrimmedString(record.data)
  const alt = readTrimmedString(record.alt) ?? readTrimmedString(source?.alt)

  if (mediaType && data && ALLOWED_MESSAGE_IMAGE_TYPES.has(mediaType)) {
    return {
      mediaType,
      data,
      ...(alt ? { alt } : {}),
    }
  }

  const url =
    readTrimmedString(imageUrl?.url)
    ?? readTrimmedString(record.image_url)
    ?? readTrimmedString(record.imageUrl)
    ?? readTrimmedString(source?.url)
    ?? readTrimmedString(source?.path)
    ?? readTrimmedString(record.url)
    ?? readTrimmedString(record.path)
    ?? readTrimmedString(record.uri)
  if (!url) {
    return null
  }

  if (!isExplicitImageType && !allowInferredImage && !mediaType?.startsWith('image/')) {
    return null
  }

  return {
    url,
    ...(mediaType ? { mediaType } : {}),
    ...(alt ? { alt } : {}),
  }
}

function normalizeImageBlock(block: unknown): MessageImageAttachment | null {
  const record = asRecord(block)
  if (!record || readTrimmedString(record.type)?.toLowerCase() !== 'image') {
    return null
  }
  return normalizeImageRecord(record, true)
}

function looksLikeImageReference(value: string): boolean {
  return (
    /^https?:\/\//iu.test(value)
    || value.startsWith('data:')
    || value.startsWith('/api/workspace/raw?')
    || value.startsWith('file://')
    || value.startsWith('/')
    || value.startsWith('~/')
    || value.startsWith('./')
    || value.startsWith('../')
    || /^[A-Za-z]:[\\/]/u.test(value)
  )
}

function imageSignature(image: MessageImageAttachment): string {
  return [
    image.mediaType ?? '',
    image.data ?? '',
    image.url ?? '',
    image.alt ?? '',
  ].join('\u0000')
}

function pushUniqueImage(
  images: MessageImageAttachment[],
  image: MessageImageAttachment,
) {
  const signature = imageSignature(image)
  if (images.some((candidate) => imageSignature(candidate) === signature)) {
    return
  }
  images.push(image)
}

function collectImageAttachments(
  value: unknown,
  images: MessageImageAttachment[],
  depth = 0,
  allowInferredImage = false,
) {
  if (depth > IMAGE_PAYLOAD_MAX_DEPTH || value === undefined || value === null) {
    return
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    if (allowInferredImage && looksLikeImageReference(trimmed)) {
      pushUniqueImage(images, { url: trimmed })
      return
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        collectImageAttachments(JSON.parse(trimmed), images, depth + 1, allowInferredImage)
      } catch {
        // Tool output often contains non-JSON text; leave it as text-only output.
      }
    }
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectImageAttachments(entry, images, depth + 1, allowInferredImage)
    }
    return
  }

  const record = asRecord(value)
  if (!record) {
    return
  }

  const directImage = normalizeImageRecord(record, allowInferredImage)
  if (directImage) {
    pushUniqueImage(images, directImage)
  }

  for (const [key, child] of Object.entries(record)) {
    if (!IMAGE_PAYLOAD_COLLECTION_KEYS.has(key)) {
      continue
    }
    collectImageAttachments(
      child,
      images,
      depth + 1,
      allowInferredImage || IMAGE_PAYLOAD_HINT_KEYS.has(key),
    )
  }
}

function extractImageAttachments(value: unknown): MessageImageAttachment[] {
  const images: MessageImageAttachment[] = []
  collectImageAttachments(value, images)
  return images
}

function readPlanningAction(value: unknown): 'enter' | 'proposed' | 'decision' | undefined {
  return value === 'enter' || value === 'proposed' || value === 'decision'
    ? value
    : undefined
}

function readPlanningEventFromV2Plan(plan: unknown): Extract<StreamEvent, { type: 'planning' }> | null {
  const record = asRecord(plan)
  const action = readPlanningAction(record?.action)
  if (!record || !action) {
    return null
  }
  const planText = typeof record.plan === 'string' ? record.plan : undefined
  const message = typeof record.message === 'string' ? record.message : undefined
  const approved = typeof record.approved === 'boolean' || record.approved === null
    ? record.approved
    : undefined
  return {
    type: 'planning',
    action,
    ...(planText !== undefined ? { plan: planText } : {}),
    ...(approved !== undefined ? { approved } : {}),
    ...(message !== undefined ? { message } : {}),
  }
}

function readTranscriptTextDelta(payload: unknown): string | undefined {
  const record = asRecord(payload)
  if (!record) {
    return undefined
  }
  for (const key of ['text', 'delta', 'textDelta', 'outputTextDelta']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  const delta = asRecord(record.delta)
  const deltaText = delta?.text
  return typeof deltaText === 'string' && deltaText.length > 0 ? deltaText : undefined
}

function promoteLegacyCodexRawDelta(envelope: TranscriptEnvelope): TranscriptEnvelope | null {
  if (
    envelope.ev.type !== 'provider.raw'
    || envelope.source.provider !== 'codex'
    || envelope.ev.method !== 'item/agentMessage/delta'
  ) {
    return null
  }
  const text = readTranscriptTextDelta(envelope.ev.payload)
  return text
    ? {
        ...envelope,
        ev: { type: 'message.delta', text, channel: 'final' },
      }
    : null
}

function appendProviderActivity(
  context: StreamEventProcessorContext,
  envelope: TranscriptEnvelope,
  text: string,
  payload: unknown,
) {
  appendMessageWithOptionalParent(context, {
    id: context.nextId(),
    kind: 'provider',
    text,
    transcript: buildTranscriptMeta(envelope, {
      providerPayload: payload,
      providerEventType: envelope.source.rawEventType ?? envelope.ev.type,
    }),
  }, getEnvelopeSubagentParentId(context.state, envelope))
}

function appendAgentMessage(
  context: StreamEventProcessorContext,
  text: string,
  images?: MessageImageAttachment[],
  parentMessageId?: string,
  transcript?: MsgItem['transcript'],
) {
  const normalizedImages = images?.filter(Boolean)
  if (!text.trim() && (!normalizedImages || normalizedImages.length === 0)) {
    return
  }
  appendMessageWithOptionalParent(context, {
    id: context.nextId(),
    kind: 'agent',
    text,
    ...(normalizedImages && normalizedImages.length > 0 ? { images: normalizedImages } : {}),
    ...(transcript ? { transcript } : {}),
  }, parentMessageId)
}

function appendAgentImagesFromPayload(
  context: StreamEventProcessorContext,
  envelope: TranscriptEnvelope,
  payload: unknown,
  parentMessageId?: string,
) {
  const images = extractImageAttachments(payload)
  if (images.length === 0) {
    return
  }
  appendAgentMessage(
    context,
    '',
    images,
    parentMessageId,
    buildTranscriptMeta(envelope, {
      providerPayload: payload,
      providerEventType: envelope.source.rawEventType ?? envelope.ev.type,
    }),
  )
}

function isReflectedUserInputActivity(
  envelope: TranscriptEnvelope,
  detail: string | undefined,
  payload: unknown,
): boolean {
  const rawEventType = envelope.source.rawEventType?.trim()
  if (!rawEventType?.startsWith('item/')) {
    return false
  }

  const payloadRecord = asRecord(payload)
  const itemRecord = asRecord(payloadRecord?.item) ?? payloadRecord
  const itemType = readTrimmedString(itemRecord?.type) ?? readTrimmedString(detail)
  return itemType === 'userMessage'
}

function normalizeToolStatus(status: string | undefined): 'running' | 'success' | 'error' {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) {
    return 'running'
  }
  if (['ok', 'completed', 'complete', 'success', 'succeeded'].includes(normalized)) {
    return 'success'
  }
  if (['error', 'failed', 'failure', 'cancelled', 'canceled', 'rejected'].includes(normalized)) {
    return 'error'
  }
  return 'running'
}

function processTranscriptEnvelope(
  context: StreamEventProcessorContext,
  envelope: TranscriptEnvelope,
  isReplay: boolean,
) {
  const promotedEnvelope = promoteLegacyCodexRawDelta(envelope)
  if (promotedEnvelope) {
    processTranscriptEnvelope(context, promotedEnvelope, isReplay)
    return
  }

  const parentMessageId = getEnvelopeSubagentParentId(context.state, envelope)
  const ev = envelope.ev

  switch (ev.type) {
    case 'turn.start':
      context.setMessages((prev) =>
        prev.map((message) =>
          message.kind === 'tool' && message.toolStatus === 'running'
            ? { ...message, toolStatus: 'success' }
            : message,
        ),
      )
      clearActiveAgentMessageIds(context.state)
      context.state.activeEnvelopeMessages = {}
      if (!isReplay) {
        context.setIsStreaming(false)
      }
      return

    case 'turn.end': {
      const resultStatus = normalizeToolStatus(ev.status)
      const isSubagentResult = Boolean(envelope.subagentId)
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev.map((message) =>
            message.kind === 'tool' && message.toolStatus === 'running'
              ? { ...message, toolStatus: resultStatus }
              : message,
          ),
          ...(isSubagentResult
            ? []
            : [{
                id: context.nextId(),
                kind: 'system' as const,
                text: 'Awaiting input',
                transcript: buildTranscriptMeta(envelope),
              }]),
        ]),
      )
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      context.onWorkspaceMutation?.()
      return
    }

    case 'message.start': {
      const key = getEnvelopeMessageKey(envelope, ev.role)
      const existing = context.state.activeEnvelopeMessages[key]
      if (existing) {
        if (ev.role === 'assistant' && !isReplay && !existing.ended) {
          context.setIsStreaming(true)
        }
        return
      }
      const kind = ev.role === 'assistant'
        ? 'agent'
        : (ev.role === 'user' ? 'user' : 'system')
      const id = context.nextId()
      context.state.activeEnvelopeMessages[key] = { msgId: id, role: ev.role, ended: false }
      appendMessageWithOptionalParent(context, {
        id,
        kind,
        text: '',
        timestamp: envelope.time,
        transcript: buildTranscriptMeta(envelope),
      }, parentMessageId)
      if (ev.role === 'assistant' && !isReplay) {
        context.setIsStreaming(true)
      }
      return
    }

    case 'message.delta': {
      const role: TranscriptMessageRole = ev.channel === 'system'
        ? 'system'
        : (context.state.activeEnvelopeMessages[getEnvelopeMessageKey(envelope, 'assistant')]?.role
          ?? context.state.activeEnvelopeMessages[getEnvelopeMessageKey(envelope, 'user')]?.role
          ?? 'assistant')
      const key = getEnvelopeMessageKey(envelope, role)
      const existing = context.state.activeEnvelopeMessages[key]
      const kind = role === 'assistant'
        ? 'agent'
        : (role === 'user' ? 'user' : 'system')
      const targetId = existing?.msgId ?? context.nextId()
      if (!existing) {
        context.state.activeEnvelopeMessages[key] = { msgId: targetId, role, ended: false }
      }
      context.setMessages((prev) => {
        const existingMessageId = findMessageId(prev, (message) => message.id === targetId)
        const base = existingMessageId
          ? prev
          : appendMessageWithOptionalParentToList(prev, {
              id: targetId,
              kind,
              text: '',
              timestamp: envelope.time,
              transcript: buildTranscriptMeta(envelope),
            }, parentMessageId, (items) => items)
        return (context.capMessages ?? capMessages)(updateMessageOrChild(base, targetId, (message) => ({
          ...message,
          text: message.text + ev.text,
        })))
      })
      if (!isReplay && role === 'assistant' && !existing?.ended) {
        context.setIsStreaming(true)
      }
      return
    }

    case 'message.image': {
      const image = normalizeImageBlock(ev.image)
      if (!image) {
        return
      }
      const role = ev.role ?? 'assistant'
      const key = getEnvelopeMessageKey(envelope, role)
      const existing = context.state.activeEnvelopeMessages[key]
      const kind = role === 'assistant'
        ? 'agent'
        : (role === 'user' ? 'user' : 'system')
      const targetId = existing?.msgId ?? context.nextId()
      if (!existing) {
        context.state.activeEnvelopeMessages[key] = { msgId: targetId, role, ended: false }
      }
      context.setMessages((prev) => {
        const existingMessageId = findMessageId(prev, (message) => message.id === targetId)
        const base = existingMessageId
          ? prev
          : appendMessageWithOptionalParentToList(prev, {
              id: targetId,
              kind,
              text: '',
              timestamp: envelope.time,
              transcript: buildTranscriptMeta(envelope),
            }, parentMessageId, (items) => items)
        return (context.capMessages ?? capMessages)(updateMessageOrChild(base, targetId, (message) => ({
          ...message,
          images: [...(message.images ?? []), image],
        })))
      })
      if (!isReplay && role === 'assistant' && !existing?.ended) {
        context.setIsStreaming(true)
      }
      return
    }

    case 'message.end': {
      for (const role of ['assistant', 'user', 'system'] as const) {
        const key = getEnvelopeMessageKey(envelope, role)
        const active = context.state.activeEnvelopeMessages[key]
        if (!active) {
          continue
        }
        context.setMessages((prev) => {
          const messageId = active.msgId
          const targetId = findMessageId(prev, (message) => message.id === messageId)
          if (!targetId) {
            return prev
          }
          const emptyMessageId = findMessageId(prev, (message) =>
            message.id === messageId
            && !message.text.trim()
            && (!message.images || message.images.length === 0),
          )
          return emptyMessageId ? removeMessageOrChild(prev, emptyMessageId) : prev
        })
        if (hasDurableEnvelopeMessageIdentity(envelope)) {
          context.state.activeEnvelopeMessages[key] = { ...active, ended: true }
        } else {
          delete context.state.activeEnvelopeMessages[key]
        }
      }
      context.setIsStreaming(false)
      return
    }

    case 'thinking.delta': {
      const key = `thinking:${envelope.itemId ?? envelope.turnId ?? envelope.id}:${envelope.subagentId ?? ''}`
      const existing = context.state.activeEnvelopeMessages[key]
      const targetId = existing?.msgId ?? context.nextId()
      if (!existing) {
        context.state.activeEnvelopeMessages[key] = { msgId: targetId, role: 'assistant' }
        appendMessageWithOptionalParent(context, {
          id: targetId,
          kind: 'thinking',
          text: '',
          timestamp: envelope.time,
          transcript: buildTranscriptMeta(envelope),
        }, parentMessageId)
      }
      context.setMessages((prev) => updateMessageOrChild(prev, targetId, (message) => ({
        ...message,
        text: message.text + ev.text,
      })))
      if (!isReplay) {
        context.setIsStreaming(true)
      }
      return
    }

    case 'tool.start': {
      const { toolInput, toolFile, oldString, newString } = extractToolDetails(
        ev.name,
        ev.input,
      )
      const questions = (ev.input as { questions?: AskQuestion[] } | undefined)?.questions
      const id = context.nextId()
      const transcript = buildTranscriptMeta(envelope)
      if (ev.name === 'AskUserQuestion') {
        appendMessageWithOptionalParent(context, {
          id,
          kind: 'ask',
          text: '',
          toolId: ev.toolCallId,
          toolName: ev.name,
          askQuestions: questions ?? [],
          askAnswered: false,
          transcript,
        }, parentMessageId)
        return
      }

      appendMessageWithOptionalParent(context, {
        id,
        kind: 'tool',
        text: '',
        toolId: ev.toolCallId,
        toolName: ev.name,
        toolStatus: 'running',
        toolInput,
        toolFile,
        oldString,
        newString,
        subagentDescription: ev.name === 'Agent'
          ? extractSubagentDescription(ev.input) ?? ev.title ?? SUBAGENT_WORKING_LABEL
          : undefined,
        transcript,
      }, parentMessageId)

      if (ev.name === 'Agent') {
        pushActiveAgentMessageId(context.state, id)
      }
      const toolSubagentId = envelope.subagentId ?? (ev.name === 'Agent' ? ev.toolCallId : undefined)
      if (
        toolSubagentId
        && (ev.name === 'Agent' || !context.state.activeEnvelopeSubagents[toolSubagentId])
      ) {
        context.state.activeEnvelopeSubagents[toolSubagentId] = id
      }
      return
    }

    case 'tool.delta': {
      context.setMessages((prev) => {
        const toolMessageId = findMessageId(prev, (message) =>
          message.kind === 'tool' && message.toolId === ev.toolCallId,
        )
        if (!toolMessageId) {
          return prev
        }
        return updateMessageOrChild(prev, toolMessageId, (message) => ({
          ...message,
          toolStatus: normalizeToolStatus(ev.status),
          toolOutput: `${message.toolOutput ?? ''}${ev.output ?? ''}`,
          transcript: buildTranscriptMeta(envelope, { providerPayload: ev.data }),
        }))
      })
      if (ev.data !== undefined) {
        appendAgentImagesFromPayload(context, envelope, ev.data, parentMessageId)
      }
      return
    }

    case 'tool.end': {
      const status = normalizeToolStatus(ev.status)
      const output = stringifyUnknown(ev.result ?? ev.error)
      let shouldTriggerWorkspaceRefresh = false
      let completedMessageId: string | undefined
      context.setMessages((prev) => {
        const toolMessageId = findMessageId(prev, (message) =>
          (message.kind === 'tool' || message.kind === 'ask') && message.toolId === ev.toolCallId,
        )
        if (!toolMessageId) {
          return prev
        }
        completedMessageId = toolMessageId
        return updateMessageOrChild(prev, toolMessageId, (message) => {
          if (message.kind === 'ask') {
            return {
              ...message,
              askAnswered: true,
              askSubmitting: false,
              transcript: buildTranscriptMeta(envelope, { providerPayload: ev.result }),
            }
          }
          if (FILE_MUTATING_TOOLS.has(message.toolName ?? '')) {
            shouldTriggerWorkspaceRefresh = true
          }
          if (message.toolName === 'Agent') {
            removeActiveAgentMessageId(context.state, message.id)
          }
          return {
            ...message,
            toolStatus: status,
            ...(output ? { toolOutput: output } : {}),
            transcript: buildTranscriptMeta(envelope, {
              providerPayload: ev.result ?? ev.error,
            }),
          }
        })
      })
      const subagentIdToClear = envelope.subagentId
        ?? (context.state.activeEnvelopeSubagents[ev.toolCallId] ? ev.toolCallId : undefined)
      if (
        subagentIdToClear
        && completedMessageId
        && context.state.activeEnvelopeSubagents[subagentIdToClear] === completedMessageId
      ) {
        delete context.state.activeEnvelopeSubagents[subagentIdToClear]
      }
      appendAgentImagesFromPayload(context, envelope, ev.result ?? ev.error, parentMessageId)
      if (shouldTriggerWorkspaceRefresh) {
        context.onWorkspaceMutation?.()
      }
      return
    }

    case 'subagent.start': {
      const id = context.nextId()
      appendMessageWithOptionalParent(context, {
        id,
        kind: 'tool',
        text: '',
        toolId: envelope.subagentId ?? envelope.itemId ?? envelope.id,
        toolName: 'Agent',
        toolStatus: 'running',
        subagentDescription: ev.title ?? ev.name ?? SUBAGENT_WORKING_LABEL,
        transcript: buildTranscriptMeta(envelope),
      }, parentMessageId)
      pushActiveAgentMessageId(context.state, id)
      if (envelope.subagentId) {
        context.state.activeEnvelopeSubagents[envelope.subagentId] = id
      }
      return
    }

    case 'subagent.end': {
      const targetSubagentId = envelope.subagentId
      if (!targetSubagentId) {
        return
      }
      context.setMessages((prev) => {
        const toolMessageId = context.state.activeEnvelopeSubagents[targetSubagentId]
          ?? findMessageId(prev, (message) => message.kind === 'tool' && message.transcript?.subagentId === targetSubagentId)
        if (!toolMessageId) {
          return prev
        }
        return updateMessageOrChild(prev, toolMessageId, (message) => ({
          ...message,
          toolStatus: normalizeToolStatus(ev.status),
          transcript: buildTranscriptMeta(envelope),
        }))
      })
      delete context.state.activeEnvelopeSubagents[targetSubagentId]
      return
    }

    case 'approval.request': {
      const questions = Array.isArray(ev.questions) ? ev.questions as AskQuestion[] : []
      const request = typeof ev.request === 'object' && ev.request !== null
        ? ev.request as Record<string, unknown>
        : {}
      if (ev.interactionKind === 'plan_approval' || request.interactionKind === 'plan_approval') {
        appendMessageWithOptionalParent(context, {
          id: context.nextId(),
          kind: 'ask',
          text: '',
          toolId: ev.toolCallId,
          toolName: typeof request.toolName === 'string' ? request.toolName : 'PlanApproval',
          askInteractionKind: 'plan_approval',
          askAnswered: false,
          planApprovalPlan: ev.prompt ?? '',
          planApprovalApproveLabel: typeof request.approveLabel === 'string' ? request.approveLabel : undefined,
          planApprovalRejectLabel: typeof request.rejectLabel === 'string' ? request.rejectLabel : undefined,
          planApprovalCustomResponseLabel: typeof request.customResponseLabel === 'string'
            ? request.customResponseLabel
            : undefined,
          transcript: buildTranscriptMeta(envelope, { providerPayload: ev.request }),
        }, parentMessageId)
        return
      }
      appendMessageWithOptionalParent(context, {
        id: context.nextId(),
        kind: questions.length > 0 ? 'ask' : 'provider',
        text: questions.length > 0 ? '' : (ev.prompt ?? 'Approval requested'),
        ...(questions.length > 0
          ? {
              toolId: ev.toolCallId,
              toolName: 'ApprovalRequest',
              askQuestions: questions,
              askAnswered: false,
            }
          : {}),
        transcript: buildTranscriptMeta(envelope, { providerPayload: ev.request }),
      }, parentMessageId)
      return
    }

    case 'approval.resolved': {
      if (!ev.toolCallId) {
        appendProviderActivity(
          context,
          envelope,
          ev.approved === false ? 'Approval rejected' : 'Approval resolved',
          ev.result,
        )
        return
      }
      context.setMessages((prev) => {
        const targetId = findMessageId(prev, (message) =>
          message.kind === 'ask' && message.toolId === ev.toolCallId,
        )
        if (!targetId) {
          return prev
        }
        return updateMessageOrChild(prev, targetId, (message) => ({
          ...message,
          askAnswered: true,
          askSubmitting: false,
          transcript: buildTranscriptMeta(envelope, { providerPayload: ev.result }),
        }))
      })
      return
    }

    case 'plan.update': {
      const planningEvent = readPlanningEventFromV2Plan(ev.plan)
      if (planningEvent) {
        context.setMessages((prev) =>
          (context.capMessages ?? capMessages)([
            ...prev,
            {
              ...toPlanningMessage(context.nextId(), planningEvent),
              transcript: buildTranscriptMeta(envelope, { providerPayload: ev.plan }),
            },
          ]),
        )
        return
      }
      const planText = formatPlanText(ev.plan)
      if (!planText) {
        return
      }
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev,
          {
            ...toPlanningMessage(context.nextId(), {
              type: 'planning',
              action: 'proposed',
              plan: planText,
            }),
            transcript: buildTranscriptMeta(envelope, { providerPayload: ev.plan }),
          },
        ]),
      )
      return
    }

    case 'file.change': {
      appendMessageWithOptionalParent(context, {
        id: context.nextId(),
        kind: 'tool',
        text: '',
        toolId: envelope.itemId ?? envelope.id,
        toolName: 'Edit',
        toolStatus: 'success',
        toolFile: ev.path,
        toolOutput: stringifyUnknown(ev.data),
        transcript: buildTranscriptMeta(envelope, { providerPayload: ev.data }),
      }, parentMessageId)
      context.onWorkspaceMutation?.()
      return
    }

    case 'provider.activity':
      appendProviderActivity(
        context,
        envelope,
        ev.title ?? ev.detail ?? `${envelope.source.provider} activity`,
        ev.data,
      )
      if (!isReflectedUserInputActivity(envelope, ev.detail, ev.data)) {
        appendAgentImagesFromPayload(context, envelope, ev.data, parentMessageId)
      }
      return

    case 'provider.raw':
      appendProviderActivity(
        context,
        envelope,
        ev.method
          ? `${envelope.source.provider} raw: ${ev.method}`
          : `${envelope.source.provider} raw activity`,
        ev.payload,
      )
      appendAgentImagesFromPayload(context, envelope, ev.payload, parentMessageId)
      return
  }
}

function sameImages(
  left: MsgItem['images'] | undefined,
  right: MsgItem['images'] | undefined,
): boolean {
  const leftImages = left ?? []
  const rightImages = right ?? []
  if (leftImages.length !== rightImages.length) {
    return false
  }
  return leftImages.every((image, index) => {
    const candidate = rightImages[index]
    return imageSignature(image) === (candidate ? imageSignature(candidate) : '')
  })
}

function isDuplicateUserBoundaryNoise(message: MsgItem): boolean {
  return (
    message.kind === 'provider'
    || message.kind === 'system'
    || (message.kind === 'agent' && !message.text.trim())
  )
}

function hasPendingEquivalentUserMessage(
  messages: MsgItem[],
  text: string,
  images?: MsgItem['images'],
  clientSendId?: string,
): boolean {
  if (clientSendId) {
    for (const message of messages) {
      if (message.kind === 'user' && message.clientSendId === clientSendId) {
        return true
      }
      if (message.children?.some((child) => child.kind === 'user' && child.clientSendId === clientSendId)) {
        return true
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (candidate.kind === 'user') {
      return candidate.text === text && sameImages(candidate.images, images)
    }
    if (!isDuplicateUserBoundaryNoise(candidate)) {
      return false
    }
  }
  return false
}

function appendUserMessageIfDistinct(
  context: StreamEventProcessorContext,
  text: string,
  images?: MsgItem['images'],
  clientSendId?: string,
) {
  context.setMessages((prev) => {
    if (hasPendingEquivalentUserMessage(prev, text, images, clientSendId)) {
      return prev
    }
    return (context.capMessages ?? capMessages)([
      ...prev,
      createUserMessage(context.nextId(), text, images, clientSendId),
    ])
  })
}

function readUserClientSendId(event: StreamEvent): string | undefined {
  const clientSendId = (event as { clientSendId?: unknown }).clientSendId
  if (typeof clientSendId !== 'string') {
    return undefined
  }
  const normalized = clientSendId.trim()
  return normalized.length > 0 ? normalized : undefined
}

function readUserDisplayText(event: StreamEvent): string | null {
  const displayText = (event as { displayText?: unknown }).displayText
  return typeof displayText === 'string' ? displayText.trim() : null
}

function appendPlanningMessage(
  context: StreamEventProcessorContext,
  event: Extract<StreamEvent, { type: 'planning' }>,
) {
  context.setMessages((prev) =>
    (context.capMessages ?? capMessages)([
      ...prev,
      toPlanningMessage(context.nextId(), event),
    ]),
  )
}

function appendPlanApprovalAsk(
  context: StreamEventProcessorContext,
  event: Extract<StreamEvent, { type: 'plan_approval' }>,
) {
  context.setMessages((prev) => {
    const existingIdx = prev.findIndex(
      (message) => message.kind === 'ask' && message.toolId === event.toolId,
    )
    if (existingIdx !== -1) {
      const updated = [...prev]
      updated[existingIdx] = {
        ...updated[existingIdx],
        askInteractionKind: 'plan_approval',
        toolName: event.toolName,
        planApprovalPlan: event.plan,
        planApprovalApproveLabel: event.approveLabel,
        planApprovalRejectLabel: event.rejectLabel,
        planApprovalCustomResponseLabel: event.customResponseLabel,
      }
      return updated
    }
    return (context.capMessages ?? capMessages)([
      ...prev,
      {
        id: context.nextId(),
        kind: 'ask',
        text: '',
        toolId: event.toolId,
        toolName: event.toolName,
        askInteractionKind: 'plan_approval',
        askAnswered: false,
        planApprovalPlan: event.plan,
        planApprovalApproveLabel: event.approveLabel,
        planApprovalRejectLabel: event.rejectLabel,
        planApprovalCustomResponseLabel: event.customResponseLabel,
      },
    ])
  })
}

function appendPlanningToolUse(
  context: StreamEventProcessorContext,
  toolName: PlanningToolName,
  input: unknown,
) {
  if (toolName === 'EnterPlanMode') {
    appendPlanningMessage(context, { type: 'planning', action: 'enter' })
    return
  }

  const parsed = parsePlanningPayload(input)
  if (typeof parsed?.plan === 'string' && parsed.plan.trim()) {
    appendPlanningMessage(context, {
      type: 'planning',
      action: 'proposed',
      plan: parsed.plan.trim(),
    })
  }
}

function appendSubagentSystemMessage(
  context: StreamEventProcessorContext,
  text: string,
  {
    toolUseId,
    descriptionHint,
  }: {
    toolUseId?: string
    descriptionHint?: string
  } = {},
) {
  if (!text.trim()) {
    return
  }

  const childMsg: MsgItem = { id: context.nextId(), kind: 'system', text }
  const normalizedHint = normalizeDescription(descriptionHint)
  const normalizedToolUseId = typeof toolUseId === 'string' ? toolUseId.trim() : ''

  context.setMessages((prev) => {
    if (context.state.activeAgentMessageIds.length > 0) {
      const runningAgentIds = new Set(
        prev
          .filter(
            (message) =>
              message.kind === 'tool'
              && message.toolName === 'Agent'
              && message.toolStatus === 'running',
          )
          .map((message) => message.id),
      )
      context.state.activeAgentMessageIds = context.state.activeAgentMessageIds.filter((id) =>
        runningAgentIds.has(id),
      )
    }

    let parentIndex = -1

    if (normalizedToolUseId) {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const message = prev[i]
        if (
          message.kind === 'tool'
          && message.toolName === 'Agent'
          && message.toolId === normalizedToolUseId
        ) {
          parentIndex = i
          break
        }
      }
    }

    if (parentIndex === -1 && normalizedHint) {
      const activeIds = context.state.activeAgentMessageIds
      for (let i = activeIds.length - 1; i >= 0; i -= 1) {
        const idx = prev.findIndex((message) => message.id === activeIds[i])
        if (idx === -1) {
          continue
        }
        const parent = prev[idx]
        if (
          parent.kind === 'tool'
          && parent.toolName === 'Agent'
          && parent.toolStatus === 'running'
          && normalizeDescription(parent.subagentDescription) === normalizedHint
        ) {
          parentIndex = idx
          break
        }
      }
    }

    if (parentIndex === -1) {
      const activeIds = context.state.activeAgentMessageIds
      for (let i = activeIds.length - 1; i >= 0; i -= 1) {
        const idx = prev.findIndex((message) => message.id === activeIds[i])
        if (idx === -1) {
          continue
        }
        const parent = prev[idx]
        if (
          parent.kind === 'tool'
          && parent.toolName === 'Agent'
          && parent.toolStatus === 'running'
        ) {
          parentIndex = idx
          break
        }
      }
    }

    if (parentIndex === -1) {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const message = prev[i]
        if (
          message.kind === 'tool'
          && message.toolName === 'Agent'
          && message.toolStatus === 'running'
        ) {
          parentIndex = i
          break
        }
      }
    }

    if (parentIndex === -1) {
      return (context.capMessages ?? capMessages)([...prev, childMsg])
    }

    const updated = [...prev]
    const parent = updated[parentIndex]
    if (parent.kind !== 'tool') {
      return (context.capMessages ?? capMessages)([...prev, childMsg])
    }
    updated[parentIndex] = {
      ...parent,
      children: [...(parent.children ?? []), childMsg],
    }
    return (context.capMessages ?? capMessages)(updated)
  })
}

export function processStreamEvent(
  context: StreamEventProcessorContext,
  event: StreamEvent,
  isReplay = false,
) {
  if (isTranscriptEnvelope(event)) {
    processTranscriptEnvelope(context, event, isReplay)
    return
  }

  if (event.type === 'agent') {
    const text =
      extractAgentMessageText(event.message)
      ?? extractAgentMessageText(event.text)
      ?? extractAgentMessageText(event)
    if (text) {
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev,
          { id: context.nextId(), kind: 'agent', text },
        ]),
      )
    }
    return
  }

  if (event.type === 'planning') {
    appendPlanningMessage(context, event)
    return
  }

  if (event.type === 'plan_approval') {
    appendPlanApprovalAsk(context, event)
    return
  }

  switch (event.type) {
    case 'assistant': {
      const blocks = event.message?.content
      if (!Array.isArray(blocks)) {
        break
      }

      let pendingAgentText = ''
      let pendingAgentImages: MessageImageAttachment[] = []
      const flushPendingAgentMessage = () => {
        appendAgentMessage(context, pendingAgentText, pendingAgentImages)
        pendingAgentText = ''
        pendingAgentImages = []
      }

      for (const block of blocks) {
        if (block.type === 'text') {
          const text = block.text ?? ''
          if (!text) {
            continue
          }
          pendingAgentText += text
        } else if (block.type === 'thinking') {
          flushPendingAgentMessage()
          const text =
            (typeof block.thinking === 'string' ? block.thinking : undefined)
            ?? (typeof block.text === 'string' ? block.text : '')
          if (block.presentation?.mergeWithActiveThinking) {
            const activeThinkingMessageId =
              context.state.currentBlock?.type === 'thinking'
                ? context.state.currentBlock.msgId
                : undefined
            const hasThinkingText = text.trim().length > 0

            context.setMessages((prev) => {
              let targetIndex = -1
              if (activeThinkingMessageId) {
                targetIndex = prev.findIndex(
                  (message) =>
                    message.kind === 'thinking' && message.id === activeThinkingMessageId,
                )
              }
              if (targetIndex === -1) {
                for (let i = prev.length - 1; i >= 0; i -= 1) {
                  const message = prev[i]
                  if (message.kind === 'thinking' && !message.text.trim()) {
                    targetIndex = i
                    break
                  }
                }
              }

              if (!hasThinkingText) {
                if (targetIndex === -1) {
                  return prev
                }
                const target = prev[targetIndex]
                if (target.kind !== 'thinking' || target.text.trim()) {
                  return prev
                }
                return prev.filter((message) => message.id !== target.id)
              }

              if (targetIndex !== -1) {
                const target = prev[targetIndex]
                if (target.kind === 'thinking') {
                  if (target.text === text) {
                    return prev
                  }
                  const updated = [...prev]
                  updated[targetIndex] = { ...target, text }
                  return updated
                }
              }

              const id = context.nextId()
              return (context.capMessages ?? capMessages)([
                ...prev,
                { id, kind: 'thinking', text },
              ])
            })

            if (context.state.currentBlock?.type === 'thinking') {
              context.state.currentBlock = null
            }
            continue
          }

          if (!text) {
            continue
          }
          const id = context.nextId()
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              { id, kind: 'thinking', text },
            ]),
          )
        } else if (block.type === 'image') {
          const image = normalizeImageBlock(block)
          if (!image) {
            continue
          }
          pendingAgentImages.push(image)
        } else if ((block as { type?: string }).type === 'agent_message') {
          flushPendingAgentMessage()
          const text = extractAgentMessageText(block)
          if (!text) {
            continue
          }
          appendAgentMessage(context, text)
        } else if (block.type === 'tool_use') {
          flushPendingAgentMessage()
          if (typeof block.id === 'string' && isPlanningToolName(block.name)) {
            context.state.planningToolNames[block.id] = block.name
            appendPlanningToolUse(context, block.name, block.input)
            continue
          }

          const id = context.nextId()
          if (block.name === 'AskUserQuestion') {
            const input = block.input as { questions?: AskQuestion[] } | undefined
            context.setMessages((prev) => {
              const existingIdx = prev.findIndex(
                (message) => message.kind === 'ask' && message.toolId === block.id,
              )
              if (existingIdx !== -1) {
                const nextQuestions = input?.questions
                if (!nextQuestions || nextQuestions.length === 0) {
                  return prev
                }
                const existing = prev[existingIdx]
                if ((existing.askQuestions?.length ?? 0) > 0) {
                  return prev
                }
                const updated = [...prev]
                updated[existingIdx] = { ...existing, askQuestions: nextQuestions }
                return updated
              }
              return (context.capMessages ?? capMessages)([
                ...prev,
                {
                  id,
                  kind: 'ask',
                  text: '',
                  toolId: block.id,
                  toolName: block.name,
                  askQuestions: input?.questions ?? [],
                  askAnswered: false,
                },
              ])
            })
          } else {
            const { toolInput, toolFile, oldString, newString } = extractToolDetails(
              block.name,
              block.input,
            )
            const subagentDescription =
              block.name === 'Agent'
                ? extractSubagentDescription(block.input) ?? SUBAGENT_WORKING_LABEL
                : undefined
            context.setMessages((prev) =>
              (context.capMessages ?? capMessages)([
                ...prev,
                {
                  id,
                  kind: 'tool',
                  text: '',
                  toolId: block.id,
                  toolName: block.name,
                  toolStatus: 'running',
                  toolInput,
                  toolFile,
                  oldString,
                  newString,
                  subagentDescription,
                },
              ]),
            )
            if (block.name === 'Agent') {
              pushActiveAgentMessageId(context.state, id)
            }
          }
        }
      }
      flushPendingAgentMessage()
      break
    }

    case 'user': {
      const content = event.message?.content
      const hasActiveAgentTool = context.state.activeAgentMessageIds.length > 0
      const subtype = typeof event.subtype === 'string' ? event.subtype : undefined
      const shouldRenderUserEnvelope = isReplay || subtype === 'queued_message'
      const displayText = readUserDisplayText(event)
      const clientSendId = readUserClientSendId(event)
      if (
        typeof content === 'string'
        && (content.trim() || displayText !== null)
        && shouldRenderUserEnvelope
      ) {
        if (hasActiveAgentTool) {
          break
        }
        appendUserMessageIfDistinct(
          context,
          displayText !== null ? (displayText || '[workspace context]') : content.trim(),
          undefined,
          clientSendId,
        )
        break
      }
      if (!Array.isArray(content)) {
        break
      }

      if (shouldRenderUserEnvelope) {
        const hasToolResult = content.some((block) => block.type === 'tool_result')
        const hasTextOrImage = content.some(
          (block) => block.type === 'text' || block.type === 'image',
        )
        if (!hasToolResult && hasTextOrImage) {
          if (hasActiveAgentTool) {
            break
          }
          let text = displayText !== null ? (displayText || '[image]') : '[image]'
          const images: { mediaType: string; data: string }[] = []
          for (const block of content) {
            if (displayText === null && block.type === 'text' && 'text' in block) {
              text = (block.text as string).trim() || text
            } else if (block.type === 'image' && 'source' in block) {
              const source = block.source as { media_type?: string; data?: string } | undefined
              images.push({ mediaType: source?.media_type ?? '', data: source?.data ?? '' })
            }
          }
          appendUserMessageIfDistinct(context, text, images, clientSendId)
          break
        }
      }

      const toolResults = content.filter((block) => block.type === 'tool_result')
      if (toolResults.length === 0) {
        break
      }
      const toolResultImages = toolResults.flatMap((result) =>
        extractImageAttachments(result.content ?? event.tool_use_result),
      )

      let shouldTriggerWorkspaceRefresh = false
      context.setMessages((prev) => {
        const updated = [...prev]
        for (const result of toolResults) {
          const planningToolName =
            result.tool_use_id ? context.state.planningToolNames[result.tool_use_id] : undefined
          if (planningToolName) {
            if (planningToolName === 'ExitPlanMode') {
              const planningEvent = parsePlanningToolResult(
                result.content ?? event.tool_use_result,
                result.is_error,
              )
              if (planningEvent) {
                updated.push(toPlanningMessage(context.nextId(), planningEvent))
              }
            }
            delete context.state.planningToolNames[result.tool_use_id!]
            continue
          }
          if (result.tool_use_id) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (message.kind === 'ask' && message.toolId === result.tool_use_id) {
                const nextMessage = { ...message, askAnswered: true, askSubmitting: false }
                updated[i] = nextMessage
                if (message.askInteractionKind === 'plan_approval') {
                  const planningEvent = parsePlanningToolResult(
                    result.content ?? event.tool_use_result,
                    result.is_error,
                  )
                  if (planningEvent) {
                    updated.push(toPlanningMessage(context.nextId(), planningEvent))
                  }
                }
                break
              }
            }
          }
          const status = result.is_error ? ('error' as const) : ('success' as const)
          const toolOutput = extractToolResultOutput(result.content)
          let matched = false
          if (result.tool_use_id) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (
                message.kind === 'tool'
                && message.toolStatus === 'running'
                && message.toolId === result.tool_use_id
              ) {
                updated[i] =
                  toolOutput === undefined
                    ? { ...message, toolStatus: status }
                    : { ...message, toolStatus: status, toolOutput }
                if (FILE_MUTATING_TOOLS.has(message.toolName ?? '')) {
                  shouldTriggerWorkspaceRefresh = true
                }
                if (message.toolName === 'Agent') {
                  removeActiveAgentMessageId(context.state, message.id)
                }
                matched = true
                break
              }
            }
          }
          if (!matched) {
            for (let i = updated.length - 1; i >= 0; i -= 1) {
              const message = updated[i]
              if (message.kind === 'tool' && message.toolStatus === 'running') {
                updated[i] =
                  toolOutput === undefined
                    ? { ...message, toolStatus: status }
                    : { ...message, toolStatus: status, toolOutput }
                if (FILE_MUTATING_TOOLS.has(message.toolName ?? '')) {
                  shouldTriggerWorkspaceRefresh = true
                }
                if (message.toolName === 'Agent') {
                  removeActiveAgentMessageId(context.state, message.id)
                }
                break
              }
            }
          }
        }
        return (context.capMessages ?? capMessages)(updated)
      })
      if (shouldTriggerWorkspaceRefresh) {
        context.onWorkspaceMutation?.()
      }
      if (toolResultImages.length > 0) {
        appendAgentMessage(context, '', toolResultImages)
      }
      break
    }

    case 'content_block_start': {
      const block = event.content_block
      if (block.type === 'text') {
        const id = context.nextId()
        context.state.currentBlock = { type: 'text', msgId: id }
        context.setMessages((prev) =>
          (context.capMessages ?? capMessages)([
            ...prev,
            { id, kind: 'agent', text: '' },
          ]),
        )
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      } else if (block.type === 'thinking') {
        const id = context.nextId()
        context.state.currentBlock = { type: 'thinking', msgId: id }
        context.setMessages((prev) =>
          (context.capMessages ?? capMessages)([
            ...prev,
            { id, kind: 'thinking', text: '' },
          ]),
        )
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      } else if (block.type === 'tool_use') {
        if (typeof block.id === 'string' && isPlanningToolName(block.name)) {
          context.state.planningToolNames[block.id] = block.name
          if (block.name === 'EnterPlanMode') {
            context.state.currentBlock = null
            appendPlanningMessage(context, { type: 'planning', action: 'enter' })
          } else {
            context.state.currentBlock = {
              type: 'planning_tool_use',
              msgId: context.nextId(),
              toolName: block.name,
              toolId: block.id,
              inputJsonParts: [],
            }
          }
          if (!isReplay) {
            context.setIsStreaming(true)
          }
          break
        }

        const id = context.nextId()
        context.state.currentBlock = {
          type: 'tool_use',
          msgId: id,
          toolName: block.name,
          toolId: block.id,
          inputJsonParts: [],
        }
        if (block.name !== 'AskUserQuestion') {
          context.setMessages((prev) =>
            (context.capMessages ?? capMessages)([
              ...prev,
              {
                id,
                kind: 'tool',
                text: '',
                toolId: block.id,
                toolName: block.name,
                toolStatus: 'running',
                toolInput: '',
                subagentDescription:
                  block.name === 'Agent' ? SUBAGENT_WORKING_LABEL : undefined,
              },
            ]),
          )
          if (block.name === 'Agent') {
            pushActiveAgentMessageId(context.state, id)
          }
        }
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      } else if (block.type === 'image') {
        const image = normalizeImageBlock(block)
        if (image) {
          appendAgentMessage(context, '', [image])
        }
        context.state.currentBlock = null
        if (!isReplay) {
          context.setIsStreaming(true)
        }
      }
      break
    }

    case 'content_block_delta': {
      const currentBlock = context.state.currentBlock
      if (!currentBlock) {
        break
      }
      const delta = event.delta
      if (delta.type === 'text_delta' && currentBlock.type === 'text') {
        const appendText = delta.text
        context.setMessages((prev) => {
          const last = prev.length - 1
          if (last >= 0 && prev[last].id === currentBlock.msgId) {
            const updated = [...prev]
            updated[last] = { ...prev[last], text: prev[last].text + appendText }
            return updated
          }
          return prev.map((message) =>
            message.id === currentBlock.msgId
              ? { ...message, text: message.text + appendText }
              : message,
          )
        })
      } else if (delta.type === 'thinking_delta' && currentBlock.type === 'thinking') {
        const appendText = delta.thinking
        context.setMessages((prev) => {
          const last = prev.length - 1
          if (last >= 0 && prev[last].id === currentBlock.msgId) {
            const updated = [...prev]
            updated[last] = { ...prev[last], text: prev[last].text + appendText }
            return updated
          }
          return prev.map((message) =>
            message.id === currentBlock.msgId
              ? { ...message, text: message.text + appendText }
              : message,
          )
        })
      } else if (delta.type === 'input_json_delta' && currentBlock.type === 'tool_use') {
        currentBlock.inputJsonParts!.push(delta.partial_json)
      } else if (
        delta.type === 'input_json_delta'
        && currentBlock.type === 'planning_tool_use'
      ) {
        currentBlock.inputJsonParts!.push(delta.partial_json)
      }
      break
    }

    case 'content_block_stop': {
      const currentBlock = context.state.currentBlock
      if (currentBlock?.type === 'text') {
        context.setMessages((prev) => {
          const message = prev.find((entry) => entry.id === currentBlock.msgId)
          if (message && message.kind === 'agent' && !message.text.trim()) {
            return prev.filter((entry) => entry.id !== currentBlock.msgId)
          }
          return prev
        })
      }
      if (currentBlock?.type === 'tool_use') {
        const rawJson = currentBlock.inputJsonParts?.join('') ?? ''
        if (currentBlock.toolName === 'AskUserQuestion') {
          let questions: AskQuestion[] = []
          try {
            const input = JSON.parse(rawJson) as { questions?: AskQuestion[] }
            questions = input.questions ?? []
          } catch {
            // ignore — ask data may already have arrived via envelope event
          }
          context.setMessages((prev) => {
            const existingIdx = prev.findIndex(
              (message) => message.kind === 'ask' && message.toolId === currentBlock.toolId,
            )
            if (existingIdx !== -1) {
              const existing = prev[existingIdx]
              if (questions.length === 0 || (existing.askQuestions?.length ?? 0) > 0) {
                return prev
              }
              const updated = [...prev]
              updated[existingIdx] = { ...existing, askQuestions: questions }
              return updated
            }
            return (context.capMessages ?? capMessages)([
              ...prev,
              {
                id: currentBlock.msgId,
                kind: 'ask',
                text: '',
                toolId: currentBlock.toolId,
                toolName: currentBlock.toolName,
                askQuestions: questions,
                askAnswered: false,
              },
            ])
          })
        } else {
          const { toolInput, toolFile, oldString, newString } = extractToolDetails(
            currentBlock.toolName,
            rawJson,
          )
          const subagentDescription =
            currentBlock.toolName === 'Agent'
              ? extractSubagentDescription(rawJson) ?? SUBAGENT_WORKING_LABEL
              : undefined
          context.setMessages((prev) =>
            prev.map((message) =>
              message.id === currentBlock.msgId
                ? { ...message, toolInput, toolFile, oldString, newString, subagentDescription }
                : message,
            ),
          )
        }
      }
      if (currentBlock?.type === 'planning_tool_use') {
        const rawJson = currentBlock.inputJsonParts?.join('') ?? ''
        appendPlanningToolUse(context, currentBlock.toolName as PlanningToolName, rawJson)
      }
      context.state.currentBlock = null
      break
    }

    case 'message_start': {
      context.setMessages((prev) =>
        prev.map((message) =>
          message.kind === 'tool' && message.toolStatus === 'running'
            ? { ...message, toolStatus: 'success' }
            : message,
        ),
      )
      clearActiveAgentMessageIds(context.state)
      context.state.activeEnvelopeMessages = {}
      context.setIsStreaming(false)
      break
    }

    case 'message_stop': {
      context.setIsStreaming(false)
      break
    }

    case 'result': {
      const resultStatus = event.is_error ? ('error' as const) : ('success' as const)
      const isSubagentResult = !event.duration_ms
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev.map((message) =>
            message.kind === 'tool' && message.toolStatus === 'running'
              ? { ...message, toolStatus: resultStatus }
              : message,
          ),
          ...(isSubagentResult
            ? []
            : [{ id: context.nextId(), kind: 'system' as const, text: 'Awaiting input' }]),
        ]),
      )
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      context.onWorkspaceMutation?.()
      break
    }

    case 'exit': {
      context.setMessages((prev) => {
        const hasRunning = prev.some(
          (message) => message.kind === 'tool' && message.toolStatus === 'running',
        )
        if (!hasRunning) {
          return (context.capMessages ?? capMessages)([
            ...prev,
            { id: context.nextId(), kind: 'system', text: 'Session ended' },
          ])
        }
        return (context.capMessages ?? capMessages)([
          ...prev.map((message) =>
            message.kind === 'tool' && message.toolStatus === 'running'
              ? { ...message, toolStatus: 'error' as const }
              : message,
          ),
          { id: context.nextId(), kind: 'system', text: 'Session ended' },
        ])
      })
      clearActiveAgentMessageIds(context.state)
      context.setIsStreaming(false)
      break
    }

    case 'system': {
      if (!event.text) {
        const subtype = (event as { subtype?: string }).subtype
        const toolUseId = (event as { tool_use_id?: string }).tool_use_id
        if (subtype === 'task_progress') {
          const description = (event as { description?: string }).description
          const tool = (event as { last_tool_name?: string }).last_tool_name
          const parts = [description, tool ? `[${tool}]` : ''].filter(Boolean)
          if (parts.length > 0) {
            appendSubagentSystemMessage(context, parts.join(' '), {
              toolUseId,
              descriptionHint: description,
            })
          }
        }
        if (subtype === 'task_started') {
          const description = (event as { description?: string }).description
          if (description) {
            appendSubagentSystemMessage(context, `Sub-agent: ${description}`, {
              toolUseId,
              descriptionHint: description,
            })
          }
        }
        if (subtype === 'task_notification') {
          const description = (event as { description?: string }).description
          const summary = (event as { summary?: string }).summary
          const status = (event as { status?: string }).status
          const text =
            summary ?? description ?? (typeof status === 'string' ? `Sub-agent ${status}` : undefined)
          if (text) {
            appendSubagentSystemMessage(context, text, {
              toolUseId,
              descriptionHint: summary ?? description,
            })
          }
        }
        break
      }
      context.setMessages((prev) =>
        (context.capMessages ?? capMessages)([
          ...prev,
          { id: context.nextId(), kind: 'system', text: event.text ?? '' },
        ]),
      )
      break
    }

    default:
      break
  }
}
