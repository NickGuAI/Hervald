import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { AuthUser } from '@gehirn/auth-providers'
import { WS_REPLAY_TAIL_LIMIT } from '../websocket'
import {
  AUTH_HEADERS,
  connectWs,
  connectWsWithReplay,
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'

async function waitForUpgradeRejection(ws: WebSocket): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for upgrade rejection')), 3_000)
    const finish = (fn: () => void) => {
      clearTimeout(timeout)
      fn()
    }

    ws.on('unexpected-response', (_req, res) => {
      finish(() => resolve(res.statusCode ?? -1))
    })
    ws.on('open', () => {
      finish(() => reject(new Error('WebSocket unexpectedly opened')))
    })
    ws.on('error', () => {
      // `ws` may emit an error alongside `unexpected-response`; the status
      // assertion comes from the HTTP upgrade response itself.
    })
  })
}

function connectWsWithAccessToken(baseUrl: string, sessionName: string, accessToken: string): Promise<WebSocket> {
  const wsUrl = baseUrl.replace('http://', 'ws://') +
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/ws`
  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (handler: () => void) => {
      if (settled) {
        return
      }
      settled = true
      handler()
    }

    ws.on('open', () => finish(() => resolve(ws)))
    ws.on('error', (error) => finish(() => reject(error)))
    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`WebSocket upgrade rejected with status ${res.statusCode}`)))
    })
  })
}

function createAuth0Verifier(usersByToken: Record<string, AuthUser>) {
  return async (token: string): Promise<AuthUser> => {
    const user = usersByToken[token]
    if (!user) {
      throw new Error('invalid token')
    }
    return user
  }
}

async function createStreamSession(baseUrl: string, name: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/agents/sessions`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mode: 'default',
      transportType: 'stream',
    }),
  })

  expect(response.status).toBe(201)
}

