import type { Request, RequestHandler, Router } from 'express'
import { WebSocket } from 'ws'
import { CODEX_MODE_COMMANDS, DEFAULT_COLS, DEFAULT_ROWS } from '../constants.js'
import { buildClaudePtyCommand, resolveClaudeApprovalPort } from '../adapters/claude/helpers.js'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../../claude-adaptive-thinking.js'
import { DEFAULT_CLAUDE_EFFORT_LEVEL, type ClaudeEffortLevel } from '../../claude-effort.js'
import { DEFAULT_CLAUDE_MAX_THINKING_TOKENS } from '../../claude-max-thinking-tokens.js'
import { createApprovalBridgeToken } from '../../policies/approval-bridge-token.js'
import { appendToBuffer, broadcastOutput } from '../session/helpers.js'
import { ProviderAuthRequiredError } from '../provider-auth.js'
import type { ProviderCreateOptions } from '../providers/provider-adapter.js'
import { resolveProviderDefaults } from '../providers/provider-adapter.js'
import { getProvider, parseProviderId } from '../providers/registry.js'
import { validateModelForAgentType } from '../providers/validate-model.js'
import {
  codexRolloutUnavailableMessage,
  hasCodexRolloutFile,
  isMissingCodexRolloutError,
} from '../adapters/codex/helpers.js'
import {
  buildLoginShellCommand,
  buildSshArgs,
  isDaemonMachine,
  isRemoteMachine,
  prepareMachineLaunchEnvironment,
} from '../machines.js'
import { MachineDaemonRegistry } from '../daemon/registry.js'
import {
  parseActiveSkillInvocation,
  parseClaudeAdaptiveThinking,
  parseClaudeEffort,
  parseClaudeMaxThinkingTokens,
  parseCwd,
  parseOptionalHost,
  parseOptionalModel,
  parseOptionalSessionName,
  parseOptionalTask,
  parseSessionCreator,
  parseSessionName,
  parseSessionTransportType,
  parseSessionType,
} from '../session/input.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  MachineConfig,
  PersistedSessionsState,
  PtySession,
  PtySpawner,
  ResolvedResumableSessionSource,
  SessionCreator,
  SessionTransportType,
  SessionType,
  StreamSession,
} from '../types.js'
import {
  asWorkerLaunchBody,
  COMMANDER_WORKER_LAUNCH_BODY_KEYS,
  launchProviderWorkerSession,
  parseWorkerLaunchRequest,
} from '../worker-launch.js'

type ProviderStreamSessionOptions = Omit<
  ProviderCreateOptions,
  'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'
>

const SESSION_CREATE_ROUTE_ONLY_WORKER_BODY_KEYS = new Set([
  'mode',
  'resumeFromSession',
  'transportType',
])

function buildSessionCreateWorkerLaunchBody(rawBody: unknown): Record<string, unknown> {
  const body = asWorkerLaunchBody(rawBody)
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !SESSION_CREATE_ROUTE_ONLY_WORKER_BODY_KEYS.has(key)),
  )
}

interface SessionCreateRouteDeps {
  router: Router
  requireWriteAccess: RequestHandler
  sessions: Map<string, AnySession>
  maxSessions: number
  taskDelayMs: number
  internalToken?: string
  daemonRegistry: MachineDaemonRegistry
  isInternalSessionRequest(req: Request): boolean
  sessionCreatorIdFromUser(req: Request): string | undefined
  getSpawner(): Promise<PtySpawner>
  readPersistedSessionsState(): Promise<PersistedSessionsState>
  resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } }
  clearCodexResumeMetadata(sessionName: string): void
  resolveLaunchMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  >
  resolveDaemonLaunchReadiness(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): { ok: true } | { ok: false; status: number; error: string }
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: AgentType,
    options?: ProviderStreamSessionOptions,
  ): Promise<StreamSession>
  retireLiveSessionForResume(sessionName: string, session: StreamSession): void
  schedulePersistedSessionsWrite(): void
}

