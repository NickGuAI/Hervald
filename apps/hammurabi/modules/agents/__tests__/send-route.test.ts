import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocketServer } from 'ws'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  }
})

import { createAgentsRouter, type AgentsRouterOptions } from '../routes'
import { spawn as spawnFn } from 'node:child_process'

const mockedSpawn = vi.mocked(spawnFn)

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
  httpServer: Server
}

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const record: import('../../../server/api-keys/store').ApiKeyRecord = {
    id: 'test-key-id',
    name: 'Test Key',
    keyHash: 'hash',
    prefix: 'hmrb_test',
    createdBy: 'test',
    createdAt: '2026-03-01T00:00:00.000Z',
    lastUsedAt: null,
    scopes: ['agents:read', 'agents:write'],
  }

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
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
    commanderSessionStorePath: '/tmp/nonexistent-send-route-test.json',
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

interface MockCodexRuntimeHarness {
  requests: Array<{ method: string; params: unknown }>
  turnStartInputs: string[]
  turnSteerInputs: string[]
  getRuntimeSpawnCount(): number
  getStartedThreadIds(): string[]
  deferNextTurnStartResponse(): void
  emitNotification(method: string, params: Record<string, unknown>): void
  releaseDeferredTurnStarts(): void
  setTurnStartBehavior(behavior: MockCodexTurnStartBehavior): void
  setTurnSteerBehavior(behavior: MockCodexTurnSteerBehavior): void
  close(): Promise<void>
}

type MockCodexTurnStartBehavior = 'success' | 'busy'
type MockCodexTurnSteerBehavior = 'success' | 'busy' | 'mismatch'

function getCodexInputText(params: unknown): string {
  if (!params || typeof params !== 'object') {
    return ''
  }

  const input = Array.isArray((params as { input?: unknown }).input)
    ? (params as { input: Array<{ text?: unknown }> }).input[0]
    : undefined
  return typeof input?.text === 'string' ? input.text : ''
}

