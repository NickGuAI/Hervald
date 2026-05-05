import { describe, expect, it } from 'vitest'
import {
  aggregateCommanderWorldAgentSource,
  parsePersistedStreamSessionEntry,
  toCommanderWorldAgent,
} from '../../session/state'
import type { CommanderSession } from '../../../commanders/store'
import { getProvider } from '../../providers/registry'

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

  it('preserves legacy OpenClaw skills discovery under the Claude adapter', () => {
    expect(getProvider('claude')?.skillScanPaths).toEqual(
      expect.arrayContaining(['~/.claude/skills', '~/.openclaw/skills']),
    )
  })

  it('keeps explicit non-Claude legacy contexts on their matching provider', () => {
    expect(parsePersistedStreamSessionEntry({
      name: 'gemini-legacy',
      agentType: 'gemini',
      mode: 'default',
      cwd: '/tmp/worktree',
      createdAt: '2026-04-24T00:00:00.000Z',
      providerContext: {
        sessionId: 'gemini-session-1',
      },
      effort: 'max',
      adaptiveThinking: 'disabled',
    })).toEqual(expect.objectContaining({
      agentType: 'gemini',
      providerContext: expect.objectContaining({
        providerId: 'gemini',
        sessionId: 'gemini-session-1',
      }),
    }))
  })

  describe('toCommanderWorldAgent / aggregateCommanderWorldAgentSource', () => {
    // Regression for codex-review P2 on PR #1279 (comment 3174491802):
    // /api/agents/world commander entries used to hardcode costUsd=0,
    // task='', lastUpdatedAt=created. Per #1216 phase 1, those values now
    // live on the conversation rows, so observability must aggregate from
    // the conversation store and pass best-effort values into
    // toCommanderWorldAgent.

    const baseCommander: CommanderSession = {
      id: 'cmd-aggregate',
      host: 'cmd-aggregate-host',
      state: 'idle',
      created: '2026-05-01T00:00:00.000Z',
      agentType: 'claude',
      cwd: '/tmp',
      maxTurns: 10,
      contextMode: 'thin',
      taskSource: null,
    }

    it('sums totalCostUsd across conversations and prefers the active conversation\'s currentTask', () => {
      const source = aggregateCommanderWorldAgentSource([
        {
          status: 'idle',
          totalCostUsd: 1.25,
          currentTask: { issueUrl: 'https://example.test/issues/idle' },
          lastMessageAt: '2026-05-01T00:01:00.000Z',
        },
        {
          status: 'active',
          totalCostUsd: 3.5,
          currentTask: { issueUrl: 'https://example.test/issues/active' },
          lastMessageAt: '2026-05-01T00:02:00.000Z',
          lastHeartbeat: '2026-05-01T00:03:00.000Z',
        },
      ])

      expect(source.totalCostUsd).toBe(4.75)
      expect(source.task).toBe('https://example.test/issues/active')
      expect(source.lastUpdatedAt).toBe('2026-05-01T00:03:00.000Z')

      const worldAgent = toCommanderWorldAgent(baseCommander, source)
      expect(worldAgent.usage.costUsd).toBe(4.75)
      expect(worldAgent.task).toBe('https://example.test/issues/active')
      expect(worldAgent.lastUpdatedAt).toBe('2026-05-01T00:03:00.000Z')
      expect(worldAgent.role).toBe('commander')
    })

    it('falls back to the most-recent-by-lastMessageAt conversation when none are active', () => {
      const source = aggregateCommanderWorldAgentSource([
        {
          status: 'idle',
          totalCostUsd: 0.5,
          currentTask: { issueUrl: 'https://example.test/issues/older' },
          lastMessageAt: '2026-05-01T00:01:00.000Z',
        },
        {
          status: 'idle',
          totalCostUsd: 0.75,
          currentTask: { issueUrl: 'https://example.test/issues/newer' },
          lastMessageAt: '2026-05-01T00:05:00.000Z',
        },
      ])

      expect(source.task).toBe('https://example.test/issues/newer')
      expect(source.totalCostUsd).toBe(1.25)
    })

    it('falls back to commander.created for lastUpdatedAt when no conversations exist', () => {
      const worldAgent = toCommanderWorldAgent(baseCommander, aggregateCommanderWorldAgentSource([]))
      expect(worldAgent.usage.costUsd).toBe(0)
      expect(worldAgent.task).toBe('')
      expect(worldAgent.lastUpdatedAt).toBe(baseCommander.created)
    })
  })
})
