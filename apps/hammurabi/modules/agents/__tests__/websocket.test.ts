import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import {
  AUTH_HEADERS,
  connectWs,
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'

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
        '/api/agents/sessions/ws-auth-required/terminal?api_key=bad-key'
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
          // `ws` may emit an error alongside `unexpected-response`; the status
          // assertion comes from the HTTP upgrade response itself.
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
})
