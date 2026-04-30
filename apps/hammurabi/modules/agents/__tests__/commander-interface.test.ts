/**
 * Tests for createCommanderSessionsInterface — the #921 P5 extraction.
 *
 * The factory under test composes the CommanderSessionsInterface from
 * router-local context dependencies. These tests inject stub closures so
 * we can verify:
 *   1. createCommanderSession calls the right creator based on agentType
 *      and wires the resulting session into the sessions Map.
 *   2. sendToSession routes immediate sends to sendImmediateTextToStreamSession
 *      and queued sends to enqueueQueuedMessage + scheduleQueuedMessageDrain.
 *   3. deleteSession tears down codex vs gemini vs claude sessions via the
 *      right teardown closure and strips sessions + handlers afterwards.
 *   4. subscribeToEvents adds + removes handlers correctly.
 *   5. shutdown fans out to both runtime shutdowns.
 *
 * These tests pin the contract between the router and the extracted
 * interface so future refactors can't silently drop a closure dependency.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createCommanderSessionsInterface,
  type CommanderInterfaceContext,
} from '../commander-interface'
import type { AnySession, StreamJsonEvent, StreamSession } from '../types'
import type { QueuedMessage } from '../message-queue'

function makeClaudeStreamSession(name: string): StreamSession {
  // The sessionsInterface only reads .kind, .agentType, .clients, .process
  // from the result of createStreamSession on the claude path. A minimal
  // stub satisfies the extraction contract without forcing us to construct
  // a fully-populated StreamSession.
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    clients: new Set(),
    process: { kill: vi.fn() } as unknown as StreamSession['process'],
    events: [],
    queuedMessages: [],
    // deliberately partial — other fields are never read by the interface
  } as unknown as StreamSession
}

function makeCodexStreamSession(name: string): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'codex',
    clients: new Set(),
    events: [],
    queuedMessages: [],
  } as unknown as StreamSession
}

function makeBaseContext(
  overrides: Partial<CommanderInterfaceContext> = {},
): CommanderInterfaceContext {
  const defaults: CommanderInterfaceContext = {
    sessions: new Map(),
    sessionEventHandlers: new Map(),
    schedulePersistedSessionsWrite: vi.fn(),
    createCodexAppServerSession: vi.fn(async (name) => makeCodexStreamSession(name)),
    createGeminiAcpSession: vi.fn(async (name) => {
      const s = makeClaudeStreamSession(name)
      ;(s as unknown as { agentType: string }).agentType = 'gemini'
      return s
    }),
    createStreamSession: vi.fn((name) => makeClaudeStreamSession(name)),
    createQueuedMessage: vi.fn((text, priority) => ({
      id: 'queued-1',
      text,
      priority,
      queuedAt: new Date().toISOString(),
    }) as unknown as QueuedMessage),
    enqueueQueuedMessage: vi.fn(() => ({ ok: true as const })),
    scheduleQueuedMessageDrain: vi.fn(),
    sendImmediateTextToStreamSession: vi.fn(async () => ({
      ok: true as const,
      queued: false,
      message: { id: 'm', text: '' } as unknown as QueuedMessage,
    })),
    teardownCodexSessionRuntime: vi.fn(async () => undefined),
    teardownGeminiSessionRuntime: vi.fn(async () => undefined),
    shutdownCodexRuntimes: vi.fn(async () => undefined),
    shutdownGeminiRuntimes: vi.fn(async () => undefined),
  }
  return { ...defaults, ...overrides }
}

describe('createCommanderSessionsInterface — createCommanderSession', () => {
  it('routes claude to createStreamSession and writes to the sessions map', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    const session = await iface.createCommanderSession({
      name: 'commander-claude',
      commanderId: 'claude',
      systemPrompt: 'hello',
      agentType: 'claude',
    })

    expect(ctx.createStreamSession).toHaveBeenCalledTimes(1)
    expect(ctx.createCodexAppServerSession).not.toHaveBeenCalled()
    expect(ctx.createGeminiAcpSession).not.toHaveBeenCalled()
    expect(ctx.sessions.get('commander-claude')).toBe(session)
    expect(ctx.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
  })

  it('routes codex to createCodexAppServerSession', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'commander-codex',
      commanderId: 'codex',
      systemPrompt: 'hi',
      agentType: 'codex',
    })

    expect(ctx.createCodexAppServerSession).toHaveBeenCalledTimes(1)
    expect(ctx.createStreamSession).not.toHaveBeenCalled()
    expect(ctx.sessions.has('commander-codex')).toBe(true)
  })

  it('routes gemini to createGeminiAcpSession', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'commander-gemini',
      commanderId: 'gemini',
      systemPrompt: 'hi',
      agentType: 'gemini',
    })

    expect(ctx.createGeminiAcpSession).toHaveBeenCalledTimes(1)
    expect(ctx.sessions.has('commander-gemini')).toBe(true)
  })

  it('falls back to a fresh codex thread when resume fails', async () => {
    let callCount = 0
    const ctx = makeBaseContext({
      createCodexAppServerSession: vi.fn(async (name) => {
        callCount += 1
        if (callCount === 1) {
          throw new Error('resume rollout missing')
        }
        return makeCodexStreamSession(name)
      }),
    })
    const iface = createCommanderSessionsInterface(ctx)

    await iface.createCommanderSession({
      name: 'commander-codex-resume',
      commanderId: 'codex-resume',
      systemPrompt: 'hi',
      agentType: 'codex',
      resumeCodexThreadId: 'stale-thread',
    })

    expect(ctx.createCodexAppServerSession).toHaveBeenCalledTimes(2)
    expect(ctx.sessions.has('commander-codex-resume')).toBe(true)
  })
})

describe('createCommanderSessionsInterface — sendToSession', () => {
  it('immediate send calls sendImmediateTextToStreamSession and returns its ok', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'hello')

    expect(ok).toBe(true)
    expect(ctx.sendImmediateTextToStreamSession).toHaveBeenCalledTimes(1)
    expect(ctx.enqueueQueuedMessage).not.toHaveBeenCalled()
  })

  it('queued send routes through createQueuedMessage + enqueue + drain', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'deferred', { queue: true, priority: 'high' })

    expect(ok).toBe(true)
    expect(ctx.createQueuedMessage).toHaveBeenCalledWith('deferred', 'high')
    expect(ctx.enqueueQueuedMessage).toHaveBeenCalledTimes(1)
    expect(ctx.scheduleQueuedMessageDrain).toHaveBeenCalledTimes(1)
    expect(ctx.sendImmediateTextToStreamSession).not.toHaveBeenCalled()
  })

  it('returns false when the session does not exist', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    expect(await iface.sendToSession('missing', 'x')).toBe(false)
    expect(ctx.sendImmediateTextToStreamSession).not.toHaveBeenCalled()
  })

  it('returns false when queued send fails to enqueue', async () => {
    const session = makeClaudeStreamSession('target')
    const sessions = new Map<string, AnySession>([['target', session]])
    const ctx = makeBaseContext({
      sessions,
      enqueueQueuedMessage: vi.fn(() => ({ ok: false as const, error: 'full' })),
    })
    const iface = createCommanderSessionsInterface(ctx)

    const ok = await iface.sendToSession('target', 'x', { queue: true })

    expect(ok).toBe(false)
    expect(ctx.scheduleQueuedMessageDrain).not.toHaveBeenCalled()
  })
})

describe('createCommanderSessionsInterface — deleteSession', () => {
  it('tears down a codex session via teardownCodexSessionRuntime', () => {
    const session = makeCodexStreamSession('codex-1')
    const sessions = new Map<string, AnySession>([['codex-1', session]])
    const sessionEventHandlers = new Map<string, Set<(e: StreamJsonEvent) => void>>([
      ['codex-1', new Set()],
    ])
    const ctx = makeBaseContext({ sessions, sessionEventHandlers })
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('codex-1')

    expect(ctx.teardownCodexSessionRuntime).toHaveBeenCalledTimes(1)
    expect(ctx.teardownGeminiSessionRuntime).not.toHaveBeenCalled()
    expect(sessions.has('codex-1')).toBe(false)
    expect(sessionEventHandlers.has('codex-1')).toBe(false)
    expect(ctx.schedulePersistedSessionsWrite).toHaveBeenCalledTimes(1)
  })

  it('tears down a claude session via process.kill(SIGTERM)', () => {
    const session = makeClaudeStreamSession('claude-1')
    const killSpy = vi.fn()
    ;(session as unknown as { process: { kill: typeof killSpy } }).process = { kill: killSpy }
    const sessions = new Map<string, AnySession>([['claude-1', session]])
    const ctx = makeBaseContext({ sessions })
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('claude-1')

    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
    expect(ctx.teardownCodexSessionRuntime).not.toHaveBeenCalled()
    expect(ctx.teardownGeminiSessionRuntime).not.toHaveBeenCalled()
    expect(sessions.has('claude-1')).toBe(false)
  })

  it('is a no-op when the session does not exist (no teardown calls, no persistence)', () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    iface.deleteSession('does-not-exist')

    expect(ctx.teardownCodexSessionRuntime).not.toHaveBeenCalled()
    expect(ctx.teardownGeminiSessionRuntime).not.toHaveBeenCalled()
    expect(ctx.schedulePersistedSessionsWrite).not.toHaveBeenCalled()
  })
})

describe('createCommanderSessionsInterface — subscribeToEvents + shutdown', () => {
  it('subscribeToEvents registers the handler and the returned fn unsubscribes', () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)
    const handler = vi.fn()

    const unsubscribe = iface.subscribeToEvents('session-x', handler)
    expect(ctx.sessionEventHandlers.get('session-x')?.has(handler)).toBe(true)

    unsubscribe()
    // After the last handler removes, the Set is cleaned up entirely.
    expect(ctx.sessionEventHandlers.has('session-x')).toBe(false)
  })

  it('shutdown awaits both runtime shutdowns in parallel', async () => {
    const ctx = makeBaseContext()
    const iface = createCommanderSessionsInterface(ctx)

    await iface.shutdown?.()

    expect(ctx.shutdownCodexRuntimes).toHaveBeenCalledTimes(1)
    expect(ctx.shutdownGeminiRuntimes).toHaveBeenCalledTimes(1)
  })
})
