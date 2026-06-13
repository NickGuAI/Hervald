import type { RequestHandler, Router } from 'express'
import type { SessionPruneCandidate, SessionPrunerConfig } from '../persistence-helpers.js'

interface SessionSweepRouteDeps {
  router: Router
  requireWriteAccess: RequestHandler
  prunerConfig: SessionPrunerConfig
  getStaleCronSessionCandidates(nowMs: number): SessionPruneCandidate[]
  getStaleNonHumanSessionCandidates(
    prunerConfig: SessionPrunerConfig,
    nowMs: number,
  ): Promise<SessionPruneCandidate[]>
  pruneStaleCronSessions(nowMs: number): number
  pruneStaleNonHumanSessions(
    prunerConfig: SessionPrunerConfig,
    nowMs: number,
  ): Promise<number>
}

export function registerSessionSweepRoutes(deps: SessionSweepRouteDeps): void {
  deps.router.post('/sessions/sweep', deps.requireWriteAccess, async (req, res) => {
    const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1'
    const nowMs = Date.now()
    const cronCandidates = deps.getStaleCronSessionCandidates(nowMs)
    const nonHumanCandidates = await deps.getStaleNonHumanSessionCandidates(deps.prunerConfig, nowMs)

    if (dryRun) {
      res.json({
        pruned: {
          cron: cronCandidates.length,
          nonHuman: nonHumanCandidates.length,
        },
        candidates: [...cronCandidates, ...nonHumanCandidates],
      })
      return
    }

    const cron = deps.pruneStaleCronSessions(nowMs)
    const nonHuman = await deps.pruneStaleNonHumanSessions(deps.prunerConfig, nowMs)
    res.json({ pruned: { cron, nonHuman } })
  })
}
