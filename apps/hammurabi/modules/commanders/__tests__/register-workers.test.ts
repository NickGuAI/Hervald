/**
 * Tests for the URL-baked commander worker dispatch route added in #1223.
 *
 * Coverage:
 *   - Auth gates: requires both `agents:write` and `commanders:write`. A key
 *     with only `agents:write` (the canonical default for /api/agents
 *     callers) is rejected with 403 — proving the new route is not a backdoor
 *     to commander attribution.
 *   - URL :id validation: malformed commander ids return 400 before any
 *     session-spawn work is attempted.
 *   - Commander existence: an unknown commander id returns 404 before
 *     dispatching, so callers can't quietly create attributed-to-nothing
 *     workers.
 *   - URL-baked creator: the dispatched worker carries
 *     `creator: { kind: "commander", id: <url-id> }` exactly — the route
 *     forwards the commander id from the URL to the agents-side
 *     `dispatchWorkerForCommander` helper.
 */
import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createCommandersRouter, type CommandersRouterOptions } from '../routes'
import type { CommanderSessionsInterface } from '../../agents/routes'

const COMMANDER_ID = '00000000-0000-4000-a000-0000000000aa'
const UNKNOWN_COMMANDER_ID = '00000000-0000-4000-a000-0000000000bb'

const FULL_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'full-scope-key',
}

const AGENTS_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'agents-only-key',
}

interface RunningServer {
  baseUrl: string
  httpServer: Server
  close: () => Promise<void>
}

interface CapturedDispatch {
  commanderId: string
  rawBody: unknown
}

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

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'full-scope-key': {
      id: 'full-scope-key-id',
      name: 'Full Scope Key',
      keyHash: 'hash-full',
      prefix: 'hmrb_full',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'commanders:read', 'commanders:write'],
    },
    'agents-only-key': {
      id: 'agents-only-key-id',
      name: 'Agents Only Key',
      keyHash: 'hash-agents',
      prefix: 'hmrb_ago',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
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
      return { ok: true as const, record }
    },
  }
}

function createMockSessionsInterface(): {
  iface: CommanderSessionsInterface
  dispatchCalls: CapturedDispatch[]
} {
  const dispatchCalls: CapturedDispatch[] = []
  const iface: CommanderSessionsInterface = {
    async createCommanderSession(params) {
      return { kind: 'stream', name: params.name } as unknown as Awaited<ReturnType<
        CommanderSessionsInterface['createCommanderSession']
      >>
    },
    async dispatchWorkerForCommander(input) {
      dispatchCalls.push({ commanderId: input.commanderId, rawBody: input.rawBody })
      const body =
        input.rawBody && typeof input.rawBody === 'object'
          ? (input.rawBody as Record<string, unknown>)
          : {}
      const sessionName = typeof body.name === 'string' ? body.name : 'worker-1'
      return {
        status: 201,
        body: {
          sessionName,
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'commander', id: input.commanderId },
          transportType: 'stream',
          agentType: typeof body.agentType === 'string' ? body.agentType : 'claude',
          host: typeof body.host === 'string' ? body.host : undefined,
          created: true,
        },
      }
    },
    async sendToSession() {
      return false
    },
    deleteSession() {},
    getSession() {
      return undefined
    },
    subscribeToEvents() {
      return () => {}
    },
  }
  return { iface, dispatchCalls }
}

