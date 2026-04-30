import type { RequestHandler, Router } from 'express'
import type { ResolvedWorkspace, WorkspaceCommandRunner } from '../../workspace/index.js'
import { WorkspaceError } from '../../workspace/index.js'
import { sendWorkspaceError, sendWorkspaceRawFile } from '../session/state.js'

interface WorkspaceRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  resolveAgentSessionWorkspace(sessionName: unknown): Promise<{
    workspace: ResolvedWorkspace
    runner: WorkspaceCommandRunner | undefined
  }>
  listWorkspaceTree: (
    workspace: ResolvedWorkspace,
    targetPath: string,
    runner?: WorkspaceCommandRunner,
  ) => Promise<unknown>
  readWorkspaceFilePreview: (
    workspace: ResolvedWorkspace,
    targetPath: string,
    runner?: WorkspaceCommandRunner,
  ) => Promise<unknown>
  readWorkspaceGitStatus: (
    workspace: ResolvedWorkspace,
    runner?: WorkspaceCommandRunner,
  ) => Promise<unknown>
  readWorkspaceGitLog: (
    workspace: ResolvedWorkspace,
    limit: number,
    runner?: WorkspaceCommandRunner,
  ) => Promise<unknown>
}

export function registerWorkspaceRoutes(deps: WorkspaceRouteDeps): void {
  const { router, requireReadAccess } = deps

  router.get('/sessions/:name/workspace/tree', requireReadAccess, async (req, res) => {
    try {
      const { workspace, runner } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      const tree = await deps.listWorkspaceTree(
        workspace,
        typeof req.query.path === 'string' ? req.query.path : '',
        runner,
      )
      res.json(tree)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/sessions/:name/workspace/expand', requireReadAccess, async (req, res) => {
    try {
      const { workspace, runner } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      const tree = await deps.listWorkspaceTree(
        workspace,
        typeof req.query.path === 'string' ? req.query.path : '',
        runner,
      )
      res.json(tree)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/sessions/:name/workspace/file', requireReadAccess, async (req, res) => {
    try {
      if (typeof req.query.path !== 'string' || !req.query.path.trim()) {
        throw new WorkspaceError(400, 'path query parameter is required')
      }
      const { workspace, runner } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      const preview = await deps.readWorkspaceFilePreview(workspace, req.query.path, runner)
      res.json(preview)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/sessions/:name/workspace/raw', requireReadAccess, async (req, res) => {
    try {
      if (typeof req.query.path !== 'string' || !req.query.path.trim()) {
        throw new WorkspaceError(400, 'path query parameter is required')
      }
      const { workspace } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      await sendWorkspaceRawFile(res, workspace, req.query.path)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/sessions/:name/workspace/git/status', requireReadAccess, async (req, res) => {
    try {
      const { workspace, runner } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      const status = await deps.readWorkspaceGitStatus(workspace, runner)
      res.json(status)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/sessions/:name/workspace/git/log', requireReadAccess, async (req, res) => {
    try {
      const { workspace, runner } = await deps.resolveAgentSessionWorkspace(String(req.params.name))
      const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 15
      const log = await deps.readWorkspaceGitLog(workspace, Number.isFinite(limit) ? limit : 15, runner)
      res.json(log)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })
}
