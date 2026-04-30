import { isObject, parseMessage, parseSessionId } from '../route-parsers.js'
import { searchCommanderTranscriptIndex } from '../transcript-index.js'
import type { CommanderRoutesContext } from './types.js'

const DEFAULT_TRANSCRIPT_SEARCH_TOP_K = 8

function parsePositiveInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return null
  }
  return raw
}

export function registerTranscriptRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  router.post('/:id/transcripts/search', context.requireReadAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    if (!(await context.sessionStore.get(commanderId))) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    const body = isObject(req.body) ? req.body : {}
    const query = parseMessage(body.query)
    if (!query) {
      res.status(400).json({ error: 'query is required' })
      return
    }

    const topK = body.topK === undefined
      ? DEFAULT_TRANSCRIPT_SEARCH_TOP_K
      : parsePositiveInteger(body.topK)
    if (topK === null) {
      res.status(400).json({ error: 'topK must be a positive integer when provided' })
      return
    }

    try {
      const hits = await searchCommanderTranscriptIndex(query, topK, {
        commanderId,
        basePath: context.commanderBasePath,
      })
      res.json({ hits })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to search commander transcripts',
      })
    }
  })
}
