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
          name: 'commander-cmdr-atlas',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-atlas' },
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
          spawnedBy: 'commander-cmdr-atlas',
          task: 'Investigate worker state drift',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      expect(await dispatchResponse.json()).toEqual(expect.objectContaining({
        sessionType: 'worker',
        spawnedBy: 'commander-cmdr-atlas',
        creator: { kind: 'commander', id: 'cmdr-atlas' },
      }))
      expect(spawned).toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it('rejects explicit creator on standalone legacy worker dispatches', async () => {
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

      expect(dispatchResponse.status).toBe(400)
      const body = await dispatchResponse.json() as { error: string }
      expect(body.error).toContain('creator must not be provided')
      expect(body.error).toContain('/api/agents/sessions/dispatch-worker')
      expect(spawned).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('rejects creator key presence even when the value is empty', async () => {
    const spawned: ReturnType<typeof createMockChildProcess>[] = []
    mockedSpawn.mockImplementation(() => {
      const mock = createMockChildProcess()
      spawned.push(mock)
      return mock.cp as never
    })

    const server = await startServer()

    try {
      for (const creator of [null, '']) {
        const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            cwd: '/tmp/standalone-worker',
            task: 'Do standalone work',
            creator,
          }),
        })

        expect(dispatchResponse.status).toBe(400)
        const body = await dispatchResponse.json() as { error: string }
        expect(body.error).toContain('creator must not be provided')
      }
      expect(spawned).toHaveLength(0)
    } finally {
      await server.close()
    }
  })
})