describe('agents websocket', () => {
  afterEach(() => {
    mockedSpawn.mockRestore()
  })

  it('requires a valid API key for upgrade requests', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-auth-required')

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-auth-required/ws'
      const ws = new WebSocket(wsUrl, {
        headers: { 'x-hammurabi-api-key': 'bad-key' },
      })

      const statusCode = await waitForUpgradeRejection(ws)

      expect(statusCode).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('requires agents:write API key scope for upgrade requests', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-api-key-write-required')

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-api-key-write-required/ws?api_key=read-only-key'
      const ws = new WebSocket(wsUrl)

      const statusCode = await waitForUpgradeRejection(ws)

      expect(statusCode).toBe(401)
      expect(mock.getStdinWrites()).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('rejects Auth0 websocket tokens without agents:write before accepting mutating frames', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer({
      verifyAuth0Token: createAuth0Verifier({
        'auth0-read-token': {
          id: 'auth0|reader',
          email: 'reader@example.com',
          metadata: {
            permissions: ['agents:read'],
          },
        },
      }),
    })

    try {
      await createStreamSession(server.baseUrl, 'ws-auth0-write-required')

      const ws = new WebSocket(
        server.baseUrl.replace('http://', 'ws://') +
          '/api/agents/sessions/ws-auth0-write-required/ws',
        { headers: { Authorization: 'Bearer auth0-read-token' } },
      )

      const statusCode = await waitForUpgradeRejection(ws)

      expect(statusCode).toBe(401)
      expect(mock.getStdinWrites()).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('accepts Auth0 websocket tokens with agents:write for stream input', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer({
      verifyAuth0Token: createAuth0Verifier({
        'auth0-write-token': {
          id: 'auth0|writer',
          email: 'writer@example.com',
          metadata: {
            permissions: ['agents:write'],
          },
        },
      }),
    })

    try {
      await createStreamSession(server.baseUrl, 'ws-auth0-write-allowed')

      const ws = await connectWsWithAccessToken(server.baseUrl, 'ws-auth0-write-allowed', 'auth0-write-token')
      ws.send(JSON.stringify({ type: 'input', text: 'Ship the Auth0 WS fix' }))

      await vi.waitFor(() => {
        expect(mock.getStdinWrites()).toHaveLength(1)
      })

      ws.close()
    } finally {
      await server.close()
    }
  })

  it('does not accept API keys from websocket query strings', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-query-auth-rejected')

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-query-auth-rejected/ws?api_key=test-key'
      const ws = new WebSocket(wsUrl)

      const statusCode = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for upgrade rejection')), 3_000)
        const finish = (fn: () => void) => {
          clearTimeout(timeout)
          fn()
        }

        ws.on('unexpected-response', (_req, res) => {
          finish(() => resolve(res.statusCode ?? -1))
        })
        ws.on('open', () => {
          finish(() => reject(new Error('WebSocket unexpectedly opened')))
        })
        ws.on('error', () => {
          // The status assertion comes from the HTTP upgrade response.
        })
      })

      expect(statusCode).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('attaches the upgraded client to the correct stream session', async () => {
    const firstMock = createMockChildProcess()
    const secondMock = createMockChildProcess()
    mockedSpawn
      .mockReturnValueOnce(firstMock.cp as never)
      .mockReturnValueOnce(secondMock.cp as never)

    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-target-session')
      await createStreamSession(server.baseUrl, 'ws-other-session')

      const ws = await connectWs(server.baseUrl, 'ws-target-session')
      const targetSession = server.agents.sessionsInterface.getSession('ws-target-session')
      const otherSession = server.agents.sessionsInterface.getSession('ws-other-session')

      expect(targetSession).toBeDefined()
      expect(otherSession).toBeDefined()

      await vi.waitFor(() => {
        expect(targetSession?.clients.size).toBe(1)
        expect(otherSession?.clients.size).toBe(0)
      })

      ws.close()

      await vi.waitFor(() => {
        expect(targetSession?.clients.size).toBe(0)
      })
    } finally {
      await server.close()
    }
  })

  it('routes basic input messages to the owning stream session', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-route-smoke')

      const ws = await connectWs(server.baseUrl, 'ws-route-smoke')
      ws.send(JSON.stringify({ type: 'input', text: 'Ship issue 921 phase P8' }))

      await vi.waitFor(() => {
        expect(mock.getStdinWrites()).toHaveLength(1)
      })

      const [stdinWrite] = mock.getStdinWrites()
      expect(JSON.parse(stdinWrite.trim())).toEqual({
        type: 'user',
        subtype: 'queued_message',
        message: {
          role: 'user',
          content: 'Ship issue 921 phase P8',
        },
      })

      ws.close()
    } finally {
      await server.close()
    }
  })

  it('replays only the buffered event tail and sets more when truncated', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-replay-tail')
      const session = server.agents.sessionsInterface.getSession('ws-replay-tail')
      expect(session?.kind).toBe('stream')
      if (!session || session.kind !== 'stream') {
        throw new Error('Expected stream session for replay test')
      }

      session.events = Array.from({ length: WS_REPLAY_TAIL_LIMIT + 25 }, (_, index) => ({
        type: 'system',
        marker: index + 1,
      })) as typeof session.events

      const { ws, replay } = await connectWsWithReplay(server.baseUrl, 'ws-replay-tail')
      const replayFrame = replay as typeof replay & {
        more?: boolean
        events?: Array<{ marker: number }>
        messages?: Array<{ kind: string; text: string }>
        projection?: {
          schemaVersion?: number
          messages?: Array<{ kind: string; text: string }>
          replayCursor?: { totalEvents?: number; returnedEvents?: number; more?: boolean }
        }
      }

      expect(replayFrame.type).toBe('replay')
      expect(replayFrame.more).toBe(true)
      expect(replayFrame.events).toBeUndefined()
      expect(replayFrame.projection).toEqual(expect.objectContaining({
        schemaVersion: 1,
        replayCursor: {
          totalEvents: WS_REPLAY_TAIL_LIMIT + 25,
          returnedEvents: WS_REPLAY_TAIL_LIMIT,
          more: true,
        },
      }))
      expect(replayFrame.messages).toEqual(replayFrame.projection?.messages)

      const debugResponse = await fetch(`${server.baseUrl}/api/agents/sessions/ws-replay-tail/debug/events`, {
        headers: AUTH_HEADERS,
      })
      expect(debugResponse.status).toBe(200)
      const debugPayload = await debugResponse.json() as { events: Array<{ marker: number }> }
      expect(debugPayload.events).toHaveLength(WS_REPLAY_TAIL_LIMIT + 25)
      expect(debugPayload.events[0]?.marker).toBe(1)
      expect(debugPayload.events.at(-1)?.marker).toBe(WS_REPLAY_TAIL_LIMIT + 25)

      ws.close()
    } finally {
      await server.close()
    }
  })

  it('includes schemaVersion 2 replay projection when transcript envelopes are buffered', async () => {
    const mock = createMockChildProcess()
    mockedSpawn.mockReturnValueOnce(mock.cp as never)
    const server = await startServer()

    try {
      await createStreamSession(server.baseUrl, 'ws-replay-v2')
      const session = server.agents.sessionsInterface.getSession('ws-replay-v2')
      expect(session?.kind).toBe('stream')
      if (!session || session.kind !== 'stream') {
        throw new Error('Expected stream session for replay v2 test')
      }

      session.events = [
        {
          schemaVersion: 2,
          id: 'env-1',
          time: '2026-05-27T00:00:00.000Z',
          source: { provider: 'codex', backend: 'rpc', rawEventType: 'turn/started' },
          turnId: 'turn-1',
          ev: { type: 'turn.start', role: 'assistant' },
        },
        {
          schemaVersion: 2,
          id: 'env-2',
          time: '2026-05-27T00:00:01.000Z',
          source: { provider: 'codex', backend: 'rpc', rawEventType: 'item/agentMessage/delta' },
          turnId: 'turn-1',
          itemId: 'msg-1',
          ev: { type: 'message.delta', text: 'hello', channel: 'final' },
        },
      ] as typeof session.events

      const { ws, replay } = await connectWsWithReplay(server.baseUrl, 'ws-replay-v2')
      const replayFrame = replay as typeof replay & {
        projection?: { schemaVersion?: number; envelopes?: Array<{ id: string }> }
        envelopes?: Array<{ id: string }>
      }

      expect(replayFrame.events).toBeUndefined()
      expect(replayFrame.projection).toEqual(expect.objectContaining({
        schemaVersion: 2,
        envelopes: [expect.objectContaining({ id: 'env-1' }), expect.objectContaining({ id: 'env-2' })],
      }))
      expect(replayFrame.envelopes).toEqual([
        expect.objectContaining({ id: 'env-1' }),
        expect.objectContaining({ id: 'env-2' }),
      ])

      ws.close()
    } finally {
      await server.close()
    }
  })
})
