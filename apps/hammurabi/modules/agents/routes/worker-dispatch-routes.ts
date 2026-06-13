import type { RequestHandler, Router } from 'express'
import {
  parseSessionName,
} from '../session/input.js'
import type { ProviderCreateOptions } from '../providers/provider-adapter.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  MachineConfig,
  StreamSession,
} from '../types.js'
import {
  asWorkerLaunchBody,
  launchProviderWorkerSession,
  LEGACY_DISPATCH_WORKER_BODY_KEYS,
  parseWorkerLaunchRequest,
} from '../worker-launch.js'

interface WorkerDispatchRouteDeps {
  router: Router
  requireDispatchWorkerAccess: RequestHandler
  maxSessions: number
  sessions: Map<string, AnySession>
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: AgentType,
    options?: Omit<ProviderCreateOptions, 'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'>,
  ): Promise<StreamSession>
  readMachineRegistry(): Promise<MachineConfig[]>
  schedulePersistedSessionsWrite(): void
}

export function registerWorkerDispatchRoutes(deps: WorkerDispatchRouteDeps): void {
  const { router, requireDispatchWorkerAccess, maxSessions, sessions } = deps

  router.post('/sessions/dispatch-worker', requireDispatchWorkerAccess, async (req, res) => {
    const requestBody = asWorkerLaunchBody(req.body)

    const rawSpawnSource = requestBody.spawnedBy
    const hasSpawnSourceValue =
      rawSpawnSource !== undefined && rawSpawnSource !== null && rawSpawnSource !== ''
    const spawnSourceName = hasSpawnSourceValue ? parseSessionName(rawSpawnSource) : undefined
    if (hasSpawnSourceValue && !spawnSourceName) {
      res.status(400).json({ error: 'Invalid spawnedBy' })
      return
    }

    let sourceSession: StreamSession | undefined
    if (spawnSourceName) {
      const candidate = sessions.get(spawnSourceName)
      if (!candidate || candidate.kind !== 'stream') {
        res.status(404).json({ error: `Stream source session "${spawnSourceName}" not found` })
        return
      }
      sourceSession = candidate
    }

    const timestamp = Date.now()
    let workerSessionName = `worker-${timestamp}`
    let suffix = 1
    while (sessions.has(workerSessionName)) {
      workerSessionName = `worker-${timestamp}-${suffix}`
      suffix += 1
    }

    const bodyRequestedHost = Object.prototype.hasOwnProperty.call(requestBody, 'host')
      && requestBody.host !== undefined
      && requestBody.host !== null
      && requestBody.host !== ''
    const parsed = parseWorkerLaunchRequest({
      allowedBodyKeys: LEGACY_DISPATCH_WORKER_BODY_KEYS,
      creator: sourceSession ? sourceSession.creator : { kind: 'human' },
      currentSkillInvocationNull: 'clear',
      fallbackCwd: sourceSession?.cwd,
      generatedName: workerSessionName,
      preferMachineCwd: bodyRequestedHost,
      rawBody: requestBody,
      requireName: false,
      routeLabel: '/api/agents/sessions/dispatch-worker',
      sourceDefaults: sourceSession
        ? {
            adaptiveThinking: sourceSession.adaptiveThinking,
            agentType: sourceSession.agentType,
            currentSkillInvocation: sourceSession.currentSkillInvocation,
            effort: sourceSession.effort,
            host: sourceSession.host,
            maxThinkingTokens: sourceSession.maxThinkingTokens,
            mode: sourceSession.mode,
            model: sourceSession.model,
          }
        : undefined,
      spawnedBy: spawnSourceName ?? undefined,
      unknownKeyStyle: 'legacy',
    })
    if (!parsed.ok) {
      res.status(parsed.status).json(parsed.body)
      return
    }

    const launched = await launchProviderWorkerSession(
      {
        createProviderStreamSession: deps.createProviderStreamSession,
        maxSessions,
        resolveMachine: async (requestedHost) => {
          if (requestedHost === undefined) {
            return { ok: true as const, machine: undefined }
          }
          try {
            const machines = await deps.readMachineRegistry()
            const machine = machines.find((entry) => entry.id === requestedHost)
            if (!machine) {
              return { ok: false as const, status: 400, error: `Unknown host machine "${requestedHost}"` }
            }
            return { ok: true as const, machine }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to read machines registry'
            return { ok: false as const, status: 500, error: message }
          }
        },
        schedulePersistedSessionsWrite: deps.schedulePersistedSessionsWrite,
        sessions,
      },
      parsed.request,
      {
        missingCwdError: 'Provide cwd when spawnedBy is omitted',
      },
    )
    if (!launched.ok) {
      res.status(launched.status).json(launched.body)
      return
    }

    if (sourceSession && !sourceSession.spawnedWorkers.includes(parsed.request.sessionName)) {
      sourceSession.spawnedWorkers.push(parsed.request.sessionName)
      deps.schedulePersistedSessionsWrite()
    }

    res.status(202).json({
      name: parsed.request.sessionName,
      sessionType: launched.session.sessionType,
      creator: launched.session.creator,
      spawnedBy: launched.session.spawnedBy,
      cwd: launched.session.cwd,
    })
  })
}
