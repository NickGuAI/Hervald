import type { Request, RequestHandler, Response, Router } from 'express'
import { describe, expect, it } from 'vitest'
import { registerSessionQueryRoutes } from '../routes/session-query-routes.js'
import type {
  AnySession,
  CompletedSession,
  ExitedStreamSessionState,
  ExternalSession,
  StreamJsonEvent,
  WorkerState,
} from '../types.js'

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}

const WRITE_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'write-only-key',
}

interface MockRequestShape {
  headers: Record<string, string | undefined>
  params: {
    name: string
  }
  query: Record<string, unknown>
}

interface MockResponseState {
  statusCode: number
  body: unknown
}

function createRequireReadAccess(): RequestHandler {
  return (req, res, next) => {
    const apiKey = typeof req.headers['x-hammurabi-api-key'] === 'string'
      ? req.headers['x-hammurabi-api-key'].trim()
      : ''

    if (apiKey.length === 0) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (apiKey === 'write-only-key') {
      res.status(403).json({ error: 'Insufficient API key scope' })
      return
    }

    if (apiKey !== 'test-key' && apiKey !== 'read-only-key') {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    next()
  }
}

function parseSessionName(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getMessagesRouteHandlers(sessions: Map<string, AnySession>): RequestHandler[] {
  const routes = new Map<string, RequestHandler[]>()

  const fakeRouter = {
    get(path: string, ...handlers: RequestHandler[]) {
      routes.set(path, handlers)
      return fakeRouter
    },
  } as unknown as Router

  registerSessionQueryRoutes({
    router: fakeRouter,
    requireReadAccess: createRequireReadAccess(),
    sessions,
    completedSessions: new Map<string, CompletedSession>(),
    exitedStreamSessions: new Map<string, ExitedStreamSessionState>(),
    isExitedSessionResumeAvailable: async () => false,
    parseSessionName,
    pruneStaleCommandRoomSessions: () => 0,
    pruneStaleNonHumanSessions: async () => 0,
    getWorkerStates: (): WorkerState[] => [],
  })

  const handlers = routes.get('/sessions/:name/messages')
  if (!handlers) {
    throw new Error('Expected /sessions/:name/messages to be registered')
  }

  return handlers
}

function createMockResponse(
  resolve: (state: MockResponseState) => void,
): { response: Response; state: MockResponseState } {
  const state: MockResponseState = {
    statusCode: 200,
    body: undefined,
  }

  const response = {
    status(code: number) {
      state.statusCode = code
      return response
    },
    json(payload: unknown) {
      state.body = payload
      resolve(state)
      return response
    },
  }

  return {
    response: response as unknown as Response,
    state,
  }
}

async function invokeHandlers(
  handlers: readonly RequestHandler[],
  request: MockRequestShape,
): Promise<MockResponseState> {
  return await new Promise<MockResponseState>((resolve, reject) => {
    const { response, state } = createMockResponse(resolve)
    let settled = false
    let index = 0

    const finish = (value: MockResponseState): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }

    const fail = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const next = (error?: unknown): void => {
      if (error) {
        fail(error)
        return
      }

      const handler = handlers[index]
      index += 1

      if (!handler) {
        finish(state)
        return
      }

      try {
        Promise
          .resolve(handler(request as unknown as Request, response, next))
          .catch(fail)
      } catch (caught) {
        fail(caught)
      }
    }

    next()
  })
}

function createExternalSession(name: string, events: StreamJsonEvent[]): ExternalSession {
  return {
    kind: 'external',
    name,
    agentType: 'codex',
    machine: 'home-mac',
    cwd: '/tmp/worktree',
    host: 'home-mac',
    status: 'connected',
    lastHeartbeat: Date.now(),
    events,
    clients: new Set(),
    createdAt: '2026-04-22T12:00:00.000Z',
    lastEventAt: events[events.length - 1]?.timestamp ?? '2026-04-22T12:00:00.000Z',
  }
}

async function invokeMessagesRoute(options: {
  headers?: Record<string, string>
  query?: Record<string, unknown>
  sessionName: string
  sessions?: Map<string, AnySession>
}): Promise<MockResponseState> {
  const handlers = getMessagesRouteHandlers(options.sessions ?? new Map())
  return await invokeHandlers(handlers, {
    headers: options.headers ?? {},
    params: {
      name: options.sessionName,
    },
    query: options.query ?? {},
  })
}

function assistantTextEvent(index: number, text: string): StreamJsonEvent {
  return {
    type: 'assistant',
    timestamp: new Date(Date.UTC(2026, 3, 22, 12, 0, index)).toISOString(),
    message: {
      id: `m-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  }
}

describe('GET /sessions/:name/messages', () => {
  it('returns 404 for an unknown session', async () => {
    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      sessionName: 'missing-session',
    })

    expect(response.statusCode).toBe(404)
    expect(response.body).toEqual({
      error: 'Session not found',
    })
  })

  it('returns 401 when auth is missing', async () => {
    const response = await invokeMessagesRoute({
      sessionName: 'test',
    })

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({
      error: 'Unauthorized',
    })
  })

  it('returns 403 when the key lacks read scope', async () => {
    const response = await invokeMessagesRoute({
      headers: WRITE_ONLY_AUTH_HEADERS,
      sessionName: 'test',
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({
      error: 'Insufficient API key scope',
    })
  })

  it('returns the 5 most recent entries by default from a 200-event session', async () => {
    const sessionName = 'peek-default'
    const sessions = new Map<string, AnySession>([[
      sessionName,
      createExternalSession(
        sessionName,
        Array.from({ length: 200 }, (_, index) => assistantTextEvent(index, `message ${index}`)),
      ),
    ]])

    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      sessionName,
      sessions,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      total: 200,
      returned: 5,
    })
    expect((response.body as { messages: Array<{ preview: string }> }).messages.map((entry) => entry.preview)).toEqual([
      'message 195',
      'message 196',
      'message 197',
      'message 198',
      'message 199',
    ])
  })

  it('honors last=10', async () => {
    const sessionName = 'peek-last-ten'
    const sessions = new Map<string, AnySession>([[
      sessionName,
      createExternalSession(
        sessionName,
        Array.from({ length: 12 }, (_, index) => assistantTextEvent(index, `entry ${index}`)),
      ),
    ]])

    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      query: { last: '10' },
      sessionName,
      sessions,
    })

    const payload = response.body as { returned: number; messages: Array<{ preview: string }> }
    expect(response.statusCode).toBe(200)
    expect(payload.returned).toBe(10)
    expect(payload.messages[0]?.preview).toBe('entry 2')
    expect(payload.messages[9]?.preview).toBe('entry 11')
  })

  it('filters to assistant entries when role=assistant', async () => {
    const sessionName = 'peek-assistant-only'
    const sessions = new Map<string, AnySession>([[
      sessionName,
      createExternalSession(sessionName, [
        {
          type: 'assistant',
          timestamp: '2026-04-22T12:00:00.000Z',
          message: {
            id: 'assistant-1',
            role: 'assistant',
            content: [{ type: 'text', text: 'assistant text' }],
          },
        },
        {
          type: 'user',
          timestamp: '2026-04-22T12:00:01.000Z',
          message: {
            role: 'user',
            content: 'user text',
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-04-22T12:00:02.000Z',
          message: {
            id: 'assistant-2',
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'README.md' } }],
          },
        },
      ]),
    ]])

    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      query: { last: '10', role: 'assistant' },
      sessionName,
      sessions,
    })

    const payload = response.body as { messages: Array<{ type: string }> }
    expect(response.statusCode).toBe(200)
    expect(payload.messages).toHaveLength(2)
    expect(payload.messages.every((entry) => entry.type === 'assistant')).toBe(true)
  })

  it('omits tool_use and tool_result entries when includeToolUse=false', async () => {
    const sessionName = 'peek-no-tools'
    const sessions = new Map<string, AnySession>([[
      sessionName,
      createExternalSession(sessionName, [
        {
          type: 'assistant',
          timestamp: '2026-04-22T12:00:00.000Z',
          message: {
            id: 'assistant-text',
            role: 'assistant',
            content: [{ type: 'text', text: 'plain assistant text' }],
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-04-22T12:00:01.000Z',
          message: {
            id: 'assistant-tool',
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'README.md' } }],
          },
        },
        {
          type: 'user',
          timestamp: '2026-04-22T12:00:02.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'Applied' }],
          },
        },
        {
          type: 'user',
          timestamp: '2026-04-22T12:00:03.000Z',
          message: {
            role: 'user',
            content: 'plain user text',
          },
        },
      ]),
    ]])

    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      query: { last: '10', includeToolUse: 'false' },
      sessionName,
      sessions,
    })

    expect(response.statusCode).toBe(200)
    expect((response.body as {
      messages: Array<{ type: string; kind?: string; preview: string }>
    }).messages.map((entry) => ({
      type: entry.type,
      kind: entry.kind,
      preview: entry.preview,
    }))).toEqual([
      { type: 'assistant', kind: 'text', preview: 'plain assistant text' },
      { type: 'user', kind: 'text', preview: 'plain user text' },
    ])
  })

  it('truncates previews at 120 chars with an ellipsis', async () => {
    const longText = 'x'.repeat(140)
    const sessionName = 'peek-truncate'
    const sessions = new Map<string, AnySession>([[
      sessionName,
      createExternalSession(sessionName, [assistantTextEvent(0, longText)]),
    ]])

    const response = await invokeMessagesRoute({
      headers: AUTH_HEADERS,
      query: { last: '1' },
      sessionName,
      sessions,
    })

    const payload = response.body as { messages: Array<{ preview: string }> }
    expect(response.statusCode).toBe(200)
    expect(payload.messages).toHaveLength(1)
    expect(payload.messages[0]?.preview).toHaveLength(120)
    expect(payload.messages[0]?.preview.endsWith('...')).toBe(true)
  })
})
