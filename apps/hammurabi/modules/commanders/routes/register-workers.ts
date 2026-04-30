import { parseSessionId } from '../route-parsers.js'
import type { CommanderRoutesContext } from './types.js'

/**
 * Registers `POST /:id/workers` — the canonical external dispatch path for
 * worker sessions attributed to a commander. The commander identity is baked
 * from the URL (verifiable via the route's `commanders:write` scope check),
 * so no caller can self-claim attribution they have not been authorized for.
 *
 * The actual session-spawn logic lives on the agents-side
 * `CommanderSessionsInterface.dispatchWorkerForCommander`; this route is the
 * thin adapter that handles URL parsing, commander existence validation,
 * and response forwarding. See issue #1223 for the full architecture.
 */
export function registerWorkerRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  router.post('/:id/workers', context.requireWorkerDispatchAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const commander = await context.sessionStore.get(commanderId)
    if (!commander) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    if (!context.sessionsInterface) {
      res.status(500).json({ error: 'sessionsInterface not configured' })
      return
    }

    try {
      const result = await context.sessionsInterface.dispatchWorkerForCommander({
        commanderId,
        rawBody: req.body,
      })
      res.status(result.status).json(result.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to dispatch worker'
      res.status(500).json({ error: message })
    }
  })
}
