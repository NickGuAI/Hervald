import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  }
})

import { spawn as spawnFn } from 'node:child_process'
import { createAgentsRouter, type AgentsRouterOptions } from '../routes'

const mockedSpawn = vi.mocked(spawnFn)

interface SpyablePassThrough extends PassThrough {
  write: ReturnType<typeof vi.fn>
}

interface MockChildProcess {
  cp: ChildProcess
  stdout: PassThrough
  stderr: PassThrough
  stdin: SpyablePassThrough
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
  httpServer: Server
}

interface TempMachinesRegistry {
  filePath: string
  cleanup: () => Promise<void>
}

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'dispatch-test-key',
}

const INTERNAL_TOKEN = 'dispatch-internal-token'

const INTERNAL_AUTH_HEADERS = {
  ...AUTH_HEADERS,
  'x-hammurabi-internal-token': INTERNAL_TOKEN,
}

const WRITE_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'dispatch-write-only-key',
}

let spawnedProcesses: MockChildProcess[] = []

function createMockChildProcess(pid: number): MockChildProcess {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough() as SpyablePassThrough
  const emitter = new EventEmitter()
  const originalWrite = stdin.write.bind(stdin) as (...args: unknown[]) => boolean
  const writeSpy = vi.fn((...args: unknown[]) => originalWrite(...args))

  stdin.write = writeSpy

  const cp = emitter as unknown as ChildProcess
  Object.assign(cp, {
    pid,
    stdout,
    stderr,
    stdin,
    kill: vi.fn((signal?: number | NodeJS.Signals) => {
      const normalizedSignal = typeof signal === 'string' ? signal : null
      emitter.emit('exit', 0, normalizedSignal)
      return true
    }),
  })

  return { cp, stdout, stderr, stdin }
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'dispatch-test-key': {
      id: 'dispatch-key-id',
      name: 'Dispatch Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_dispatch',
      createdBy: 'test',
      createdAt: '2026-03-25T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'agents:admin'],
    },
    'dispatch-write-only-key': {
      id: 'dispatch-write-key-id',
      name: 'Dispatch Write-only Key',
      keyHash: 'hash',
      prefix: 'hmrb_dispatch_write',
      createdBy: 'test',
      createdAt: '2026-03-25T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write'],
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

      return {
        ok: true as const,
        record,
      }
    },
  }
}

async function startServer(options: Partial<AgentsRouterOptions> = {}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const agents = createAgentsRouter({
    apiKeyStore: createTestApiKeyStore(),
    autoResumeSessions: false,
    commanderSessionStorePath: '/tmp/nonexistent-commander-sessions-dispatch-worker-test.json',
    internalToken: INTERNAL_TOKEN,
    ...options,
  })
  app.use('/api/agents', agents.router)

  const httpServer = createServer(app)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/agents/')) {
      agents.handleUpgrade(req, socket, head)
    } else {
      socket.destroy()
    }
  })

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
      await agents.sessionsInterface.shutdown?.()
      httpServer.closeAllConnections?.()
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