async function startServer(
  options: Partial<CommandersRouterOptions> & {
    sessionsInterface?: CommanderSessionsInterface
  } = {},
): Promise<RunningServer> {
  const sessionStorePath = options.sessionStorePath
    ?? join(await createTempDir('hammurabi-commanders-register-workers-store-'), 'sessions.json')
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

async function seedCommander(storePath: string): Promise<void> {
  await writeFile(
    storePath,
    JSON.stringify(
      {
        sessions: [
          {
            id: COMMANDER_ID,
            host: 'host-a',
            pid: null,
            state: 'idle',
            created: '2026-02-20T00:00:00.000Z',
            lastHeartbeat: null,
            taskSource: { owner: 'NickGuAI', repo: 'example-repo', label: 'commander' },
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
}

describe('POST /api/commanders/:id/workers', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const dir = await createTempDir('hammurabi-register-workers-auth-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const { iface } = createMockSessionsInterface()
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'worker-test', agentType: 'codex' }),
        },
      )
      expect(response.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('rejects an API key missing commanders:write with 403', async () => {
    const dir = await createTempDir('hammurabi-register-workers-scope-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const { iface, dispatchCalls } = createMockSessionsInterface()
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: {
            ...AGENTS_ONLY_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'worker-test', agentType: 'codex' }),
        },
      )
      expect(response.status).toBe(403)
      expect(dispatchCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('rejects an invalid :id with 400', async () => {
    const dir = await createTempDir('hammurabi-register-workers-bad-id-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const { iface, dispatchCalls } = createMockSessionsInterface()
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/not%20a%20uuid/workers`,
        {
          method: 'POST',
          headers: {
            ...FULL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'worker-test', agentType: 'codex' }),
        },
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid commander id' })
      expect(dispatchCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('rejects an unknown :id with 404 before dispatching', async () => {
    const dir = await createTempDir('hammurabi-register-workers-unknown-id-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const { iface, dispatchCalls } = createMockSessionsInterface()
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${UNKNOWN_COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: {
            ...FULL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'worker-test', agentType: 'codex' }),
        },
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: `Commander "${UNKNOWN_COMMANDER_ID}" not found`,
      })
      expect(dispatchCalls).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('forwards URL-baked commanderId to dispatchWorkerForCommander on success', async () => {
    const dir = await createTempDir('hammurabi-register-workers-success-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const { iface, dispatchCalls } = createMockSessionsInterface()
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: {
            ...FULL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'worker-attribution-test',
            agentType: 'codex',
            host: 'yus-mac-mini',
            cwd: '/Users/yugu/Desktop/TheG/example-repo',
            task: 'echo hello',
          }),
        },
      )
      expect(response.status).toBe(201)
      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.creator).toEqual({ kind: 'commander', id: COMMANDER_ID })
      expect(payload.sessionType).toBe('worker')
      expect(payload.transportType).toBe('stream')
      expect(payload.created).toBe(true)

      expect(dispatchCalls).toHaveLength(1)
      expect(dispatchCalls[0]?.commanderId).toBe(COMMANDER_ID)
      const body = dispatchCalls[0]?.rawBody as Record<string, unknown>
      expect(body.name).toBe('worker-attribution-test')
      expect(body.agentType).toBe('codex')
      expect(body.host).toBe('yus-mac-mini')
      // Crucial: the request body did NOT carry creator (URL-baked design),
      // so the dispatch helper sees no creator field on the forwarded body.
      expect('creator' in body).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('returns 500 with a clear error when sessionsInterface is not configured', async () => {
    const dir = await createTempDir('hammurabi-register-workers-no-iface-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const server = await startServer({ sessionStorePath: storePath })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: {
            ...FULL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'worker-test', agentType: 'codex' }),
        },
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'sessionsInterface not configured' })
    } finally {
      await server.close()
    }
  })

  it('forwards 4xx errors from dispatchWorkerForCommander unchanged', async () => {
    const dir = await createTempDir('hammurabi-register-workers-forward-error-')
    const storePath = join(dir, 'sessions.json')
    await seedCommander(storePath)

    const iface: CommanderSessionsInterface = {
      async createCommanderSession(params) {
        return { kind: 'stream', name: params.name } as unknown as Awaited<ReturnType<
          CommanderSessionsInterface['createCommanderSession']
        >>
      },
      async dispatchWorkerForCommander() {
        return {
          status: 400,
          body: {
            error: 'creator must not be provided on /api/commanders/:id/workers — commander identity is baked from the URL',
          },
        }
      },
      async sendToSession() {
        return false
      },
      deleteSession() {},
      getSession() {
        return undefined
      },
      subscribeToEvents() {
        return () => {}
      },
    }
    const server = await startServer({ sessionStorePath: storePath, sessionsInterface: iface })

    try {
      const response = await fetch(
        `${server.baseUrl}/api/commanders/${COMMANDER_ID}/workers`,
        {
          method: 'POST',
          headers: {
            ...FULL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'worker-bad-creator',
            creator: { kind: 'commander', id: 'forged-attribution' },
          }),
        },
      )
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toContain('creator must not be provided')
    } finally {
      await server.close()
    }
  })
})
