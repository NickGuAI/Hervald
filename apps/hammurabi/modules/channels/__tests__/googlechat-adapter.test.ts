import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../commanders/conversation-store'
import { CommanderSecretsStore } from '../../commanders/secrets-store'
import { CommanderChannelBindingStore } from '../store'
import type { CommanderChannelBinding } from '../types'
import { GoogleChatChannelAdapter } from '../googlechat/adapter'
import { chunkGoogleChatText, type GoogleChatMessageClient } from '../googlechat/api'
import type {
  GoogleChatAccessTokenProvider,
  GoogleChatBearerVerifier,
} from '../googlechat/auth'
import { googleChatCredentialRef } from '../googlechat/config'

const COMMANDER_ID = '00000000-0000-4000-a000-000000000001'
const OTHER_COMMANDER_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = 'chat-main'
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-googlechat-adapter-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createVerifier(): GoogleChatBearerVerifier {
  return {
    verifyBearerToken: vi.fn(async (bearerToken, config) => {
      if (bearerToken !== `token:${config.webhookAudience}`) {
        throw new Error('invalid token')
      }
      return {
        audience: config.webhookAudience,
        email: 'chat@system.gserviceaccount.com',
        payload: {
          aud: config.webhookAudience,
          email: 'chat@system.gserviceaccount.com',
          email_verified: true,
        },
      }
    }),
  }
}

