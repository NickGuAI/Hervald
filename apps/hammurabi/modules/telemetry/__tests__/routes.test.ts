import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import type { TelemetryHub } from '../hub'
import { createTelemetryRouterWithHub } from '../routes'
import type { LocalScannerLike } from '../local-scanner'

interface RunningServer {
  baseUrl: string
  hub: TelemetryHub
  close: () => Promise<void>
}

const testDirectories: string[] = []

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey) => {
      if (rawKey === 'test-key') {
        return {
          ok: true,
          record: {
            id: 'test-key-id',
            name: 'Test Key',
            keyHash: 'hash',
            prefix: 'hmrb_test',
            createdBy: 'test',
            createdAt: '2026-02-16T00:00:00.000Z',
            lastUsedAt: null,
            scopes: ['telemetry:write', 'telemetry:read'],
          },
        }
      }
      return { ok: false, reason: 'not_found' }
    },
  }
}

async function createTempStoreFilePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-telemetry-routes-'))
  testDirectories.push(directory)
  return path.join(directory, 'events.jsonl')
}

async function startServer(options: {
  apiKeyStore?: ApiKeyStoreLike
  storeFilePath: string
  now: () => Date
  localScanner?: LocalScannerLike
}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())
  const telemetry = createTelemetryRouterWithHub({
    apiKeyStore: options.apiKeyStore,
    dataFilePath: options.storeFilePath,
    now: options.now,
    localScanner: options.localScanner,
  })
  app.use(
    '/api/telemetry',
    telemetry.router,
  )

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener))
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hub: telemetry.hub,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
        server.closeAllConnections?.()
      })
    },
  }
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  )
})

