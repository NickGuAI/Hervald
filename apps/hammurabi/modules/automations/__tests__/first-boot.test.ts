import express from 'express'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyRecord, ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { createOrgRouter } from '../../org/route.js'
import { OperatorStore } from '../../operators/store.js'
import { createAutomationsRouter } from '../routes.js'
import {
  AutomationScheduler,
  type CronScheduler,
} from '../scheduler.js'
import { AutomationStore } from '../store.js'

const API_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const previousEnv = {
  HAMMURABI_DATA_DIR: process.env.HAMMURABI_DATA_DIR,
  COMMANDER_DATA_DIR: process.env.COMMANDER_DATA_DIR,
  HAMMURABI_COMMANDER_MEMORY_DIR: process.env.HAMMURABI_COMMANDER_MEMORY_DIR,
  HAMMURABI_AGENT_SKILLS_DIR: process.env.HAMMURABI_AGENT_SKILLS_DIR,
}

const tempDirs: string[] = []

interface RunningServer {
  baseUrl: string
  initialized: Promise<void>
  scheduledJobs: ScheduledJob[]
  close: () => Promise<void>
}

interface ScheduledJob {
  expression: string
  name?: string
  timezone?: string
}

function restoreEnvVar(
  key: 'HAMMURABI_DATA_DIR' | 'COMMANDER_DATA_DIR' | 'HAMMURABI_COMMANDER_MEMORY_DIR' | 'HAMMURABI_AGENT_SKILLS_DIR',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-03-18T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['commanders:read', 'commanders:write', 'org:write'],
    },
  } satisfies Record<string, ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' }
      }

      return { ok: true, record }
    },
  }
}

function createTestCronScheduler(scheduledJobs: ScheduledJob[]): CronScheduler {
  return {
    schedule(expression, _task, options) {
      scheduledJobs.push({
        expression,
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.timezone ? { timezone: options.timezone } : {}),
      })
      return {
        stop: vi.fn(),
        destroy: vi.fn(),
        getNextRun: () => null,
      }
    },
    validate(expression) {
      return expression.trim().length > 0
    },
  }
}

