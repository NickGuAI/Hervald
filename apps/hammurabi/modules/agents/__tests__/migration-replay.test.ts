import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_HEADERS, installMockCodexSidecar, startServer } from './routes-test-harness'

describe('agent session creator/sessionType migration replay', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('backfills a legacy persisted session on first restore and replays cleanly on restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-migration-replay-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString()
    const completedAt = new Date(Date.now() - 4 * 60_000).toISOString()

    try {
      await writeFile(
        sessionStorePath,
        JSON.stringify({
          sessions: [
            {
              name: 'worker-1710000000000',
              agentType: 'claude',
              mode: 'default',
              cwd: '/tmp/legacy-worker',
              createdAt,
              sessionState: 'exited',
              hadResult: true,
              providerContext: {
                providerId: 'claude',
                sessionId: 'claude-worker-legacy',
              },
              parentSession: 'commander-cmdr-atlas',
              sessionCategory: 'regular',
              events: [
                {
                  type: 'result',
                  subtype: 'success',
                  timestamp: completedAt,
                  total_cost_usd: 0.01,
                },
              ],
            },
          ],
        }, null, 2),
        'utf8',
      )

      const server = await startServer({ sessionStorePath, autoResumeSessions: true })
      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'worker-1710000000000',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-atlas' },
            spawnedBy: 'commander-cmdr-atlas',
          }),
        ]))
      } finally {
        await server.close()
      }

      const upgradedRaw = await readFile(sessionStorePath, 'utf8')
      expect(JSON.parse(upgradedRaw)).toEqual({
        sessions: [
          expect.objectContaining({
            name: 'worker-1710000000000',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-atlas' },
            spawnedBy: 'commander-cmdr-atlas',
          }),
        ],
      })
      expect(consoleInfo).toHaveBeenCalledTimes(1)

      consoleInfo.mockClear()

      const replayServer = await startServer({ sessionStorePath, autoResumeSessions: true })
      try {
        const response = await fetch(`${replayServer.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'worker-1710000000000',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-atlas' },
          }),
        ]))
      } finally {
        await replayServer.close()
      }

      expect(await readFile(sessionStorePath, 'utf8')).toBe(upgradedRaw)
      expect(consoleInfo).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('replays persisted currentSkillInvocation on restore', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hammurabi-skill-trust-replay-'))
    const sessionStorePath = join(dir, 'stream-sessions.json')
    installMockCodexSidecar()

    try {
      const firstServer = await startServer({ sessionStorePath, autoResumeSessions: false })
      const workerName = 'skill-trust-worker'
      try {
        const createResponse = await fetch(`${firstServer.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: workerName,
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            cwd: '/tmp/skill-trust-worker',
            currentSkillInvocation: {
              skillId: 'send-weekly-update',
              displayName: '/send-weekly-update',
              startedAt: '2026-04-26T12:00:00.000Z',
              toolUseId: 'toolu_skill_123',
            },
          }),
        })

        expect(createResponse.status).toBe(201)
      } finally {
        await firstServer.close()
      }

      expect(JSON.parse(await readFile(sessionStorePath, 'utf8'))).toEqual({
        sessions: [
          expect.objectContaining({
            name: workerName,
            currentSkillInvocation: {
              skillId: 'send-weekly-update',
              displayName: '/send-weekly-update',
              startedAt: '2026-04-26T12:00:00.000Z',
              toolUseId: 'toolu_skill_123',
            },
          }),
        ],
      })

      const replayServer = await startServer({ sessionStorePath, autoResumeSessions: true })
      try {
        await vi.waitFor(() => {
          expect(
            replayServer.agents.approvalSessionsInterface.getSessionContext(workerName)?.currentSkillInvocation,
          ).toEqual({
            skillId: 'send-weekly-update',
            displayName: '/send-weekly-update',
            startedAt: '2026-04-26T12:00:00.000Z',
            toolUseId: 'toolu_skill_123',
          })
        })
      } finally {
        await replayServer.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
