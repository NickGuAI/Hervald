import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultHeartbeatConfig } from '../heartbeat'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../store'
import type { CommanderRuntimeConfig } from '../runtime-config.shared'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
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
            heartbeat: createDefaultHeartbeatConfig(),
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

  it('uses config-backed default maxTurns when loading legacy sessions without maxTurns', async () => {
    const dir = await createTempDir('hammurabi-commander-config-default-max-turns-')
    const storePath = join(dir, 'sessions.json')
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: 'legacy-config-defaults',
            host: 'legacy-config-defaults-host',
            pid: null,
            state: 'idle',
            created: '2026-03-18T00:00:00.000Z',
            heartbeat: createDefaultHeartbeatConfig(),
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

    const store = new CommanderSessionStore(storePath, { runtimeConfig })
    const [session] = await store.list()

    expect(session?.maxTurns).toBe(18)
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
            heartbeat: createDefaultHeartbeatConfig(),
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

  it('roundtrips commander heartbeat config through save and load', async () => {
    const dir = await createTempDir('hammurabi-commander-heartbeat-roundtrip-')
    const storePath = join(dir, 'sessions.json')
    const heartbeat = {
      intervalMs: 3_600_000,
      messageTemplate: '[HB {{timestamp}}] Keep going.',
      intervalOverridden: true,
    }
    const store = new CommanderSessionStore(storePath)

    await store.create({
      id: 'heartbeat-roundtrip',
      host: 'heartbeat-host',
      state: 'idle',
      created: '2026-05-01T00:00:00.000Z',
      agentType: 'claude',
      maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
      contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
      heartbeat,
      taskSource: null,
    })

    const reloaded = new CommanderSessionStore(storePath)
    const session = await reloaded.get('heartbeat-roundtrip')
    expect(session?.heartbeat).toEqual(heartbeat)

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Array<{ id: string; heartbeat?: unknown }>
    }
    expect(persisted.sessions.find((entry) => entry.id === 'heartbeat-roundtrip')?.heartbeat).toEqual(heartbeat)
  })

  it('loads legacy commander heartbeat lastSentAt and drops it on serialize', async () => {
    const dir = await createTempDir('hammurabi-commander-heartbeat-last-sent-discard-')
    const storePath = join(dir, 'sessions.json')
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: 'heartbeat-legacy-last-sent',
            host: 'heartbeat-legacy-host',
            state: 'idle',
            created: '2026-05-01T00:00:00.000Z',
            agentType: 'claude',
            maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
            contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
            heartbeat: {
              intervalMs: 60_000,
              messageTemplate: '[HB {{timestamp}}] Legacy',
              lastSentAt: '2026-05-01T12:00:00Z',
            },
            taskSource: null,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const store = new CommanderSessionStore(storePath)
    const loaded = await store.get('heartbeat-legacy-last-sent')

    expect(loaded?.heartbeat).toEqual({
      intervalMs: 60_000,
      messageTemplate: '[HB {{timestamp}}] Legacy',
    })

    await store.update('heartbeat-legacy-last-sent', (current) => current)
    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Array<{ id: string; heartbeat?: Record<string, unknown> }>
    }
    const serialized = persisted.sessions.find((entry) => entry.id === 'heartbeat-legacy-last-sent')
    expect(serialized?.heartbeat).toEqual({
      intervalMs: 60_000,
      messageTemplate: '[HB {{timestamp}}] Legacy',
    })
    expect(serialized?.heartbeat).not.toHaveProperty('lastSentAt')
    expect(JSON.stringify(persisted)).not.toContain('lastSentAt')
  })

  it('migrates a missing commander heartbeat from the most recent legacy conversation heartbeat', async () => {
    const dir = await createTempDir('hammurabi-commander-heartbeat-migration-')
    const storePath = join(dir, 'sessions.json')
    const commanderId = '00000000-0000-4000-a000-000000000135'
    const conversationDir = join(dir, commanderId, 'conversations')
    await mkdir(conversationDir, { recursive: true })
    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'legacy-heartbeat-host',
            state: 'idle',
            created: '2026-05-01T00:00:00.000Z',
            maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
            contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
            taskSource: null,
          },
        ],
      }, null, 2),
      'utf8',
    )
    await writeFile(
      join(conversationDir, '11111111-1111-4111-8111-111111111111.json'),
      JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        commanderId,
        surface: 'ui',
        name: 'older',
        status: 'idle',
        currentTask: null,
        lastHeartbeat: null,
        heartbeat: {
          intervalMs: 1_800_000,
          messageTemplate: '[OLDER {{timestamp}}]',
        },
        heartbeatTickCount: 0,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T00:05:00.000Z',
        lastMessageAt: '2026-05-01T00:10:00.000Z',
      }, null, 2),
      'utf8',
    )
    await writeFile(
      join(conversationDir, '22222222-2222-4222-8222-222222222222.json'),
      JSON.stringify({
        id: '22222222-2222-4222-8222-222222222222',
        commanderId,
        surface: 'ui',
        name: 'newer',
        status: 'idle',
        currentTask: null,
        lastHeartbeat: '2026-05-01T00:30:00.000Z',
        heartbeat: {
          intervalMs: 7_200_000,
          messageTemplate: '[NEWER {{timestamp}}]',
          lastSentAt: '2026-05-01T00:35:00.000Z',
        },
        heartbeatTickCount: 2,
        completedTasks: 0,
        totalCostUsd: 0,
        createdAt: '2026-05-01T00:15:00.000Z',
        lastMessageAt: '2026-05-01T00:20:00.000Z',
      }, null, 2),
      'utf8',
    )

    const store = new CommanderSessionStore(storePath)
    const migrated = await store.get(commanderId)

    expect(migrated?.heartbeat).toEqual({
      intervalMs: 7_200_000,
      messageTemplate: '[NEWER {{timestamp}}]',
    })

    const persistedAfterFirstLoad = await readFile(storePath, 'utf8')
    const persisted = JSON.parse(persistedAfterFirstLoad) as {
      sessions: Array<{ id: string; heartbeat?: unknown }>
    }
    expect(persisted.sessions.find((entry) => entry.id === commanderId)?.heartbeat).toEqual(migrated?.heartbeat)

    const reloaded = new CommanderSessionStore(storePath)
    await reloaded.list()
    expect(await readFile(storePath, 'utf8')).toBe(persistedAfterFirstLoad)
  })
})
