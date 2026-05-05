import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_HEADERS,
  createMockPtySpawner,
  createTempMachinesRegistry,
  startServer,
} from './routes-test-harness'

describe('/api/agents/sessions/dispatch-worker host routing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts host as the canonical machine-routing field', async () => {
    const { spawner } = createMockPtySpawner()
    const registry = await createTempMachinesRegistry({
      machines: [
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          cwd: '/home/builder/workspace',
        },
      ],
    })
    const server = await startServer({ machinesFilePath: registry.filePath, ptySpawner: spawner })

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          host: 'gpu-1',
          task: 'Investigate worker routing',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const dispatchPayload = await dispatchResponse.json() as {
        name: string
        cwd?: string
      }
      expect(dispatchPayload.cwd).toBe('/home/builder/workspace')

      const sessionResponse = await fetch(
        `${server.baseUrl}/api/agents/sessions/${encodeURIComponent(dispatchPayload.name)}`,
        { headers: AUTH_HEADERS },
      )
      expect(sessionResponse.status).toBe(200)
      const sessionPayload = await sessionResponse.json() as { host?: string }
      expect(sessionPayload.host).toBe('gpu-1')
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('rejects machine and requires host as the canonical machine-routing field', async () => {
    const { spawner } = createMockPtySpawner()
    const registry = await createTempMachinesRegistry({
      machines: [
        {
          id: 'gpu-1',
          label: 'GPU',
          host: '10.0.1.50',
          user: 'builder',
          cwd: '/home/builder/workspace',
        },
      ],
    })
    const server = await startServer({ machinesFilePath: registry.filePath, ptySpawner: spawner })

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          machine: 'gpu-1',
          task: 'Investigate worker routing',
        }),
      })

      expect(dispatchResponse.status).toBe(400)
      expect(await dispatchResponse.json()).toEqual({
        error: 'Unknown request body properties: machine',
      })
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
      await registry.cleanup()
    }
  })

  it('returns 400 when machine is provided alongside host', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          cwd: '/tmp/legacy-conflict',
          host: 'gpu-1',
          machine: 'gpu-2',
        }),
      })

      expect(dispatchResponse.status).toBe(400)
      expect(await dispatchResponse.json()).toEqual({
        error: 'Unknown request body properties: machine',
      })
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('returns 400 for unknown routing-ish fields', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          cwd: '/tmp/legacy-unknown-field',
          worker_machine: 'gpu-1',
        }),
      })

      expect(dispatchResponse.status).toBe(400)
      const payload = await dispatchResponse.json() as { error?: string }
      expect(payload.error).toBe('Unknown request body properties: worker_machine')
      expect(spawner.spawn).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