function createFetchRecorder(status = 200): {
  fetchImpl: typeof fetch
  calls: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }>
} {
  const calls: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = []
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {}
    calls.push({ url: String(input), init, body })
    return new Response(JSON.stringify({ accepted: true }), { status })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function createMessageEvent(overrides: {
  type?: string
  spaceType?: string
  singleUserBotDm?: boolean
  annotations?: unknown[]
  text?: string
  argumentText?: string
  user?: Record<string, unknown>
  messageName?: string
} = {}) {
  const spaceType = overrides.spaceType ?? 'SPACE'
  const spaceName = spaceType === 'DIRECT_MESSAGE' ? 'spaces/DM123' : 'spaces/AAA'
  return {
    type: overrides.type ?? 'MESSAGE',
    eventTime: '2026-05-20T15:00:00.000Z',
    user: overrides.user ?? {
      name: 'users/123',
      displayName: 'Nick',
      email: 'nick@example.com',
      type: 'HUMAN',
    },
    space: {
      name: spaceName,
      spaceType,
      ...(overrides.singleUserBotDm ? { singleUserBotDm: true } : {}),
    },
    thread: {
      name: `${spaceName}/threads/thread-1`,
    },
    message: {
      name: overrides.messageName ?? `${spaceName}/messages/message-1`,
      text: overrides.text ?? '@Hammurabi hello',
      argumentText: overrides.argumentText ?? 'hello',
      annotations: overrides.annotations ?? [{
        type: 'USER_MENTION',
        userMention: {
          type: 'MENTION',
          user: {
            name: 'users/app',
            displayName: 'Hammurabi',
            type: 'BOT',
          },
        },
      }],
      thread: {
        name: `${spaceName}/threads/thread-1`,
      },
      space: {
        name: spaceName,
      },
    },
  }
}

async function createAdapter(input: {
  fetchImpl?: typeof fetch
  verifier?: GoogleChatBearerVerifier
  tokenProvider?: GoogleChatAccessTokenProvider
  chatClient?: GoogleChatMessageClient
} = {}) {
  const dataDir = await createTempDir()
  const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
  const secretsStore = new CommanderSecretsStore({
    dataDir,
    keyFilePath: join(dataDir, 'master.key'),
  })
  const adapter = new GoogleChatChannelAdapter({
    bindingStore,
    secretsStore,
    internalToken: 'internal-token',
    dataDir,
    apiBaseUrl: 'http://hammurabi.local',
    fetchImpl: input.fetchImpl ?? createFetchRecorder().fetchImpl,
    bearerVerifier: input.verifier ?? createVerifier(),
    tokenProvider: input.tokenProvider,
    chatClient: input.chatClient,
  })
  return { adapter, bindingStore, secretsStore, dataDir }
}

async function createBinding(
  bindingStore: CommanderChannelBindingStore,
  overrides: Partial<CommanderChannelBinding> = {},
): Promise<CommanderChannelBinding> {
  return bindingStore.create({
    commanderId: overrides.commanderId ?? COMMANDER_ID,
    provider: 'googlechat',
    accountId: overrides.accountId ?? ACCOUNT_ID,
    displayName: overrides.displayName ?? 'Google Chat',
    enabled: overrides.enabled ?? true,
    config: {
      provider: 'googlechat',
      webhookAudience: 'aud-1',
      webhookAudienceType: 'url',
      credentialRef: googleChatCredentialRef(overrides.accountId ?? ACCOUNT_ID),
      credentialConfigured: true,
      dmPolicy: 'allowlist',
      groupPolicy: 'open',
      dmAllowlist: ['nick@example.com'],
      groupAllowlist: [],
      globalAllowlist: [],
      requireMention: true,
      ...(overrides.config ?? {}),
    },
  })
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = '2026-05-20T15:00:00.000Z'
  return {
    id: 'conversation-1',
    commanderId: COMMANDER_ID,
    surface: 'googlechat',
    channelMeta: {
      provider: 'googlechat',
      chatType: 'space',
      accountId: ACCOUNT_ID,
      peerId: 'spaces/AAA',
      groupId: 'spaces/AAA',
      threadId: 'spaces/AAA/threads/thread-1',
      sessionKey: 'googlechat:chat-main:space:spaces/AAA:thread:spaces/AAA/threads/thread-1',
      displayName: 'Nick',
      space: 'spaces/AAA',
    },
    lastRoute: {
      channel: 'googlechat',
      to: 'spaces/AAA',
      accountId: ACCOUNT_ID,
      threadId: 'spaces/AAA/threads/thread-1',
    },
    name: 'Google Chat space',
    status: 'active',
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    creationSource: 'channel',
    createdByKind: 'channel',
    createdAt: now,
    lastMessageAt: now,
    ...overrides,
  }
}

describe('GoogleChatChannelAdapter', () => {
  it('verifies a MESSAGE webhook and forwards a normalized channel payload', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)

    const result = await adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent(),
    })

    expect(result).toEqual({ status: 200, body: { accepted: true, delivered: true } })
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.url).toBe('http://hammurabi.local/api/commanders/channel-message')
    expect(recorder.calls[0]?.init?.headers).toMatchObject({
      'x-hammurabi-internal-token': 'internal-token',
    })
    expect(recorder.calls[0]?.body).toMatchObject({
      provider: 'googlechat',
      accountId: ACCOUNT_ID,
      chatType: 'space',
      peerId: 'spaces/AAA',
      groupId: 'spaces/AAA',
      threadId: 'spaces/AAA/threads/thread-1',
      space: 'spaces/AAA',
      commanderId: COMMANDER_ID,
      message: 'hello',
      rawSourceId: 'spaces/AAA/messages/message-1',
      metadata: {
        googlechat: {
          mentionedBot: true,
          senderEmail: 'nick@example.com',
          senderUserId: 'users/123',
        },
      },
    })
  })

  it('uses the Google Chat user resource as DM peer id while preserving email allowlists', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore, {
      config: {
        dmPolicy: 'allowlist',
        dmAllowlist: ['users/123'],
      },
    })

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent({
        spaceType: 'DIRECT_MESSAGE',
        singleUserBotDm: true,
        user: {
          name: 'users/123',
          displayName: 'Nick',
          email: 'nick@example.com',
          type: 'HUMAN',
        },
      }),
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })

    expect(recorder.calls[0]?.body).toMatchObject({
      chatType: 'direct',
      peerId: 'users/123',
      metadata: {
        googlechat: {
          senderUserId: 'users/123',
          senderEmail: 'nick@example.com',
        },
      },
    })

    const emailRecorder = createFetchRecorder()
    const { adapter: emailAdapter, bindingStore: emailStore } = await createAdapter({ fetchImpl: emailRecorder.fetchImpl })
    await createBinding(emailStore, {
      config: {
        dmPolicy: 'allowlist',
        dmAllowlist: ['nick@example.com'],
      },
    })

    await expect(emailAdapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent({
        spaceType: 'DIRECT_MESSAGE',
        singleUserBotDm: true,
        messageName: 'spaces/DM123/messages/message-2',
        user: {
          name: 'users/123',
          displayName: 'Nick',
          email: 'nick@example.com',
          type: 'HUMAN',
        },
      }),
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })
    expect(emailRecorder.calls[0]?.body).toMatchObject({
      peerId: 'users/123',
    })
  })

  it('rejects invalid or missing Google Chat bearer tokens before ingest', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)

    await expect(adapter.handleInteractionEvent({
      body: createMessageEvent(),
    })).resolves.toMatchObject({ status: 401 })
    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer wrong',
      body: createMessageEvent(),
    })).resolves.toMatchObject({ status: 401 })
    expect(recorder.calls).toHaveLength(0)
  })

  it('acknowledges ADDED_TO_SPACE and unsupported events without forwarding', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: { type: 'ADDED_TO_SPACE' },
    })).resolves.toMatchObject({ status: 200, body: { text: expect.any(String) } })
    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: { type: 'CARD_CLICKED' },
    })).resolves.toEqual({ status: 200, body: { accepted: true, ignored: true, eventType: 'CARD_CLICKED' } })
    expect(recorder.calls).toHaveLength(0)
  })

  it('only treats users/app or the configured bot user as a mention', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore, {
      config: {
        groupPolicy: 'open',
        requireMention: true,
      },
    })

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent({
        annotations: [{
          type: 'USER_MENTION',
          userMention: {
            type: 'MENTION',
            user: {
              name: 'users/other-bot',
              displayName: 'Other Bot',
              type: 'BOT',
            },
          },
        }],
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: { dropped: true, reason: 'mention-required' },
    })

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent({ messageName: 'spaces/AAA/messages/message-2' }),
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })
    expect(recorder.calls).toHaveLength(1)
  })

  it('forwards Google Chat APP_COMMAND events through the same inbound path', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)
    const body = {
      ...createMessageEvent({
        type: 'APP_COMMAND',
        messageName: 'spaces/AAA/messages/command-1',
        annotations: [],
        text: '/daily',
        argumentText: 'daily',
      }),
      appCommandMetadata: {
        appCommandId: 'daily',
        appCommandType: 'SLASH_COMMAND',
      },
    }

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body,
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })

    expect(recorder.calls[0]?.body).toMatchObject({
      message: 'daily',
      rawSourceId: 'spaces/AAA/messages/command-1',
      metadata: {
        googlechat: {
          eventType: 'APP_COMMAND',
          mentionedBot: true,
        },
      },
    })
  })

  it('drops unauthorized DMs, disabled spaces, and missing mentions without forwarding', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore, {
      config: {
        dmPolicy: 'allowlist',
        dmAllowlist: ['allowed@example.com'],
        groupPolicy: 'disabled',
        requireMention: true,
      },
    })

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent({
        spaceType: 'DIRECT_MESSAGE',
        singleUserBotDm: true,
        user: { name: 'users/blocked', email: 'blocked@example.com', displayName: 'Blocked' },
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: { dropped: true, reason: 'allowlist-deny' },
    })
    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent(),
    })).resolves.toMatchObject({
      status: 200,
      body: { dropped: true, reason: 'group-disabled' },
    })

    const { adapter: mentionAdapter, bindingStore: mentionStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(mentionStore, {
      accountId: 'chat-mention',
      config: {
        webhookAudience: 'aud-mention',
        groupPolicy: 'open',
        requireMention: true,
      },
    })
    await expect(mentionAdapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-mention',
      body: createMessageEvent({ annotations: [] }),
    })).resolves.toMatchObject({
      status: 200,
      body: { dropped: true, reason: 'mention-required' },
    })
    expect(recorder.calls).toHaveLength(0)
  })

  it('rejects ambiguous enabled account bindings instead of silently choosing a commander', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)
    await createBinding(bindingStore, { commanderId: OTHER_COMMANDER_ID })

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body: createMessageEvent(),
    })).resolves.toMatchObject({ status: 409 })
    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      commanderId: OTHER_COMMANDER_ID,
      body: createMessageEvent({ messageName: 'spaces/AAA/messages/message-2' }),
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.body).toMatchObject({ commanderId: OTHER_COMMANDER_ID })
  })

  it('deduplicates retry webhooks by stable Google Chat message id', async () => {
    const recorder = createFetchRecorder()
    const { adapter, bindingStore } = await createAdapter({ fetchImpl: recorder.fetchImpl })
    await createBinding(bindingStore)
    const body = createMessageEvent()

    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body,
    })).resolves.toMatchObject({ status: 200, body: { delivered: true } })
    await expect(adapter.handleInteractionEvent({
      authorization: 'Bearer token:aud-1',
      body,
    })).resolves.toEqual({ status: 200, body: { accepted: true, delivered: false, duplicate: true } })
    expect(recorder.calls).toHaveLength(1)
  })

  it('sends outbound replies through spaces.messages.create with service-account auth', async () => {
    const dataDir = await createTempDir()
    const bindingStore = new CommanderChannelBindingStore(join(dataDir, 'channels.json'))
    const secretsStore = new CommanderSecretsStore({
      dataDir,
      keyFilePath: join(dataDir, 'master.key'),
    })
    const credentialRef = googleChatCredentialRef(ACCOUNT_ID)
    await secretsStore.setSecret(COMMANDER_ID, credentialRef, JSON.stringify({
      client_email: 'bot@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
    }))
    await createBinding(bindingStore, {
      config: {
        credentialRef,
        credentialConfigured: true,
      },
    })
    const tokenProvider: GoogleChatAccessTokenProvider = {
      getAccessToken: vi.fn(async () => 'access-token'),
    }
    const createMessage = vi.fn(async () => ({ name: 'spaces/AAA/messages/reply-1' }))
    const chatClient: GoogleChatMessageClient = { createMessage }
    const adapter = new GoogleChatChannelAdapter({
      bindingStore,
      secretsStore,
      internalToken: 'internal-token',
      dataDir,
      tokenProvider,
      chatClient,
      bearerVerifier: createVerifier(),
    })

    await expect(adapter.send(
      { provider: 'googlechat', accountId: ACCOUNT_ID, commanderId: COMMANDER_ID },
      createConversation(),
      { text: 'reply text' },
    )).resolves.toMatchObject({ success: true })
    await expect(adapter.send(
      { provider: 'googlechat', accountId: ACCOUNT_ID, commanderId: COMMANDER_ID },
      createConversation(),
      { text: 'second reply' },
    )).resolves.toMatchObject({ success: true })

    expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(expect.objectContaining({
      client_email: 'bot@example.iam.gserviceaccount.com',
    }))
    expect(createMessage).toHaveBeenNthCalledWith(1, {
      accessToken: 'access-token',
      spaceName: 'spaces/AAA',
      threadName: 'spaces/AAA/threads/thread-1',
      text: 'reply text',
      requestId: expect.stringMatching(/^client-conversation-1-[a-z0-9]{12}-0$/u),
    })
    expect(createMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: 'second reply',
      requestId: expect.stringMatching(/^client-conversation-1-[a-z0-9]{12}-0$/u),
    }))
    expect(createMessage.mock.calls[1]?.[0]?.requestId).not.toBe(createMessage.mock.calls[0]?.[0]?.requestId)
  })

  it('chunks text on UTF-8 byte boundaries for Google Chat message limits', () => {
    expect(chunkGoogleChatText('abcdef', 3)).toEqual(['abc', 'def'])
    expect(chunkGoogleChatText('你你你', 6)).toEqual(['你你', '你'])
  })
})
