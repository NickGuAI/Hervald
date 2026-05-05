/**
 * Tests for createApprovalSessionsInterface — the issue/921 P6a extraction.
 *
 * These tests inject stub closures so we can verify:
 *   1. getSessionContext projects the right fields for stream sessions
 *      and returns null for missing / non-stream sessions.
 *   2. findSessionContextByClaudeSessionId matches only claude sessions
 *      with the exact resume session id.
 *   3. listPendingCodexApprovals collects + sorts by requestedAt.
 *   4. resolvePendingCodexApproval dispatches valid IDs to the injected
 *      decision applier and returns 'not_found' for malformed / unknown IDs.
 *   5. subscribeToCodexApprovalQueue registers + returns an unsubscribe.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createClaudeProviderContext,
  createCodexProviderContext,
} from '../providers/provider-session-context'

import {
  createApprovalSessionsInterface,
  type ApprovalInterfaceContext,
} from '../approval-interface'
import type {
  AnySession,
  CodexApprovalQueueEvent,
  CodexPendingApprovalRequest,
  PendingCodexApprovalView,
  StreamSession,
} from '../types'

function makeCodexSession(name: string, overrides: Partial<StreamSession> = {}): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'codex',
    sessionType: 'worker',
    creator: { kind: 'human', id: 'test-user' },
    mode: 'default',
    cwd: '/tmp',
    host: undefined,
    providerContext: createCodexProviderContext(),
    codexPendingApprovals: new Map(),
    ...overrides,
  } as unknown as StreamSession
}

function makeClaudeSession(name: string, resumeSessionId: string | null = null): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    sessionType: 'worker',
    creator: { kind: 'human', id: 'test-user' },
    mode: 'default',
    cwd: '/tmp',
    host: undefined,
    providerContext: createClaudeProviderContext({
      sessionId: resumeSessionId ?? undefined,
    }),
  } as unknown as StreamSession
}

function makeBaseContext(
  overrides: Partial<ApprovalInterfaceContext> = {},
): ApprovalInterfaceContext {
  const defaults: ApprovalInterfaceContext = {
    sessions: new Map(),
    codexApprovalQueueSubscribers: new Set(),
    getApprovalCommanderScopeId: vi.fn((_s) => 'commander-scope-id'),
    toPendingCodexApprovalView: vi.fn(
      (session, request) => ({
        id: `codex:${session.name}:${request.requestId}`,
        sessionName: session.name,
        requestId: request.requestId,
        actionId: 'codex-file-change',
        actionLabel: 'File Change',
        requestedAt: request.requestedAt ?? '2026-04-22T00:00:00Z',
      } as unknown as PendingCodexApprovalView),
    ),
    applyCodexApprovalDecision: vi.fn(() => ({ ok: true as const })),
  }
  return { ...defaults, ...overrides }
}

describe('createApprovalSessionsInterface — getSessionContext', () => {
  it('projects fields from a stream session', () => {
    const session = makeCodexSession('codex-1', {
      currentSkillInvocation: {
        skillId: 'send-weekly-update',
        displayName: '/send-weekly-update',
        startedAt: '2026-04-26T12:00:00.000Z',
        toolUseId: 'toolu_123',
      },
    })
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['codex-1', session]]),
    })
    const iface = createApprovalSessionsInterface(ctx)

    const result = iface.getSessionContext('codex-1')
    expect(result).toEqual({
      sessionName: 'codex-1',
      sessionType: 'worker',
      creator: { kind: 'human', id: 'test-user' },
      agentType: 'codex',
      mode: 'default',
      cwd: '/tmp',
      host: undefined,
      commanderScopeId: 'commander-scope-id',
      currentSkillInvocation: {
        skillId: 'send-weekly-update',
        displayName: '/send-weekly-update',
        startedAt: '2026-04-26T12:00:00.000Z',
        toolUseId: 'toolu_123',
      },
    })
    expect(ctx.getApprovalCommanderScopeId).toHaveBeenCalledWith(session)
  })

  it('returns null for missing session', () => {
    const iface = createApprovalSessionsInterface(makeBaseContext())
    expect(iface.getSessionContext('nope')).toBeNull()
  })

  it('returns null for non-stream session', () => {
    const ptySession = { name: 'pty-1', kind: 'pty' } as unknown as AnySession
    const ctx = makeBaseContext({ sessions: new Map([['pty-1', ptySession]]) })
    const iface = createApprovalSessionsInterface(ctx)
    expect(iface.getSessionContext('pty-1')).toBeNull()
  })
})

describe('createApprovalSessionsInterface — findSessionContextByClaudeSessionId', () => {
  it('matches a claude session by resume session id', () => {
    const target = makeClaudeSession('claude-target', 'session-abc')
    const other = makeClaudeSession('claude-other', 'session-xyz')
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([
        ['claude-target', target],
        ['claude-other', other],
      ]),
    })
    const iface = createApprovalSessionsInterface(ctx)

    const result = iface.findSessionContextByClaudeSessionId('session-abc')
    expect(result?.sessionName).toBe('claude-target')
  })

  it('trims whitespace and returns null on empty input', () => {
    const iface = createApprovalSessionsInterface(makeBaseContext())
    expect(iface.findSessionContextByClaudeSessionId('   ')).toBeNull()
    expect(iface.findSessionContextByClaudeSessionId('')).toBeNull()
  })

  it('ignores non-claude sessions even if id matches', () => {
    const codex = makeCodexSession('codex-1')
    codex.providerContext = createCodexProviderContext({
      threadId: 'session-abc',
    })
    const ctx = makeBaseContext({ sessions: new Map([['codex-1', codex]]) })
    const iface = createApprovalSessionsInterface(ctx)

    expect(iface.findSessionContextByClaudeSessionId('session-abc')).toBeNull()
  })
})

describe('createApprovalSessionsInterface — listPendingCodexApprovals', () => {
  it('collects from codex sessions and sorts by requestedAt ascending', () => {
    const s1 = makeCodexSession('codex-A')
    const s2 = makeCodexSession('codex-B')
    ;(s1 as unknown as { codexPendingApprovals: Map<number, CodexPendingApprovalRequest> })
      .codexPendingApprovals.set(1, {
        requestId: 1,
        requestedAt: '2026-01-01T05:00:00Z',
      } as unknown as CodexPendingApprovalRequest)
    ;(s2 as unknown as { codexPendingApprovals: Map<number, CodexPendingApprovalRequest> })
      .codexPendingApprovals.set(2, {
        requestId: 2,
        requestedAt: '2026-01-01T03:00:00Z',
      } as unknown as CodexPendingApprovalRequest)

    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['codex-A', s1], ['codex-B', s2]]),
    })
    const iface = createApprovalSessionsInterface(ctx)
    const pending = iface.listPendingCodexApprovals()

    expect(pending).toHaveLength(2)
    // Earlier requestedAt first
    expect(pending[0]?.sessionName).toBe('codex-B')
    expect(pending[1]?.sessionName).toBe('codex-A')
  })

  it('skips non-codex sessions', () => {
    const claude = makeClaudeSession('claude-1', 'session-z')
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['claude-1', claude]]),
    })
    const iface = createApprovalSessionsInterface(ctx)
    expect(iface.listPendingCodexApprovals()).toEqual([])
  })
})

describe('createApprovalSessionsInterface — resolvePendingCodexApproval', () => {
  it('returns not_found for malformed approval IDs', () => {
    const iface = createApprovalSessionsInterface(makeBaseContext())
    const result = iface.resolvePendingCodexApproval('bogus', 'approve')
    expect(result).toEqual({
      ok: false,
      code: 'not_found',
      reason: expect.stringContaining('bogus'),
    })
  })

  it('returns not_found when the session is missing', () => {
    const iface = createApprovalSessionsInterface(makeBaseContext())
    const result = iface.resolvePendingCodexApproval('codex:ghost:1', 'approve')
    expect(result).toEqual({
      ok: false,
      code: 'not_found',
      reason: expect.stringContaining('codex:ghost:1'),
    })
  })

  it('dispatches valid IDs to the injected decider', () => {
    const session = makeCodexSession('codex-x')
    const decider = vi.fn(() => ({ ok: true as const }))
    const ctx = makeBaseContext({
      sessions: new Map<string, AnySession>([['codex-x', session]]),
      applyCodexApprovalDecision: decider,
    })
    const iface = createApprovalSessionsInterface(ctx)

    const result = iface.resolvePendingCodexApproval('codex:codex-x:42', 'reject')
    expect(result).toEqual({ ok: true })
    expect(decider).toHaveBeenCalledWith(session, 42, 'reject')
  })
})

describe('createApprovalSessionsInterface — subscribeToCodexApprovalQueue', () => {
  it('registers the listener and the returned fn unsubscribes', () => {
    const subscribers = new Set<(event: CodexApprovalQueueEvent) => void>()
    const ctx = makeBaseContext({ codexApprovalQueueSubscribers: subscribers })
    const iface = createApprovalSessionsInterface(ctx)
    const listener = vi.fn()

    const unsubscribe = iface.subscribeToCodexApprovalQueue(listener)
    expect(subscribers.has(listener)).toBe(true)

    unsubscribe()
    expect(subscribers.has(listener)).toBe(false)
  })
})
