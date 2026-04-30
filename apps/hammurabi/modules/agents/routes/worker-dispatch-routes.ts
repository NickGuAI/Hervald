import type { RequestHandler, Router } from 'express'
import {
  parseActiveSkillInvocation,
  parseAgentType,
  parseCwd,
  parseOptionalHost,
  parseSessionCreator,
  parseSessionName,
} from '../session/input.js'
import type {
  AnySession,
  ClaudePermissionMode,
  CodexSessionCreateOptions,
  GeminiSessionCreateOptions,
  MachineConfig,
  StreamSession,
  StreamSessionCreateOptions,
} from '../types.js'

interface WorkerDispatchRouteDeps {
  router: Router
  requireDispatchWorkerAccess: RequestHandler
  maxSessions: number
  sessions: Map<string, AnySession>
  createCodexAppServerSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options?: CodexSessionCreateOptions,
  ): Promise<StreamSession>
  createGeminiAcpSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options?: GeminiSessionCreateOptions,
  ): Promise<StreamSession>
  createStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: 'claude',
    options?: StreamSessionCreateOptions,
  ): StreamSession
  readMachineRegistry(): Promise<MachineConfig[]>
  schedulePersistedSessionsWrite(): void
}

export function registerWorkerDispatchRoutes(deps: WorkerDispatchRouteDeps): void {
  const { router, requireDispatchWorkerAccess, maxSessions, sessions } = deps

  router.post('/sessions/dispatch-worker', requireDispatchWorkerAccess, async (req, res) => {
    const rawSpawnSource = req.body?.spawnedBy
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

    const requestedCreator = parseSessionCreator(req.body?.creator)
    if (requestedCreator === null) {
      res.status(400).json({ error: 'Invalid creator. Expected { kind, id? }' })
      return
    }

    const requestedMachine = parseOptionalHost(req.body?.machine)
    if (requestedMachine === null) {
      res.status(400).json({ error: 'Invalid machine: expected machine ID string' })
      return
    }

    if (sessions.size >= maxSessions) {
      res.status(429).json({ error: `Session limit reached (${maxSessions})` })
      return
    }

    const hasRequestedAgentType =
      typeof req.body?.agentType === 'string' && req.body.agentType.trim().length > 0
    const parsedAgentType = parseAgentType(req.body?.agentType)
    const workerAgentType: 'claude' | 'codex' | 'gemini' = hasRequestedAgentType
      ? (parsedAgentType === 'codex' || parsedAgentType === 'gemini' ? parsedAgentType : 'claude')
      : (sourceSession?.agentType === 'codex' || sourceSession?.agentType === 'gemini'
          ? sourceSession.agentType
          : 'claude')
    const workerMode: ClaudePermissionMode = sourceSession?.mode ?? 'default'

    const targetMachineId = requestedMachine ?? sourceSession?.host
    let targetMachine: MachineConfig | undefined
    if (targetMachineId !== undefined) {
      try {
        const machines = await deps.readMachineRegistry()
        targetMachine = machines.find((entry) => entry.id === targetMachineId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read machines registry'
        res.status(500).json({ error: message })
        return
      }

      if (!targetMachine) {
        res.status(400).json({ error: `Unknown host machine "${targetMachineId}"` })
        return
      }
    }

    const rawTask = typeof req.body?.task === 'string' ? req.body.task.trim() : ''
    const currentSkillInvocationOverrideRequested = Boolean(
      req.body
      && typeof req.body === 'object'
      && Object.prototype.hasOwnProperty.call(req.body, 'currentSkillInvocation'),
    )
    const rawCurrentSkillInvocation = req.body?.currentSkillInvocation
    const parsedCurrentSkillInvocation = rawCurrentSkillInvocation === null
      ? undefined
      : parseActiveSkillInvocation(rawCurrentSkillInvocation)
    if (
      currentSkillInvocationOverrideRequested
      && rawCurrentSkillInvocation !== null
      && parsedCurrentSkillInvocation === null
    ) {
      res.status(400).json({
        error: 'Invalid currentSkillInvocation. Expected { skillId, displayName, startedAt, toolUseId? } or null',
      })
      return
    }

    const requestedCwd = parseCwd(req.body?.cwd)
    if (requestedCwd === null) {
      res.status(400).json({ error: 'Invalid cwd: must be an absolute path' })
      return
    }

    const timestamp = Date.now()
    let workerSessionName = `worker-${timestamp}`
    let suffix = 1
    while (sessions.has(workerSessionName)) {
      workerSessionName = `worker-${timestamp}-${suffix}`
      suffix += 1
    }

    try {
      const inheritedWorkerCwd = requestedMachine !== undefined
        ? (targetMachine?.cwd ?? sourceSession?.cwd)
        : (sourceSession?.cwd ?? targetMachine?.cwd)
      const workerCwd = requestedCwd ?? inheritedWorkerCwd
      if (!workerCwd) {
        res.status(400).json({ error: 'Provide cwd when spawnedBy is omitted' })
        return
      }
      const creator = sourceSession
        ? sourceSession.creator
        : (requestedCreator ?? { kind: 'human' as const })
      // Worker skill trust is explicit session state: inherit the parent's
      // active skill by default, allow an override object, and allow `null`
      // to sever the link for unrelated worker dispatches.
      const currentSkillInvocation = currentSkillInvocationOverrideRequested
        ? parsedCurrentSkillInvocation
        : sourceSession?.currentSkillInvocation
      const workerCurrentSkillInvocation = currentSkillInvocation ?? undefined
      const workerOptions = {
        sessionType: 'worker' as const,
        creator,
        currentSkillInvocation: workerCurrentSkillInvocation,
        ...(spawnSourceName
          ? {
              spawnedBy: spawnSourceName,
            }
          : {}),
      }
      const workerSession = workerAgentType === 'codex'
        ? await deps.createCodexAppServerSession(
          workerSessionName,
          workerMode,
          rawTask,
          workerCwd,
          {
            ...workerOptions,
            machine: targetMachine,
          },
        )
        : workerAgentType === 'gemini'
          ? await deps.createGeminiAcpSession(
            workerSessionName,
            workerMode,
            rawTask,
            workerCwd,
            {
              ...workerOptions,
              machine: targetMachine,
            },
          )
          : deps.createStreamSession(
            workerSessionName,
            workerMode,
            rawTask,
            workerCwd,
            targetMachine,
            workerAgentType,
            {
              ...workerOptions,
            },
          )

      sessions.set(workerSessionName, workerSession)
      if (sourceSession && !sourceSession.spawnedWorkers.includes(workerSessionName)) {
        sourceSession.spawnedWorkers.push(workerSessionName)
      }
      deps.schedulePersistedSessionsWrite()

      res.status(202).json({
        name: workerSessionName,
        sessionType: workerSession.sessionType,
        creator: workerSession.creator,
        spawnedBy: workerSession.spawnedBy,
        cwd: workerSession.cwd,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to dispatch worker'
      res.status(500).json({ error: message })
    }
  })
}