async function createCommanderSession(
  baseUrl: string,
  name = 'commander-main',
  options: {
    headers?: Record<string, string>
    mode?: 'default'
  } = {},
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/agents/sessions`, {
    method: 'POST',
    headers: {
      ...(options.headers ?? INTERNAL_AUTH_HEADERS),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mode: options.mode ?? 'default',
      transportType: 'stream',
      sessionType: 'commander',
      creator: { kind: 'commander', id: 'api-key' },
      cwd: '/tmp',
    }),
  })

  expect(response.status).toBe(201)
}

async function createTempMachinesRegistry(contents: unknown): Promise<TempMachinesRegistry> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-machines-'))
  const filePath = join(dir, 'machines.json')
  const payload = typeof contents === 'string' ? contents : JSON.stringify(contents)
  await writeFile(filePath, payload)
  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function createRemoteParentSession(baseUrl: string, name = 'commander-remote'): Promise<void> {
  const response = await fetch(`${baseUrl}/api/agents/sessions`, {
    method: 'POST',
    headers: {
      ...INTERNAL_AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mode: 'default',
      transportType: 'stream',
      sessionType: 'commander',
      creator: { kind: 'commander', id: 'api-key' },
      host: 'gpu-1',
      cwd: '/home/builder/projects/issue-963',
    }),
  })

  expect(response.status).toBe(201)
}

beforeEach(() => {
  let nextPid = 1000
  spawnedProcesses = []
  mockedSpawn.mockReset()
  mockedSpawn.mockImplementation(() => {
    const mock = createMockChildProcess(nextPid)
    spawnedProcesses.push(mock)
    nextPid += 1
    return mock.cp as never
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('dispatch-worker', () => {
  it('creates a worker session with spawned lineage and worker typing', async () => {
    const server = await startServer()

    try {
      await createCommanderSession(server.baseUrl)

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-main',
          task: 'Investigate flaky worker status',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        sessionType: string
        creator?: { kind?: string; id?: string }
        cwd?: string
        spawnedBy?: string
      }

      expect(dispatchPayload.name).toMatch(/^worker-\d+/)
      expect(dispatchPayload.sessionType).toBe('worker')
      expect(dispatchPayload.creator).toEqual({
        kind: 'commander',
        id: 'api-key',
      })
      expect(dispatchPayload.cwd).toBe('/tmp')
      expect(dispatchPayload.spawnedBy).toBe('commander-main')

      expect(spawnedProcesses.length).toBe(2)
      const workerProcess = spawnedProcesses[1]
      await vi.waitFor(() => {
        expect(workerProcess.stdin.write).toHaveBeenCalled()
      })

      const taskWrite = workerProcess.stdin.write.mock.calls.find(([chunk]) =>
        typeof chunk === 'string' && chunk.includes('Investigate flaky worker status'),
      )
      expect(taskWrite).toBeDefined()

      workerProcess.stdout.write('{"type":"result","subtype":"success","result":"investigation complete","total_cost_usd":0.05}\n')
      const workerEmitter = workerProcess.cp as unknown as EventEmitter
      workerEmitter.emit('exit', 0, null)

      await vi.waitFor(async () => {
        const statusResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(dispatchPayload.name)}`,
          { headers: AUTH_HEADERS },
        )
        expect(statusResponse.status).toBe(200)
        const statusPayload = await statusResponse.json() as {
          completed: boolean
          status: string
          sessionType?: string
          spawnedBy?: string
          result?: { finalComment?: string }
        }
        expect(statusPayload.completed).toBe(true)
        expect(statusPayload.status).toBe('success')
        expect(statusPayload.sessionType).toBe('worker')
        expect(statusPayload.spawnedBy).toBe('commander-main')
        expect(statusPayload.result?.finalComment).toBe('investigation complete')
      })

      const workersResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/commander-main/workers`,
        { headers: AUTH_HEADERS },
      )
      expect(workersResponse.status).toBe(200)
      const workers = await workersResponse.json() as Array<{ name: string; status: string }>
      expect(workers).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: dispatchPayload.name, status: 'done' }),
      ]))

      const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      expect(sessionsResponse.status).toBe(200)
      const sessions = await sessionsResponse.json() as Array<{
        name: string
        sessionType?: string
        creator?: { kind?: string; id?: string }
        spawnedBy?: string
      }>
      expect(sessions.find((entry) => entry.name === dispatchPayload.name)).toMatchObject({
        sessionType: 'worker',
        creator: {
          kind: 'commander',
          id: 'api-key',
        },
        spawnedBy: 'commander-main',
      })
    } finally {
      await server.close()
    }
  })

  it('creates a standalone worker with an optional initial task and requested cwd', async () => {
    const server = await startServer()

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          cwd: '/tmp/standalone-worker',
          task: '/legion-implement https://github.com/NickGuAI/Hervald/issues/818',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        sessionType: string
        creator?: { kind?: string; id?: string }
        cwd?: string
        spawnedBy?: string
      }

      expect(dispatchPayload.name).toMatch(/^worker-\d+/)
      expect(dispatchPayload.sessionType).toBe('worker')
      expect(dispatchPayload.creator).toEqual({
        kind: 'human',
      })
      expect(dispatchPayload.cwd).toBe('/tmp/standalone-worker')
      expect(dispatchPayload.spawnedBy).toBeUndefined()

      expect(spawnedProcesses.length).toBe(1)
      const workerProcess = spawnedProcesses[0]
      await vi.waitFor(() => {
        expect(workerProcess.stdin.write).toHaveBeenCalled()
      })

      const taskWrite = workerProcess.stdin.write.mock.calls.find(([chunk]) =>
        typeof chunk === 'string' &&
        chunk.includes('/legion-implement https://github.com/NickGuAI/Hervald/issues/818'),
      )
      expect(taskWrite).toBeDefined()

      const statusResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(dispatchPayload.name)}`,
        { headers: AUTH_HEADERS },
      )
      expect(statusResponse.status).toBe(200)
      const statusPayload = await statusResponse.json() as {
        completed: boolean
        agentType?: string
        sessionType?: string
        creator?: { kind?: string; id?: string }
        cwd?: string
        spawnedBy?: string
      }
      expect(statusPayload.completed).toBe(false)
      expect(statusPayload.agentType).toBe('claude')
      expect(statusPayload.sessionType).toBe('worker')
      expect(statusPayload.creator).toEqual({
        kind: 'human',
      })
      expect(statusPayload.cwd).toBe('/tmp/standalone-worker')
      expect(statusPayload.spawnedBy).toBeUndefined()
    } finally {
      await server.close()
    }
  })

  it('allows creating a worker without an initial task', async () => {
      const server = await startServer()

    try {
      await createCommanderSession(server.baseUrl)

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-main',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        cwd?: string
        spawnedBy?: string
      }
      expect(dispatchPayload.name).toMatch(/^worker-\d+/)
      expect(dispatchPayload.cwd).toBe('/tmp')
      expect(dispatchPayload.spawnedBy).toBe('commander-main')
      expect(spawnedProcesses.length).toBe(2)
      const workerProcess = spawnedProcesses[1]
      expect(workerProcess.stdin.write).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('dispatches workers from default-mode parents in default mode', async () => {
    const server = await startServer()

    try {
      await createCommanderSession(server.baseUrl, 'commander-dangerous', {
        mode: 'default',
      })

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...WRITE_ONLY_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-dangerous',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const payload = await dispatchResponse.json() as { name: string; spawnedBy?: string }
      expect(payload.name).toMatch(/^worker-\d+/)
      expect(payload.spawnedBy).toBe('commander-dangerous')
      expect(spawnedProcesses).toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it('preserves the parent session cwd for remote workers when cwd is omitted', async () => {
    const registry = await createTempMachinesRegistry({
      machines: [
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          port: 22,
          cwd: '/home/builder/workspace',
        },
      ],
    })
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      await createRemoteParentSession(server.baseUrl)

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-remote',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        cwd?: string
        spawnedBy?: string
      }

      expect(dispatchPayload.name).toMatch(/^worker-\d+/)
      expect(dispatchPayload.cwd).toBe('/home/builder/projects/issue-963')
      expect(dispatchPayload.spawnedBy).toBe('commander-remote')

      expect(mockedSpawn).toHaveBeenCalledTimes(2)
      const sshArgs = mockedSpawn.mock.calls[1]?.[1]
      expect(Array.isArray(sshArgs)).toBe(true)
      const remoteCommand = sshArgs?.[sshArgs.length - 1]
      expect(remoteCommand).toContain('cd ')
      expect(remoteCommand).toContain('/home/builder/projects/issue-963')
      expect(remoteCommand).not.toContain('/home/builder/workspace')
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('uses the target machine cwd when dispatch overrides the machine without an explicit cwd', async () => {
    const registry = await createTempMachinesRegistry({
      machines: [
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          port: 22,
          cwd: '/home/builder/workspace',
        },
      ],
    })
    const server = await startServer({ machinesFilePath: registry.filePath })

    try {
      await createCommanderSession(server.baseUrl)

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-main',
          machine: 'gpu-1',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        cwd?: string
        spawnedBy?: string
      }

      expect(dispatchPayload.name).toMatch(/^worker-\d+/)
      expect(dispatchPayload.cwd).toBe('/home/builder/workspace')
      expect(dispatchPayload.spawnedBy).toBe('commander-main')

      expect(mockedSpawn).toHaveBeenCalledTimes(2)
      const sshArgs = mockedSpawn.mock.calls[1]?.[1]
      expect(Array.isArray(sshArgs)).toBe(true)
      const remoteCommand = sshArgs?.[sshArgs.length - 1]
      expect(remoteCommand).toContain('cd ')
      expect(remoteCommand).toContain('/home/builder/workspace')
      expect(remoteCommand).not.toContain('/tmp')
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('requires cwd for standalone worker dispatch when no spawn source is available', async () => {
    const server = await startServer()

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          task: 'Handle standalone worker',
        }),
      })

      expect(dispatchResponse.status).toBe(400)
      expect(await dispatchResponse.json()).toEqual({
        error: 'Provide cwd when spawnedBy is omitted',
      })
    } finally {
      await server.close()
    }
  })

  describe('remote approval bridge (issue/1224)', () => {
    it('reverse-tunnels the approval daemon and propagates the internal token for remote Claude worker dispatch', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'remote-test',
            label: 'Remote Test Mac',
            host: 'remote.test',
            user: 'tester',
          },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      const originalPort = process.env.HAMMURABI_PORT
      process.env.HAMMURABI_PORT = '20001'

      try {
        await createCommanderSession(server.baseUrl)

        const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            spawnedBy: 'commander-main',
            machine: 'remote-test',
            agentType: 'claude',
            cwd: '/tmp',
          }),
        })

        expect(dispatchResponse.status).toBe(202)

        expect(mockedSpawn).toHaveBeenCalledTimes(2)
        const [command, args] = mockedSpawn.mock.calls[1]!
        expect(command).toBe('ssh')

        const sshArgs = args as string[]

        const rIdx = sshArgs.indexOf('-R')
        expect(rIdx).toBeGreaterThan(-1)
        expect(sshArgs[rIdx + 1]).toBe('127.0.0.1:20001:127.0.0.1:20001')

        const sendEnvIdx = sshArgs.findIndex(
          (arg) => typeof arg === 'string' && arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN',
        )
        expect(sendEnvIdx).toBeGreaterThan(-1)
        expect(sshArgs.join(' ')).not.toContain(INTERNAL_TOKEN)

        const destinationIdx = sshArgs.indexOf('tester@remote.test')
        expect(destinationIdx).toBeGreaterThan(-1)
        expect(rIdx).toBeLessThan(destinationIdx)
        expect(sendEnvIdx).toBeLessThan(destinationIdx)
      } finally {
        if (originalPort === undefined) {
          delete process.env.HAMMURABI_PORT
        } else {
          process.env.HAMMURABI_PORT = originalPort
        }
        await server.close()
        await registry.cleanup()
      }
    })

    it('omits approval bridge flags for Codex remote worker dispatch (Codex uses granular stdio approval)', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'remote-test',
            label: 'Remote Test Mac',
            host: 'remote.test',
            user: 'tester',
          },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        await createCommanderSession(server.baseUrl)

        const dispatchPromise = fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            spawnedBy: 'commander-main',
            machine: 'remote-test',
            agentType: 'codex',
            cwd: '/tmp',
          }),
        })

        // Codex remote dispatch ssh-spawns a remote app-server inside
        // ensureConnected, which then awaits an `initialize` response that
        // the mock will never send. Inspect the captured spawn args first,
        // then emit exit on the mock to unstick the dispatch route.
        await vi.waitFor(() => {
          expect(mockedSpawn).toHaveBeenCalledTimes(2)
        })

        const [command, args] = mockedSpawn.mock.calls[1]!
        expect(command).toBe('ssh')
        const sshArgs = args as string[]
        expect(sshArgs).not.toContain('-R')
        expect(
          sshArgs.find(
            (arg) => typeof arg === 'string' && arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN',
          ),
        ).toBeUndefined()

        const codexProcess = spawnedProcesses[1]
        const codexEmitter = codexProcess.cp as unknown as EventEmitter
        codexEmitter.emit('exit', 1, null)

        // Force exit(1) on the runtime makes ensureConnected reject, so the
        // dispatch route MUST surface 500 (the codex bootstrap failed).
        // Locking in 500 here prevents a future bug from silently bypassing
        // ensureConnected and producing a spurious 202 with no real session.
        const dispatchResponse = await dispatchPromise
        expect(dispatchResponse.status).toBe(500)
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

    it('does not emit any SSH spawn or approval bridge flags for local Claude worker dispatch', async () => {
      const server = await startServer()

      try {
        await createCommanderSession(server.baseUrl)

        const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            spawnedBy: 'commander-main',
            agentType: 'claude',
          }),
        })

        expect(dispatchResponse.status).toBe(202)

        expect(mockedSpawn).toHaveBeenCalledTimes(2)
        for (const [command, args] of mockedSpawn.mock.calls) {
          expect(command).not.toBe('ssh')
          const argList = args as string[]
          expect(argList).not.toContain('-R')
          expect(
            argList.find(
              (arg) => typeof arg === 'string' && arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN',
            ),
          ).toBeUndefined()
        }
      } finally {
        await server.close()
      }
    })
  })
})
