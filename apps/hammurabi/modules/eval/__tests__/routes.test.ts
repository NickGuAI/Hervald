import express from 'express'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createEvalRouter } from '../routes'

const tempDirs: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' }
      }
      const scopes = ['telemetry:read', 'telemetry:write']
      if (options?.requiredScopes?.some((scope) => !scopes.includes(scope))) {
        return { ok: false, reason: 'insufficient_scope' }
      }
      return {
        ok: true,
        record: {
          id: 'test-key-id',
          name: 'Test Key',
          keyHash: 'hash',
          prefix: 'hmrb_test',
          createdBy: 'test',
          createdAt: '2026-06-02T00:00:00.000Z',
          lastUsedAt: null,
          scopes,
        },
      }
    },
  }
}

async function startServer(rootPath: string) {
  const app = express()
  app.use(express.json())
  app.use('/api/eval', createEvalRouter({
    apiKeyStore: createTestApiKeyStore(),
    rootPath,
    now: () => new Date('2026-06-02T10:00:00.000Z'),
  }))
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('eval routes', () => {
  it('writes normalized manifests and filters by benchmark/source/runner mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-eval-routes-'))
    tempDirs.push(root)
    const server = await startServer(root)
    try {
      const createResponse = await fetch(`${server.baseUrl}/api/eval/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-api-key': 'test-key',
        },
        body: JSON.stringify({
          runId: 'run-terminal-smoke',
          bench: 'terminal-bench',
          source: 'terminal-bench',
          profile: 'smoke',
          runnerMode: 'subscription-host-cli',
          commanderId: 'benchmark-commander',
          result: {
            status: 'blocked',
            failures: ['Docker daemon is not reachable'],
            tasks: [
              {
                taskId: 'hello-world',
                status: 'blocked',
                failure: 'Docker daemon is not reachable',
              },
            ],
          },
          summaryMarkdown: '# Smoke run\n\nDocker blocked the local run.\n',
        }),
      })

      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as { runId: string; status: string; telemetryMetadata: { runner_mode: string } }
      expect(created).toMatchObject({
        runId: 'run-terminal-smoke',
        status: 'blocked',
        telemetryMetadata: {
          runner_mode: 'subscription-host-cli',
        },
      })

      const listResponse = await fetch(
        `${server.baseUrl}/api/eval/runs?bench=terminal-bench&source=terminal-bench&runner_mode=subscription-host-cli`,
        {
          headers: {
            'x-hammurabi-api-key': 'test-key',
          },
        },
      )
      expect(listResponse.status).toBe(200)
      const list = await listResponse.json() as { runs: Array<{ runId: string; failures: string[]; tasks: Array<{ taskId: string }> }> }
      expect(list.runs).toHaveLength(1)
      expect(list.runs[0]).toMatchObject({
        runId: 'run-terminal-smoke',
        failures: ['Docker daemon is not reachable'],
        tasks: [
          {
            taskId: 'hello-world',
          },
        ],
      })

      const emptyResponse = await fetch(`${server.baseUrl}/api/eval/runs?runner_mode=api-key`, {
        headers: {
          'x-hammurabi-api-key': 'test-key',
        },
      })
      const empty = await emptyResponse.json() as { runs: unknown[] }
      expect(empty.runs).toEqual([])

      const statusResponse = await fetch(`${server.baseUrl}/api/eval/runs/run-terminal-smoke/status`, {
        headers: {
          'x-hammurabi-api-key': 'test-key',
        },
      })
      expect(statusResponse.status).toBe(200)
      await expect(statusResponse.json()).resolves.toMatchObject({
        runId: 'run-terminal-smoke',
        status: 'blocked',
      })

      const reportResponse = await fetch(`${server.baseUrl}/api/eval/runs/run-terminal-smoke/report?format=markdown`, {
        headers: {
          'x-hammurabi-api-key': 'test-key',
        },
      })
      expect(reportResponse.status).toBe(200)
      await expect(reportResponse.text()).resolves.toContain('Docker blocked the local run')
    } finally {
      await server.close()
    }
  })

  it('blocks leaderboard submission until human auth is confirmed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-eval-submit-'))
    tempDirs.push(root)
    const server = await startServer(root)
    try {
      await fetch(`${server.baseUrl}/api/eval/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-api-key': 'test-key',
        },
        body: JSON.stringify({
          runId: 'run-submit',
          bench: 'locomo',
          profile: 'smoke',
          runnerMode: 'api-key',
          result: { status: 'completed', failures: [] },
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/eval/runs/run-submit/submit`, {
        method: 'POST',
        headers: {
          'x-hammurabi-api-key': 'test-key',
        },
      })
      expect(response.status).toBe(409)
      const payload = await response.json() as { status: string; blocker: string }
      expect(payload.status).toBe('blocked')
      expect(payload.blocker).toContain('human-owned auth step')
    } finally {
      await server.close()
    }
  })

  it('rejects unsafe run ids before writing eval artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hammurabi-eval-runid-'))
    tempDirs.push(root)
    const server = await startServer(root)
    try {
      const response = await fetch(`${server.baseUrl}/api/eval/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hammurabi-api-key': 'test-key',
        },
        body: JSON.stringify({
          runId: '../../../.ssh',
          bench: 'terminal-bench',
          profile: 'smoke',
          runnerMode: 'subscription-host-cli',
          result: { status: 'completed', failures: [] },
        }),
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining('runId must be a safe slug'),
      })
      await expect(stat(path.join(root, '2026-06-02'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await server.close()
    }
  })
})