describe('telemetry routes', () => {
  it('returns 503 for telemetry endpoints when API key is not configured', async () => {
    const now = new Date('2026-02-10T10:00:00.000Z')
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      storeFilePath: filePath,
      now: () => now,
    })

    const compactResponse = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })
    expect(compactResponse.status).toBe(503)

    const sessionsResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`)
    expect(sessionsResponse.status).toBe(503)

    const summaryResponse = await fetch(`${server.baseUrl}/api/telemetry/summary`)
    expect(summaryResponse.status).toBe(503)

    await server.close()
  })

  it('requires API key for write and read endpoints', async () => {
    let now = new Date('2026-02-10T10:00:00.000Z')
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
    })

    const response = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })

    expect(response.status).toBe(401)

    const readResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`)
    expect(readResponse.status).toBe(401)

    await server.close()
  })

  it('returns lifecycle status and summary data for recorded telemetry calls', async () => {
    let now = new Date('2026-02-10T10:00:00.000Z')
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
    })

    await server.hub.ingest({
      sessionId: 'session-1',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      currentTask: 'Implementing routes',
      inputTokens: 200,
      outputTokens: 100,
      cost: 0.042,
      durationMs: 0,
      timestamp: now,
    })

    const sessionsResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const sessions = (await sessionsResponse.json()) as Array<{
      id: string
      status: string
      callCount: number
      totalCost: number
      totalTokens: number
    }>

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'active',
      callCount: 1,
      totalCost: 0.042,
      totalTokens: 300,
    })

    now = new Date('2026-02-10T10:02:00.000Z')
    const idleResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const idleSessions = (await idleResponse.json()) as Array<{ status: string }>
    expect(idleSessions[0]?.status).toBe('idle')

    now = new Date('2026-02-10T10:04:59.000Z')
    const almostStaleResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const almostStaleSessions = (await almostStaleResponse.json()) as Array<{
      status: string
    }>
    expect(almostStaleSessions[0]?.status).toBe('idle')

    now = new Date('2026-02-10T10:05:00.000Z')
    const staleResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const staleSessions = (await staleResponse.json()) as Array<{ status: string }>
    expect(staleSessions[0]?.status).toBe('stale')

    const detailResponse = await fetch(`${server.baseUrl}/api/telemetry/sessions/session-1`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const detail = (await detailResponse.json()) as {
      session: { id: string }
      calls: Array<{ model: string; cost: number }>
    }

    expect(detail.session.id).toBe('session-1')
    expect(detail.calls).toHaveLength(1)
    expect(detail.calls[0]).toMatchObject({
      model: 'o3',
      cost: 0.042,
    })

    const summaryResponse = await fetch(`${server.baseUrl}/api/telemetry/summary`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const summary = (await summaryResponse.json()) as {
      totalSessions: number
      topModels: Array<{ model: string }>
      topAgents: Array<{ agent: string }>
      costToday: number
      inputTokensToday: number
      outputTokensToday: number
      totalTokensToday: number
    }

    expect(summary.totalSessions).toBe(1)
    expect(summary.topModels[0]?.model).toBe('o3')
    expect(summary.topAgents[0]?.agent).toBe('codex')
    expect(summary.costToday).toBeGreaterThan(0)
    expect(summary.inputTokensToday).toBe(200)
    expect(summary.outputTokensToday).toBe(100)
    expect(summary.totalTokensToday).toBe(300)

    await server.close()
  })

  it('replays persisted telemetry entries on restart', async () => {
    let now = new Date('2026-02-11T08:00:00.000Z')
    const filePath = await createTempStoreFilePath()

    const firstServer = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
    })

    await firstServer.hub.ingest({
      sessionId: 'restart-session',
      agentName: 'claude-code',
      model: 'claude-sonnet',
      provider: 'claude-local',
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.02,
      durationMs: 0,
      currentTask: 'Working',
      timestamp: now,
    })
    await firstServer.close()

    now = new Date('2026-02-11T08:00:10.000Z')
    const secondServer = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
    })

    const sessionsResponse = await fetch(`${secondServer.baseUrl}/api/telemetry/sessions`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    const sessions = (await sessionsResponse.json()) as Array<{
      id: string
      callCount: number
      totalCost: number
    }>

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: 'restart-session',
      callCount: 1,
      totalCost: 0.02,
    })

    await secondServer.close()
  })

  it('uses calendar week boundaries for weekly summary totals', async () => {
    const now = new Date('2026-02-10T10:00:00.000Z')
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
    })

    await server.hub.ingest({
      sessionId: 's-old',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
      cost: 1,
      durationMs: 0,
      currentTask: 'Working',
      timestamp: new Date('2026-02-08T23:30:00.000Z'),
    })
    await server.hub.ingest({
      sessionId: 's-new',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
      cost: 2,
      durationMs: 0,
      currentTask: 'Working',
      timestamp: new Date('2026-02-10T09:00:00.000Z'),
    })

    const summaryResponse = await fetch(`${server.baseUrl}/api/telemetry/summary`, {
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    expect(summaryResponse.status).toBe(200)

    const summary = (await summaryResponse.json()) as {
      costToday: number
      costWeek: number
      costMonth: number
      inputTokensToday: number
      inputTokensWeek: number
      inputTokensMonth: number
      outputTokensToday: number
      outputTokensWeek: number
      outputTokensMonth: number
      totalTokensToday: number
      totalTokensWeek: number
      totalTokensMonth: number
      topAgents: Array<{ agent: string; cost: number; sessions: number }>
    }

    expect(summary.costToday).toBe(2)
    expect(summary.costWeek).toBe(2)
    expect(summary.costMonth).toBe(3)
    expect(summary.inputTokensToday).toBe(100)
    expect(summary.inputTokensWeek).toBe(100)
    expect(summary.inputTokensMonth).toBe(200)
    expect(summary.outputTokensToday).toBe(50)
    expect(summary.outputTokensWeek).toBe(50)
    expect(summary.outputTokensMonth).toBe(100)
    expect(summary.totalTokensToday).toBe(150)
    expect(summary.totalTokensWeek).toBe(150)
    expect(summary.totalTokensMonth).toBe(300)
    expect(summary.topAgents).toEqual([
      {
        agent: 'codex',
        cost: 3,
        sessions: 2,
      },
    ])

    await server.close()
  })

  it('triggers local scan via POST /api/telemetry/scan', async () => {
    const now = new Date('2026-02-20T10:00:00.000Z')
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => now,
      localScanner: {
        scan: async () => ({
          scanned: 10,
          ingested: 4,
          skipped: 6,
          durationMs: 123,
        }),
      },
    })

    const scanResponse = await fetch(`${server.baseUrl}/api/telemetry/scan`, {
      method: 'POST',
      headers: {
        'x-hammurabi-api-key': 'test-key',
      },
    })
    expect(scanResponse.status).toBe(200)

    const body = (await scanResponse.json()) as {
      ok: boolean
      scanned: number
      ingested: number
      skipped: number
      durationMs: number
    }
    expect(body).toEqual({
      ok: true,
      scanned: 10,
      ingested: 4,
      skipped: 6,
      durationMs: 123,
    })

    await server.close()
  })

  it('summary includes dailyCosts sorted ascending by date', async () => {
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => new Date('2026-02-20T12:00:00.000Z'),
    })

    const days = ['2026-02-18', '2026-02-19', '2026-02-20']
    for (const [i, day] of days.entries()) {
      await server.hub.ingest({
        sessionId: `s-${i}`,
        agentName: 'codex',
        model: 'o3',
        provider: 'openai',
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.01 * (i + 1),
        durationMs: 0,
        currentTask: 'Working',
        timestamp: new Date(`${day}T10:00:00.000Z`),
      })
    }

    const summaryResponse = await fetch(`${server.baseUrl}/api/telemetry/summary`, {
      headers: { 'x-hammurabi-api-key': 'test-key' },
    })
    const summary = (await summaryResponse.json()) as {
      dailyCosts: { date: string; costUsd: number }[]
    }

    expect(Array.isArray(summary.dailyCosts)).toBe(true)
    expect(summary.dailyCosts.length).toBe(3)
    // Sorted ascending
    expect(summary.dailyCosts[0]?.date).toBe('2026-02-18')
    expect(summary.dailyCosts[1]?.date).toBe('2026-02-19')
    expect(summary.dailyCosts[2]?.date).toBe('2026-02-20')
    // Costs match
    expect(summary.dailyCosts[0]?.costUsd).toBeCloseTo(0.01)
    expect(summary.dailyCosts[2]?.costUsd).toBeCloseTo(0.03)

    await server.close()
  })

  it('POST /compact runs compaction and returns ok', async () => {
    const filePath = await createTempStoreFilePath()
    const server = await startServer({
      apiKeyStore: createTestApiKeyStore(),
      storeFilePath: filePath,
      now: () => new Date('2026-02-20T12:00:00.000Z'),
    })

    await server.hub.ingest({
      sessionId: 's-compact',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      inputTokens: 5,
      outputTokens: 5,
      cost: 0.005,
      durationMs: 0,
      currentTask: 'Working',
      timestamp: new Date('2026-02-20T12:00:00.000Z'),
    })

    const compactResponse = await fetch(`${server.baseUrl}/api/telemetry/compact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hammurabi-api-key': 'test-key',
      },
      body: JSON.stringify({ retentionDays: 30 }),
    })

    expect(compactResponse.status).toBe(200)
    const body = (await compactResponse.json()) as { ok: boolean; retentionDays: number }
    expect(body.ok).toBe(true)
    expect(body.retentionDays).toBe(30)

    await server.close()
  })
})
