import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCodexProviderContext } from '../../modules/agents/providers/provider-session-context'
import { readPersistedSessionsState } from '../../modules/agents/session/persistence'
import type { PersistedStreamSession } from '../../modules/agents/types'
import { createDefaultHeartbeatConfig } from '../../modules/commanders/heartbeat'
import { ConversationStore } from '../../modules/commanders/conversation-store'
import {
  CommanderSessionStore,
  DEFAULT_COMMANDER_CONTEXT_MODE,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../../modules/commanders/store'
import {
  resetActiveRuntimeStateForLaunch,
  shouldStopActiveSessionsOnBoot,
} from '../launch-state-reset'

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

function buildPersistedSession(
  name: string,
  overrides: Partial<PersistedStreamSession> = {},
): PersistedStreamSession {
  return {
    name,
    sessionType: 'commander',
    creator: {
      kind: 'commander',
      id: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
    },
    conversationId: '11111111-1111-4111-8111-111111111111',
    agentType: 'codex',
    model: 'gpt-5',
    mode: 'default',
    cwd: '/tmp/project',
    createdAt: '2026-05-29T00:00:00.000Z',
    providerContext: createCodexProviderContext({
      threadId: `${name}-thread`,
    }),
    queuedMessages: [],
    pendingDirectSendMessages: [],
    ...overrides,
  }
}

async function createConversation(
  store: ConversationStore,
  input: {
    id: string
    commanderId: string
    status: 'active' | 'idle' | 'archived'
    createdAt: string
  },
) {
  return store.create({
    id: input.id,
    commanderId: input.commanderId,
    surface: 'ui',
    agentType: 'codex',
    model: 'gpt-5',
    status: input.status,
    currentTask: null,
    lastHeartbeat: null,
    heartbeatTickCount: 0,
    completedTasks: 0,
    totalCostUsd: 0,
    creationSource: 'ui',
    createdByKind: 'human',
    createdAt: input.createdAt,
    lastMessageAt: input.createdAt,
  })
}

describe('launch state reset', () => {
  it('parses the launch reset opt-in environment value', () => {
    expect(shouldStopActiveSessionsOnBoot('1')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('true')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('on')).toBe(true)
    expect(shouldStopActiveSessionsOnBoot('0')).toBe(false)
    expect(shouldStopActiveSessionsOnBoot(undefined)).toBe(false)
  })

  it('marks stale active persisted runtime state as restartable before module init', async () => {
    const dir = await createTempDir('hammurabi-launch-reset-')
    const sessionStorePath = join(dir, 'agents', 'stream-sessions.json')
    const commanderDataDir = join(dir, 'commander')
    const commanderSessionStorePath = join(commanderDataDir, 'sessions.json')
    const commanderId = 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e'
    const idleCommanderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

    await mkdir(join(dir, 'agents'), { recursive: true })

    const currentQueuedMessage = {
      id: 'current-normal',
      text: 'resume this on manual restart',
      priority: 'normal' as const,
      queuedAt: '2026-05-29T00:01:00.000Z',
    }
    await writeFile(
      sessionStorePath,
      JSON.stringify({
        sessions: [
          buildPersistedSession('active-stream', {
            sessionState: 'active',
            activeTurnId: 'turn-1',
            hadResult: true,
            daemonProcess: {
              processId: 'daemon-process-1',
              mode: 'pipe',
            },
            currentQueuedMessage,
            queuedMessages: [
              {
                id: 'queued-normal',
                text: 'already queued',
                priority: 'normal',
                queuedAt: '2026-05-29T00:02:00.000Z',
              },
            ],
            pendingDirectSendMessages: [
              {
                id: 'queued-high',
                text: 'send first',
                priority: 'high',
                queuedAt: '2026-05-29T00:03:00.000Z',
              },
            ],
          }),
          buildPersistedSession('already-exited', {
            sessionState: 'exited',
            hadResult: true,
          }),
        ],
      }, null, 2),
      'utf8',
    )

    const conversationStore = new ConversationStore(commanderDataDir)
    await createConversation(conversationStore, {
      id: '11111111-1111-4111-8111-111111111111',
      commanderId,
      status: 'active',
      createdAt: '2026-05-29T00:00:00.000Z',
    })
    await createConversation(conversationStore, {
      id: '22222222-2222-4222-8222-222222222222',
      commanderId,
      status: 'idle',
      createdAt: '2026-05-29T00:01:00.000Z',
    })
    await createConversation(conversationStore, {
      id: '33333333-3333-4333-8333-333333333333',
      commanderId,
      status: 'archived',
      createdAt: '2026-05-29T00:02:00.000Z',
    })

    const commanderStore = new CommanderSessionStore(commanderSessionStorePath)
    await commanderStore.create({
      id: commanderId,
      host: 'localhost',
      state: 'running',
      created: '2026-05-29T00:00:00.000Z',
      agentType: 'codex',
      model: 'gpt-5',
      heartbeat: createDefaultHeartbeatConfig(),
      maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
      contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
      taskSource: null,
    })
    await commanderStore.create({
      id: idleCommanderId,
      host: 'localhost',
      state: 'stopped',
      created: '2026-05-29T00:01:00.000Z',
      agentType: 'claude',
      heartbeat: createDefaultHeartbeatConfig(),
      maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
      contextMode: DEFAULT_COMMANDER_CONTEXT_MODE,
      taskSource: null,
    })

    const result = await resetActiveRuntimeStateForLaunch({
      sessionStorePath,
      commanderDataDir,
      commanderSessionStorePath,
    })

    expect(result).toEqual({
      streamSessionsStopped: 1,
      conversationsStopped: 1,
      commanderSessionsStopped: 1,
      errors: [],
    })

    const persistedSessions = await readPersistedSessionsState(sessionStorePath)
    const activeStream = persistedSessions.sessions.find((session) => session.name === 'active-stream')
    const alreadyExited = persistedSessions.sessions.find((session) => session.name === 'already-exited')

    expect(activeStream?.sessionState).toBe('exited')
    expect(activeStream?.hadResult).toBe(false)
    expect(activeStream?.activeTurnId).toBeUndefined()
    expect(activeStream?.daemonProcess).toBeUndefined()
    expect(activeStream?.currentQueuedMessage).toBeUndefined()
    expect(activeStream?.queuedMessages?.map((message) => message.id)).toEqual([
      'current-normal',
      'queued-normal',
    ])
    expect(activeStream?.pendingDirectSendMessages?.map((message) => message.id)).toEqual([
      'queued-high',
    ])
    expect(alreadyExited?.sessionState).toBe('exited')
    expect(alreadyExited?.hadResult).toBe(true)

    const reloadedConversationStore = new ConversationStore(commanderDataDir)
    await expect(reloadedConversationStore.get('11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ status: 'idle' })
    await expect(reloadedConversationStore.get('22222222-2222-4222-8222-222222222222'))
      .resolves.toMatchObject({ status: 'idle' })
    await expect(reloadedConversationStore.get('33333333-3333-4333-8333-333333333333'))
      .resolves.toMatchObject({ status: 'archived' })

    const reloadedCommanderStore = new CommanderSessionStore(commanderSessionStorePath)
    await expect(reloadedCommanderStore.get(commanderId)).resolves.toMatchObject({ state: 'idle' })
    await expect(reloadedCommanderStore.get(idleCommanderId)).resolves.toMatchObject({ state: 'stopped' })

    const rawPersistedSessions = await readFile(sessionStorePath, 'utf8')
    expect(rawPersistedSessions).not.toContain('daemon-process-1')
    expect(rawPersistedSessions).not.toContain('turn-1')
  })

  it('fails fast when a reset store cannot be read', async () => {
    const dir = await createTempDir('hammurabi-launch-reset-failure-')
    const sessionStorePath = join(dir, 'agents')
    const commanderDataDir = join(dir, 'commander')
    const commanderSessionStorePath = join(commanderDataDir, 'sessions.json')
    await mkdir(sessionStorePath, { recursive: true })

    const result = await resetActiveRuntimeStateForLaunch({
      sessionStorePath,
      commanderDataDir,
      commanderSessionStorePath,
    })

    expect(result.streamSessionsStopped).toBe(0)
    expect(result.conversationsStopped).toBe(0)
    expect(result.commanderSessionsStopped).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('stream sessions:')
  })
})
