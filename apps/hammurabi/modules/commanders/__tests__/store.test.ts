import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultHeartbeatState } from '../heartbeat'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
  type CommanderSession,
} from '../store'
import type { CommanderRuntimeConfig } from '../runtime-config.shared'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createBaseSession(input: {
  id: string
  host: string
  created: string
}): CommanderSession {
  return {
    id: input.id,
    host: input.host,
    pid: null,
    state: 'idle',
    created: input.created,
    agentType: 'claude',
    maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
    contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
    heartbeat: createDefaultHeartbeatState(),
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    taskSource: null,
    currentTask: null,
    completedTasks: 0,
    totalCostUsd: 0,
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('CommanderSessionStore', () => {
  const runtimeConfig: CommanderRuntimeConfig = {
    defaults: {
      maxTurns: 18,
    },
    limits: {
      maxTurns: 25,
    },
  }

  it('persists and restores sessions with and without channel metadata', async () => {
    const dir = await createTempDir('hammurabi-commander-store-')
    const storePath = join(dir, 'sessions.json')
    const store = new CommanderSessionStore(storePath)

    await store.create(createBaseSession({
      id: 'legacy',
      host: 'legacy-host',
      created: '2026-03-18T00:00:00.000Z',
    }))

    await store.create({
      ...createBaseSession({
        id: 'channel',
        host: 'telegram-group-supergroup-9876543',
        created: '2026-03-18T00:00:01.000Z',
      }),
      channelMeta: {
        provider: 'telegram',
        chatType: 'forum-topic',
        accountId: 'default',
        peerId: 'supergroup-9876543',
        threadId: '42',
        sessionKey: 'telegram:default:forum-topic:supergroup-9876543:thread:42',
        displayName: 'Ops Group / Deploys',
        subject: 'Deploys',
      },
      lastRoute: {
        channel: 'telegram',
        to: 'supergroup-9876543',
        accountId: 'default',
        threadId: '42',
      },
    })

    const reloaded = new CommanderSessionStore(storePath)
    const sessions = await reloaded.list()

    expect(sessions).toHaveLength(2)
    const legacy = sessions.find((session) => session.id === 'legacy')
    expect(legacy?.channelMeta).toBeUndefined()
    expect(legacy?.lastRoute).toBeUndefined()

    const channel = sessions.find((session) => session.id === 'channel')
    expect(channel?.channelMeta).toEqual({
      provider: 'telegram',
      chatType: 'forum-topic',
      accountId: 'default',
      peerId: 'supergroup-9876543',
      threadId: '42',
      sessionKey: 'telegram:default:forum-topic:supergroup-9876543:thread:42',
      displayName: 'Ops Group / Deploys',
      subject: 'Deploys',
    })
    expect(channel?.lastRoute).toEqual({
      channel: 'telegram',
      to: 'supergroup-9876543',
      accountId: 'default',
      threadId: '42',
    })
  })

  it('findOrCreateBySessionKey creates on miss and updates lastRoute on hit', async () => {
    const dir = await createTempDir('hammurabi-commander-upsert-')
    const store = new CommanderSessionStore(join(dir, 'sessions.json'))

    const first = await store.findOrCreateBySessionKey(
      'whatsapp:default:direct:15551234567',
      {
        channelMeta: {
          provider: 'whatsapp',
          chatType: 'direct',
          accountId: 'default',
          peerId: '15551234567',
          sessionKey: 'whatsapp:default:direct:15551234567',
          displayName: '+1 555 123 4567',
        },
        lastRoute: {
          channel: 'whatsapp',
          to: '15551234567',
          accountId: 'default',
        },
        host: 'whatsapp-direct-15551234567',
      },
    )

    expect(first.created).toBe(true)
    expect(first.commander.channelMeta?.sessionKey).toBe('whatsapp:default:direct:15551234567')

    const second = await store.findOrCreateBySessionKey(
      'whatsapp:default:direct:15551234567',
      {
        channelMeta: {
          provider: 'whatsapp',
          chatType: 'direct',
          accountId: 'default',
          peerId: '15551234567',
          sessionKey: 'whatsapp:default:direct:15551234567',
          displayName: '+1 555 123 4567',
        },
        lastRoute: {
          channel: 'whatsapp',
          to: '15550000000',
          accountId: 'default',
        },
      },
    )

    expect(second.created).toBe(false)
    expect(second.commander.id).toBe(first.commander.id)
    expect(second.commander.lastRoute).toEqual({
      channel: 'whatsapp',
      to: '15550000000',
      accountId: 'default',
    })
  })

  it('findOrCreateBySessionKey is safe under concurrent upserts', async () => {
    const dir = await createTempDir('hammurabi-commander-concurrency-')
    const store = new CommanderSessionStore(join(dir, 'sessions.json'))
    const sessionKey = 'telegram:default:group:supergroup-1'

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.findOrCreateBySessionKey(sessionKey, {
          channelMeta: {
            provider: 'telegram',
            chatType: 'group',
            accountId: 'default',
            peerId: 'supergroup-1',
            sessionKey,
            displayName: 'Ops Group',
          },
          lastRoute: {
            channel: 'telegram',
            to: `supergroup-1:${index}`,
            accountId: 'default',
          },
        }),
      ),
    )

    const commanderIds = new Set(results.map((result) => result.commander.id))
    expect(commanderIds.size).toBe(1)

    const sessions = await store.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.channelMeta?.sessionKey).toBe(sessionKey)
    expect(sessions[0]?.lastRoute?.to.startsWith('supergroup-1:')).toBe(true)
  })

  it('defaults maxTurns and contextMode when loading legacy sessions.json entries', async () => {
    const dir = await createTempDir('hammurabi-commander-legacy-defaults-')
    const storePath = join(dir, 'sessions.json')
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: 'legacy-defaults',
            host: 'legacy-defaults-host',
            pid: null,
            state: 'idle',
            created: '2026-03-18T00:00:00.000Z',
            heartbeat: createDefaultHeartbeatState(),
            lastHeartbeat: null,
            heartbeatTickCount: 0,
            taskSource: null,
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )

    const store = new CommanderSessionStore(storePath)
    const [session] = await store.list()

    expect(session?.maxTurns).toBe(DEFAULT_COMMANDER_MAX_TURNS)
    expect(session?.contextMode).toBe(DEFAULT_COMMANDER_CONTEXT_MODE)
  })

  it('uses config-backed default maxTurns when creating channel-scoped commanders', async () => {
    const dir = await createTempDir('hammurabi-commander-config-default-max-turns-')
    const store = new CommanderSessionStore(join(dir, 'sessions.json'), { runtimeConfig })

    const created = await store.findOrCreateBySessionKey(
      'telegram:default:group:supergroup-42',
      {
        channelMeta: {
          provider: 'telegram',
          chatType: 'group',
          accountId: 'default',
          peerId: 'supergroup-42',
          sessionKey: 'telegram:default:group:supergroup-42',
          displayName: 'Ops Group',
        },
        lastRoute: {
          channel: 'telegram',
          to: 'supergroup-42',
          accountId: 'default',
        },
      },
    )

    expect(created.created).toBe(true)
    expect(created.commander.maxTurns).toBe(18)
  })

  it('clamps persisted maxTurns to the configured runtime limit when loading sessions.json', async () => {
    const dir = await createTempDir('hammurabi-commander-config-limit-clamp-')
    const storePath = join(dir, 'sessions.json')
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: 'legacy-clamped',
            host: 'legacy-clamped-host',
            pid: null,
            state: 'idle',
            created: '2026-03-18T00:00:00.000Z',
            heartbeat: createDefaultHeartbeatState(),
            lastHeartbeat: null,
            heartbeatTickCount: 0,
            taskSource: null,
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
            maxTurns: 99,
          },
        ],
      }),
      'utf8',
    )

    const store = new CommanderSessionStore(storePath, { runtimeConfig })
    const [session] = await store.list()

    expect(session?.maxTurns).toBe(25)
  })
})
