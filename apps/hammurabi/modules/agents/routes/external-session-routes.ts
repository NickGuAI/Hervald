import type { RequestHandler, Router } from 'express'
import { MAX_STREAM_EVENTS } from '../constants.js'
import { parseSessionName } from '../session/input.js'
import { parseProviderId } from '../providers/registry.js'
import type {
  AnySession,
  ExternalSession,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

interface ExternalSessionRouteDeps {
  router: Router
  requireWriteAccess: RequestHandler
  maxSessions: number
  sessions: Map<string, AnySession>
  broadcastEvent(session: StreamSession | ExternalSession, event: StreamJsonEvent): void
}

export function registerExternalSessionRoutes(deps: ExternalSessionRouteDeps): void {
  const { router, requireWriteAccess, maxSessions, sessions } = deps

  router.post('/sessions/register', requireWriteAccess, (req, res) => {
    const name = parseSessionName(req.body?.name)
    if (!name) {
      res.status(400).json({ error: 'Invalid or missing session name' })
      return
    }

    if (sessions.has(name)) {
      res.status(409).json({ error: `Session "${name}" already exists` })
      return
    }

    if (sessions.size >= maxSessions) {
      res.status(503).json({ error: 'Maximum session limit reached' })
      return
    }

    const agentType = parseProviderId(req.body?.agentType) ?? 'claude'
    const machine = typeof req.body?.machine === 'string' ? req.body.machine.trim() : ''
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd.trim() : ''
    const task = typeof req.body?.task === 'string' ? req.body.task.trim() : undefined
    const metadata = typeof req.body?.metadata === 'object' && req.body.metadata !== null
      ? req.body.metadata as Record<string, unknown>
      : undefined

    if (!machine) {
      res.status(400).json({ error: 'machine is required' })
      return
    }

    const now = Date.now()
    const session: ExternalSession = {
      kind: 'external',
      name,
      sessionType: 'worker',
      creator: {
        kind: 'human',
        ...(req.user?.id ? { id: req.user.id } : {}),
      },
      agentType,
      machine,
      cwd: cwd || '/',
      host: machine,
      task,
      status: 'connected',
      lastHeartbeat: now,
      events: [],
      clients: new Set(),
      createdAt: new Date(now).toISOString(),
      lastEventAt: new Date(now).toISOString(),
      metadata,
    }

    sessions.set(name, session)
    res.status(201).json({
      registered: true,
      name,
      agentType,
      machine,
      cwd: session.cwd,
    })
  })

  router.post('/sessions/:name/heartbeat', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'external') {
      res.status(404).json({ error: `External session "${sessionName}" not found` })
      return
    }

    const now = Date.now()
    session.lastHeartbeat = now
    session.status = 'connected'
    session.lastEventAt = new Date(now).toISOString()

    if (typeof req.body?.metadata === 'object' && req.body.metadata !== null) {
      session.metadata = { ...session.metadata, ...req.body.metadata as Record<string, unknown> }
    }

    res.json({ ok: true, status: session.status })
  })

  router.post('/sessions/:name/events', requireWriteAccess, (req, res) => {
    const sessionName = parseSessionName(req.params.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const session = sessions.get(sessionName)
    if (!session || session.kind !== 'external') {
      res.status(404).json({ error: `External session "${sessionName}" not found` })
      return
    }

    const events = Array.isArray(req.body?.events) ? req.body.events as unknown[] : []
    if (events.length === 0) {
      res.status(400).json({ error: 'events must be a non-empty array' })
      return
    }

    let accepted = 0
    for (const rawEvent of events) {
      if (typeof rawEvent !== 'object' || rawEvent === null) {
        continue
      }
      const event = rawEvent as StreamJsonEvent
      if (typeof event.type !== 'string' || !event.type) {
        continue
      }

      session.events.push(event)
      session.lastEventAt = new Date().toISOString()
      session.lastHeartbeat = Date.now()
      deps.broadcastEvent(session, event)
      accepted += 1
    }

    if (session.events.length > MAX_STREAM_EVENTS) {
      session.events = session.events.slice(-MAX_STREAM_EVENTS)
    }

    res.json({ accepted })
  })
}
