import type { RequestHandler, Router } from 'express'
import {
  parseActiveSkillInvocation,
  parseCwd,
  parseOptionalHost,
  parseSessionCreator,
  parseSessionName,
} from '../session/input.js'
import type { ProviderCreateOptions } from '../providers/provider-adapter.js'
import { getProvider, parseProviderId } from '../providers/registry.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  MachineConfig,
  StreamSession,
} from '../types.js'

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

const ALLOWED_WORKER_DISPATCH_BODY_KEYS = new Set([
  'agentType',
  'creator',
  'currentSkillInvocation',
  'cwd',
  'host',
  'spawnedBy',
  'task',
])

export function registerWorkerDispatchRoutes(deps: WorkerDispatchRouteDeps): void {
  const { router, requireDispatchWorkerAccess, maxSessions, sessions } = deps

  router.post('/sessions/dispatch-worker', requireDispatchWorkerAccess, async (req, res) => {
    const requestBody = req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : undefined
    if (requestBody) {
      const unknownKeys = Object.keys(requestBody).filter((key) => !ALLOWED_WORKER_DISPATCH_BODY_KEYS.has(key))
      if (unknownKeys.length > 0) {
        res.status(400).json({
          error: `Unknown request body properties: ${unknownKeys.join(', ')}`,
        })
        return
      }
    }

    const rawSpawnSource = requestBody?.spawnedBy
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

    const requestedCreator = parseSessionCreator(requestBody?.creator)
    if (requestedCreator === null) {
      res.status(400).json({ error: 'Invalid creator. Expected { kind, id? }' })
      return
    }

    const requestedHost = parseOptionalHost(requestBody?.host)
    if (requestedHost === null) {
      res.status(400).json({ error: 'Invalid host: expected machine ID string' })
      return
    }

    if (sessions.size >= maxSessions) {
      res.status(429).json({ error: `Session limit reached (${maxSessions})` })
      return
    }

    const hasRequestedAgentType =
      typeof requestBody?.agentType === 'string' && requestBody.agentType.trim().length > 0
    const parsedAgentType = parseProviderId(requestBody?.agentType)
    const workerAgentType: AgentType = hasRequestedAgentType
      ? (parsedAgentType ?? 'claude')
      : (sourceSession?.agentType ?? 'claude')
    const provider = getProvider(workerAgentType)
    if (!provider?.capabilities.supportsWorkerDispatch) {
      res.status(400).json({
        error: `Provider ${workerAgentType} cannot dispatch worker sessions`,
      })
      return
    }
    const workerMode: ClaudePermissionMode = sourceSession?.mode ?? 'default'

    const targetMachineId = requestedHost ?? sourceSession?.host
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

    const rawTask = typeof requestBody?.task === 'string' ? requestBody.task.trim() : ''
    const currentSkillInvocationOverrideRequested = Boolean(
      requestBody
      && Object.prototype.hasOwnProperty.call(requestBody, 'currentSkillInvocation'),
    )
    const rawCurrentSkillInvocation = requestBody?.currentSkillInvocation
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

    const requestedCwd = parseCwd(requestBody?.cwd)
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
      const inheritedWorkerCwd = requestedHost !== undefined
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
      const workerSession = await deps.createProviderStreamSession(
        workerSessionName,
        workerMode,
        rawTask,
        workerCwd,
        targetMachine,
        workerAgentType,
        workerOptions,
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
