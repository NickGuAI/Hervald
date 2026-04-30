/**
 * Tests for createStreamIoHelpers — issue/921 Phase P6d extraction.
 *
 * Covers the full helper contract after OpenClaw removal:
 * broadcastStreamEvent, writeToStdin, and resetActiveTurnState.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createStreamIoHelpers,
  type StreamIoContext,
} from '../stream-io-helpers'
import type { ExternalSession, StreamJsonEvent, StreamSession } from '../types'

function makeStreamSession(name: string, overrides: Partial<StreamSession> = {}): StreamSession {
  return {
    name,
    kind: 'stream',
    agentType: 'claude',
    sessionType: 'worker',
    clients: new Set(),
    lastTurnCompleted: false,
    process: {
      stdin: {
        writable: true,
        write: vi.fn(() => true),
        once: vi.fn(),
      },
    },
    stdinDraining: false,
    ...overrides,
  } as unknown as StreamSession
}

function makeExternalSession(name: string): ExternalSession {
  return {
    name,
    kind: 'external',
    clients: new Set(),
  } as unknown as ExternalSession
}

function makeBaseContext(
  overrides: Partial<StreamIoContext> = {},
): StreamIoContext {
  return {
    sessionEventHandlers: new Map(),
    ...overrides,
  }
}

describe('createStreamIoHelpers — broadcastStreamEvent', () => {
  it('fans out to WebSocket clients in OPEN state, skips others', () => {
    // WebSocket.OPEN is 1 in the `ws` module; we stand-in with a sentinel
    // object that matches the readyState constant the helper compares to.
    const openClient = { readyState: 1, send: vi.fn() }
    const closingClient = { readyState: 2, send: vi.fn() }
    const session = makeStreamSession('s1')
    ;(session as unknown as { clients: Set<unknown> }).clients = new Set([openClient, closingClient])

    const event: StreamJsonEvent = { type: 'system', text: 'hi' } as unknown as StreamJsonEvent
    const ctx = makeBaseContext()
    const { broadcastStreamEvent } = createStreamIoHelpers(ctx)

    broadcastStreamEvent(session, event)

    expect(openClient.send).toHaveBeenCalledWith(JSON.stringify(event))
    expect(closingClient.send).not.toHaveBeenCalled()
  })

  it('invokes per-session handlers', () => {
    const handler = vi.fn()
    const sessionEventHandlers = new Map([['s1', new Set([handler])]])
    const session = makeStreamSession('s1')
    const event: StreamJsonEvent = { type: 'system' } as unknown as StreamJsonEvent

    const { broadcastStreamEvent } = createStreamIoHelpers({ sessionEventHandlers })
    broadcastStreamEvent(session, event)

    expect(handler).toHaveBeenCalledWith(event)
  })

  it('swallows handler exceptions so one bad subscriber cannot stop the fanout', () => {
    const badHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()
    const sessionEventHandlers = new Map([['s1', new Set([badHandler, goodHandler])]])
    const session = makeStreamSession('s1')
    const event: StreamJsonEvent = { type: 'system' } as unknown as StreamJsonEvent

    const { broadcastStreamEvent } = createStreamIoHelpers({ sessionEventHandlers })
    expect(() => broadcastStreamEvent(session, event)).not.toThrow()
    expect(goodHandler).toHaveBeenCalled()
  })

  it('handles external sessions (same contract)', () => {
    const client = { readyState: 1, send: vi.fn() }
    const session = makeExternalSession('ext-1')
    ;(session as unknown as { clients: Set<unknown> }).clients = new Set([client])

    const { broadcastStreamEvent } = createStreamIoHelpers(makeBaseContext())
    broadcastStreamEvent(session, { type: 'system' } as unknown as StreamJsonEvent)
    expect(client.send).toHaveBeenCalled()
  })
})

describe('createStreamIoHelpers — writeToStdin', () => {
  it('returns false when stdin is not writable', () => {
    const session = makeStreamSession('s1')
    ;(session as unknown as { process: { stdin: { writable: boolean } } }).process.stdin.writable = false

    const { writeToStdin } = createStreamIoHelpers(makeBaseContext())
    expect(writeToStdin(session, 'data')).toBe(false)
  })

  it('drops the write + broadcasts a system event when draining', () => {
    const openClient = { readyState: 1, send: vi.fn() }
    const session = makeStreamSession('s1', { stdinDraining: true })
    ;(session as unknown as { clients: Set<unknown> }).clients = new Set([openClient])

    const { writeToStdin } = createStreamIoHelpers(makeBaseContext())
    expect(writeToStdin(session, 'data')).toBe(false)

    // The drop-notice system event was broadcast.
    expect(openClient.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse((openClient.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string)
    expect(sent.type).toBe('system')
    expect(sent.text).toMatch(/Input dropped/)
  })

  it('flips stdinDraining=true when write returns false, and resets on drain', () => {
    const drainCb: { fn: (() => void) | null } = { fn: null }
    const stdinWrite = vi.fn(() => false)
    const stdinOnce = vi.fn((event: string, cb: () => void) => {
      if (event === 'drain') drainCb.fn = cb
    })
    const session = makeStreamSession('s1')
    ;(session as unknown as {
      process: { stdin: { writable: boolean; write: typeof stdinWrite; once: typeof stdinOnce } }
    }).process.stdin = { writable: true, write: stdinWrite, once: stdinOnce }

    const { writeToStdin } = createStreamIoHelpers(makeBaseContext())
    const ok = writeToStdin(session, 'x')

    expect(ok).toBe(true)
    expect(session.stdinDraining).toBe(true)
    // Drain callback clears the flag.
    drainCb.fn?.()
    expect(session.stdinDraining).toBe(false)
  })

  it('returns false when stdin.write throws', () => {
    const session = makeStreamSession('s1')
    ;(session as unknown as {
      process: { stdin: { writable: boolean; write: ReturnType<typeof vi.fn> } }
    }).process.stdin.write = vi.fn(() => {
      throw new Error('stdin closed')
    })

    const { writeToStdin } = createStreamIoHelpers(makeBaseContext())
    expect(writeToStdin(session, 'x')).toBe(false)
  })
})

describe('createStreamIoHelpers — resetActiveTurnState', () => {
  it('clears turn-completion flags for non-cron sessions', () => {
    const session = makeStreamSession('worker-session', {
      lastTurnCompleted: true,
      completedTurnAt: '2026-04-22T00:00:00Z',
      finalResultEvent: { type: 'result' } as unknown as StreamJsonEvent,
    })
    const { resetActiveTurnState } = createStreamIoHelpers(makeBaseContext())

    resetActiveTurnState(session)
    expect(session.lastTurnCompleted).toBe(false)
    expect(session.completedTurnAt).toBeUndefined()
    expect(session.finalResultEvent).toBeUndefined()
  })

  it('preserves turn-completion flags for cron sessions (they stay marked)', () => {
    const session = makeStreamSession('command-room-foo', {
      sessionType: 'cron',
      lastTurnCompleted: true,
      completedTurnAt: '2026-04-22T00:00:00Z',
      finalResultEvent: { type: 'result' } as unknown as StreamJsonEvent,
    })
    const { resetActiveTurnState } = createStreamIoHelpers(makeBaseContext())

    resetActiveTurnState(session)
    expect(session.lastTurnCompleted).toBe(true)
    expect(session.completedTurnAt).toBe('2026-04-22T00:00:00Z')
  })

  it('is a no-op for sessions that are not already completed', () => {
    const session = makeStreamSession('s1', { lastTurnCompleted: false })
    const { resetActiveTurnState } = createStreamIoHelpers(makeBaseContext())
    resetActiveTurnState(session)
    expect(session.lastTurnCompleted).toBe(false)
  })
})

describe('createStreamIoHelpers — factory smoke', () => {
  it('returns all 3 helpers', () => {
    const helpers = createStreamIoHelpers(makeBaseContext())
    expect(typeof helpers.broadcastStreamEvent).toBe('function')
    expect(typeof helpers.writeToStdin).toBe('function')
    expect(typeof helpers.resetActiveTurnState).toBe('function')
  })
})