function sendProviderAuthRequiredResponse(res: Parameters<RequestHandler>[1], error: ProviderAuthRequiredError): void {
  res.status(424).json({
    code: 'AUTH_REQUIRED',
    provider: error.provider,
    status: error.snapshot.status,
    authMethod: error.snapshot.authMethod,
    scopeId: error.snapshot.scopeId,
    host: error.snapshot.host,
    reauthUrl: error.snapshot.reauthUrl,
    error: error.message,
  })
}

export function registerSessionCreateRoutes(deps: SessionCreateRouteDeps): void {
  const {
    router,
    requireWriteAccess,
    sessions,
    maxSessions,
    taskDelayMs,
    internalToken,
    daemonRegistry,
  } = deps

  router.post('/sessions', requireWriteAccess, async (req, res) => {
    const sessionName = parseSessionName(req.body?.name)
    if (!sessionName) {
      res.status(400).json({ error: 'Invalid session name' })
      return
    }

    const mode: ClaudePermissionMode = 'default'

    const parsedEffort = parseClaudeEffort(req.body?.effort)
    if (parsedEffort === null) {
      res.status(400).json({ error: 'Invalid effort. Expected one of: low, medium, high, max' })
      return
    }

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(req.body?.adaptiveThinking)
    if (parsedAdaptiveThinking === null) {
      res.status(400).json({ error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' })
      return
    }

    const parsedMaxThinkingTokens = parseClaudeMaxThinkingTokens(req.body?.maxThinkingTokens)
    if (parsedMaxThinkingTokens === null) {
      res.status(400).json({ error: 'Invalid maxThinkingTokens. Expected integer 1024..256000' })
      return
    }

    const task = parseOptionalTask(req.body?.task)
    if (task === null) {
      res.status(400).json({ error: 'Task must be a string' })
      return
    }

    const model = parseOptionalModel(req.body?.model)
    if (model === null) {
      res.status(400).json({ error: 'model must be a string when provided' })
      return
    }

    const resumeFromSession = parseOptionalSessionName(req.body?.resumeFromSession)
    if (resumeFromSession === null) {
      res.status(400).json({ error: 'Invalid resume session name' })
      return
    }

    if (sessions.has(sessionName)) {
      res.status(409).json({ error: `Session "${sessionName}" already exists` })
      return
    }

    let resumeSource: ResolvedResumableSessionSource | undefined
    if (resumeFromSession) {
      let persistedState: PersistedSessionsState
      try {
        persistedState = await deps.readPersistedSessionsState()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load persisted sessions'
        res.status(500).json({ error: message })
        return
      }

      const resolved = deps.resolveResumableSessionSource(resumeFromSession, persistedState)
      if (!resolved.source) {
        res.status(resolved.error?.status ?? 404).json({
          error: resolved.error?.message ?? `Session "${resumeFromSession}" is not resumable`,
        })
        return
      }
      resumeSource = resolved.source
    }

    if (sessions.size >= maxSessions && !resumeSource?.liveSession) {
      res.status(429).json({ error: `Session limit reached (${maxSessions})` })
      return
    }

    const requestedCreator = parseSessionCreator(req.body?.creator)
    if (requestedCreator === null) {
      res.status(400).json({ error: 'Invalid creator. Expected { kind, id? }' })
      return
    }
    const requestedCurrentSkillInvocation = parseActiveSkillInvocation(req.body?.currentSkillInvocation)
    if (requestedCurrentSkillInvocation === null) {
      res.status(400).json({
        error: 'Invalid currentSkillInvocation. Expected { skillId, displayName, startedAt, toolUseId? }',
      })
      return
    }

    const internalSessionRequest = deps.isInternalSessionRequest(req)
    const defaultHumanCreator: SessionCreator = {
      kind: 'human',
      ...(deps.sessionCreatorIdFromUser(req) ? { id: deps.sessionCreatorIdFromUser(req) } : {}),
    }
    const creator = resumeSource?.source.creator ?? requestedCreator ?? defaultHumanCreator
    if (!internalSessionRequest && creator.kind !== 'human') {
      const errorMessage = creator.kind === 'commander'
        ? 'creator: commander requires the canonical /api/commanders/:id/workers route, which provides URL-baked commander identity'
        : `Only internal callers can create ${creator.kind} session creators`
      res.status(403).json({ error: errorMessage })
      return
    }

    const rawRequestedSessionType = req.body?.sessionType
    const requestedSessionType = parseSessionType(rawRequestedSessionType)
    if (requestedSessionType === null) {
      res.status(400).json({
        error: 'Invalid sessionType. Expected one of: commander, worker, cron, sentinel, automation',
      })
      return
    }
    const sessionType: SessionType = resumeSource?.source.sessionType
      ?? requestedSessionType
      ?? (creator.kind === 'human' ? 'worker' : creator.kind)
    if (!internalSessionRequest && sessionType !== 'worker') {
      res.status(403).json({ error: 'Only internal callers can create non-worker session types' })
      return
    }

    const cwd = resumeSource?.source.cwd ?? parseCwd(req.body?.cwd)
    if (cwd === null) {
      res.status(400).json({ error: 'Invalid cwd: must be an absolute path' })
      return
    }

    const agentType = resumeSource?.source.agentType ?? parseProviderId(req.body?.agentType) ?? 'claude'
    const provider = getProvider(agentType)
    if (!provider) {
      res.status(400).json({ error: `Unknown provider: ${agentType}` })
      return
    }
    const providerDefaults = resolveProviderDefaults(provider)
    const effectiveModel = resumeSource?.source.model ?? model ?? null
    const modelValidation = validateModelForAgentType(agentType, effectiveModel)
    if (!modelValidation.ok) {
      res.status(400).json({ error: modelValidation.error, validIds: modelValidation.validIds })
      return
    }
    const effort: ClaudeEffortLevel | undefined = provider.uiCapabilities.supportsEffort
      ? (
        resumeSource?.source.effort
        ?? parsedEffort
        ?? providerDefaults.effort
        ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      )
      : undefined
    const adaptiveThinking: ClaudeAdaptiveThinkingMode | undefined = provider.uiCapabilities.supportsAdaptiveThinking
      ? (
        resumeSource?.source.adaptiveThinking
        ?? parsedAdaptiveThinking
        ?? providerDefaults.adaptiveThinking
        ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
      )
      : undefined
    const maxThinkingTokens = provider.uiCapabilities.supportsMaxThinkingTokens
      ? (
        resumeSource?.source.maxThinkingTokens
        ?? parsedMaxThinkingTokens
        ?? providerDefaults.maxThinkingTokens
        ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS
      )
      : undefined
    const transportType: Exclude<SessionTransportType, 'external'> = resumeSource || provider.uiCapabilities.forcedTransport === 'stream'
      ? 'stream'
      : parseSessionTransportType(req.body?.transportType)
    const requestedHost = resumeSource?.source.host ?? parseOptionalHost(req.body?.host)
    if (requestedHost === null) {
      res.status(400).json({ error: 'Invalid host: expected machine ID string' })
      return
    }

    const resumeProvider = resumeSource ? getProvider(resumeSource.source.agentType) : undefined
    const resumeProviderId = resumeSource
      ? resumeProvider?.getResumeId(resumeSource.source as unknown as StreamSession)
      : undefined
    if (
      resumeSource &&
      !resumeSource.liveSession &&
      resumeProvider?.id === 'codex' &&
      resumeProviderId &&
      !resumeSource.source.host &&
      !(await hasCodexRolloutFile(resumeProviderId, resumeSource.source.createdAt))
    ) {
      deps.clearCodexResumeMetadata(resumeFromSession!)
      res.status(409).json({
        error: codexRolloutUnavailableMessage(resumeFromSession!),
      })
      return
    }

    if (!resumeSource && sessionType === 'worker' && transportType === 'stream') {
      const parsed = parseWorkerLaunchRequest({
        allowedBodyKeys: COMMANDER_WORKER_LAUNCH_BODY_KEYS,
        creator,
        currentSkillInvocationNull: 'invalid',
        fallbackCwd: process.env.HOME ?? '/tmp',
        mode,
        preferMachineCwd: requestedHost !== undefined,
        rawBody: buildSessionCreateWorkerLaunchBody(req.body),
        requireName: true,
        routeLabel: '/api/agents/sessions',
        unknownKeyStyle: 'quoted',
      })
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body)
        return
      }

      const launched = await launchProviderWorkerSession(
        {
          createProviderStreamSession: deps.createProviderStreamSession,
          maxSessions,
          resolveDaemonLaunchReadiness: deps.resolveDaemonLaunchReadiness,
          resolveMachine: deps.resolveLaunchMachine,
          schedulePersistedSessionsWrite: deps.schedulePersistedSessionsWrite,
          sessions,
        },
        parsed.request,
        {
          missingCwdError: 'Provide cwd or host when creating a worker stream session',
        },
      )
      if (!launched.ok) {
        res.status(launched.status).json(launched.body)
        return
      }

      res.status(201).json({
        sessionName: parsed.request.sessionName,
        mode: parsed.request.mode,
        sessionType: launched.session.sessionType,
        creator: launched.session.creator,
        transportType: 'stream',
        agentType: parsed.request.agentType,
        host: launched.session.host,
        created: true,
      })
      return
    }

    const resolvedMachine = await deps.resolveLaunchMachine(requestedHost)
    if (!resolvedMachine.ok) {
      res.status(resolvedMachine.status).json({ error: resolvedMachine.error })
      return
    }
    const machine = resolvedMachine.machine
    const daemonReadiness = deps.resolveDaemonLaunchReadiness(machine, agentType)
    if (!daemonReadiness.ok) {
      res.status(daemonReadiness.status).json({ error: daemonReadiness.error })
      return
    }

    const requestedMachineCwd = cwd ?? machine?.cwd
    const sessionCwd = requestedMachineCwd ?? process.env.HOME ?? '/tmp'
    const daemonMachine = isDaemonMachine(machine) ? machine : undefined
    const remoteMachine = isRemoteMachine(machine) ? machine : undefined

    if (transportType === 'stream') {
      try {
        const session = await deps.createProviderStreamSession(
          sessionName,
          mode,
          task ?? '',
          requestedMachineCwd,
          machine,
          agentType,
          {
            effort,
            adaptiveThinking,
            maxThinkingTokens,
            model: resumeSource ? undefined : model,
            resumeSessionId: resumeSource ? provider.getResumeId(resumeSource.source) : undefined,
            resumedFrom: resumeFromSession,
            sessionType,
            creator,
            conversationId: resumeSource?.source.conversationId,
            currentSkillInvocation: resumeSource
              ? resumeSource.source.currentSkillInvocation
              : requestedCurrentSkillInvocation,
            spawnedBy: resumeSource?.source.spawnedBy,
            spawnedWorkers: resumeSource?.source.spawnedWorkers,
          },
        )
        if (resumeSource?.liveSession) {
          deps.retireLiveSessionForResume(resumeFromSession!, resumeSource.liveSession)
        }
        sessions.set(sessionName, session)
        deps.schedulePersistedSessionsWrite()
        res.status(201).json({
          sessionName,
          mode,
          sessionType: session.sessionType,
          creator: session.creator,
          transportType: 'stream',
          agentType,
          host: session.host,
          created: true,
        })
      } catch (err) {
        if (resumeFromSession && isMissingCodexRolloutError(err)) {
          deps.clearCodexResumeMetadata(resumeFromSession)
          res.status(409).json({
            error: codexRolloutUnavailableMessage(resumeFromSession),
          })
          return
        }
        if (err instanceof ProviderAuthRequiredError) {
          sendProviderAuthRequiredResponse(res, err)
          return
        }
        const message = err instanceof Error ? err.message : 'Failed to create stream session'
        res.status(500).json({ error: message })
      }
      return
    }

    try {
      const claudeEffort = effort ?? providerDefaults.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      const ptySpawner = daemonMachine ? null : await deps.getSpawner()
      const localSpawnCwd = process.env.HOME || '/tmp'
      const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
      const providerPtyEnv = provider.preparePtyEnv?.({ mode, effort: claudeEffort }) ?? {}
      const requiresApprovalBridge = provider.uiCapabilities.supportsAdaptiveThinking
      const approvalBridgeToken = requiresApprovalBridge && internalToken
        ? createApprovalBridgeToken({ internalToken, sessionName })
        : undefined
      const remoteShellCommand = buildLoginShellCommand(
        'exec "${SHELL:-/bin/bash}" -l',
        requestedMachineCwd,
        remoteMachine ? preparedLaunch.sourcedEnvFile : undefined,
      )
      const remoteApprovalBridge = remoteMachine && requiresApprovalBridge
        ? {
            port: resolveClaudeApprovalPort(process.env),
            approvalBridgeToken,
          }
        : undefined
      const ptyCommand = remoteMachine ? 'ssh' : 'bash'
      const ptyArgs = remoteMachine
        ? buildSshArgs(
          remoteMachine,
          remoteShellCommand,
          true,
          remoteApprovalBridge,
          preparedLaunch.sshSendEnvKeys,
        )
        : ['-l']
      const ptyEnv = requiresApprovalBridge
        ? {
            ...preparedLaunch.env,
            ...providerPtyEnv,
            HAMMURABI_PORT: resolveClaudeApprovalPort(process.env),
            HAMMURABI_INTERNAL_TOKEN: undefined,
            HAMMURABI_SESSION_NAME: sessionName,
            ...(approvalBridgeToken ? { HAMMURABI_APPROVAL_BRIDGE_TOKEN: approvalBridgeToken } : {}),
          }
        : {
            ...preparedLaunch.env,
            ...providerPtyEnv,
            HAMMURABI_INTERNAL_TOKEN: undefined,
          }
      const pty = daemonMachine
        ? daemonRegistry.spawnPty(daemonMachine.id, {
            command: ptyCommand,
            args: ptyArgs,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            cwd: sessionCwd,
            env: ptyEnv,
          })
        : ptySpawner!.spawn(ptyCommand, ptyArgs, {
            name: 'xterm-256color',
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            cwd: remoteMachine ? localSpawnCwd : sessionCwd,
            env: ptyEnv,
          })
      const createdAt = new Date().toISOString()

      const session: PtySession = {
        kind: 'pty',
        name: sessionName,
        sessionType,
        creator,
        agentType,
        effort: provider.uiCapabilities.supportsEffort ? claudeEffort : undefined,
        adaptiveThinking: provider.uiCapabilities.supportsAdaptiveThinking ? adaptiveThinking : undefined,
        maxThinkingTokens: provider.uiCapabilities.supportsMaxThinkingTokens ? maxThinkingTokens : undefined,
        cwd: sessionCwd,
        host: daemonMachine?.id ?? remoteMachine?.id,
        task: task && task.length > 0 ? task : undefined,
        pty,
        buffer: '',
        clients: new Set(),
        createdAt,
        lastEventAt: createdAt,
      }

      pty.onData((data) => {
        session.lastEventAt = new Date().toISOString()
        appendToBuffer(session, data)
        broadcastOutput(session, data)
      })

      pty.onExit(({ exitCode, signal }) => {
        const exitMsg = JSON.stringify({ type: 'exit', exitCode, signal })
        for (const client of session.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(exitMsg)
          }
        }
        sessions.delete(sessionName)
        deps.schedulePersistedSessionsWrite()
      })

      sessions.set(sessionName, session)

      const command = provider.uiCapabilities.supportsEffort
        ? buildClaudePtyCommand(
          mode,
          claudeEffort,
          adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
          maxThinkingTokens ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
        )
        : CODEX_MODE_COMMANDS[mode]
      pty.write(command + '\r')

      if (task && task.length > 0) {
        setTimeout(() => {
          if (sessions.has(sessionName)) {
            session.pty.write(task + '\r')
          }
        }, taskDelayMs)
      }

      res.status(201).json({
        sessionName,
        mode,
        sessionType,
        creator,
        transportType: 'pty',
        agentType,
        host: session.host,
        created: true,
      })
    } catch (err) {
      if (remoteMachine) {
        const message = err instanceof Error ? err.message : 'SSH connection failed'
        res.status(500).json({ error: `Failed to create remote PTY session: ${message}` })
        return
      }
      res.status(500).json({ error: 'Failed to create PTY session' })
    }
  })
}
