import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../migrations/write-json-file-atomically.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../migrations/write-json-file-atomically.js')>()
  return {
    ...actual,
    writeJsonFileAtomically: vi.fn(actual.writeJsonFileAtomically),
  }
})

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeJsonFileAtomically } from '../../../migrations/write-json-file-atomically.js'
import { ConversationStore } from '../conversation-store'
import { buildDefaultCommanderConversationId } from '../store'

const tempDirs: string[] = []
const writeJsonFileAtomicallyMock = vi.mocked(writeJsonFileAtomically)

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function buildHistoricalDefaultConversationId(commanderId: string): string {
  const hash = createHash('sha256')
    .update(`legacy-conversation:${commanderId}`)
    .digest('hex')

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-')
}

afterEach(async () => {
  vi.clearAllMocks()
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
      heartbeatTickCount: 0,
      completedTasks: 0,
      totalCostUsd: 0,
      createdAt,
      lastMessageAt: createdAt,
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(created.name).toMatch(/^[a-z0-9-]+$/)

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

  it('backfills missing legacy conversation names once and persists them', async () => {
    const dir = await createTempDir('hammurabi-conversation-backfill-')
    const commanderId = '00000000-0000-4000-a000-0000000000cc'
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const conversationDir = join(dir, commanderId, 'conversations')
    const conversationPath = join(conversationDir, `${conversationId}.json`)
    await mkdir(conversationDir, { recursive: true })
    await writeFile(
      conversationPath,
      JSON.stringify({
        id: conversationId,
        commanderId,
        surface: 'ui',
        status: 'idle',
        currentTask: null,
        lastHeartbeat: null,
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T01:00:00.000Z',
        lastMessageAt: '2026-05-01T01:00:00.000Z',
      }, null, 2),
      'utf8',
    )

    const store = new ConversationStore(dir)
    const loaded = await store.get(conversationId)
    expect(loaded?.name).toMatch(/^[a-z0-9-]+$/)

    const persistedRaw = await readFile(conversationPath, 'utf8')
    const persisted = JSON.parse(persistedRaw) as { name?: string }
    expect(typeof persisted.name).toBe('string')
    expect(persisted.name).toBe(loaded?.name)

    const reloaded = new ConversationStore(dir)
    const loadedAgain = await reloaded.get(conversationId)
    expect(loadedAgain?.name).toBe(loaded?.name)
  })

  it('renames the historical default conversation file to the canonical default id', async () => {
    const dir = await createTempDir('hammurabi-conversation-default-id-migration-')
    const commanderId = '00000000-0000-4000-a000-0000000000ce'
    const historicalId = buildHistoricalDefaultConversationId(commanderId)
    const canonicalId = buildDefaultCommanderConversationId(commanderId)
    const conversationDir = join(dir, commanderId, 'conversations')
    const historicalPath = join(conversationDir, `${historicalId}.json`)
    const canonicalPath = join(conversationDir, `${canonicalId}.json`)
    await mkdir(conversationDir, { recursive: true })
    await writeFile(
      historicalPath,
      JSON.stringify({
        id: historicalId,
        commanderId,
        surface: 'ui',
        name: 'default',
        status: 'idle',
        currentTask: null,
        lastHeartbeat: null,
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T02:00:00.000Z',
        lastMessageAt: '2026-05-01T02:00:00.000Z',
      }, null, 2),
      'utf8',
    )

    const store = new ConversationStore(dir)
    const loaded = await store.get(canonicalId)
    expect(loaded?.id).toBe(canonicalId)

    const persistedRaw = await readFile(canonicalPath, 'utf8')
    const persisted = JSON.parse(persistedRaw) as { id?: string }
    expect(persisted.id).toBe(canonicalId)
    await expect(readFile(historicalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips providerContext migration rewrites when the stored conversation is already canonical', async () => {
    const dir = await createTempDir('hammurabi-conversation-noop-migration-')
    const commanderId = '00000000-0000-4000-a000-0000000000cf'
    const conversationId = '44444444-4444-4444-8444-444444444444'
    const conversationDir = join(dir, commanderId, 'conversations')
    const conversationPath = join(conversationDir, `${conversationId}.json`)
    await mkdir(conversationDir, { recursive: true })
    await writeFile(
      conversationPath,
      JSON.stringify({
        id: conversationId,
        commanderId,
        surface: 'ui',
        agentType: 'claude',
        name: 'canonical-chat',
        status: 'idle',
        currentTask: null,
        providerContext: {
          providerId: 'claude',
          sessionId: 'claude-session-1',
        },
        lastHeartbeat: null,
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T03:00:00.000Z',
        lastMessageAt: '2026-05-01T03:00:00.000Z',
      }, null, 2),
      'utf8',
    )

    writeJsonFileAtomicallyMock.mockClear()
    const store = new ConversationStore(dir)
    const loaded = await store.get(conversationId)

    expect(loaded?.providerContext).toEqual({
      providerId: 'claude',
      sessionId: 'claude-session-1',
    })
    expect(writeJsonFileAtomicallyMock).not.toHaveBeenCalled()
  })

  it('strips legacy heartbeat config on first rewrite while preserving heartbeat telemetry', async () => {
    const dir = await createTempDir('hammurabi-conversation-strip-heartbeat-')
    const commanderId = '00000000-0000-4000-a000-0000000000dd'
    const conversationId = '44444444-4444-4444-8444-444444444444'
    const conversationDir = join(dir, commanderId, 'conversations')
    const conversationPath = join(conversationDir, `${conversationId}.json`)
    await mkdir(conversationDir, { recursive: true })
    await writeFile(
      conversationPath,
      JSON.stringify({
        id: conversationId,
        commanderId,
        surface: 'ui',
        name: 'legacy-chat',
        status: 'idle',
        currentTask: null,
        lastHeartbeat: '2026-05-01T01:15:00.000Z',
        heartbeat: {
          intervalMs: 3_600_000,
          messageTemplate: '[HB {{timestamp}}] Legacy config',
          lastSentAt: '2026-05-01T01:20:00.000Z',
        },
        heartbeatTickCount: 7,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T01:00:00.000Z',
        lastMessageAt: '2026-05-01T01:20:00.000Z',
      }, null, 2),
      'utf8',
    )

    const store = new ConversationStore(dir)
    const loaded = await store.get(conversationId)
    expect(loaded).toEqual(expect.objectContaining({
      id: conversationId,
      lastHeartbeat: '2026-05-01T01:15:00.000Z',
      heartbeatTickCount: 7,
    }))

    const persisted = JSON.parse(await readFile(conversationPath, 'utf8')) as Record<string, unknown>
    expect(persisted.heartbeat).toBeUndefined()
    expect(persisted.lastHeartbeat).toBe('2026-05-01T01:15:00.000Z')
    expect(persisted.heartbeatTickCount).toBe(7)
    expect(JSON.stringify(persisted)).not.toContain('lastSentAt')

    const reloaded = new ConversationStore(dir)
    const loadedAgain = await reloaded.get(conversationId)
    expect(loadedAgain?.lastHeartbeat).toBe('2026-05-01T01:15:00.000Z')
    expect(loadedAgain?.heartbeatTickCount).toBe(7)
  })
})
