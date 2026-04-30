import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'

describe('dispatch worker creator wiring', () => {
  afterEach(() => {
    mockedSpawn.mockReset()
  })

  it('inherits the parent commander creator for dispatched workers', async () => {
    const spawned: ReturnType<typeof createMockChildProcess>[] = []
    mockedSpawn.mockImplementation(() => {
      const mock = createMockChildProcess()
      spawned.push(mock)
      return mock.cp as never
    })

    const server = await startServer()

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'commander-cmdr-athena',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-athena' },
          cwd: '/tmp',
        }),
      })
      expect(createResponse.status).toBe(201)

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-cmdr-athena',
          task: 'Investigate worker state drift',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      expect(await dispatchResponse.json()).toEqual(expect.objectContaining({
        sessionType: 'worker',
        spawnedBy: 'commander-cmdr-athena',
        creator: { kind: 'commander', id: 'cmdr-athena' },
      }))
      expect(spawned).toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it('accepts an explicit commander creator for standalone worker dispatches', async () => {
    const spawned: ReturnType<typeof createMockChildProcess>[] = []
    mockedSpawn.mockImplementation(() => {
      const mock = createMockChildProcess()
      spawned.push(mock)
      return mock.cp as never
    })

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
          task: 'Do standalone commander-scoped work',
          creator: { kind: 'commander', id: 'cmdr-cli' },
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const body = await dispatchResponse.json() as {
        name: string
        sessionType?: string
        spawnedBy?: string
        creator?: { kind?: string; id?: string }
      }
      expect(body).toEqual(expect.objectContaining({
        sessionType: 'worker',
        creator: { kind: 'commander', id: 'cmdr-cli' },
      }))

      const statusResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(body.name)}`,
        { headers: AUTH_HEADERS },
      )
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(expect.objectContaining({
        creator: { kind: 'commander', id: 'cmdr-cli' },
        sessionType: 'worker',
      }))
      expect(spawned).toHaveLength(1)
    } finally {
      await server.close()
    }
  })
})
