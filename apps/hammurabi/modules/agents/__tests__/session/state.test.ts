import { describe, expect, it } from 'vitest'
import { parsePersistedStreamSessionEntry } from '../../session/state'

describe('agents/session/state', () => {
  it('drops legacy persisted OpenClaw entries during restore parsing', () => {
    expect(parsePersistedStreamSessionEntry({
      name: 'openclaw-legacy',
      agentType: 'openclaw',
      mode: 'default',
      cwd: '/tmp/worktree',
      createdAt: '2026-04-24T00:00:00.000Z',
    })).toBeNull()
  })

  it('round-trips persisted currentSkillInvocation when the stored shape is valid', () => {
    expect(parsePersistedStreamSessionEntry({
      name: 'worker-skill-01',
      agentType: 'claude',
      mode: 'default',
      cwd: '/tmp/worktree',
      createdAt: '2026-04-24T00:00:00.000Z',
      currentSkillInvocation: {
        skillId: 'send-weekly-update',
        displayName: '/send-weekly-update',
        startedAt: '2026-04-24T00:01:00.000Z',
        toolUseId: 'toolu_123',
      },
    })).toEqual(expect.objectContaining({
      name: 'worker-skill-01',
      currentSkillInvocation: {
        skillId: 'send-weekly-update',
        displayName: '/send-weekly-update',
        startedAt: '2026-04-24T00:01:00.000Z',
        toolUseId: 'toolu_123',
      },
    }))
  })

  it('ignores malformed persisted currentSkillInvocation without rejecting the session', () => {
    expect(parsePersistedStreamSessionEntry({
      name: 'worker-skill-02',
      agentType: 'claude',
      mode: 'default',
      cwd: '/tmp/worktree',
      createdAt: '2026-04-24T00:00:00.000Z',
      currentSkillInvocation: {
        skillId: 'send-weekly-update',
        startedAt: '2026-04-24T00:01:00.000Z',
      },
    })).toEqual(expect.objectContaining({
      name: 'worker-skill-02',
      currentSkillInvocation: undefined,
    }))
  })
})