function installMockCodexSidecar(): MockCodexRuntimeHarness {
  const turnStartInputs: string[] = []
  const turnSteerInputs: string[] = []
  const requests: Array<{ method: string; params: unknown }> = []
  const startedThreadIds: string[] = []
  const activeTurnIds = new Map<string, string>()
  const servers = new Set<WebSocketServer>()
  const sockets = new Set<import('ws').WebSocket>()
  const deferredTurnStartResponses: Array<{ socket: import('ws').WebSocket; payload: string }> = []
  let threadCounter = 0
  let runtimeSpawnCount = 0
  let deferredTurnStartCount = 0
  let turnStartBehavior: MockCodexTurnStartBehavior = 'success'
  let turnSteerBehavior: MockCodexTurnSteerBehavior = 'success'

  mockedSpawn.mockImplementation((command, args) => {
    if (command !== 'codex' || !Array.isArray(args) || args[0] !== 'app-server') {
      throw new Error(`Unexpected spawn call in send-route.test: ${command}`)
    }

    const listenIndex = args.indexOf('--listen')
    if (listenIndex === -1) {
      throw new Error('Missing --listen flag for mocked Codex runtime')
    }

    const listenTarget = args[listenIndex + 1]
    const match = typeof listenTarget === 'string' ? listenTarget.match(/:(\d+)$/) : null
    if (!match) {
      throw new Error('Missing codex sidecar listen port')
    }

    runtimeSpawnCount += 1
    const runtimeEmitter = new EventEmitter()
    let exited = false
    const emitExit = (code: number | null, signal: string | null = null) => {
      if (exited) {
        return
      }
      exited = true
      runtimeProcess.exitCode = code
      runtimeProcess.signalCode = signal
      runtimeEmitter.emit('exit', code, signal)
      runtimeEmitter.emit('close', code, signal)
    }
    const runtimeProcess = Object.assign(runtimeEmitter, {
      pid: process.pid,
      stdin: null,
      stdout: null,
      stderr: null,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn((signal?: string) => {
        emitExit(null, typeof signal === 'string' ? signal : 'SIGTERM')
        return true
      }),
    })

    const port = Number(match[1])
    const sidecarServer = new WebSocketServer({ host: '127.0.0.1', port })
    servers.add(sidecarServer)
    sidecarServer.on('connection', (socket) => {
      sockets.add(socket as import('ws').WebSocket)
      socket.on('close', () => {
        sockets.delete(socket as import('ws').WebSocket)
      })
      socket.on('message', (data) => {
        const raw = JSON.parse(data.toString()) as {
          id?: number
          method?: string
          params?: unknown
        }

        if (typeof raw.id !== 'number' || typeof raw.method !== 'string') {
          return
        }

        requests.push({ method: raw.method, params: raw.params })

        if (raw.method === 'thread/start') {
          threadCounter += 1
          const threadId = `thread-test-${threadCounter}`
          startedThreadIds.push(threadId)
          socket.send(JSON.stringify({ id: raw.id, result: { thread: { id: threadId } } }))
          return
        }

        if (raw.method === 'turn/start') {
          const textValue = getCodexInputText(raw.params)
          turnStartInputs.push(textValue)
          const payload = JSON.stringify({ id: raw.id, result: { turn: { id: `turn-${turnStartInputs.length}` } } })
          if (deferredTurnStartCount > 0) {
            deferredTurnStartCount -= 1
            deferredTurnStartResponses.push({
              socket: socket as import('ws').WebSocket,
              payload,
            })
            return
          }
          if (turnStartBehavior === 'busy') {
            socket.send(JSON.stringify({
              id: raw.id,
              error: { code: -32001, message: 'Turn already in progress' },
            }))
            return
          }
          socket.send(payload)
          return
        }

        if (raw.method === 'turn/steer') {
          const params = (raw.params && typeof raw.params === 'object')
            ? raw.params as { expectedTurnId?: unknown; threadId?: unknown }
            : {}
          const expectedTurnId = typeof params.expectedTurnId === 'string' ? params.expectedTurnId : undefined
          const threadId = typeof params.threadId === 'string' ? params.threadId : undefined
          const activeTurnId = threadId ? activeTurnIds.get(threadId) : undefined
          turnSteerInputs.push(getCodexInputText(raw.params))

          if (turnSteerBehavior === 'busy') {
            socket.send(JSON.stringify({
              id: raw.id,
              error: { code: -32001, message: 'Turn already in progress' },
            }))
            return
          }

          if (turnSteerBehavior === 'mismatch' || (expectedTurnId && activeTurnId && expectedTurnId !== activeTurnId)) {
            socket.send(JSON.stringify({
              id: raw.id,
              error: {
                code: -32002,
                message: `expectedTurnId mismatch: ${expectedTurnId ?? 'missing'} does not match active turn ${activeTurnId ?? 'none'}`,
              },
            }))
            return
          }

          socket.send(JSON.stringify({
            id: raw.id,
            result: {
              turnId: activeTurnId ?? expectedTurnId ?? `turn-steer-${turnSteerInputs.length}`,
            },
          }))
          return
        }

        socket.send(JSON.stringify({ id: raw.id, result: {} }))
      })
    })

    return runtimeProcess as never
  })

  return {
    requests,
    turnStartInputs,
    turnSteerInputs,
    getRuntimeSpawnCount: () => runtimeSpawnCount,
    getStartedThreadIds: () => [...startedThreadIds],
    deferNextTurnStartResponse: () => {
      deferredTurnStartCount += 1
    },
    emitNotification: (method, params) => {
      const targetThreadId = typeof params.threadId === 'string' ? params.threadId : undefined
      const turnId = params.turn && typeof params.turn === 'object' && typeof (params.turn as { id?: unknown }).id === 'string'
        ? (params.turn as { id: string }).id
        : undefined
      if (targetThreadId && method === 'turn/started' && turnId) {
        activeTurnIds.set(targetThreadId, turnId)
      }
      if (targetThreadId && (method === 'turn/completed' || method === 'turn/interrupted')) {
        if (!turnId || activeTurnIds.get(targetThreadId) === turnId) {
          activeTurnIds.delete(targetThreadId)
        }
      }
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: {
            ...params,
            ...(targetThreadId ? { threadId: targetThreadId } : {}),
          } }))
        }
      }
    },
    releaseDeferredTurnStarts: () => {
      const pendingResponses = deferredTurnStartResponses.splice(0, deferredTurnStartResponses.length)
      for (const pending of pendingResponses) {
        pending.socket.send(pending.payload)
      }
    },
    setTurnStartBehavior: (behavior) => {
      turnStartBehavior = behavior
    },
    setTurnSteerBehavior: (behavior) => {
      turnSteerBehavior = behavior
    },
    close: async () => {
      const closeJobs = [...servers].map(async (server) => {
        for (const client of server.clients) {
          client.close()
        }
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
      })
      await Promise.all(closeJobs)
      servers.clear()
    },
  }
}