async function startServer(dataDir: string, knownCommanderIds = new Set<string>()): Promise<RunningServer> {
  const app = express()
  const apiKeyStore = createTestApiKeyStore()
  const commanderDataDir = path.join(dataDir, 'commander')
  const automationStore = new AutomationStore({
    dirPath: path.join(dataDir, 'automations'),
    commanderDataDir,
  })
  const scheduledJobs: ScheduledJob[] = []
  const automationScheduler = new AutomationScheduler({
    store: automationStore,
    scheduler: createTestCronScheduler(scheduledJobs),
    commanderStore: {
      async get(commanderId: string) {
        return knownCommanderIds.has(commanderId) ? { id: commanderId } : null
      },
    },
  })
  const initialized = automationScheduler.initialize()

  app.use(express.json())
  app.use('/api/org', createOrgRouter({
    apiKeyStore,
    commanderDataDir,
    sessionStore: {
      async list() {
        return []
      },
    },
    conversationStore: {
      async listByCommander() {
        return []
      },
    },
    questStore: {
      async list() {
        return []
      },
    },
    profileStore: {
      async getAvatarUrl() {
        return null
      },
      async getProfile() {
        return null
      },
    },
    automationStore,
  }))
  app.use('/api/automations', createAutomationsRouter({
    apiKeyStore,
    store: automationStore,
    scheduler: automationScheduler,
    schedulerInitialized: initialized,
  }).router)

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
    initialized,
    scheduledJobs,
    close: async () => {
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

beforeEach(() => {
  delete process.env.COMMANDER_DATA_DIR
  delete process.env.HAMMURABI_COMMANDER_MEMORY_DIR
  delete process.env.HAMMURABI_AGENT_SKILLS_DIR
})

afterEach(async () => {
  restoreEnvVar('HAMMURABI_DATA_DIR', previousEnv.HAMMURABI_DATA_DIR)
  restoreEnvVar('COMMANDER_DATA_DIR', previousEnv.COMMANDER_DATA_DIR)
  restoreEnvVar('HAMMURABI_COMMANDER_MEMORY_DIR', previousEnv.HAMMURABI_COMMANDER_MEMORY_DIR)
  restoreEnvVar('HAMMURABI_AGENT_SKILLS_DIR', previousEnv.HAMMURABI_AGENT_SKILLS_DIR)
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('automations first boot', () => {
  async function readSupportedMemoryCliSubcommands(): Promise<Set<string>> {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
    const source = await readFile(
      path.join(repoRoot, 'packages', 'hammurabi-cli', 'src', 'memory.ts'),
      'utf8',
    )
    return new Set(
      [...source.matchAll(/command\s*(?:!={2}|={2}=)\s*'([^']+)'/gu)]
        .map((match) => match[1])
        .filter((command): command is string => Boolean(command)),
    )
  }

  function extractMemoryCliSubcommands(instruction: string): string[] {
    return [...instruction.matchAll(/\bhammurabi\s+memory\s+([a-z][a-z-]*)\b/giu)]
      .map((match) => match[1])
      .filter((command): command is string => Boolean(command))
  }

  it('repairs live memory cleanup automations that reference unsupported memory CLI commands', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-memory-cleanup-'))
    tempDirs.push(dataDir)
    const automationsDir = path.join(dataDir, 'automations')
    const commanderDataDir = path.join(dataDir, 'commander')
    await mkdir(automationsDir, { recursive: true })

    const staleInstruction = 'For each active commander, run hammurabi memory compact --commander <id>.'
    const supportedMemoryCommands = await readSupportedMemoryCliSubcommands()
    expect(extractMemoryCliSubcommands(staleInstruction).some((command) =>
      !supportedMemoryCommands.has(command),
    )).toBe(true)

    await writeFile(
      path.join(automationsDir, 'memory-consolidation-id.json'),
      `${JSON.stringify({
        id: 'memory-consolidation-id',
        operatorId: 'founder-test',
        parentCommanderId: null,
        name: 'memory-consolidation',
        trigger: 'schedule',
        schedule: '0 0 * * *',
        instruction: staleInstruction,
        agentType: 'codex',
        permissionMode: 'default',
        skills: [],
        status: 'active',
        description: 'Nightly memory compaction across all active commanders - midnight ET',
        timezone: 'America/New_York',
        workDir: '/home/builder/App/apps/hammurabi',
        model: 'gpt-5.5',
        sessionType: 'stream',
        createdAt: '2026-04-17T02:00:18.315Z',
        lastRun: '2026-06-12T04:06:06.207Z',
        totalRuns: 56,
        totalCostUsd: 59.002174,
        history: [{
          timestamp: '2026-06-12T04:06:06.207Z',
          action: 'No completion comment provided.',
          result: 'No completion comment provided.',
          costUsd: 0,
          durationSec: 366,
          source: 'schedule',
        }],
      }, null, 2)}\n`,
      'utf8',
    )

    const store = new AutomationStore({
      dirPath: automationsDir,
      commanderDataDir,
    })
    await store.ensureLoaded()

    const memoryCleanup = await store.get('memory-consolidation-id')
    expect(memoryCleanup).toMatchObject({
      name: 'memory-consolidation',
      skills: ['commander-memory-cleanup'],
      lastRun: '2026-06-12T04:06:06.207Z',
      totalRuns: 56,
      totalCostUsd: 59.002174,
    })
    expect(memoryCleanup?.history).toHaveLength(1)
    expect(memoryCleanup?.instruction).toContain('/commander-memory-cleanup')
    expect(extractMemoryCliSubcommands(memoryCleanup?.instruction ?? '').filter((command) =>
      !supportedMemoryCommands.has(command),
    )).toEqual([])
  })

  it('globalizes Atlas hygiene automations in place while preserving history', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-atlas-global-'))
    tempDirs.push(dataDir)
    const automationsDir = path.join(dataDir, 'automations')
    const commanderDataDir = path.join(dataDir, 'commander')
    await mkdir(automationsDir, { recursive: true })

    const history = [
      {
        timestamp: '2026-06-01T04:00:00.000Z',
        action: 'Run completed',
        result: 'Cleaned context hygiene.',
        costUsd: 0.25,
        durationSec: 42,
        source: 'schedule',
      },
    ]
    await writeFile(
      path.join(automationsDir, 'context-hygiene-id.json'),
      `${JSON.stringify({
        id: 'context-hygiene-id',
        operatorId: 'founder-test',
        parentCommanderId: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
        name: 'context-hygiene',
        trigger: 'schedule',
        schedule: '0 4 * * *',
        instruction: 'Clean context.',
        agentType: 'claude',
        permissionMode: 'default',
        skills: ['context-rot-cleanup'],
        status: 'active',
        createdAt: '2026-05-01T00:00:00.000Z',
        lastRun: '2026-06-01T04:00:00.000Z',
        totalRuns: 37,
        totalCostUsd: 9.25,
        history,
        memoryPath: path.join(automationsDir, 'context-hygiene-id', 'memory.md'),
        outputDir: path.join(automationsDir, 'context-hygiene-id'),
      }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(automationsDir, 'atlas-other.json'),
      `${JSON.stringify({
        id: 'atlas-other',
        operatorId: 'founder-test',
        parentCommanderId: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
        name: 'atlas-specific-task',
        trigger: 'schedule',
        schedule: '0 12 * * *',
        instruction: 'Stay scoped.',
        agentType: 'claude',
        permissionMode: 'default',
        skills: [],
        status: 'active',
      }, null, 2)}\n`,
      'utf8',
    )

    const store = new AutomationStore({
      dirPath: automationsDir,
      commanderDataDir,
    })
    await store.ensureLoaded()

    const moved = await store.get('context-hygiene-id')
    expect(moved).toMatchObject({
      id: 'context-hygiene-id',
      parentCommanderId: null,
      totalRuns: 37,
      totalCostUsd: 9.25,
      lastRun: '2026-06-01T04:00:00.000Z',
      history,
    })
    expect(await store.get('atlas-other')).toMatchObject({
      id: 'atlas-other',
      parentCommanderId: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
    })
    const written = JSON.parse(await readFile(path.join(automationsDir, 'context-hygiene-id.json'), 'utf8')) as {
      parentCommanderId?: string | null
      history?: unknown[]
    }
    expect(written.parentCommanderId).toBeNull()
    expect(written.history).toEqual(history)
  })

  it('keeps automations usable when the scheduler starts before founder setup', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-first-boot-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = await startServer(dataDir)

    try {
      await expect(server.initialized).resolves.toBeUndefined()
      expect(consoleError).not.toHaveBeenCalled()

      const firstListResponse = await fetch(`${server.baseUrl}/api/automations`, {
        headers: API_HEADERS,
      })
      expect(firstListResponse.status).toBe(200)
      expect(await firstListResponse.json()).toEqual([])

      const orgResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick.gu@example.com',
          },
        }),
      })
      expect(orgResponse.status).toBe(201)

      const createResponse = await fetch(`${server.baseUrl}/api/automations`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'First boot schedule',
          trigger: 'schedule',
          schedule: '* * * * *',
          instruction: 'Confirm automations still work after founder setup.',
          agentType: 'claude',
          status: 'active',
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as Record<string, unknown>
      expect(created.operatorId).toEqual(expect.stringMatching(/^founder-/))
      expect(server.scheduledJobs).toEqual([
        {
          expression: '* * * * *',
          name: `automation-${created.id}`,
        },
      ])

      const secondListResponse = await fetch(`${server.baseUrl}/api/automations`, {
        headers: API_HEADERS,
      })
      expect(secondListResponse.status).toBe(200)
      const automations = await secondListResponse.json() as Array<Record<string, unknown>>
      expect(automations).toHaveLength(1)
      expect(automations[0]).toMatchObject({
        id: created.id,
        name: 'First boot schedule',
        operatorId: created.operatorId,
      })
    } finally {
      consoleError.mockRestore()
      await server.close()
    }
  })

  it('persists CLI-created schedule automations and exposes show/list fields', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-cli-create-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    const agentSkillsDir = path.join(dataDir, 'agent-skills')
    for (const skill of ['gog', 'hammurabi']) {
      const skillDir = path.join(agentSkillsDir, 'core', skill)
      await mkdir(skillDir, { recursive: true })
      await writeFile(path.join(skillDir, 'SKILL.md'), `# ${skill}\n`, 'utf8')
    }
    process.env.HAMMURABI_AGENT_SKILLS_DIR = agentSkillsDir
    const commanderId = 'df5eb54a-8b36-41d1-9164-300d11e6da79'
    const server = await startServer(dataDir, new Set([commanderId]))

    try {
      await expect(server.initialized).resolves.toBeUndefined()
      const orgResponse = await fetch(`${server.baseUrl}/api/org`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Gehirn',
          founder: {
            displayName: 'Nick Gu',
            email: 'nick.gu@example.com',
          },
        }),
      })
      expect(orgResponse.status).toBe(201)

      const createResponse = await fetch(`${server.baseUrl}/api/automations`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          trigger: 'schedule',
          name: 'Gehirn grant and CRM email tracker',
          parentCommanderId: commanderId,
          schedule: '0 9 * * *',
          timezone: 'America/New_York',
          workDir: '/home/builder/PKMS/gehirn-monorepo',
          agentType: 'codex',
          permissionMode: 'default',
          sessionType: 'stream',
          skills: ['gog', 'hammurabi'],
          enabled: true,
          instruction: 'Run Operations/automation/email-followup-tracker/run_and_push.sh',
        }),
      })
      const createBody = await createResponse.text()
      expect(createResponse.status, createBody).toBe(201)
      const created = JSON.parse(createBody) as Record<string, unknown>
      expect(created).toMatchObject({
        name: 'Gehirn grant and CRM email tracker',
        parentCommanderId: commanderId,
        schedule: '0 9 * * *',
        timezone: 'America/New_York',
        workDir: '/home/builder/PKMS/gehirn-monorepo',
        agentType: 'codex',
        permissionMode: 'default',
        sessionType: 'stream',
        skills: ['gog', 'hammurabi'],
        status: 'active',
        enabled: true,
      })
      expect(server.scheduledJobs).toEqual([
        {
          expression: '0 9 * * *',
          name: `automation-${created.id}`,
          timezone: 'America/New_York',
        },
      ])

      const showResponse = await fetch(`${server.baseUrl}/api/automations/${created.id}`, {
        headers: API_HEADERS,
      })
      expect(showResponse.status).toBe(200)
      await expect(showResponse.json()).resolves.toMatchObject({
        id: created.id,
        parentCommanderId: commanderId,
        schedule: '0 9 * * *',
        workDir: '/home/builder/PKMS/gehirn-monorepo',
        agentType: 'codex',
        permissionMode: 'default',
        sessionType: 'stream',
        skills: ['gog', 'hammurabi'],
        enabled: true,
      })

      const listResponse = await fetch(`${server.baseUrl}/api/automations?parentCommanderId=${commanderId}`, {
        headers: API_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const listed = await listResponse.json() as Array<Record<string, unknown>>
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        id: created.id,
        enabled: true,
      })

      const persisted = JSON.parse(
        await readFile(path.join(dataDir, 'automations', `${created.id}.json`), 'utf8'),
      ) as Record<string, unknown>
      expect(persisted).toMatchObject({
        id: created.id,
        parentCommanderId: commanderId,
        status: 'active',
        workDir: '/home/builder/PKMS/gehirn-monorepo',
        skills: ['gog', 'hammurabi'],
      })
    } finally {
      await server.close()
    }
  })

  it('defers legacy automation migration until a founder exists', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-legacy-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    await mkdir(path.join(dataDir, 'automation'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'automation', 'tasks.json'),
      `${JSON.stringify({
        tasks: [
          {
            id: 'legacy-task',
            name: 'Legacy task',
            schedule: '* * * * *',
            instruction: 'Run the legacy task.',
          },
        ],
      })}\n`,
      'utf8',
    )
    const store = new AutomationStore({
      dirPath: path.join(dataDir, 'automations'),
      commanderDataDir: path.join(dataDir, 'commander'),
    })

    await expect(store.ensureLoaded()).resolves.toBeUndefined()
    expect(await store.list()).toEqual([])

    await new OperatorStore(path.join(dataDir, 'operators.json')).saveFounder({
      id: 'founder-test',
      kind: 'founder',
      displayName: 'Founder Test',
      email: 'founder@example.com',
      avatarUrl: null,
      createdAt: '2026-05-07T00:00:00.000Z',
    })

    const automations = await store.list()
    expect(automations).toHaveLength(1)
    expect(automations[0]).toMatchObject({
      id: 'legacy-task',
      operatorId: 'founder-test',
      name: 'Legacy task',
      trigger: 'schedule',
      schedule: '* * * * *',
    })
  })

  it('does not suppress corrupted operator stores when migration needs a founder', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-automations-corrupt-'))
    tempDirs.push(dataDir)
    process.env.HAMMURABI_DATA_DIR = dataDir
    await mkdir(path.join(dataDir, 'automation'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'automation', 'tasks.json'),
      `${JSON.stringify({
        tasks: [
          {
            id: 'legacy-task',
            name: 'Legacy task',
            schedule: '* * * * *',
            instruction: 'Run the legacy task.',
          },
        ],
      })}\n`,
      'utf8',
    )
    await writeFile(path.join(dataDir, 'operators.json'), '{bad json', 'utf8')
    const store = new AutomationStore({
      dirPath: path.join(dataDir, 'automations'),
      commanderDataDir: path.join(dataDir, 'commander'),
    })

    await expect(store.ensureLoaded()).rejects.toThrow('Invalid operator store JSON')
  })
})
