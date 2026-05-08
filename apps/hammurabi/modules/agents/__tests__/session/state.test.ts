import { describe, expect, it } from 'vitest'
import {
  aggregateCommanderWorldAgentSource,
  liveSessionToApiPayload,
  parsePersistedStreamSessionEntry,
  toCommanderWorldAgent,
} from '../../session/state'
import { SessionMessageQueue } from '../../message-queue'
import type { StreamSession } from '../../types'
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

  it('preserves persisted model selections during restore parsing', () => {
    expect(parsePersistedStreamSessionEntry({
      name: 'worker-model-01',
      agentType: 'codex',
      model: 'gpt-5.4',
      mode: 'default',
      cwd: '/tmp/worktree',
      createdAt: '2026-04-24T00:00:00.000Z',
      providerContext: {
        providerId: 'codex',
        threadId: 'thread-1',
      },
    })).toEqual(expect.objectContaining({
      name: 'worker-model-01',
      agentType: 'codex',
      model: 'gpt-5.4',
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

  it('projects live stream sessions to a JSON-safe AgentSession payload', () => {
    const watchdog = setTimeout(() => {}, 30_000)
    watchdog.unref()

    try {
      const session = {
        kind: 'stream',
        name: 'command-room-codex',
        sessionType: 'commander',
        creator: { kind: 'commander', id: 'cmdr-atlas' },
        conversationId: '11111111-1111-4111-8111-111111111111',
        agentType: 'codex',
        model: 'gpt-5.4',
        effort: 'max',
        adaptiveThinking: 'disabled',
        mode: 'default',
        cwd: '/tmp/worktree',
        host: 'local',
        spawnedBy: 'parent-session',
        spawnedWorkers: ['worker-1'],
        process: { pid: 4242 },
        events: [],
        clients: new Set(),
        createdAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        stdoutBuffer: '',
        stdinDraining: false,
        lastTurnCompleted: true,
        providerContext: { providerId: 'codex', threadId: 'thread-1' },
        conversationEntryCount: 0,
        autoRotatePending: false,
        codexTurnWatchdogTimer: watchdog,
        codexUnclassifiedIncomingCount: 0,
        codexPendingApprovals: new Map(),
        messageQueue: new SessionMessageQueue(20, [{
          id: 'queued-1',
          text: 'next',
          priority: 'normal',
          queuedAt: '2026-05-01T00:00:00.000Z',
        }]),
        pendingDirectSendMessages: [{
          id: 'direct-1',
          text: 'follow-up',
          priority: 'high',
          queuedAt: '2026-05-01T00:00:01.000Z',
        }],
        queuedMessageRetryDelayMs: 0,
        queuedMessageDrainScheduled: false,
        queuedMessageDrainPending: false,
        queuedMessageDrainPendingForce: false,
        restoredIdle: false,
      } as unknown as StreamSession

      const payload = liveSessionToApiPayload(session)
      const serialized = JSON.stringify(payload)
      expect(serialized).toBeTruthy()
      expect(JSON.parse(serialized)).toEqual({
        name: 'command-room-codex',
        created: session.createdAt,
        lastActivityAt: session.lastEventAt,
        pid: 4242,
        transportType: 'stream',
        processAlive: true,
        hadResult: false,
        status: 'active',
        queuedMessageCount: 2,
        sessionType: 'commander',
        creator: { kind: 'commander', id: 'cmdr-atlas' },
        agentType: 'codex',
        effort: 'max',
        adaptiveThinking: 'disabled',
        model: 'gpt-5.4',
        cwd: '/tmp/worktree',
        host: 'local',
        spawnedBy: 'parent-session',
        spawnedWorkers: ['worker-1'],
      })
      expect(payload).not.toHaveProperty('process')
      expect(payload).not.toHaveProperty('clients')
      expect(payload).not.toHaveProperty('events')
      expect(payload).not.toHaveProperty('messageQueue')
      expect(payload).not.toHaveProperty('providerContext')
      expect(payload).not.toHaveProperty('codexTurnWatchdogTimer')
    } finally {
      clearTimeout(watchdog)
    }
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