function getTurnStartText(request: { params?: unknown } | undefined): string | null {
  return getCodexInputText(request?.params) || null
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /sessions/:name/send (codex)', () => {
  it('routes through codex turn/start for codex sessions', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
        }),
      })

      expect(createResponse.status).toBe(201)

      const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'codex send input' }),
      })

      expect(sendResponse.status).toBe(200)
      const sendPayload = (await sendResponse.json()) as { sent?: boolean; queued?: boolean }
      expect(sendPayload.sent).toBe(true)
      expect(sendPayload.queued ?? false).toBe(false)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['codex send input'])
      })
      expect(codexSidecar.turnSteerInputs).toEqual([])
      expect(codexSidecar.requests.some((request) => request.method === 'turn/start')).toBe(true)
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('spawns one Codex runtime per session and routes sends without cross-session coupling', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createAlpha = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-alpha',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
        }),
      })
      expect(createAlpha.status).toBe(201)

      const createBeta = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-beta',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
        }),
      })
      expect(createBeta.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.getRuntimeSpawnCount()).toBe(2)
        expect(codexSidecar.getStartedThreadIds()).toHaveLength(2)
      })

      const sendAlpha = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-alpha/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'alpha input' }),
      })
      expect(sendAlpha.status).toBe(200)

      const sendBeta = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-beta/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'beta input' }),
      })
      expect(sendBeta.status).toBe(200)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['alpha input', 'beta input'])
      })

      const turnRequests = codexSidecar.requests.filter((request) => request.method === 'turn/start')
      expect(turnRequests).toHaveLength(2)
      const threadIds = turnRequests.map((request) => {
        const params = request.params as { threadId?: unknown }
        return typeof params.threadId === 'string' ? params.threadId : null
      })
      expect(threadIds.filter((id): id is string => id !== null)).toHaveLength(2)
      expect(new Set(threadIds.filter((id): id is string => id !== null)).size).toBe(2)
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('steers /send live through Codex when an active turn id exists', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-queued',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })

      const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-queued/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'live steer follow-up' }),
      })

      expect(sendResponse.status).toBe(200)
      const sendPayload = (await sendResponse.json()) as { sent?: boolean; queued?: boolean }
      expect(sendPayload.sent).toBe(true)
      expect(sendPayload.queued ?? false).toBe(false)

      await vi.waitFor(() => {
        const steerRequests = codexSidecar.requests.filter((request) => request.method === 'turn/steer')
        expect(steerRequests).toHaveLength(1)
        expect(steerRequests[0]?.params).toEqual({
          expectedTurnId: 'turn-1',
          threadId,
          input: [{ type: 'text', text: 'live steer follow-up' }],
        })
      })

      expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      expect(codexSidecar.turnSteerInputs).toEqual(['live steer follow-up'])

      const queueResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-queued/queue`,
        { headers: AUTH_HEADERS },
      )
      expect(queueResponse.status).toBe(200)
      expect(await queueResponse.json()).toMatchObject({
        currentMessage: null,
        items: [],
        totalCount: 0,
      })
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it.each(['mismatch', 'busy'] as const)(
    'falls back to queued /send semantics when turn/steer returns %s during an active turn',
    async (steerBehavior) => {
      const codexSidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: `codex-http-send-fallback-${steerBehavior}`,
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task: 'initial busy turn',
          }),
        })

        expect(createResponse.status).toBe(201)

        await vi.waitFor(() => {
          expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
        })

        const threadId = codexSidecar.getStartedThreadIds()[0]
        expect(threadId).toBeTruthy()

        codexSidecar.emitNotification('turn/started', {
          threadId,
          turn: { id: 'turn-1', status: 'inProgress' },
        })
        codexSidecar.setTurnSteerBehavior(steerBehavior)

        const sendResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(`codex-http-send-fallback-${steerBehavior}`)}/send`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ text: 'queued follow-up' }),
          },
        )

        expect(sendResponse.status).toBe(202)
        expect(await sendResponse.json()).toEqual({ sent: false, queued: true })

        await vi.waitFor(() => {
          const steerRequests = codexSidecar.requests.filter((request) => request.method === 'turn/steer')
          expect(steerRequests.length).toBeGreaterThan(0)
          expect(steerRequests[0]?.params).toEqual({
            expectedTurnId: 'turn-1',
            threadId,
            input: [{ type: 'text', text: 'queued follow-up' }],
          })
        })

        const queueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(`codex-http-send-fallback-${steerBehavior}`)}/queue`,
          { headers: AUTH_HEADERS },
        )
        expect(queueResponse.status).toBe(200)
        expect(await queueResponse.json()).toMatchObject({
          currentMessage: { text: 'queued follow-up', priority: 'high' },
          items: [],
          totalCount: 1,
        })
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      } finally {
        await server.close()
        await codexSidecar.close()
      }
    },
  )

  it('propagates queue-full errors from /send when retryable steer fallback queueing is saturated', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-queue-full',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })
      codexSidecar.setTurnSteerBehavior('mismatch')

      for (let index = 0; index < 20; index += 1) {
        const queueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-http-send-queue-full/message?queue=true`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ text: `queued ${index + 1}` }),
          },
        )
        expect(queueResponse.status).toBe(202)
      }

      const sendResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-queue-full/send`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'overflow send' }),
        },
      )

      expect(sendResponse.status).toBe(409)
      expect(await sendResponse.json()).toEqual({
        sent: false,
        error: 'Queue is full (max 20 messages)',
      })
      expect(codexSidecar.requests.some((request) => {
        return request.method === 'turn/steer' && getTurnStartText(request) === 'overflow send'
      })).toBe(true)
      expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('returns queue-full errors from /message when retryable steer fallback queueing is saturated', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-message-queue-full',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })
      codexSidecar.setTurnSteerBehavior('busy')

      for (let index = 0; index < 20; index += 1) {
        const queueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-http-message-queue-full/message?queue=true`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ text: `queued ${index + 1}` }),
          },
        )
        expect(queueResponse.status).toBe(202)
      }

      const messageResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-message-queue-full/message`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'overflow send' }),
        },
      )

      expect(messageResponse.status).toBe(409)
      expect(await messageResponse.json()).toEqual({
        sent: false,
        error: 'Queue is full (max 20 messages)',
      })
      expect(codexSidecar.requests.some((request) => {
        return request.method === 'turn/steer' && getTurnStartText(request) === 'overflow send'
      })).toBe(true)
      expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('preempts repeated direct sends after retryable steer rejection and reports the occupied next-turn slot', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-preemption',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })
      codexSidecar.setTurnSteerBehavior('busy')

      const sendAResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-preemption/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'A' }),
      })
      expect(sendAResponse.status).toBe(202)
      expect(await sendAResponse.json()).toEqual({ sent: false, queued: true })

      const visibleQueueResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-preemption/message?queue=true`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'visible queue' }),
        },
      )
      expect(visibleQueueResponse.status).toBe(202)

      const stopResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-preemption/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'stop' }),
      })
      expect(stopResponse.status).toBe(202)
      expect(await stopResponse.json()).toEqual({ sent: false, queued: true })

      await vi.waitFor(() => {
        const steerTexts = codexSidecar.requests
          .filter((request) => request.method === 'turn/steer')
          .map((request) => getTurnStartText(request))
        expect(steerTexts).toContain('A')
        expect(steerTexts).toContain('stop')
      })

      const queuedSnapshotResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-preemption/queue`,
        { headers: AUTH_HEADERS },
      )
      expect(queuedSnapshotResponse.status).toBe(200)
      expect(await queuedSnapshotResponse.json()).toMatchObject({
        currentMessage: { text: 'stop', priority: 'high' },
        items: [
          { text: 'A', priority: 'high' },
          { text: 'visible queue', priority: 'normal' },
        ],
        totalCount: 3,
      })

      const requestCountBeforeStop = codexSidecar.requests.filter((request) => request.method === 'turn/start').length
      codexSidecar.setTurnStartBehavior('success')
      codexSidecar.emitNotification('turn/completed', {
        threadId,
        turn: { id: 'turn-1', status: 'completed' },
      })

      await vi.waitFor(() => {
        const newTurnStarts = codexSidecar.requests
          .filter((request) => request.method === 'turn/start')
          .slice(requestCountBeforeStop)
        expect(newTurnStarts.length).toBeGreaterThan(0)
        expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('stop')
      })

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-2', status: 'inProgress' },
      })
      const requestCountBeforeA = codexSidecar.requests.filter((request) => request.method === 'turn/start').length
      codexSidecar.emitNotification('turn/completed', {
        threadId,
        turn: { id: 'turn-2', status: 'completed' },
      })

      await vi.waitFor(() => {
        const newTurnStarts = codexSidecar.requests
          .filter((request) => request.method === 'turn/start')
          .slice(requestCountBeforeA)
        expect(newTurnStarts.length).toBeGreaterThan(0)
        expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('A')
      })

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-3', status: 'inProgress' },
      })
      const requestCountBeforeVisibleQueue = codexSidecar.requests.filter((request) => request.method === 'turn/start').length
      codexSidecar.emitNotification('turn/completed', {
        threadId,
        turn: { id: 'turn-3', status: 'completed' },
      })

      await vi.waitFor(() => {
        const newTurnStarts = codexSidecar.requests
          .filter((request) => request.method === 'turn/start')
          .slice(requestCountBeforeVisibleQueue)
        expect(newTurnStarts.length).toBeGreaterThan(0)
        expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('visible queue')
      })
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('clears a pending direct-send fallback slot without leaving queue counts hidden', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-send-clear-preemption',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })
      codexSidecar.setTurnSteerBehavior('busy')

      const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-clear-preemption/send`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'stop' }),
      })
      expect(sendResponse.status).toBe(202)
      expect(await sendResponse.json()).toEqual({ sent: false, queued: true })

      await vi.waitFor(() => {
        const steerTexts = codexSidecar.requests
          .filter((request) => request.method === 'turn/steer')
          .map((request) => getTurnStartText(request))
        expect(steerTexts).toContain('stop')
      })

      const pendingSnapshotResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-clear-preemption/queue`,
        { headers: AUTH_HEADERS },
      )
      expect(pendingSnapshotResponse.status).toBe(200)
      expect(await pendingSnapshotResponse.json()).toMatchObject({
        currentMessage: { text: 'stop', priority: 'high' },
        items: [],
        totalCount: 1,
      })

      const turnStartCountBeforeClear = codexSidecar.requests.filter((request) => request.method === 'turn/start').length
      const clearResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-send-clear-preemption/queue`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })
      expect(clearResponse.status).toBe(200)
      expect(await clearResponse.json()).toEqual({ cleared: true })

      const clearedSnapshotResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-send-clear-preemption/queue`,
        { headers: AUTH_HEADERS },
      )
      expect(clearedSnapshotResponse.status).toBe(200)
      expect(await clearedSnapshotResponse.json()).toMatchObject({
        currentMessage: null,
        items: [],
        totalCount: 0,
      })

      codexSidecar.setTurnStartBehavior('success')
      codexSidecar.emitNotification('turn/completed', {
        threadId,
        turn: { id: 'turn-1', status: 'completed' },
      })
      await new Promise((resolve) => setTimeout(resolve, 350))

      expect(codexSidecar.requests.filter((request) => request.method === 'turn/start')).toHaveLength(turnStartCountBeforeClear)
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('does not start a second queue drain while a Codex queued send is still pending', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-queue-drain-lock',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
        }),
      })

      expect(createResponse.status).toBe(201)

      codexSidecar.deferNextTurnStartResponse()
      const firstQueueResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-queue-drain-lock/message?queue=true`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'first queued' }),
        },
      )
      expect(firstQueueResponse.status).toBe(202)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['first queued'])
      })

      const secondQueueResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-queue-drain-lock/message?queue=true`,
        {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'second queued' }),
        },
      )
      expect(secondQueueResponse.status).toBe(202)

      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(codexSidecar.turnStartInputs).toEqual(['first queued'])

      codexSidecar.releaseDeferredTurnStarts()

      await vi.waitFor(async () => {
        const queueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-http-queue-drain-lock/queue`,
          { headers: AUTH_HEADERS },
        )
        expect(queueResponse.status).toBe(200)
        expect(await queueResponse.json()).toMatchObject({
          currentMessage: { text: 'first queued' },
          items: [{ text: 'second queued' }],
          totalCount: 1,
        })
      })
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })

  it('keeps queue=true on SessionMessageQueue semantics even when a codex turn is active', async () => {
    const codexSidecar = installMockCodexSidecar()
    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'codex-http-queue',
          mode: 'default',
          transportType: 'stream',
          agentType: 'codex',
          task: 'initial busy turn',
        }),
      })

      expect(createResponse.status).toBe(201)

      await vi.waitFor(() => {
        expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      })

      const threadId = codexSidecar.getStartedThreadIds()[0]
      expect(threadId).toBeTruthy()

      codexSidecar.emitNotification('turn/started', {
        threadId,
        turn: { id: 'turn-1', status: 'inProgress' },
      })

      const queueFirstResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/message?queue=true`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'first queued message' }),
      })
      expect(queueFirstResponse.status).toBe(202)
      const firstQueued = (await queueFirstResponse.json()) as {
        queued: boolean
        id: string
        position: number
      }
      expect(firstQueued).toMatchObject({ queued: true, position: 1 })

      const queueSecondResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/message?queue=true`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'second queued message' }),
      })
      expect(queueSecondResponse.status).toBe(202)
      const secondQueued = (await queueSecondResponse.json()) as {
        queued: boolean
        id: string
        position: number
      }
      expect(secondQueued).toMatchObject({ queued: true, position: 2 })

      const queueSnapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue`, {
        headers: AUTH_HEADERS,
      })
      expect(queueSnapshotResponse.status).toBe(200)
      const initialSnapshot = (await queueSnapshotResponse.json()) as {
        items: Array<{ id: string; text: string }>
        currentMessage?: { id: string; text: string } | null
        totalCount?: number
      }
      expect(initialSnapshot.currentMessage ?? null).toBeNull()
      expect(initialSnapshot.totalCount).toBe(2)
      expect(initialSnapshot.items.map((message) => message.text)).toEqual([
        'first queued message',
        'second queued message',
      ])

      const reorderResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue/reorder`, {
        method: 'PUT',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ order: [secondQueued.id, firstQueued.id] }),
      })
      expect(reorderResponse.status).toBe(200)
      expect(await reorderResponse.json()).toEqual({ reordered: true })

      const reorderedSnapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue`, {
        headers: AUTH_HEADERS,
      })
      expect(reorderedSnapshotResponse.status).toBe(200)
      const reorderedSnapshot = (await reorderedSnapshotResponse.json()) as {
        items: Array<{ id: string; text: string }>
        totalCount?: number
      }
      expect(reorderedSnapshot.totalCount).toBe(2)
      expect(reorderedSnapshot.items.map((message) => message.text)).toEqual([
        'second queued message',
        'first queued message',
      ])

      const removeResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/codex-http-queue/queue/${encodeURIComponent(secondQueued.id)}`,
        {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        },
      )
      expect(removeResponse.status).toBe(200)
      expect(await removeResponse.json()).toEqual({ removed: true, id: secondQueued.id })

      const afterRemoveSnapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue`, {
        headers: AUTH_HEADERS,
      })
      expect(afterRemoveSnapshotResponse.status).toBe(200)
      const afterRemoveSnapshot = (await afterRemoveSnapshotResponse.json()) as {
        items: Array<{ id: string; text: string }>
        totalCount?: number
      }
      expect(afterRemoveSnapshot.totalCount).toBe(1)
      expect(afterRemoveSnapshot.items.map((message) => message.text)).toEqual(['first queued message'])

      const clearResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })
      expect(clearResponse.status).toBe(200)
      expect(await clearResponse.json()).toEqual({ cleared: true })

      const clearedSnapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-http-queue/queue`, {
        headers: AUTH_HEADERS,
      })
      expect(clearedSnapshotResponse.status).toBe(200)
      const clearedSnapshot = (await clearedSnapshotResponse.json()) as {
        items: Array<{ id: string; text: string }>
        currentMessage?: { id: string; text: string } | null
        totalCount?: number
      }
      expect(clearedSnapshot.currentMessage ?? null).toBeNull()
      expect(clearedSnapshot.totalCount).toBe(0)
      expect(clearedSnapshot.items).toEqual([])
      expect(codexSidecar.turnStartInputs).toEqual(['initial busy turn'])
      expect(codexSidecar.turnSteerInputs).toEqual([])
    } finally {
      await server.close()
      await codexSidecar.close()
    }
  })
})
