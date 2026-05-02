import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultHeartbeatState } from '../heartbeat'
import { ConversationStore } from '../conversation-store'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

describe('ConversationStore', () => {
  it('persists create/read/update flows including conversation status transitions', async () => {
    const dir = await createTempDir('hammurabi-conversation-store-')
    const store = new ConversationStore(dir)
    const createdAt = '2026-05-01T00:00:00.000Z'

    const created = await store.create({
      commanderId: '00000000-0000-4000-a000-0000000000aa',
      surface: 'api',
      status: 'idle',
      currentTask: null,
      lastHeartbeat: null,
      heartbeat: createDefaultHeartbeatState(),
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt,
      lastMessageAt: createdAt,
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)

    const activeHeartbeatAt = '2026-05-01T00:15:00.000Z'
    const activated = await store.update(created.id, (current) => ({
      ...current,
      status: 'active',
      currentTask: {
        issueNumber: 1216,
        issueUrl: 'https://github.com/NickGuAI/Hervald/issues/1216',
        startedAt: '2026-05-01T00:05:00.000Z',
      },
      lastHeartbeat: activeHeartbeatAt,
      heartbeat: {
        ...current.heartbeat,
        lastSentAt: activeHeartbeatAt,
      },
      heartbeatTickCount: 3,
      completedTasks: 2,
      totalCostUsd: 1.75,
      lastMessageAt: '2026-05-01T00:20:00.000Z',
    }))

    expect(activated).toEqual(expect.objectContaining({
      id: created.id,
      status: 'active',
      heartbeatTickCount: 3,
      completedTasks: 2,
      totalCostUsd: 1.75,
      lastHeartbeat: activeHeartbeatAt,
      currentTask: {
        issueNumber: 1216,
        issueUrl: 'https://github.com/NickGuAI/Hervald/issues/1216',
        startedAt: '2026-05-01T00:05:00.000Z',
      },
    }))

    const archived = await store.update(created.id, (current) => ({
      ...current,
      status: 'archived',
      currentTask: null,
    }))

    expect(archived?.status).toBe('archived')
    expect(archived?.currentTask).toBeNull()

    const reloaded = new ConversationStore(dir)
    const listed = await reloaded.listByCommander('00000000-0000-4000-a000-0000000000aa')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(expect.objectContaining({
      id: created.id,
      status: 'archived',
      heartbeatTickCount: 3,
      completedTasks: 2,
      totalCostUsd: 1.75,
      lastHeartbeat: activeHeartbeatAt,
    }))
  })

  it('upserts channel-bound conversations by session key without creating duplicates', async () => {
    const dir = await createTempDir('hammurabi-conversation-channel-binding-')
    const store = new ConversationStore(dir)
    const commanderId = '00000000-0000-4000-a000-0000000000bb'
    const sessionKey = 'telegram:default:forum-topic:supergroup-42:thread:7'

    const first = await store.findOrCreateConversationBySessionKey(commanderId, sessionKey, {
      surface: 'telegram',
      channelMeta: {
        provider: 'telegram',
        chatType: 'forum-topic',
        accountId: 'default',
        peerId: 'supergroup-42',
        threadId: '7',
        sessionKey,
        displayName: 'Ops / Releases',
        subject: 'Releases',
      },
      lastRoute: {
        channel: 'telegram',
        to: 'supergroup-42',
        accountId: 'default',
        threadId: '7',
      },
    })

    expect(first.created).toBe(true)
    expect(first.conversation.channelMeta?.sessionKey).toBe(sessionKey)
    expect(first.conversation.lastRoute?.to).toBe('supergroup-42')

    const second = await store.findOrCreateConversationBySessionKey(commanderId, sessionKey, {
      surface: 'telegram',
      channelMeta: {
        provider: 'telegram',
        chatType: 'forum-topic',
        accountId: 'default',
        peerId: 'supergroup-42',
        threadId: '7',
        sessionKey,
        displayName: 'Ops / Releases',
        subject: 'Hotfixes',
      },
      lastRoute: {
        channel: 'telegram',
        to: 'supergroup-42:hotfixes',
        accountId: 'default',
        threadId: '7',
      },
    })

    expect(second.created).toBe(false)
    expect(second.conversation.id).toBe(first.conversation.id)
    expect(second.conversation.channelMeta).toEqual(expect.objectContaining({
      subject: 'Hotfixes',
      sessionKey,
    }))
    expect(second.conversation.lastRoute).toEqual({
      channel: 'telegram',
      to: 'supergroup-42:hotfixes',
      accountId: 'default',
      threadId: '7',
    })

    const reloaded = new ConversationStore(dir)
    const conversations = await reloaded.listByCommander(commanderId)
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.id).toBe(first.conversation.id)
  })
})
