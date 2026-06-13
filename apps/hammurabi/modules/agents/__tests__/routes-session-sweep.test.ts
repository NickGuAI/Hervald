import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { RequestHandler } from 'express'
import { registerSessionSweepRoutes } from '../routes/session-sweep-routes'
import type { SessionPruneCandidate, SessionPrunerConfig } from '../persistence-helpers'

const requireWriteAccess: RequestHandler = (_req, _res, next) => next()
const prunerConfig: SessionPrunerConfig = {
  enabled: true,
  staleSessionTtlMs: 60_000,
  exitedSessionTtlMs: 120_000,
}

async function startSweepServer(
  deps: Omit<Parameters<typeof registerSessionSweepRoutes>[0], 'router' | 'requireWriteAccess' | 'prunerConfig'>,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const app = express()
  app.use(express.json())
  const router = express.Router()
  registerSessionSweepRoutes({
    router,
    requireWriteAccess,
    prunerConfig,
    ...deps,
  })
  app.use('/api/agents', router)

  const server: Server = await new Promise((resolve) => {
    const listening = createServer(app)
    listening.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/agents`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
}

function makeCandidate(name: string, reason: SessionPruneCandidate['reason']): SessionPruneCandidate {
  return {
    name,
    sessionType: 'worker',
    creator: { kind: 'commander', id: 'atlas' },
    lifecycle: 'exited',
    ageMs: 180_000,
    reason,
  }
}

describe('session sweep routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns dry-run candidates without pruning sessions', async () => {
    const cronCandidate = makeCandidate('cron-old', 'cron-completed-ttl')
    const workerCandidate = makeCandidate('worker-old', 'exited-commander-worker-ttl')
    const deps = {
      getStaleCronSessionCandidates: vi.fn(() => [cronCandidate]),
      getStaleNonHumanSessionCandidates: vi.fn(async () => [workerCandidate]),
      pruneStaleCronSessions: vi.fn(() => 1),
      pruneStaleNonHumanSessions: vi.fn(async () => 1),
    }
    const server = await startSweepServer(deps)

    try {
      const response = await fetch(`${server.baseUrl}/sessions/sweep?dryRun=true`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        pruned: {
          cron: 1,
          nonHuman: 1,
        },
        candidates: [cronCandidate, workerCandidate],
      })
      expect(deps.getStaleNonHumanSessionCandidates).toHaveBeenCalledWith(
        prunerConfig,
        expect.any(Number),
      )
      expect(deps.pruneStaleCronSessions).not.toHaveBeenCalled()
      expect(deps.pruneStaleNonHumanSessions).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('runs both pruners when dry-run is not requested', async () => {
    const deps = {
      getStaleCronSessionCandidates: vi.fn(() => []),
      getStaleNonHumanSessionCandidates: vi.fn(async () => []),
      pruneStaleCronSessions: vi.fn(() => 2),
      pruneStaleNonHumanSessions: vi.fn(async () => 3),
    }
    const server = await startSweepServer(deps)

    try {
      const response = await fetch(`${server.baseUrl}/sessions/sweep`, { method: 'POST' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ pruned: { cron: 2, nonHuman: 3 } })
      expect(deps.pruneStaleCronSessions).toHaveBeenCalledWith(expect.any(Number))
      expect(deps.pruneStaleNonHumanSessions).toHaveBeenCalledWith(prunerConfig, expect.any(Number))
    } finally {
      await server.close()
    }
  })
})
