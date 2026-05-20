import type {
  ChannelChatType,
  ChannelInboundEvent,
} from '../types.js'
import type { GoogleChatChannelConfig } from './config.js'

export interface GoogleChatNormalizedMessage {
  event: ChannelInboundEvent
  eventType: string
  spaceName: string
  threadName?: string
  senderUserId: string
  senderEmail?: string
  mentionedBot: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key]
  return isObject(value) ? value : undefined
}

function arrayField(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key]
  return Array.isArray(value) ? value : []
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const normalized = typeof source?.[key] === 'string' ? source[key].trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function booleanField(source: Record<string, unknown> | undefined, key: string): boolean {
  return source?.[key] === true
}

export function googleChatEventType(payload: unknown): string {
  return isObject(payload) ? stringField(payload, 'type') ?? 'UNKNOWN' : 'UNKNOWN'
}

function googleChatSpaceName(payload: Record<string, unknown>, message: Record<string, unknown> | undefined): string | undefined {
  return stringField(objectField(payload, 'space'), 'name')
    ?? stringField(objectField(message ?? {}, 'space'), 'name')
}

function googleChatThreadName(payload: Record<string, unknown>, message: Record<string, unknown> | undefined): string | undefined {
  return stringField(objectField(payload, 'thread'), 'name')
    ?? stringField(objectField(message ?? {}, 'thread'), 'name')
    ?? stringField(payload, 'threadKey')
}

function googleChatSpaceType(space: Record<string, unknown> | undefined): string {
  return stringField(space, 'spaceType') ?? stringField(space, 'type') ?? 'SPACE'
}

function chatTypeForSpace(space: Record<string, unknown> | undefined): ChannelChatType {
  const spaceType = googleChatSpaceType(space)
  if (
    booleanField(space, 'singleUserBotDm')
    || spaceType === 'DIRECT_MESSAGE'
    || spaceType === 'DM'
  ) {
    return 'direct'
  }
  if (spaceType === 'GROUP_CHAT') {
    return 'group'
  }
  return 'space'
}

function userIdentifier(user: Record<string, unknown> | undefined): {
  id: string
  displayName?: string
  email?: string
} {
  const email = stringField(user, 'email')?.toLowerCase()
  const id = stringField(user, 'name') ?? email ?? 'unknown'
  return {
    id,
    ...(stringField(user, 'displayName') ? { displayName: stringField(user, 'displayName') } : {}),
    ...(email ? { email } : {}),
  }
}

function messageText(message: Record<string, unknown> | undefined): string {
  return stringField(message, 'argumentText')
    ?? stringField(message, 'text')
    ?? ''
}

function annotationUserMention(annotation: unknown): Record<string, unknown> | undefined {
  if (!isObject(annotation) || stringField(annotation, 'type') !== 'USER_MENTION') {
    return undefined
  }
  const userMention = objectField(annotation, 'userMention')
  if (!userMention || stringField(userMention, 'type') !== 'MENTION') {
    return undefined
  }
  return objectField(userMention, 'user')
}

function mentionedUsers(message: Record<string, unknown> | undefined): string[] {
  if (!message) {
    return []
  }
  return arrayField(message, 'annotations')
    .map((annotation) => annotationUserMention(annotation))
    .filter((user): user is Record<string, unknown> => Boolean(user))
    .map((user) => stringField(user, 'name') ?? stringField(user, 'displayName') ?? '')
    .filter((value) => value.length > 0)
}

export function googleChatMessageMentionsBot(
  payload: unknown,
  config?: Pick<GoogleChatChannelConfig, 'botUserName'>,
): boolean {
  if (!isObject(payload)) {
    return false
  }
  const message = objectField(payload, 'message')
  if (objectField(message ?? {}, 'slashCommand') || objectField(payload, 'appCommandMetadata')) {
    return true
  }
  const botUserName = config?.botUserName?.trim()
  return arrayField(message ?? {}, 'annotations').some((annotation) => {
    const user = annotationUserMention(annotation)
    if (!user) {
      return false
    }
    const name = stringField(user, 'name')
    if (botUserName) {
      return name === botUserName || name === 'users/app'
    }
    return name === 'users/app'
  })
}

export function normalizeGoogleChatMessageEvent(
  payload: unknown,
  input: {
    accountId: string
    config?: Pick<GoogleChatChannelConfig, 'botUserName'>
  },
): GoogleChatNormalizedMessage {
  if (!isObject(payload)) {
    throw new Error('Google Chat interaction event must be a JSON object')
  }
  const eventType = googleChatEventType(payload)
  if (eventType !== 'MESSAGE' && eventType !== 'APP_COMMAND') {
    throw new Error(`Google Chat event "${eventType}" is not a MESSAGE or APP_COMMAND event`)
  }

  const message = objectField(payload, 'message')
  const space = objectField(payload, 'space') ?? objectField(message ?? {}, 'space')
  const user = objectField(payload, 'user') ?? objectField(message ?? {}, 'sender')
  const spaceName = googleChatSpaceName(payload, message)
  if (!spaceName) {
    throw new Error('Google Chat MESSAGE event is missing space.name')
  }
  const sender = userIdentifier(user)
  const chatType = chatTypeForSpace(space)
  const threadName = googleChatThreadName(payload, message)
  const messageName = stringField(message, 'name')
  const mentionedBot = googleChatMessageMentionsBot(payload, input.config)
  const peerId = chatType === 'direct' ? sender.id : spaceName
  const rawSourceId = messageName
    ?? `${eventType}:${spaceName}:${threadName ?? 'root'}:${stringField(payload, 'eventTime') ?? Date.now()}`
  const spaceType = googleChatSpaceType(space)

  const event: ChannelInboundEvent = {
    provider: 'googlechat',
    accountId: input.accountId,
    chatType,
    peerId,
    ...(sender.displayName ? { peerDisplayName: sender.displayName } : {}),
    ...(chatType !== 'direct' ? { groupId: spaceName } : {}),
    ...(threadName ? { threadId: threadName } : {}),
    text: messageText(message),
    metadata: {
      googlechat: {
        eventType,
        spaceName,
        spaceType,
        ...(threadName ? { threadName } : {}),
        senderUserId: sender.id,
        ...(sender.email ? { senderEmail: sender.email } : {}),
        ...(sender.displayName ? { senderDisplayName: sender.displayName } : {}),
        mentionedBot,
        mentions: mentionedUsers(message),
        ...(messageName ? { messageName } : {}),
      },
    },
    rawTimestamp: stringField(payload, 'eventTime')
      ?? stringField(message, 'createTime')
      ?? new Date().toISOString(),
    rawSourceId,
  }

  return {
    event,
    eventType,
    spaceName,
    ...(threadName ? { threadName } : {}),
    senderUserId: sender.id,
    ...(sender.email ? { senderEmail: sender.email } : {}),
    mentionedBot,
  }
}
