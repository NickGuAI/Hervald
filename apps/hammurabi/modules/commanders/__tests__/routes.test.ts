import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { CommanderEmailConfigStore } from '../email-config'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'
import type { CommanderSessionsInterface } from '../../agents/routes'
import { CommandRoomExecutor } from '../../command-room/executor'
import { CommandRoomRunStore } from '../../command-room/run-store'
import { CommandRoomScheduler, type CronScheduler } from '../../command-room/scheduler'
import { CommandRoomTaskStore } from '../../command-room/task-store'
import { CommanderSessionStore, DEFAULT_COMMANDER_MAX_TURNS } from '../store'
import { toCommanderSessionName } from '../routes/context'
import { HeartbeatLog } from '../heartbeat-log'
import { QuestStore } from '../quest-store'
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_MESSAGE,
} from '../heartbeat'
import type { CommanderEmailClient, CommanderInboundEmail } from '../email-poller'
import type { ClaudeEffortLevel } from '../../claude-effort'
import { COMMANDER_WIZARD_START_MESSAGE } from '../templates/wizard-prompt'

vi.setConfig({ testTimeout: 60_000 })

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

interface MockSessionEntry {
  name: string
  systemPrompt: string
  agentType: 'claude' | 'codex' | 'gemini'
  effort?: ClaudeEffortLevel
  cwd?: string
  resumeSessionId?: string
  maxTurns?: number
}

interface MockSessionsInterface {
  interface: CommanderSessionsInterface
  createCalls: MockSessionEntry[]
  sendCalls: Array<{
    name: string
    text: string
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }>
  activeSessions: Set<string>
  triggerEvent: (sessionName: string, event: unknown) => void
  setUsage: (usage: {
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
  }) => void
}

class StubEmailClient implements CommanderEmailClient {
  readonly getCalls: Array<{ account: string; messageId: string }> = []
  readonly replyCalls: Array<{
    account: string
    messageId: string
    threadId?: string
    to: string
    subject: string
    body: string
    from?: string
  }> = []
  private readonly message: CommanderInboundEmail

  constructor(message: CommanderInboundEmail) {
    this.message = message
  }

  async searchMessages(): Promise<Array<{ id: string }>> {
    return []
  }

  async getMessage(account: string, messageId: string): Promise<CommanderInboundEmail> {
    this.getCalls.push({ account, messageId })
    return {
      ...this.message,
      gmailMessageId: messageId,
    }
  }

  async sendReply(input: {
    account: string
    messageId: string
    threadId?: string
    to: string
    subject: string
    body: string
    from?: string
  }): Promise<void> {
    this.replyCalls.push(input)
  }
}

interface MockCronJob {
  stop: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  getNextRun: ReturnType<typeof vi.fn>
}

interface ScheduledRegistration {
  expression: string
  task: () => Promise<void> | void
  options?: { name?: string; timezone?: string }
  job: MockCronJob
}

const tempDirs: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return { ok: true as const, record }
    },
  }
}

function createMockSessionsInterface(opts: {
  /** Cost that getSession() reports for each active session's usage.costUsd */
  sessionCostUsd?: number
  /** input token count that getSession() reports */
  sessionInputTokens?: number
  /** output token count that getSession() reports */
  sessionOutputTokens?: number
  /** claudeSessionId that getSession() reports for each active session */
  sessionClaudeSessionId?: string
  /** codexThreadId that getSession() reports for each active session */
  sessionCodexThreadId?: string
  /** sessions that should be treated as already active (e.g. reconciled after restart) */
  initialActiveSessions?: string[]
  /** ordered send results returned by sendToSession before falling back to session presence */
  sendResults?: boolean[]
} = {}): MockSessionsInterface {
  const createCalls: MockSessionEntry[] = []
  const sendCalls: Array<{
    name: string
    text: string
    options?: {
      queue?: boolean
      priority?: 'high' | 'normal' | 'low'
    }
  }> = []
  const activeSessions = new Set<string>(opts.initialActiveSessions ?? [])
  const agentTypeBySessionName = new Map<string, 'claude' | 'codex' | 'gemini'>(
    (opts.initialActiveSessions ?? []).map((sessionName) => [sessionName, 'claude']),
  )
  const eventHandlers = new Map<string, Set<(event: unknown) => void>>()
  const sendResults = [...(opts.sendResults ?? [])]
  const usage = {
    inputTokens: opts.sessionInputTokens ?? 0,
    outputTokens: opts.sessionOutputTokens ?? 0,
    costUsd: opts.sessionCostUsd ?? 0,
  }

  const mock: CommanderSessionsInterface = {
    async createCommanderSession(params) {
      const agentType = params.agentType ?? 'claude'
      createCalls.push({
        ...params,
        agentType,
      })
      activeSessions.add(params.name)
      agentTypeBySessionName.set(params.name, agentType)
      // Return a minimal fake StreamSession (interface uses opaque return type)
      return { kind: 'stream', name: params.name } as unknown as Awaited<ReturnType<
        CommanderSessionsInterface['createCommanderSession']
      >>
    },
    async dispatchWorkerForCommander() {
      // Tests in this file do not exercise the worker dispatch path; the
      // dedicated suite for `POST /:id/workers` lives in
      // `register-workers.test.ts` with its own mock implementation.
      return {
        status: 501,
        body: { error: 'dispatchWorkerForCommander is not stubbed for this test fixture' },
      }
    },
    async sendToSession(name, text, options) {
      sendCalls.push(options ? { name, text, options } : { name, text })
      if (sendResults.length > 0) {
        return sendResults.shift() ?? false
      }
      return activeSessions.has(name)
    },
    deleteSession(name) {
      activeSessions.delete(name)
      agentTypeBySessionName.delete(name)
    },
    getSession(name) {
      if (!activeSessions.has(name)) return undefined
      const agentType = agentTypeBySessionName.get(name) ?? 'claude'
      return {
        kind: 'stream',
        name,
        agentType,
        claudeSessionId: agentType === 'claude' ? opts.sessionClaudeSessionId : undefined,
        codexThreadId: agentType === 'codex' ? opts.sessionCodexThreadId : undefined,
        usage: { ...usage },
      } as unknown as ReturnType<CommanderSessionsInterface['getSession']>
    },
    subscribeToEvents(name, handler) {
      if (!eventHandlers.has(name)) eventHandlers.set(name, new Set())
      eventHandlers.get(name)!.add(handler as (event: unknown) => void)
      return () => {
        eventHandlers.get(name)?.delete(handler as (event: unknown) => void)
      }
    },
  }

  return {
    interface: mock,
    createCalls,
    sendCalls,
    activeSessions,
    triggerEvent(sessionName, event) {
      for (const handler of eventHandlers.get(sessionName) ?? []) {
        handler(event)
      }
    },
    setUsage(nextUsage) {
      if (typeof nextUsage.inputTokens === 'number' && Number.isFinite(nextUsage.inputTokens)) {
        usage.inputTokens = nextUsage.inputTokens
      }
      if (typeof nextUsage.outputTokens === 'number' && Number.isFinite(nextUsage.outputTokens)) {
        usage.outputTokens = nextUsage.outputTokens
      }
      if (typeof nextUsage.costUsd === 'number' && Number.isFinite(nextUsage.costUsd)) {
        usage.costUsd = nextUsage.costUsd
      }
    },
  }
}

function createMockCronScheduler(nextRuns: Date[]): {
  scheduler: CronScheduler
  scheduled: ScheduledRegistration[]
} {
  const scheduled: ScheduledRegistration[] = []
  const scheduler: CronScheduler = {
    validate: vi.fn((expression: string) => expression !== 'invalid cron'),
    schedule: vi.fn((expression, task, options) => {
      const nextRun = nextRuns.shift() ?? null
      const job: MockCronJob = {
        stop: vi.fn(),
        destroy: vi.fn(),
        getNextRun: vi.fn(() => nextRun),
      }
      scheduled.push({ expression, task, options, job })
      return job
    }),
  }
  return { scheduler, scheduled }
}

