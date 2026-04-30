/**
 * Tests for the real `dispatchWorkerForCommander` helper composed onto the
 * agents-side `CommanderSessionsInterface` (issue #1223). The
 * `register-workers.test.ts` suite covers the commanders-router adapter
 * with a mocked dispatch helper; this suite exercises the actual
 * helper closure against a real `createAgentsRouter` so we pin the
 * URL-baked-creator + key-presence-rejection contract end-to-end.
 */
import { describe, expect, it } from 'vitest'
import { createMockPtySpawner, startServer } from './routes-test-harness'

const COMMANDER_ID = 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e'

describe('dispatchWorkerForCommander helper (agents-side)', () => {
  it('rejects body.creator regardless of value (key presence is the contract)', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      // Each of these inputs would silently fall through to the URL-baked
      // creator if the route only inspected value, not key presence. Per
      // #1223's "no silent drop" constraint, all three return 400.
      const explicitCreator = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: {
          name: 'worker-explicit-creator',
          creator: { kind: 'commander', id: 'forged-attribution' },
        },
      })
      expect(explicitCreator.status).toBe(400)
      expect(String(explicitCreator.body.error)).toContain('creator must not be provided')

      const nullCreator = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: { name: 'worker-null-creator', creator: null },
      })
      expect(nullCreator.status).toBe(400)
      expect(String(nullCreator.body.error)).toContain('creator must not be provided')

      const emptyCreator = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: { name: 'worker-empty-creator', creator: '' },
      })
      expect(emptyCreator.status).toBe(400)
      expect(String(emptyCreator.body.error)).toContain('creator must not be provided')
    } finally {
      await server.close()
    }
  })

  it('rejects body.parentSession regardless of value (key presence is the contract)', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const explicitParent = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: {
          name: 'worker-explicit-parent',
          parentSession: 'commander-d66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
        },
      })
      expect(explicitParent.status).toBe(400)
      expect(String(explicitParent.body.error)).toContain('parentSession is not honored')

      const nullParent = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: { name: 'worker-null-parent', parentSession: null },
      })
      expect(nullParent.status).toBe(400)
      expect(String(nullParent.body.error)).toContain('parentSession is not honored')
    } finally {
      await server.close()
    }
  })

  it('rejects sessionType !== "worker"', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const result = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: {
          name: 'worker-bad-session-type',
          sessionType: 'commander',
        },
      })
      expect(result.status).toBe(400)
      expect(String(result.body.error)).toContain('sessionType must be "worker"')
    } finally {
      await server.close()
    }
  })

  it('returns 400 when session name is missing or invalid', async () => {
    const { spawner } = createMockPtySpawner()
    const server = await startServer({ ptySpawner: spawner })

    try {
      const result = await server.agents.sessionsInterface.dispatchWorkerForCommander({
        commanderId: COMMANDER_ID,
        rawBody: { name: '   ' },
      })
      expect(result.status).toBe(400)
      expect(String(result.body.error)).toContain('Invalid session name')
    } finally {
      await server.close()
    }
  })
})
