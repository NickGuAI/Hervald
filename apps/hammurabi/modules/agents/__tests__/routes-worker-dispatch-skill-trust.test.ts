import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
  createMockChildProcess,
  mockedSpawn,
  startServer,
} from './routes-test-harness'

const ACTIVE_SKILL = {
  skillId: 'send-weekly-update',
  displayName: '/send-weekly-update',
  startedAt: '2026-04-26T12:00:00.000Z',
  toolUseId: 'toolu_skill_123',
} as const

describe('dispatch worker skill trust wiring', () => {
  afterEach(() => {
    mockedSpawn.mockReset()
  })

  it('inherits currentSkillInvocation from the parent stream session by default', async () => {
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
          name: 'commander-skill-parent',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-atlas' },
          cwd: '/tmp',
        }),
      })
      expect(createResponse.status).toBe(201)

      const sourceSession = server.agents.sessionsInterface.getSession('commander-skill-parent')
      expect(sourceSession).toBeDefined()
      sourceSession!.currentSkillInvocation = { ...ACTIVE_SKILL }

      const dispatchResponse = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-skill-parent',
          task: 'Fan out work from the trusted skill',
        }),
      })

      expect(dispatchResponse.status).toBe(202)
      const payload = await dispatchResponse.json() as { name: string }
      const workerContext = server.agents.approvalSessionsInterface.getSessionContext(payload.name)
      expect(workerContext?.currentSkillInvocation).toEqual(ACTIVE_SKILL)
      expect(sourceSession?.currentSkillInvocation).toEqual(ACTIVE_SKILL)
      expect(spawned).toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it('supports explicit skill-context override and nullification on dispatch', async () => {
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
          name: 'commander-skill-parent',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-atlas' },
          cwd: '/tmp',
        }),
      })
      expect(createResponse.status).toBe(201)

      const sourceSession = server.agents.sessionsInterface.getSession('commander-skill-parent')
      expect(sourceSession).toBeDefined()
      sourceSession!.currentSkillInvocation = { ...ACTIVE_SKILL }

      const nullifiedDispatch = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-skill-parent',
          currentSkillInvocation: null,
        }),
      })
      expect(nullifiedDispatch.status).toBe(202)
      const nullifiedPayload = await nullifiedDispatch.json() as { name: string }
      expect(
        server.agents.approvalSessionsInterface.getSessionContext(nullifiedPayload.name)?.currentSkillInvocation,
      ).toBeUndefined()

      const overriddenSkill = {
        skillId: 'lockdown',
        displayName: '/lockdown',
        startedAt: '2026-04-26T12:05:00.000Z',
      }
      const overrideDispatch = await fetch(`${server.baseUrl}/api/agents/sessions/dispatch-worker`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          spawnedBy: 'commander-skill-parent',
          currentSkillInvocation: overriddenSkill,
        }),
      })
      expect(overrideDispatch.status).toBe(202)
      const overridePayload = await overrideDispatch.json() as { name: string }
      expect(
        server.agents.approvalSessionsInterface.getSessionContext(overridePayload.name)?.currentSkillInvocation,
      ).toEqual(overriddenSkill)
      expect(sourceSession?.currentSkillInvocation).toEqual(ACTIVE_SKILL)
      expect(spawned).toHaveLength(3)
    } finally {
      await server.close()
    }
  })
})