async function startServer(
  options: Partial<CommandersRouterOptions> = {},
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-commanders-session-store-'), 'sessions.json')
  const memoryBasePath = options.memoryBasePath
    ?? join(dirname(sessionStorePath), 'memory')

  const app = express()
  app.use(express.json())

  const commanders = createCommandersRouter({
    apiKeyStore: createTestApiKeyStore(),
    ...options,
    sessionStorePath,
    memoryBasePath,
  })
  app.use('/api/commanders', commanders.router)

  const httpServer = createServer(app)

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    httpServer,
    close: async () => {
      commanders.dispose()
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

afterEach(async () => {
  vi.clearAllMocks()
  // Small drain to allow any in-flight async heartbeat log writes to complete
  // before deleting temp directories, preventing ENOTEMPTY race conditions.
  await sleep(150)
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  )
})

describe('commanders routes', () => {
  it('lists sessions from persisted JSON store', async () => {
    const dir = await createTempDir('hammurabi-commanders-store-')
    const storePath = join(dir, 'sessions.json')
    await writeFile(
      storePath,
      JSON.stringify(
        {
          sessions: [
            {
              id: '00000000-0000-4000-a000-000000000002',
              host: 'host-a',
              pid: null,
              state: 'idle',
              created: '2026-02-20T00:00:00.000Z',
              lastHeartbeat: null,
              taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
              currentTask: null,
              completedTasks: 0,
              totalCostUsd: 0,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const server = await startServer({ sessionStorePath: storePath })
    try {
      const response = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([
        expect.objectContaining({
          id: '00000000-0000-4000-a000-000000000002',
          host: 'host-a',
          state: 'idle',
        }),
      ])
    } finally {
      await server.close()
    }
  })

  it('includes quest and schedule counts in commander responses', async () => {
    const dir = await createTempDir('hammurabi-commanders-panel-counts-')
    const storePath = join(dir, 'sessions.json')
    const questStore = new QuestStore(dir)
    const commandRoomTaskStore = new CommandRoomTaskStore(join(dir, 'command-room-tasks.json'))
    await writeFile(
      storePath,
      JSON.stringify(
        {
          sessions: [
            {
              id: '00000000-0000-4000-a000-000000000002',
              host: 'host-a',
              pid: null,
              state: 'idle',
              created: '2026-02-20T00:00:00.000Z',
              lastHeartbeat: null,
              taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
              currentTask: null,
              completedTasks: 0,
              totalCostUsd: 0,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    await questStore.create({
      commanderId: '00000000-0000-4000-a000-000000000002',
      status: 'pending',
      source: 'manual',
      instruction: 'Investigate quests panel mismatch',
      contract: {
        cwd: '/home/builder/App',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })
    await questStore.create({
      commanderId: '00000000-0000-4000-a000-000000000002',
      status: 'done',
      source: 'manual',
      instruction: 'Audit schedule rendering',
      contract: {
        cwd: '/home/builder/App',
        permissionMode: 'default',
        agentType: 'claude',
        skillsToUse: [],
      },
    })
    await commandRoomTaskStore.createTask({
      name: '00000000-0000-4000-a000-000000000002-daily-review',
      schedule: '0 * * * *',
      machine: 'local',
      workDir: '/home/builder/App',
      agentType: 'claude',
      instruction: 'Run commander review',
      enabled: true,
      commanderId: '00000000-0000-4000-a000-000000000002',
    })
    const server = await startServer({
      sessionStorePath: storePath,
      questStore,
      commandRoomTaskStore,
    })
    try {
      const response = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([
        expect.objectContaining({
          id: '00000000-0000-4000-a000-000000000002',
          questCount: 2,
          scheduleCount: 1,
        }),
      ])
    } finally {
      await server.close()
    }
  })

  it('creates idle commander and rejects duplicate host', async () => {
    const dir = await createTempDir('hammurabi-commanders-create-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      const first = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-1',
          taskSource: {
            owner: 'NickGuAI',
            repo: 'monorepo-g',
            label: 'commander',
          },
        }),
      })

      expect(first.status).toBe(201)
      const created = (await first.json()) as {
        state: string
        host: string
        id: string
        heartbeat: {
          intervalMs: number
          messageTemplate: string
          lastSentAt: string | null
        }
        lastHeartbeat: string | null
      }
      expect(created.state).toBe('idle')
      expect(created.host).toBe('worker-1')
      expect(created.id).toBeTruthy()
      expect(created.heartbeat).toEqual({
        intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
        messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
        lastSentAt: null,
      })
      expect(created.lastHeartbeat).toBeNull()

      const second = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-1',
          taskSource: {
            owner: 'NickGuAI',
            repo: 'monorepo-g',
            label: 'commander',
          },
        }),
      })

      expect(second.status).toBe(409)

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { sessions: unknown[] }
      expect(persisted.sessions).toHaveLength(1)

      const names = JSON.parse(await readFile(join(dir, 'names.json'), 'utf8')) as Record<string, string>
      expect(names[created.id]).toBe('worker-1')

      const template = await readFile(join(memoryBasePath, 'COMMANDER.template.md'), 'utf8')
      expect(template).toContain('[COMMANDER_ID]')
      expect(template).toContain('## Memory')

      const workflow = await readFile(join(memoryBasePath, created.id, 'COMMANDER.md'), 'utf8')
      expect(workflow).not.toContain(`hammurabi memory find --commander ${created.id}`)
      expect(workflow).toContain(`hammurabi memory save --commander ${created.id}`)
      expect(workflow).toContain('.memory/MEMORY.md')
    } finally {
      await server.close()
    }
  })

  it('starts wizard sessions with local API target and inherited auth headers', async () => {
    const dir = await createTempDir('hammurabi-commanders-wizard-start-')
    const storePath = join(dir, 'sessions.json')
    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const response = await fetch(`${server.baseUrl}/api/commanders/wizard/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentType: 'claude',
          effort: 'low',
          apiBaseUrl: 'https://evil.example.com',
        }),
      })

      expect(response.status).toBe(201)
      const started = (await response.json()) as {
        sessionName: string
        created: boolean
      }
      expect(started.created).toBe(true)
      expect(started.sessionName).toMatch(/^commander-wizard-/)

      expect(mock.createCalls).toHaveLength(1)
      const createCall = mock.createCalls[0]!
      expect(createCall.name).toBe(started.sessionName)
      expect(createCall.maxTurns).toBe(DEFAULT_COMMANDER_MAX_TURNS)
      expect(createCall.systemPrompt).toContain('agent-skills/gehirn-skills/commander-create-wizard/SKILL.md')
      expect(createCall.systemPrompt).toContain('x-hammurabi-api-key: test-key')
      expect(createCall.systemPrompt).toContain('http://127.0.0.1:')
      expect(createCall.systemPrompt).toContain('/api/commanders')
      expect(createCall.systemPrompt).not.toContain('evil.example.com')

      expect(mock.sendCalls).toEqual([
        {
          name: started.sessionName,
          text: COMMANDER_WIZARD_START_MESSAGE,
        },
      ])
    } finally {
      await server.close()
    }
  })

  it('loads config-backed maxTurns defaults and limits for create and remote registration', async () => {
    const dir = await createTempDir('hammurabi-commanders-runtime-config-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    await writeFile(
      join(dir, 'config.yaml'),
      [
        'commanders:',
        '  runtime:',
        '    defaults:',
        '      maxTurns: 18',
        '    limits:',
        '      maxTurns: 25',
      ].join('\n'),
      'utf8',
    )

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      runtimeConfigPath: join(dir, 'config.yaml'),
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-config-defaults',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; maxTurns: number }
      expect(created.maxTurns).toBe(18)

      const invalidResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-config-too-many-turns',
          maxTurns: 26,
        }),
      })
      expect(invalidResponse.status).toBe(400)
      expect(await invalidResponse.json()).toEqual({
        error: 'maxTurns must be an integer between 1 and 25',
      })

      const remoteResponse = await fetch(`${server.baseUrl}/api/commanders/remote/register`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          machineId: 'mac-mini',
          label: 'remote-config-defaults',
        }),
      })
      expect(remoteResponse.status).toBe(201)
      const remote = (await remoteResponse.json()) as { commanderId: string }

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        sessions: Array<Record<string, unknown>>
      }
      const remoteSession = persisted.sessions.find((entry) => entry.id === remote.commanderId)
      expect(remoteSession?.maxTurns).toBe(18)
    } finally {
      await server.close()
    }
  })

  it('loads canonical root config when session store uses commander/sessions.json path', async () => {
    const dir = await createTempDir('hammurabi-commanders-runtime-config-root-')
    const previousDataDir = process.env.HAMMURABI_DATA_DIR
    process.env.HAMMURABI_DATA_DIR = dir

    const commanderDataDir = join(dir, 'commander')
    const storePath = join(commanderDataDir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    await mkdir(commanderDataDir, { recursive: true })
    await writeFile(
      join(dir, 'config.yaml'),
      [
        'commanders:',
        '  runtime:',
        '    defaults:',
        '      maxTurns: 19',
        '    limits:',
        '      maxTurns: 27',
      ].join('\n'),
      'utf8',
    )

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-root-config-defaults',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { maxTurns: number }
      expect(created.maxTurns).toBe(19)
    } finally {
      await server.close()
      if (previousDataDir === undefined) {
        delete process.env.HAMMURABI_DATA_DIR
      } else {
        process.env.HAMMURABI_DATA_DIR = previousDataDir
      }
    }
  })

  it('starts commanders with config-backed turn defaults and scoped quest commands', async () => {
    const dir = await createTempDir('hammurabi-commanders-config-backed-start-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()
    await writeFile(
      join(dir, 'config.yaml'),
      [
        'commanders:',
        '  runtime:',
        '    defaults:',
        '      maxTurns: 14',
        '    limits:',
        '      maxTurns: 40',
      ].join('\n'),
      'utf8',
    )

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      runtimeConfigPath: join(dir, 'config.yaml'),
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-config-backed-start',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
      })

      const createCall = mock.createCalls[0]!
      expect(createCall.maxTurns).toBe(14)
      expect(createCall.systemPrompt).toContain(
        `hammurabi quests list --commander ${created.id}`,
      )
      expect(createCall.systemPrompt).not.toContain('\nhammurabi quests list\n')
    } finally {
      await server.close()
    }
  })

  it('surfaces max-turn termination as explicit runtime state in commander detail', async () => {
    const dir = await createTempDir('hammurabi-commanders-max-turn-runtime-state-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-max-turn-state',
          maxTurns: 9,
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
      })

      mock.triggerEvent(toCommanderSessionName(created.id), {
        type: 'result',
        subtype: 'error_max_turns',
        terminal_reason: 'max_turns',
        result: 'Reached maximum number of turns (9)',
        errors: ['Reached maximum number of turns (9)'],
      })

      const detailResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}`, {
        headers: AUTH_HEADERS,
      })
      expect(detailResponse.status).toBe(200)
      const detail = (await detailResponse.json()) as {
        runtime?: {
          terminalState?: {
            kind?: string
            message?: string
            errors?: string[]
          } | null
        }
        runtimeConfig?: {
          defaults?: { maxTurns?: number }
          limits?: { maxTurns?: number }
        }
      }

      expect(detail.runtime?.terminalState).toEqual({
        kind: 'max_turns',
        subtype: 'error_max_turns',
        terminalReason: 'max_turns',
        message: 'Reached maximum number of turns (9)',
        errors: ['Reached maximum number of turns (9)'],
      })
      expect(detail.runtimeConfig?.defaults?.maxTurns).toBeDefined()
      expect(detail.runtimeConfig?.limits?.maxTurns).toBeDefined()
    } finally {
      await server.close()
    }
  })

  it('PATCH /:id/runtime clears stale fat cadence state when switching to thin', async () => {
    const dir = await createTempDir('hammurabi-commanders-runtime-thin-switch-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-runtime-thin-switch',
          contextMode: 'fat',
          contextConfig: {
            fatPinInterval: 3,
          },
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/runtime`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            contextMode: 'thin',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)
      expect(await patchResponse.json()).toEqual({
        id: created.id,
        maxTurns: DEFAULT_COMMANDER_MAX_TURNS,
        contextMode: 'thin',
        contextConfig: null,
      })

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        sessions?: Array<{
          id?: string
          contextMode?: string
          contextConfig?: { fatPinInterval?: number }
        }>
      }
      const updated = persisted.sessions?.find((session) => session.id === created.id)
      expect(updated?.contextMode).toBe('thin')
      expect(updated?.contextConfig).toBeUndefined()
    } finally {
      await server.close()
    }
  })

  it('deletes only wizard-named sessions from the cleanup endpoint', async () => {
    const dir = await createTempDir('hammurabi-commanders-wizard-delete-')
    const storePath = join(dir, 'sessions.json')
    const mock = createMockSessionsInterface({
      initialActiveSessions: ['commander-wizard-existing'],
    })
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const invalidResponse = await fetch(
        `${server.baseUrl}/api/commanders/wizard/${encodeURIComponent('not-a-wizard-session')}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(invalidResponse.status).toBe(400)
      expect(mock.activeSessions.has('commander-wizard-existing')).toBe(true)

      const validResponse = await fetch(
        `${server.baseUrl}/api/commanders/wizard/${encodeURIComponent('commander-wizard-existing')}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(validResponse.status).toBe(204)
      expect(mock.activeSessions.has('commander-wizard-existing')).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('persists commander email config and returns it through the API', async () => {
    const dir = await createTempDir('hammurabi-commanders-email-config-route-')
    const storePath = join(dir, 'sessions.json')
    const emailConfigStore = new CommanderEmailConfigStore(dir)
    const server = await startServer({
      sessionStorePath: storePath,
      emailConfigStore,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-email-config',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const putResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/email/config`,
        {
          method: 'PUT',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            account: 'assistant@pioneeringminds.ai',
            query: 'label:commander',
            pollIntervalMinutes: 5,
            replyAccount: 'nickgu@gehirn.ai',
            enabled: true,
          }),
        },
      )

      expect(putResponse.status).toBe(200)
      expect(await putResponse.json()).toEqual({
        config: {
          account: 'assistant@pioneeringminds.ai',
          query: 'label:commander',
          pollIntervalMinutes: 5,
          replyAccount: 'nickgu@gehirn.ai',
          enabled: true,
        },
      })

      const getResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/email/config`,
        {
          headers: AUTH_HEADERS,
        },
      )
      expect(getResponse.status).toBe(200)
      expect(await getResponse.json()).toEqual({
        config: {
          account: 'assistant@pioneeringminds.ai',
          query: 'label:commander',
          pollIntervalMinutes: 5,
          replyAccount: 'nickgu@gehirn.ai',
          enabled: true,
        },
      })
    } finally {
      await server.close()
    }
  })

  it('sends threaded replies through the commander email reply endpoint', async () => {
    const dir = await createTempDir('hammurabi-commanders-email-reply-route-')
    const storePath = join(dir, 'sessions.json')
    const emailConfigStore = new CommanderEmailConfigStore(dir)
    const mock = createMockSessionsInterface()
    const emailClient = new StubEmailClient({
      gmailMessageId: 'mid-1',
      threadId: 'thread-1',
      from: '"Nick Gu" <nickgu@gehirn.ai>',
      to: 'assistant@pioneeringminds.ai',
      subject: 'Need commander help',
      body: 'Original message',
      labels: ['INBOX'],
      attachments: [],
      replyTo: 'nickgu@gehirn.ai',
      receivedAt: '2026-04-03T10:00:00.000Z',
      references: [],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
      emailConfigStore,
      emailClient,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-email-reply',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      await emailConfigStore.set(created.id, {
        account: 'assistant@pioneeringminds.ai',
        query: 'label:commander',
        pollIntervalMinutes: 5,
        replyAccount: 'nickgu@gehirn.ai',
        enabled: true,
      })

      const response = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/email/reply`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messageId: 'mid-1',
            threadId: 'thread-1',
            body: 'Commander reply body',
          }),
        },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        accepted: true,
        account: 'nickgu@gehirn.ai',
        threadId: 'thread-1',
        messageId: 'mid-1',
      })
      expect(emailClient.getCalls).toEqual([
        { account: 'assistant@pioneeringminds.ai', messageId: 'mid-1' },
      ])
      expect(emailClient.replyCalls).toEqual([
        {
          account: 'nickgu@gehirn.ai',
          messageId: 'mid-1',
          threadId: 'thread-1',
          to: 'nickgu@gehirn.ai',
          subject: 'Re: Need commander help',
          body: 'Commander reply body',
        },
      ])
    } finally {
      await server.close()
    }
  })

  it('updates heartbeat config without starting commander runtime', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-config-')
    const storePath = join(dir, 'sessions.json')
    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-heartbeat-config',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HEARTBEAT CUSTOM {{timestamp}}]',
          }),
        },
      )

      expect(patchResponse.status).toBe(200)
      expect(await patchResponse.json()).toEqual({
        id: created.id,
        heartbeat: {
          intervalMs: 25,
          messageTemplate: '[HEARTBEAT CUSTOM {{timestamp}}]',
          lastSentAt: null,
        },
        lastHeartbeat: null,
      })

      await sleep(60)
      // No start was called, so no session sends should have occurred
      expect(mock.sendCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('sends periodic heartbeat messages while running and stops after stop', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-loop-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })
    let commanderId: string | null = null

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-heartbeat-loop',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }
      commanderId = created.id

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HEARTBEAT QUICK {{timestamp}}]',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      // Wait for at least a startup send + one heartbeat send
      await vi.waitFor(() => {
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(2)
      })
      expect(mock.sendCalls.some((call) => call.text.includes('[HEARTBEAT QUICK '))).toBe(true)

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        state: string
        lastHeartbeat: string | null
        heartbeat: {
          intervalMs: number
          messageTemplate: string
          lastSentAt: string | null
        }
      }>
      const updated = sessions.find((session) => session.id === created.id)
      expect(updated?.state).toBe('running')
      expect(updated?.heartbeat.intervalMs).toBe(25)
      expect(updated?.heartbeat.messageTemplate).toBe('[HEARTBEAT QUICK {{timestamp}}]')
      expect(updated?.heartbeat.lastSentAt).toBeTruthy()
      expect(updated?.lastHeartbeat).toBe(updated?.heartbeat.lastSentAt)

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(stopResponse.status).toBe(200)

      await sleep(40)
      const sendsAfterStopSettled = mock.sendCalls.length
      await sleep(80)
      expect(mock.sendCalls.length).toBe(sendsAfterStopSettled)
    } finally {
      await server.close()
    }
  })

  it('keeps heartbeat loops running when queue backpressure is transient', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-backpressure-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface({
      sendResults: [true, false, true],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })
    let commanderId: string | null = null

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-heartbeat-backpressure',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }
      commanderId = created.id

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HEARTBEAT QUICK {{timestamp}}]',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(3)
      })
      expect(mock.sendCalls[1]?.text).toContain('[HEARTBEAT QUICK ')
      expect(mock.sendCalls[2]?.text).toContain('[HEARTBEAT QUICK ')

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        state: string
      }>
      const updated = sessions.find((session) => session.id === created.id)
      expect(updated?.state).toBe('running')
    } finally {
      if (commanderId) {
        await fetch(`${server.baseUrl}/api/commanders/${commanderId}/stop`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
      }
      await server.close()
    }
  })

  it('triggers a manual heartbeat immediately through /heartbeat/trigger', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-manual-trigger-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })
    let commanderId: string | null = null

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-heartbeat-manual',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }
      commanderId = created.id

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 5_000,
            messageTemplate: '[HEARTBEAT MANUAL {{timestamp}}]',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls).toHaveLength(1)
      })

      const triggerResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat/trigger`,
        {
          method: 'POST',
          headers: AUTH_HEADERS,
        },
      )

      expect(triggerResponse.status).toBe(200)
      expect(await triggerResponse.json()).toEqual({
        runId: expect.any(String),
        timestamp: expect.any(String),
        sessionName: `commander-${created.id}`,
        triggered: true,
      })

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) => call.text.includes('[HEARTBEAT MANUAL ')),
        ).toBe(true)
      })
    } finally {
      await server.close()
    }
  })

  it('writes a heartbeat error entry when commander is not running when heartbeat fires', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-stop-log-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const sessionStore = new CommanderSessionStore(storePath)
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStore,
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'fixture-heartbeat-stop-log',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 10,
            messageTemplate: '[HEARTBEAT QUICK {{timestamp}}]',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      // Wait for at least one send (startup prompt) confirming commander is running
      await vi.waitFor(() => {
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(1)
      })

      // Simulate the commander's session being stopped externally (state → stopped)
      const sessions = await sessionStore.list()
      const session = sessions[0]
      if (session) {
        await sessionStore.update(session.id, (current) => ({
          ...current,
          state: 'stopped',
          pid: null,
          currentTask: null,
        }))
      }

      // Wait for the heartbeat log to record an error after detecting non-running state
      await vi.waitFor(async () => {
        const heartbeatLogResponse = await fetch(
          `${server.baseUrl}/api/commanders/${created.id}/heartbeat-log`,
          { headers: AUTH_HEADERS },
        )
        const payload = (await heartbeatLogResponse.json()) as {
          entries: Array<{ outcome: string; errorMessage?: string }>
        }
        expect(payload.entries.some((entry) => entry.outcome === 'error')).toBe(true)
      }, { timeout: 2000 })

      const heartbeatLogResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat-log`,
        { headers: AUTH_HEADERS },
      )
      expect(heartbeatLogResponse.status).toBe(200)
      const payload = (await heartbeatLogResponse.json()) as {
        entries: Array<{
          outcome: string
          errorMessage?: string
        }>
      }

      expect(payload.entries.some((entry) =>
        entry.outcome === 'error' &&
        entry.errorMessage === 'Commander session was not running when heartbeat fired')).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('applies heartbeat PATCH updates immediately for running commander', async () => {
    const dir = await createTempDir('hammurabi-commanders-heartbeat-live-patch-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })
    let commanderId: string | null = null

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-heartbeat-live',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }
      commanderId = created.id

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const patchFirst = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HB1 {{timestamp}}]',
          }),
        },
      )
      expect(patchFirst.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls.some((call) => call.text.includes('[HB1 '))).toBe(true)
      })

      const patchSecond = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messageTemplate: '[HB2 {{timestamp}}]',
          }),
        },
      )
      expect(patchSecond.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls.some((call) => call.text.includes('[HB2 '))).toBe(true)
      })

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(stopResponse.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('starts and stops commander lifecycle with sessionsInterface', async () => {
    const dir = await createTempDir('hammurabi-commanders-lifecycle-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-lifecycle',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)
      expect(await startResponse.json()).toEqual({
        id: created.id,
        state: 'running',
        started: true,
      })

      // createCommanderSession should be called once with the system prompt
      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
      })
      expect(mock.createCalls[0]?.systemPrompt).not.toContain(`# ${'Shared'} Commander Knowledge`)
      expect(mock.createCalls[0]?.systemPrompt).not.toContain(`shared-${'knowledge'}/*.md`)
      expect(mock.createCalls[0]?.systemPrompt).toEqual(
        expect.stringContaining('## Commander Memory'),
      )
      // Session name should match commander id pattern
      expect(mock.createCalls[0]?.name).toBe(`commander-${created.id}`)
      expect(mock.createCalls[0]?.agentType).toBe('claude')

      // State should be running
      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        state: string
      }>
      const started = sessions.find((entry) => entry.id === created.id)
      expect(started?.state).toBe('running')

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          state: 'Stopping for test',
        }),
      })

      expect(stopResponse.status).toBe(200)
      expect(await stopResponse.json()).toEqual({
        id: created.id,
        state: 'stopped',
        stopped: true,
      })
    } finally {
      await server.close()
    }
  })

  it('injects stored persona into the launched commander system prompt', async () => {
    const dir = await createTempDir('hammurabi-commanders-persona-prompt-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-persona-prompt',
          persona: '  Grumpy pirate who gives terse status updates and owns bug triage.  ',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
      })

      const systemPrompt = mock.createCalls[0]?.systemPrompt ?? ''
      expect(systemPrompt).toContain('## Persona')
      expect(systemPrompt).toContain('Grumpy pirate who gives terse status updates and owns bug triage.')
      expect(systemPrompt.indexOf('## Persona')).toBeGreaterThan(
        systemPrompt.indexOf('You are Commander, the orchestration agent for GitHub task execution.'),
      )
    } finally {
      await server.close()
    }
  })

  it('prepends per-commander COMMANDER.md before workspace prompt and only migrates commander-local maxTurns, not workspace fallback frontmatter', async () => {
    const dir = await createTempDir('hammurabi-commanders-workflow-source-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const workspaceDir = join(dir, 'workspace')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(
      join(workspaceDir, 'COMMANDER.md'),
      [
        '---',
        'maxTurns: 3',
        '---',
        'WORKSPACE PROMPT SOURCE',
      ].join('\n'),
      'utf8',
    )
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const firstCreate = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-workflow-fallback',
          cwd: workspaceDir,
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const firstCommander = (await firstCreate.json()) as { id: string }
      const firstWorkflow = await readFile(join(memoryBasePath, firstCommander.id, 'COMMANDER.md'), 'utf8')
      expect(firstWorkflow).not.toContain(`hammurabi memory find --commander ${firstCommander.id}`)
      expect(firstWorkflow).toContain(`hammurabi memory save --commander ${firstCommander.id}`)
      expect(firstWorkflow).toContain(workspaceDir)
      const firstStart = await fetch(
        `${server.baseUrl}/api/commanders/${firstCommander.id}/start`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
        },
      )
      expect(firstStart.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
      })
      expect(mock.createCalls[0]?.systemPrompt).toContain('WORKSPACE PROMPT SOURCE')
      expect(mock.createCalls[0]?.maxTurns).toBe(DEFAULT_COMMANDER_MAX_TURNS)

      const secondCreate = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-workflow-authoritative',
          cwd: workspaceDir,
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const secondCommander = (await secondCreate.json()) as { id: string }
      const commanderRoot = join(memoryBasePath, secondCommander.id)
      await mkdir(commanderRoot, { recursive: true })
      await writeFile(
        join(commanderRoot, 'COMMANDER.md'),
        [
          '---',
          'maxTurns: 7',
          '---',
          'COMMANDER-DIR PROMPT SOURCE',
        ].join('\n'),
        'utf8',
      )

      const secondStart = await fetch(
        `${server.baseUrl}/api/commanders/${secondCommander.id}/start`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
        },
      )
      expect(secondStart.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(2)
      })
      const secondPrompt = mock.createCalls[1]?.systemPrompt ?? ''
      expect(secondPrompt).toContain('COMMANDER-DIR PROMPT SOURCE')
      expect(secondPrompt).toContain('## Workspace Context')
      expect(secondPrompt).toContain('WORKSPACE PROMPT SOURCE')
      expect(secondPrompt.indexOf('COMMANDER-DIR PROMPT SOURCE')).toBeLessThan(
        secondPrompt.indexOf('WORKSPACE PROMPT SOURCE'),
      )
      expect(mock.createCalls[1]?.maxTurns).toBe(7)

      const thirdCreate = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-workflow-identity-only',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const thirdCommander = (await thirdCreate.json()) as { id: string }
      const thirdCommanderRoot = join(memoryBasePath, thirdCommander.id)
      await mkdir(thirdCommanderRoot, { recursive: true })
      await writeFile(
        join(thirdCommanderRoot, 'COMMANDER.md'),
        [
          '---',
          'maxTurns: 7',
          '---',
          'IDENTITY-ONLY PROMPT SOURCE',
        ].join('\n'),
        'utf8',
      )

      const thirdStart = await fetch(
        `${server.baseUrl}/api/commanders/${thirdCommander.id}/start`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
        },
      )
      expect(thirdStart.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(3)
      })
      expect(mock.createCalls[2]?.systemPrompt).toContain('IDENTITY-ONLY PROMPT SOURCE')
      expect(mock.createCalls[2]?.systemPrompt).not.toContain('WORKSPACE PROMPT SOURCE')
      expect(mock.createCalls[2]?.maxTurns).toBe(7)
    } finally {
      await server.close()
    }
  })

  it('reloads authoritative COMMANDER.md body for fat heartbeats instead of sending injected memory context', async () => {
    const dir = await createTempDir('hammurabi-commanders-workflow-heartbeat-reload-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-workflow-reload',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createResponse.json()) as { id: string }
      const commanderRoot = join(memoryBasePath, commander.id)
      const memoryRoot = join(commanderRoot, '.memory')
      await mkdir(commanderRoot, { recursive: true })
      await mkdir(memoryRoot, { recursive: true })
      await writeFile(
        join(commanderRoot, 'COMMANDER.md'),
        'COMMANDER PROMPT V1',
        'utf8',
      )
      await writeFile(
        join(memoryRoot, 'MEMORY.md'),
        '# Commander Memory\n\n- Initial memory fact',
        'utf8',
      )
      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await writeFile(
        join(commanderRoot, 'COMMANDER.md'),
        'COMMANDER PROMPT V2',
        'utf8',
      )
      await writeFile(
        join(memoryRoot, 'MEMORY.md'),
        '# Commander Memory\n\n- Updated memory fact',
        'utf8',
      )

      const heartbeatResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/heartbeat`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
        },
      )
      expect(heartbeatResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(2)
      })
      const lastSend = mock.sendCalls[mock.sendCalls.length - 1]
      expect(lastSend?.text).toContain('COMMANDER PROMPT V2')
      expect(lastSend?.text).toContain('Check your task list.')
      expect(lastSend?.text).not.toContain('COMMANDER PROMPT V1')
      expect(lastSend?.text).not.toContain('Updated memory fact')
      expect(lastSend?.text).not.toContain('# Hammurabi Quest Board')
      expect(lastSend?.text).not.toContain('# Commander Memory Workflow')
    } finally {
      await server.close()
    }
  })

  it('rehydrates heartbeat prompt after restart reconciliation without runtime state', async () => {
    const dir = await createTempDir('hammurabi-commanders-restart-rehydrate-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const agentsSessionStorePath = join(dir, 'agents-sessions.json')
    const commanderId = '00000000-0000-4000-a000-0000000e4d8a'
    const commanderSessionName = `commander-${commanderId}`

    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'worker-rehydrate',
            pid: null,
            state: 'running',
            created: '2026-03-01T00:00:00.000Z',
            heartbeat: {
              intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
              messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
              lastSentAt: null,
            },
            lastHeartbeat: null,
            taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )
    await writeFile(
      agentsSessionStorePath,
      JSON.stringify({
        sessions: [
          { name: commanderSessionName },
        ],
      }),
      'utf8',
    )
    const commanderRoot = join(memoryBasePath, commanderId)
    const memoryRoot = join(commanderRoot, '.memory')
    await mkdir(commanderRoot, { recursive: true })
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(
      join(commanderRoot, 'COMMANDER.md'),
      'RESTART REHYDRATED PROMPT',
      'utf8',
    )
    await writeFile(
      join(memoryRoot, 'MEMORY.md'),
      '# Commander Memory\n\n- Recovered memory fact',
      'utf8',
    )

    const mock = createMockSessionsInterface({
      initialActiveSessions: [commanderSessionName],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
      agentsSessionStorePath,
    })

    try {
      await vi.waitFor(async () => {
        const heartbeatResponse = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/heartbeat`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
          },
        )
        expect(heartbeatResponse.status).toBe(200)
      }, { timeout: 3000 })

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) =>
            call.text.includes('RESTART REHYDRATED PROMPT') &&
            call.text.includes('Check your task list.') &&
            !call.text.includes('Recovered memory fact')),
        ).toBe(true)
      })
      expect(mock.createCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('ignores malformed persisted agent session JSON during startup reconciliation', async () => {
    const dir = await createTempDir('hammurabi-commanders-restart-malformed-agents-store-')
    const storePath = join(dir, 'sessions.json')
    const agentsSessionStorePath = join(dir, 'agents-sessions.json')
    const commanderId = '00000000-0000-4000-a000-0000000e4d8b'
    const commanderSessionName = toCommanderSessionName(commanderId)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'worker-malformed-store',
            pid: null,
            state: 'running',
            created: '2026-03-01T00:00:00.000Z',
            heartbeat: {
              intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
              messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
              lastSentAt: null,
            },
            lastHeartbeat: null,
            taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )
    await writeFile(agentsSessionStorePath, '{"sessions":[', 'utf8')
    const mock = createMockSessionsInterface({
      initialActiveSessions: [commanderSessionName],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      agentsSessionStorePath,
      sessionsInterface: mock.interface,
    })

    try {
      await sleep(50)
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        '[commanders] Startup reconciliation failed:',
        expect.anything(),
      )

      const response = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([
        expect.objectContaining({
          id: commanderId,
          state: 'running',
        }),
      ])
    } finally {
      consoleErrorSpy.mockRestore()
      await server.close()
    }
  })

  it('preserves thin heartbeat cadence after restart reconciliation without runtime state', async () => {
    const dir = await createTempDir('hammurabi-commanders-restart-thin-cadence-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const agentsSessionStorePath = join(dir, 'agents-sessions.json')
    const commanderId = '00000000-0000-4000-a000-0000007e4d8a'
    const commanderSessionName = `commander-${commanderId}`

    await writeFile(
      storePath,
      JSON.stringify({
        sessions: [
          {
            id: commanderId,
            host: 'worker-thin-rehydrate',
            pid: null,
            state: 'running',
            created: '2026-03-01T00:00:00.000Z',
            heartbeat: {
              intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
              messageTemplate: DEFAULT_HEARTBEAT_MESSAGE,
              lastSentAt: '2026-03-01T00:05:00.000Z',
            },
            lastHeartbeat: '2026-03-01T00:05:00.000Z',
            heartbeatTickCount: 1,
            contextConfig: {
              fatPinInterval: 4,
            },
            taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
            currentTask: null,
            completedTasks: 0,
            totalCostUsd: 0,
          },
        ],
      }),
      'utf8',
    )
    await writeFile(
      agentsSessionStorePath,
      JSON.stringify({
        sessions: [
          { name: commanderSessionName },
        ],
      }),
      'utf8',
    )

    const mock = createMockSessionsInterface({
      initialActiveSessions: [commanderSessionName],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
      agentsSessionStorePath,
    })

    try {
      await vi.waitFor(async () => {
        const heartbeatResponse = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/heartbeat`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
          },
        )
        expect(heartbeatResponse.status).toBe(200)
      }, { timeout: 3000 })

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) =>
            call.text.includes('Check your task list.') &&
            call.text.includes('If current task is complete, mark it done and pick up the next one.'),
          ),
        ).toBe(true)
      }, { timeout: 3000 })

      await vi.waitFor(async () => {
        const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
          sessions?: Array<{ id?: string; heartbeatTickCount?: number }>
        }
        const updated = persisted.sessions?.find((session) => session.id === commanderId)
        expect(updated?.heartbeatTickCount).toBe(2)
      }, { timeout: 3000 })
    } finally {
      await server.close()
    }
  })

  it('persists cwd when creating a commander with cwd in request body', async () => {
    const dir = await createTempDir('hammurabi-commanders-cwd-create-')
    const storePath = join(dir, 'sessions.json')
    const server = await startServer({ sessionStorePath: storePath })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-cwd',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
          cwd: '/tmp/my-project',
        }),
      })

      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; cwd?: string }
      expect(created.cwd).toBe('/tmp/my-project')

      // Persisted in the store
      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{ id: string; cwd?: string }>
      const found = sessions.find((s) => s.id === created.id)
      expect(found?.cwd).toBe('/tmp/my-project')
    } finally {
      await server.close()
    }
  })

  it('accumulates totalCostUsd from agent session usage on stop', async () => {
    const dir = await createTempDir('hammurabi-commanders-cost-stop-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    // Mock reports 1.5 USD of session cost when getSession is called during stop
    const mock = createMockSessionsInterface({
      sessionCostUsd: 1.5,
      sessionClaudeSessionId: 'claude-test-session-id',
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-cost-stop',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(startResponse.status).toBe(200)

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(stopResponse.status).toBe(200)

      // totalCostUsd should be accumulated from agentSession.usage.costUsd (1.5)
      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        totalCostUsd: number
        claudeSessionId?: string
      }>
      const stopped = sessions.find((s) => s.id === created.id)
      expect(stopped?.totalCostUsd).toBe(1.5)
      expect(stopped?.claudeSessionId).toBe('claude-test-session-id')
    } finally {
      await server.close()
    }
  })

  it('always starts fresh claude session (no resume) so COMMANDER.md is authoritative', async () => {
    const dir = await createTempDir('hammurabi-commanders-claude-restart-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface({
      sessionClaudeSessionId: 'claude-resume-123',
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-claude-restart',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const firstStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(firstStartResponse.status).toBe(200)

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(stopResponse.status).toBe(200)

      const secondStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(secondStartResponse.status).toBe(200)

      expect(mock.createCalls).toHaveLength(2)
      expect(mock.createCalls[0]?.agentType).toBe('claude')
      // Second start must NOT resume — always fresh so COMMANDER.md is injected (#727)
      expect(mock.createCalls[1]).toEqual(
        expect.objectContaining({
          agentType: 'claude',
          resumeSessionId: undefined,
        }),
      )
    } finally {
      await server.close()
    }
  })

  it('defaults commander Claude effort to max and lets profile updates change the launched effort', async () => {
    const dir = await createTempDir('hammurabi-commanders-effort-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-effort',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string; effort?: string }
      expect(created.effort).toBe('max')

      const patchResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/profile`, {
        method: 'PATCH',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          effort: 'high',
        }),
      })
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      expect(mock.createCalls[0]).toEqual(expect.objectContaining({
        agentType: 'claude',
        effort: 'high',
      }))

      const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
        sessions: Array<{ effort?: string }>
      }
      expect(persisted.sessions[0]?.effort).toBe('high')
    } finally {
      await server.close()
    }
  })

  it('reuses persisted codex thread id when restarting commander chat', async () => {
    const dir = await createTempDir('hammurabi-commanders-codex-restart-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface({
      sessionCodexThreadId: 'codex-thread-123',
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-codex-restart',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const firstStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agentType: 'codex' }),
      })
      expect(firstStartResponse.status).toBe(200)
      await vi.waitFor(() => {
        expect(mock.createCalls).toHaveLength(1)
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(1)
      })
      expect(mock.createCalls[0]).toEqual(
        expect.objectContaining({
          agentType: 'codex',
          resumeSessionId: undefined,
        }),
      )
      expect(mock.sendCalls[0]?.text).toBe(
        'Commander runtime started. Acknowledge readiness and await instructions.',
      )

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/stop`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(stopResponse.status).toBe(200)

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        agentType?: 'claude' | 'codex'
        codexThreadId?: string
      }>
      const stopped = sessions.find((session) => session.id === created.id)
      expect(stopped?.agentType).toBe('codex')
      expect(stopped?.codexThreadId).toBe('codex-thread-123')

      const secondStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      })
      expect(secondStartResponse.status).toBe(200)

      expect(mock.createCalls).toHaveLength(2)
      expect(mock.createCalls[0]?.agentType).toBe('codex')
      // Second start must NOT resume — always fresh so COMMANDER.md is injected (#727)
      expect(mock.createCalls[1]).toEqual(
        expect.objectContaining({
          agentType: 'codex',
        }),
      )
    } finally {
      await server.close()
    }
  })

  it('rolls back commander state when codex bootstrap throws before the session registers', async () => {
    const dir = await createTempDir('hammurabi-commanders-codex-bootstrap-failure-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const sessionStore = new CommanderSessionStore(storePath)
    const mock = createMockSessionsInterface()
    const originalCreateCommanderSession = mock.interface.createCommanderSession.bind(mock.interface)
    let createAttempts = 0

    mock.interface.createCommanderSession = vi.fn(async (params) => {
      createAttempts += 1
      if (createAttempts === 1) {
        throw new Error('Injected codex bootstrap failure')
      }
      return originalCreateCommanderSession(params)
    })

    const server = await startServer({
      sessionStore,
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-codex-bootstrap-failure',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const firstStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ agentType: 'codex' }),
      })
      expect(firstStartResponse.status).toBe(500)
      expect(await firstStartResponse.json()).toEqual({
        error: 'Injected codex bootstrap failure',
      })

      const afterFailure = await sessionStore.get(created.id)
      expect(afterFailure).toMatchObject({
        id: created.id,
        state: 'idle',
        agentType: 'codex',
        pid: null,
      })
      expect(mock.activeSessions.has(`commander-${created.id}`)).toBe(false)

      const secondStartResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(secondStartResponse.status).toBe(200)
      expect(mock.createCalls).toHaveLength(1)
      expect(mock.createCalls[0]).toEqual(expect.objectContaining({ agentType: 'codex' }))
    } finally {
      await server.close()
    }
  })

  it('sends message to running commander', async () => {
    const dir = await createTempDir('hammurabi-commanders-message-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-message',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const message = 'Please investigate issue #167'

      const messageResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/message?mode=followup`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message,
        }),
      })

      expect(messageResponse.status).toBe(200)
      expect(await messageResponse.json()).toEqual({ accepted: true })

      // The message should appear in sendCalls (startup prompt + the explicit message)
      await vi.waitFor(() => {
        expect(mock.sendCalls.some((call) => call.text === message)).toBe(true)
      })
      mock.triggerEvent(toCommanderSessionName(created.id), {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: message }],
        },
      })

      const workingMemoryPath = join(memoryBasePath, created.id, '.memory', 'working-memory.json')
      const workingMemory = JSON.parse(await readFile(workingMemoryPath, 'utf-8')) as {
        checkpoints?: Array<{ source?: string; summary?: string }>
      }
      expect(
        (workingMemory.checkpoints ?? []).some(
          (entry) => entry.source === 'message' && entry.summary?.includes(message),
        ),
      ).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('queues collect-mode commander messages and keeps followups immediate', async () => {
    const dir = await createTempDir('hammurabi-commanders-message-queue-modes-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-message-queue',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const collectMessages = [
        'Collect update one',
        'Collect update two',
      ]

      for (const message of collectMessages) {
        const collectResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ message }),
        })
        expect(collectResponse.status).toBe(200)
        expect(await collectResponse.json()).toEqual({ accepted: true })
      }

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) =>
            call.text === collectMessages.join('\n\n')
            && call.options?.queue === true
            && call.options.priority === 'normal'),
        ).toBe(true)
      }, { timeout: 2_500 })

      const followupMessage = 'Send this followup immediately'
      const followupResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/message?mode=followup`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: followupMessage }),
      })
      expect(followupResponse.status).toBe(200)
      expect(await followupResponse.json()).toEqual({ accepted: true })

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) => call.text === followupMessage && call.options === undefined),
        ).toBe(true)
      })
    } finally {
      await server.close()
    }
  })

  it('retries collect-mode payloads when queueing is temporarily rejected', async () => {
    const dir = await createTempDir('hammurabi-commanders-message-queue-retry-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface({
      sendResults: [true, false, true],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-message-queue',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const collectMessages = [
        'Collect retry one',
        'Collect retry two',
      ]

      for (const message of collectMessages) {
        const collectResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ message }),
        })
        expect(collectResponse.status).toBe(200)
        expect(await collectResponse.json()).toEqual({ accepted: true })
      }

      await vi.waitFor(() => {
        const queuedCollectCalls = mock.sendCalls.filter((call) =>
          call.text === collectMessages.join('\n\n')
          && call.options?.queue === true
          && call.options.priority === 'normal')
        expect(queuedCollectCalls).toHaveLength(2)
      }, { timeout: 4_000 })
    } finally {
      await server.close()
    }
  })

  it('does not retry collect-mode payloads after the commander session exits', async () => {
    const dir = await createTempDir('hammurabi-commanders-message-queue-unavailable-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface({
      sendResults: [true, false],
    })

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-message-queue',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const collectMessages = [
        'Collect unavailable one',
        'Collect unavailable two',
      ]

      for (const message of collectMessages) {
        const collectResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ message }),
        })
        expect(collectResponse.status).toBe(200)
        expect(await collectResponse.json()).toEqual({ accepted: true })
      }

      mock.activeSessions.delete(toCommanderSessionName(created.id))

      await vi.waitFor(() => {
        const queuedCollectCalls = mock.sendCalls.filter((call) =>
          call.text === collectMessages.join('\n\n')
          && call.options?.queue === true
          && call.options.priority === 'normal')
        expect(queuedCollectCalls).toHaveLength(1)
      }, { timeout: 4_000 })

      await sleep(1_250)

      const queuedCollectCalls = mock.sendCalls.filter((call) =>
        call.text === collectMessages.join('\n\n')
        && call.options?.queue === true
        && call.options.priority === 'normal')
      expect(queuedCollectCalls).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  it('does not store internal startup and heartbeat prompts as user-message working memory', async () => {
    const dir = await createTempDir('hammurabi-commanders-internal-prompt-filter-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })
    let commanderId: string | null = null

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-internal-filter',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }
      commanderId = created.id

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HEARTBEAT FILTER {{timestamp}}]',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(mock.sendCalls.length).toBeGreaterThanOrEqual(2)
      })

      for (const call of mock.sendCalls.slice(0, 2)) {
        mock.triggerEvent(toCommanderSessionName(created.id), {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: call.text }],
          },
        })
      }

      await sleep(50)

      const workingMemoryPath = join(
        memoryBasePath,
        created.id,
        '.memory',
        'working-memory.json',
      )
      const workingMemory = JSON.parse(await readFile(workingMemoryPath, 'utf-8')) as {
        checkpoints?: Array<{ source?: string; summary?: string }>
      }
      const messageCheckpoints = (workingMemory.checkpoints ?? []).filter(
        (entry) => entry.source === 'message',
      )
      expect(messageCheckpoints).toHaveLength(0)
    } finally {
      if (commanderId) {
        await fetch(`${server.baseUrl}/api/commanders/${commanderId}/stop`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
      }
      await server.close()
    }
  })

  it('reads, appends, and clears working memory through the API', async () => {
    const dir = await createTempDir('hammurabi-commanders-working-memory-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-memory',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as { id: string }

      const initialResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/memory/working-memory`,
        { headers: AUTH_HEADERS },
      )
      expect(initialResponse.status).toBe(200)
      expect((await initialResponse.json()) as { content: string }).toEqual({ content: '' })

      const note = 'Investigate working-memory trim policy.'
      const appendResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/memory/working-memory`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: note }),
        },
      )
      expect(appendResponse.status).toBe(201)
      const appended = (await appendResponse.json()) as { content: string }
      expect(appended.content).toContain(note)

      const rereadResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/memory/working-memory`,
        { headers: AUTH_HEADERS },
      )
      expect(rereadResponse.status).toBe(200)
      expect(((await rereadResponse.json()) as { content: string }).content).toContain(note)

      const clearResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/memory/working-memory`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(clearResponse.status).toBe(204)

      const clearedResponse = await fetch(
        `${server.baseUrl}/api/commanders/${created.id}/memory/working-memory`,
        { headers: AUTH_HEADERS },
      )
      expect(clearedResponse.status).toBe(200)
      expect((await clearedResponse.json()) as { content: string }).toEqual({ content: '' })
    } finally {
      await server.close()
    }
  })

  it('proxies GitHub tasks filtered by commander label', async () => {
    const dir = await createTempDir('hammurabi-commanders-tasks-')
    const storePath = join(dir, 'sessions.json')

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input instanceof URL ? input.toString() : String(input)
        if (!url.includes('/issues?')) {
          throw new Error(`Unexpected URL: ${url}`)
        }
        return new Response(
          JSON.stringify([
            {
              number: 167,
              title: 'Commander lifecycle',
              body: 'Implement routes',
              html_url: 'https://github.com/NickGuAI/Hervald/issues/167',
              state: 'open',
              labels: [{ name: 'commander' }],
            },
            {
              number: 999,
              title: 'PR placeholder',
              html_url: 'https://github.com/NickGuAI/Hervald/pull/999',
              state: 'open',
              pull_request: {},
              labels: [],
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    )

    const server = await startServer({
      sessionStorePath: storePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-tasks',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const tasksResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/tasks`, {
        headers: AUTH_HEADERS,
      })

      expect(tasksResponse.status).toBe(200)
      expect(await tasksResponse.json()).toEqual([
        {
          number: 167,
          title: 'Commander lifecycle',
          body: 'Implement routes',
          issueUrl: 'https://github.com/NickGuAI/Hervald/issues/167',
          state: 'open',
          labels: ['commander'],
        },
      ])

      const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
      expect(requestedUrl).toContain('labels=commander')
    } finally {
      await server.close()
    }
  })

  it('assigns task label and persists currentTask', async () => {
    const dir = await createTempDir('hammurabi-commanders-assign-')
    const storePath = join(dir, 'sessions.json')

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input instanceof URL ? input.toString() : String(input)
        if (!url.endsWith('/issues/167/labels')) {
          throw new Error(`Unexpected URL: ${url}`)
        }
        return new Response(JSON.stringify([{ name: 'commander' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    )

    const server = await startServer({
      sessionStorePath: storePath,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => new Date('2026-02-21T12:00:00.000Z'),
    })

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-assign',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const created = (await createResponse.json()) as { id: string }

      const assignResponse = await fetch(`${server.baseUrl}/api/commanders/${created.id}/tasks`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          issueNumber: 167,
        }),
      })

      expect(assignResponse.status).toBe(201)
      expect(await assignResponse.json()).toEqual({
        assigned: true,
        currentTask: {
          issueNumber: 167,
          issueUrl: 'https://github.com/NickGuAI/Hervald/issues/167',
          startedAt: '2026-02-21T12:00:00.000Z',
        },
      })

      const listResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await listResponse.json()) as Array<{
        id: string
        currentTask: { issueNumber: number } | null
      }>
      const updated = sessions.find((session) => session.id === created.id)
      expect(updated?.currentTask?.issueNumber).toBe(167)

      const callBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '')
      expect(callBody).toContain('"labels":["commander"]')
    } finally {
      await server.close()
    }
  })

  it('routes commander cron CRUD through the shared scheduler and exposes live cron metadata', async () => {
    const dir = await createTempDir('hammurabi-commanders-cron-routes-')
    const storePath = join(dir, 'sessions.json')
    const taskStore = new CommandRoomTaskStore(join(dir, 'tasks.json'))
    const runStore = new CommandRoomRunStore(join(dir, 'runs.json'))
    const createSession = vi.fn(async () => ({ sessionId: 'session-cron-1' }))
    const monitorSession = vi.fn(async () => ({
      sessionId: 'session-cron-1',
      status: 'SUCCESS' as const,
      finalComment: 'Commander cron run done.',
      filesChanged: 0,
      durationMin: 1,
      raw: { total_cost_usd: 0.09 },
    }))
    const now = () => new Date('2026-03-05T10:00:00.000Z')
    const executor = new CommandRoomExecutor({
      taskStore,
      runStore,
      now,
      agentSessionFactory: () => ({
        createSession,
        monitorSession,
      }),
    })
    const { scheduler: cronEngine, scheduled } = createMockCronScheduler([
      new Date('2026-03-05T10:05:00.000Z'),
      new Date('2026-03-05T10:10:00.000Z'),
      new Date('2026-03-05T10:15:00.000Z'),
    ])
    const commandRoomScheduler = new CommandRoomScheduler({
      taskStore,
      executor,
      scheduler: cronEngine,
    })
    const commandRoomSchedulerReady = commandRoomScheduler.initialize()

    const server = await startServer({
      sessionStorePath: storePath,
      sessionStore: new CommanderSessionStore(storePath),
      commandRoomTaskStore: taskStore,
      commandRoomRunStore: runStore,
      commandRoomScheduler,
      commandRoomSchedulerReady,
      now,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-cron-routes',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      expect(createCommanderResponse.status).toBe(201)
      const commander = (await createCommanderResponse.json()) as { id: string }

      const createCronResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/crons`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          schedule: '*/5 * * * *',
          instruction: 'Check the park status.',
          enabled: true,
          agentType: 'claude',
          workDir: '/tmp/monorepo-g',
        }),
      })
      expect(createCronResponse.status).toBe(201)
      const createdCron = (await createCronResponse.json()) as {
        id: string
        lastRun: string | null
        nextRun: string | null
      }
      expect(createdCron.lastRun).toBeNull()
      expect(createdCron.nextRun).toBe('2026-03-05T10:05:00.000Z')
      expect(scheduled).toHaveLength(1)

      const listBeforeRunResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/crons`,
        { headers: AUTH_HEADERS },
      )
      expect(listBeforeRunResponse.status).toBe(200)
      const listedBeforeRun = (await listBeforeRunResponse.json()) as Array<{
        id: string
        lastRun: string | null
        nextRun: string | null
      }>
      const listedCreatedBeforeRun = listedBeforeRun.find((entry) => entry.id === createdCron.id)
      expect(listedCreatedBeforeRun).toEqual(expect.objectContaining({
        id: createdCron.id,
        lastRun: null,
        nextRun: '2026-03-05T10:05:00.000Z',
      }))

      const scheduledCallback = scheduled
        .find((entry) => entry.options?.name === `command-room-${createdCron.id}`)
        ?.task
      if (!scheduledCallback) {
        throw new Error('Expected commander cron callback to be registered')
      }
      await scheduledCallback()

      await vi.waitFor(async () => {
        const runs = await runStore.listRunsForTask(createdCron.id)
        expect(runs).toHaveLength(1)
      })

      const listAfterRunResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/crons`,
        { headers: AUTH_HEADERS },
      )
      expect(listAfterRunResponse.status).toBe(200)
      const listedAfterRun = (await listAfterRunResponse.json()) as Array<{
        id: string
        lastRun: string | null
        nextRun: string | null
      }>
      const listedCreatedAfterRun = listedAfterRun.find((entry) => entry.id === createdCron.id)
      expect(listedCreatedAfterRun).toEqual(expect.objectContaining({
        id: createdCron.id,
        lastRun: '2026-03-05T10:00:00.000Z',
        nextRun: '2026-03-05T10:05:00.000Z',
      }))
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(monitorSession).toHaveBeenCalledWith('session-cron-1', undefined)

      const updateCronResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/crons/${createdCron.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            schedule: '0 11 * * *',
          }),
        },
      )
      expect(updateCronResponse.status).toBe(200)
      const updatedCron = (await updateCronResponse.json()) as {
        nextRun: string | null
      }
      expect(updatedCron.nextRun).toBe('2026-03-05T10:10:00.000Z')
      expect(scheduled).toHaveLength(2)
      expect(scheduled[0]?.job.stop).toHaveBeenCalledTimes(1)
      expect(scheduled[0]?.job.destroy).toHaveBeenCalledTimes(1)

      const disableCronResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/crons/${createdCron.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            enabled: false,
          }),
        },
      )
      expect(disableCronResponse.status).toBe(200)
      const disabledCron = (await disableCronResponse.json()) as {
        nextRun: string | null
      }
      expect(disabledCron.nextRun).toBeNull()
      expect(scheduled[1]?.job.stop).toHaveBeenCalledTimes(1)
      expect(scheduled[1]?.job.destroy).toHaveBeenCalledTimes(1)

      const deleteCronResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/crons/${createdCron.id}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(deleteCronResponse.status).toBe(204)

      expect(await runStore.listRunsForTask(createdCron.id)).toEqual([])

      const emptyListResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/crons`, {
        headers: AUTH_HEADERS,
      })
      expect(emptyListResponse.status).toBe(200)
      const remaining = await emptyListResponse.json() as Array<{ id: string; taskType?: string }>
      expect(remaining.some((task) => task.id === createdCron.id)).toBe(false)
      expect(remaining).toEqual([])
    } finally {
      await server.close()
    }
  })

  // NOTE: WebSocket live-event streaming is no longer tested here.
  // The WS endpoint for commander sessions has moved to the agents router:
  //   /api/agents/sessions/commander-{id}/ws
  // End-to-end WS streaming is verified via agents router integration tests.
  it.skip('streams live events over websocket', () => {
    // Skipped: commander WS endpoint was removed as part of the stream-session migration.
    // See apps/hammurabi/modules/agents/routes.ts for the agents WS handler.
  })

  it('supports quest CRUD routes including note appends', async () => {
    const dir = await createTempDir('hammurabi-commanders-quest-routes-')
    const storePath = join(dir, 'sessions.json')
    const server = await startServer({ sessionStorePath: storePath })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-routes',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createCommanderResponse.json()) as { id: string }

      const createQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          instruction: 'Draft implementation plan',
          contract: {
            cwd: '/tmp/monorepo-g',
            permissionMode: 'default',
            agentType: 'claude',
            skillsToUse: ['issue-finder'],
          },
        }),
      })
      expect(createQuestResponse.status).toBe(201)
      const createdQuest = (await createQuestResponse.json()) as {
        id: string
        status: string
      }
      expect(createdQuest.status).toBe('pending')

      const listResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const listed = (await listResponse.json()) as Array<{ id: string }>
      expect(listed).toHaveLength(1)
      expect(listed[0]?.id).toBe(createdQuest.id)

      const patchResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${createdQuest.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            status: 'active',
            note: 'Started working on the route implementation',
          }),
        },
      )
      expect(patchResponse.status).toBe(200)
      const patched = (await patchResponse.json()) as { status: string; note?: string }
      expect(patched.status).toBe('active')
      expect(patched.note).toBe('Started working on the route implementation')

      const appendNoteResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${createdQuest.id}/notes`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            note: 'Added tests and confirmed passing status',
          }),
        },
      )
      expect(appendNoteResponse.status).toBe(200)
      const noted = (await appendNoteResponse.json()) as { note?: string }
      expect(noted.note).toContain('Started working on the route implementation')
      expect(noted.note).toContain('Added tests and confirmed passing status')

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${createdQuest.id}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(deleteResponse.status).toBe(204)

      const emptyListResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        headers: AUTH_HEADERS,
      })
      expect(emptyListResponse.status).toBe(200)
      expect(await emptyListResponse.json()).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('lists quests across commanders from the aggregate quests route', async () => {
    const dir = await createTempDir('hammurabi-commanders-quest-routes-aggregate-')
    const storePath = join(dir, 'sessions.json')
    const server = await startServer({ sessionStorePath: storePath })

    try {
      const firstCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-aggregate-a',
        }),
      })
      const firstCommander = (await firstCommanderResponse.json()) as { id: string }

      const secondCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-aggregate-b',
        }),
      })
      const secondCommander = (await secondCommanderResponse.json()) as { id: string }

      await fetch(`${server.baseUrl}/api/commanders/${firstCommander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          instruction: 'Investigate issue #882',
        }),
      })

      await fetch(`${server.baseUrl}/api/commanders/${secondCommander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          instruction: 'Implement issue #881',
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/commanders/quests`, {
        headers: AUTH_HEADERS,
      })
      expect(response.status).toBe(200)

      const quests = (await response.json()) as Array<{
        instruction: string
        commanderId?: string
      }>
      expect(quests).toHaveLength(2)
      expect(quests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          instruction: 'Investigate issue #882',
          commanderId: firstCommander.id,
        }),
        expect.objectContaining({
          instruction: 'Implement issue #881',
          commanderId: secondCommander.id,
        }),
      ]))
    } finally {
      await server.close()
    }
  })

  it('resets active quests to pending when commander starts', async () => {
    const dir = await createTempDir('hammurabi-commanders-quest-stale-guard-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const mock = createMockSessionsInterface()
    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      sessionsInterface: mock.interface,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-stale-guard',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createCommanderResponse.json()) as { id: string }

      const createQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          instruction: 'Fix stale quest state',
        }),
      })
      const createdQuest = (await createQuestResponse.json()) as { id: string }

      const patchToActiveResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${createdQuest.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            status: 'active',
          }),
        },
      )
      expect(patchToActiveResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      const questsResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        headers: AUTH_HEADERS,
      })
      const quests = (await questsResponse.json()) as Array<{ id: string; status: string }>
      expect(quests).toEqual([
        expect.objectContaining({
          id: createdQuest.id,
          status: 'pending',
        }),
      ])
    } finally {
      await server.close()
    }
  })

  it('prepends pending quests to heartbeat messages', async () => {
    const dir = await createTempDir('hammurabi-commanders-quest-heartbeat-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const heartbeatLog = new HeartbeatLog({
      dataDir: join(dir, 'heartbeat-data'),
    })
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      heartbeatLog,
      sessionsInterface: mock.interface,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-heartbeat',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createCommanderResponse.json()) as { id: string }

      const instructions = [
        'First pending quest',
        'Second pending quest',
        'Third pending quest',
        'Fourth pending quest',
      ]
      for (const instruction of instructions) {
        const createQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            source: 'manual',
            instruction,
          }),
        })
        expect(createQuestResponse.status).toBe(201)
      }

      const patchHeartbeatResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HB {{timestamp}}]',
          }),
        },
      )
      expect(patchHeartbeatResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      // Wait for at least a startup send + one heartbeat with quest board
      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) => call.text.includes('[QUEST BOARD] Top pending quests:')),
        ).toBe(true)
      })

      const heartbeatCall = mock.sendCalls.find((call) =>
        call.text.includes('[QUEST BOARD] Top pending quests:'),
      )

      expect(heartbeatCall).toBeDefined()
      const heartbeatText = heartbeatCall?.text ?? ''
      expect(heartbeatText).toContain('1. First pending quest')
      expect(heartbeatText).toContain('2. Second pending quest')
      const hasThirdQuest = heartbeatText.includes('3. Third pending quest')
      const hasFourthQuest = heartbeatText.includes('3. Fourth pending quest')
      expect(hasThirdQuest || hasFourthQuest).toBe(true)
      expect(hasThirdQuest && hasFourthQuest).toBe(false)

      await vi.waitFor(async () => {
        const entries = await heartbeatLog.read(commander.id, 5)
        expect(entries[0]).toEqual(expect.objectContaining({
          questCount: 4,
          outcome: 'ok',
        }))
        expect(entries[0]).not.toHaveProperty('claimedQuestId')
        expect(entries[0]).not.toHaveProperty('claimedQuestInstruction')
      })

      const stopResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/stop`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(stopResponse.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('records open quest-board work counts in heartbeat logs even when currentTask is null', async () => {
    const dir = await createTempDir('hammurabi-commanders-active-quest-heartbeat-')
    const storePath = join(dir, 'sessions.json')
    const memoryBasePath = join(dir, 'memory')
    const heartbeatLog = new HeartbeatLog({
      dataDir: join(dir, 'heartbeat-data'),
    })
    const mock = createMockSessionsInterface()

    const server = await startServer({
      sessionStorePath: storePath,
      memoryBasePath,
      heartbeatLog,
      sessionsInterface: mock.interface,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-active-quest-heartbeat',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createCommanderResponse.json()) as { id: string }

      const createActiveQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Refine active heartbeat snapshot',
          contract: {
            cwd: '/home/builder/App',
            permissionMode: 'default',
            agentType: 'claude',
            skillsToUse: [],
          },
        }),
      })
      expect(createActiveQuestResponse.status).toBe(201)
      const activeQuest = (await createActiveQuestResponse.json()) as { id: string }

      const createPendingQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          instruction: 'Keep pending heartbeat context visible',
          contract: {
            cwd: '/home/builder/App',
            permissionMode: 'default',
            agentType: 'claude',
            skillsToUse: [],
          },
        }),
      })
      expect(createPendingQuestResponse.status).toBe(201)

      const updateQuestResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/quests/${activeQuest.id}`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            status: 'active',
          }),
        },
      )
      expect(updateQuestResponse.status).toBe(200)

      const patchHeartbeatResponse = await fetch(
        `${server.baseUrl}/api/commanders/${commander.id}/heartbeat`,
        {
          method: 'PATCH',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intervalMs: 25,
            messageTemplate: '[HB {{timestamp}}]',
          }),
        },
      )
      expect(patchHeartbeatResponse.status).toBe(200)

      const startResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/start`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
      })
      expect(startResponse.status).toBe(200)

      await vi.waitFor(() => {
        expect(
          mock.sendCalls.some((call) => call.text.includes('[QUEST BOARD] Top pending quests:')),
        ).toBe(true)
      })

      await vi.waitFor(async () => {
        const entries = await heartbeatLog.read(commander.id, 5)
        expect(
          entries.some((entry) =>
            entry.questCount === 2 &&
            entry.outcome === 'ok'),
        ).toBe(true)
      })
    } finally {
      await server.close()
    }
  })

  it('imports instruction text from githubIssueUrl', async () => {
    const dir = await createTempDir('hammurabi-commanders-quest-github-import-')
    const storePath = join(dir, 'sessions.json')
    const readTask = vi.fn(async () => ({
      number: 331,
      title: 'Implement quest board backend',
      body: 'Add store, routes, and tests for commander quests.',
      labels: ['commander'],
      assignees: [],
      comments: [],
      url: 'https://github.com/NickGuAI/Hervald/issues/331',
    }))
    const ghTasksFactory = vi.fn((_repo: string) => ({ readTask }))

    const server = await startServer({
      sessionStorePath: storePath,
      ghTasksFactory,
    })

    try {
      const createCommanderResponse = await fetch(`${server.baseUrl}/api/commanders`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'worker-quest-github-import',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
        }),
      })
      const commander = (await createCommanderResponse.json()) as { id: string }

      const createQuestResponse = await fetch(`${server.baseUrl}/api/commanders/${commander.id}/quests`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          githubIssueUrl: 'https://github.com/NickGuAI/Hervald/issues/331',
        }),
      })

      expect(createQuestResponse.status).toBe(201)
      const createdQuest = (await createQuestResponse.json()) as {
        source: string
        instruction: string
      }
      expect(createdQuest.source).toBe('github-issue')
      expect(createdQuest.instruction).toContain('Implement quest board backend')
      expect(createdQuest.instruction).toContain('Add store, routes, and tests for commander quests.')
      expect(ghTasksFactory).toHaveBeenCalledWith('NickGuAI/Hervald')
      expect(readTask).toHaveBeenCalledWith(331)
    } finally {
      await server.close()
    }
  })

  it('persists sessions across server restarts', async () => {
    const dir = await createTempDir('hammurabi-commanders-restart-')
    const storePath = join(dir, 'sessions.json')

    const firstServer = await startServer({ sessionStorePath: storePath })
    const createResponse = await fetch(`${firstServer.baseUrl}/api/commanders`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        host: 'worker-restart',
        taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
      }),
    })
    expect(createResponse.status).toBe(201)
    await firstServer.close()

    const secondServer = await startServer({ sessionStorePath: storePath })
    try {
      const listResponse = await fetch(`${secondServer.baseUrl}/api/commanders`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      expect(await listResponse.json()).toEqual([
        expect.objectContaining({
          host: 'worker-restart',
          state: 'idle',
        }),
      ])
    } finally {
      await secondServer.close()
    }
  })

  describe('memory CLI endpoints', () => {
    async function createServerWithCommander(
      options: Partial<CommandersRouterOptions> & {
        state?: 'idle' | 'running' | 'paused' | 'stopped'
      } = {},
    ): Promise<{
      server: RunningServer
      commanderId: string
      memoryBasePath: string
    }> {
      const { state = 'idle', ...routerOptions } = options
      const dir = await createTempDir('hammurabi-memory-routes-')
      const storePath = join(dir, 'sessions.json')
      const memoryBasePath = join(dir, 'commanders')
      const commanderId = '00000000-0000-4000-a000-00000000e301'
      await writeFile(
        storePath,
        JSON.stringify({
          sessions: [
            {
              id: commanderId,
              host: 'test-host',
              pid: null,
              state,
              created: '2026-03-01T00:00:00.000Z',
              lastHeartbeat: null,
              taskSource: { owner: 'NickGuAI', repo: 'monorepo-g', label: 'commander' },
              currentTask: null,
              completedTasks: 0,
              totalCostUsd: 0,
            },
          ],
        }),
      )
      const server = await startServer({
        sessionStorePath: storePath,
        memoryBasePath,
        agentsSessionStorePath: join(dir, 'agents-sessions.json'),
        ...routerOptions,
      })
      return { server, commanderId, memoryBasePath }
    }

    it('POST /:id/memory/facts saves facts and returns result', async () => {
      const { server, commanderId } = await createServerWithCommander()
      try {
        const response = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/memory/facts`,
          {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
            body: JSON.stringify({ facts: ['Always use pnpm in monorepo'] }),
          },
        )
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('factsAdded')
        expect(body).toHaveProperty('lineCount')
        expect(body.factsAdded).toBe(1)
      } finally {
        await server.close()
      }
    })

    it('POST /:id/memory/facts returns 400 when facts is empty', async () => {
      const { server, commanderId } = await createServerWithCommander()
      try {
        const response = await fetch(
          `${server.baseUrl}/api/commanders/${commanderId}/memory/facts`,
          {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
            body: JSON.stringify({ facts: [] }),
          },
        )
        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.error).toContain('facts array')
      } finally {
        await server.close()
      }
    })

    it('POST /:id/memory/facts returns 404 for unknown commander', async () => {
      const { server } = await createServerWithCommander()
      try {
        const response = await fetch(
          `${server.baseUrl}/api/commanders/nonexistent/memory/facts`,
          {
            method: 'POST',
            headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
            body: JSON.stringify({ facts: ['some fact'] }),
          },
        )
        expect(response.status).toBe(404)
      } finally {
        await server.close()
      }
    })

    it('exposes read-only workspace tree and file preview routes', async () => {
      const workspaceDir = await createTempDir('hammurabi-commander-workspace-')
      await mkdir(join(workspaceDir, 'quests'), { recursive: true })
      await writeFile(join(workspaceDir, 'brief.md'), 'Commander workspace\n', 'utf8')

      const server = await startServer()
      try {
        const createResponse = await fetch(`${server.baseUrl}/api/commanders`, {
          method: 'POST',
          headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify({
            host: 'local-hq',
            cwd: workspaceDir,
          }),
        })
        expect(createResponse.status).toBe(201)
        const created = await createResponse.json()

        const treeResponse = await fetch(
          `${server.baseUrl}/api/commanders/${created.id}/workspace/tree`,
          { headers: AUTH_HEADERS },
        )
        expect(treeResponse.status).toBe(200)
        const treeBody = await treeResponse.json()
        expect(treeBody.nodes.map((node: { name: string }) => node.name)).toEqual(['quests', 'brief.md'])

        const fileResponse = await fetch(
          `${server.baseUrl}/api/commanders/${created.id}/workspace/file?path=brief.md`,
          { headers: AUTH_HEADERS },
        )
        expect(fileResponse.status).toBe(200)
        const fileBody = await fileResponse.json()
        expect(fileBody.kind).toBe('text')
        expect(fileBody.content).toContain('Commander workspace')
      } finally {
        await server.close()
      }
    })
  })
})
