import { Router, type Request } from 'express'
import { WebSocket } from 'ws'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createReadStream } from 'node:fs'
import * as path from 'node:path'
import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import multer from 'multer'
import { buildCommanderSessionSeed } from '../commanders/memory/module.js'
import { ConversationStore } from '../commanders/conversation-store.js'
import { resolveCommanderDataDir } from '../commanders/paths.js'
import { resolveHammurabiDataDir, resolveModuleDataDir } from '../data-dir.js'
import {
  buildLegacyCommanderConversationId,
  CommanderSessionStore,
  DEFAULT_COMMANDER_MAX_TURNS,
} from '../commanders/store.js'
import { loadCommanderRuntimeConfig } from '../commanders/runtime-config.js'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  normalizeClaudeAdaptiveThinkingMode,
  type ClaudeAdaptiveThinkingMode,
} from '../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  normalizeClaudeEffortLevel,
  type ClaudeEffortLevel,
} from '../claude-effort.js'
import {
  getMimeType,
  listWorkspaceTree,
  readWorkspaceFilePreview,
  readWorkspaceGitLog,
  readWorkspaceGitStatus,
  resolveWorkspacePath,
  resolveWorkspaceRoot,
  toWorkspaceError,
  WorkspaceError,
  type WorkspaceCommandRunner,
} from '../workspace/index.js'
import { createAgentsAuthContext } from './router-context.js'
import { registerDiscoveryRoutes } from './routes/discovery-routes.js'
import { registerExternalSessionRoutes } from './routes/external-session-routes.js'
import { registerMachineWorldRoutes } from './routes/machine-world-routes.js'
import { registerSessionControlRoutes } from './routes/session-control-routes.js'
import { registerSessionQueryRoutes } from './routes/session-query-routes.js'
import { registerWorkerDispatchRoutes } from './routes/worker-dispatch-routes.js'
import { registerWorkspaceRoutes } from './routes/workspace-routes.js'
import {
  CODEX_MODE_COMMANDS,
  CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS,
  COMMANDER_PATH_SEGMENT_PATTERN,
  COMMANDER_SESSION_NAME_PREFIX,
  DEFAULT_AGENT_PRUNER_ENABLED,
  DEFAULT_AGENT_PRUNER_EXITED_SESSION_TTL_MS,
  DEFAULT_AGENT_PRUNER_STALE_SESSION_TTL_MS,
  DEFAULT_AGENT_PRUNER_SWEEP_INTERVAL_MS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_SESSION_STORE_PATH,
  FILE_NAME_PATTERN,
  MACHINE_TOOL_KEYS,
  MAX_BUFFER_BYTES,
  MAX_STREAM_EVENTS,
  SESSION_NAME_PATTERN,
  WORKSPACE_EXEC_MAX_BUFFER_BYTES,
} from './constants.js'
import { buildClaudePtyCommand, resolveClaudeApprovalPort } from './adapters/claude/helpers.js'
import { createClaudeStreamSession } from './adapters/claude/index.js'
import { createAgentsWebSocket } from './websocket.js'
import {
  buildCodexApprovalDecisionEvent,
  buildCodexApprovalMissingIdSystemEvent,
  buildCodexApprovalRequestSystemEvent,
  clearCodexPendingApprovalByItemId,
  clearCodexPendingApprovals as clearCodexPendingApprovalsFromHelper,
  clearCodexTurnWatchdog,
  codexRolloutDirectoryForCreatedAt,
  codexRolloutUnavailableMessage,
  extractCodexUsageTotals,
  getCodexApprovalRequestDetails,
  getCodexApprovalTargetLabel,
  getCodexCompletedItemId,
  hasCodexRolloutFile,
  hasPendingCodexApprovals,
  isMissingCodexRolloutError,
  markCodexTurnHealthy,
  parseCodexApprovalMethod,
  parseCodexSidecarError,
} from './adapters/codex/helpers.js'
import {
  applyCodexApprovalDecision as applyCodexApprovalDecisionAdapter,
  createCodexAppServerSession as createCodexAppServerSessionAdapter,
  failCodexSession as failCodexSessionAdapter,
  shutdownCodexRuntimes as shutdownCodexRuntimesAdapter,
  teardownCodexSessionRuntime as teardownCodexSessionRuntimeAdapter,
} from './adapters/codex/index.js'
import {
  createGeminiAcpSession as createGeminiAcpSessionAdapter,
} from './adapters/gemini/index.js'
import {
  parseActiveSkillInvocation,
  parseAgentType,
  parseAutoRotateEntryThreshold,
  parseClaudeAdaptiveThinking,
  parseClaudeEffort,
  parseCodexApprovalDecision,
  parseCwd,
  parseMaxSessions,
  parseOptionalHost,
  parseOptionalModel,
  parseOptionalSessionName,
  parseOptionalTask,
  parseSessionCreator,
  parseSessionName,
  parseSessionTransportType,
  parseSessionType,
  parseTaskDelayMs,
  parseWsKeepAliveIntervalMs,
  parseCodexTurnWatchdogTimeoutMs,
} from './session/input.js'
import { registerCodexProcessExitSessionMap } from './process-exit.js'
import {
  buildLoginShellCommand,
  buildMachineProbeScript,
  prepareMachineLaunchEnvironment,
  buildRemoteCommand,
  buildSshArgs,
  buildSshDestination,
  createMachineRegistryStore,
  createMissingToolStatus,
  createWorkspaceSshCommandRunner,
  ensureSshControlDir,
  isRemoteMachine,
  parseMachineHealthOutput,
  parseMachineRegistry,
  resolveTailscaleHostname,
  runCapturedCommand,
  shellEscape,
  validateMachineConfig,
} from './machines.js'
import {
  appendCodexSidecarTail,
  appendJsonReplayEvent,
  appendToBuffer,
  applyStreamUsageEvent,
  broadcastOutput,
  childProcessHasExited,
  truncateLogText,
} from './session/helpers.js'
import {
  appendCommanderTranscriptEvent as appendCommanderTranscriptEventToStore,
  appendGenericTranscriptEvent,
  clearCodexResumeMetadata as clearCodexResumeMetadataForStore,
  readPersistedSessionsState as readPersistedSessionsStateFromStore,
  resolveRestoredReplaySource,
  restorePersistedSessions as restorePersistedSessionsFromStore,
  retireLiveCodexSessionForResume as retireLiveCodexSessionForResumeForStore,
  serializePersistedSessionsState as serializePersistedSessionsStateForStore,
  writePersistedSessionsState as writePersistedSessionsStateToStore,
  writeTranscriptMetaForSession as writeTranscriptMeta,
} from './session/persistence.js'
import {
  applyRestoredReplayState,
  asObject,
  buildPersistedEntryFromExitedSession,
  buildPersistedEntryFromLiveStreamSession,
  canResumeLiveStreamSession,
  countCompletedTurnEntries,
  extractClaudeSessionId,
  getCommanderLabels,
  getCommanderWorldAgentId,
  getCommanderWorldAgentPhase,
  getCommanderWorldAgentStatus,
  getLastToolUse,
  getToolResultIds,
  getToolUses,
  getWorkerStates as getWorkerStatesFromState,
  getWorldAgentPhase,
  getWorldAgentRole,
  getWorldAgentStatus,
  getWorldAgentTask,
  getWorldAgentUsage,
  hasPendingAskUserQuestion,
  hasResumeIdentifier,
  mergePersistedSessionWithTranscriptMeta,
  parseFrontmatter,
  parsePersistedSessionsState,
  resolveLastUpdatedAt,
  sendWorkspaceError,
  sendWorkspaceRawFile,
  snapshotDeletedResumableStreamSession,
  snapshotExitedStreamSession,
  summarizeWorkerStates,
  toCommanderWorldAgent,
  toCompletedSession,
  toExitBasedCompletedSession,
  toWorldAgent,
} from './session/state.js'
import { CodexSessionRuntime } from './launchers/runtimes.js'
import type {
  ActiveSkillInvocation,
  AgentSession,
  AgentType,
  AgentsRouterOptions,
  AgentsRouterResult,
  AnySession,
  CapturedCommandResult,
  ClaudePermissionMode,
  CodexApprovalDecision,
  CodexApprovalMethod,
  CodexPendingApprovalRequest,
  CodexProtocolMessage,
  CodexRuntimeFailure,
  CodexSessionCreateOptions,
  CodexSessionRuntimeHandle,
  CommanderSessionsInterface,
  CompletedSession,
  CompletedSessionMetadata,
  ExitedStreamSessionState,
  ExternalSession,
  GeminiAcpRuntimeHandle,
  GeminiSessionCreateOptions,
  MachineConfig,
  MachineHealthReport,
  MachineToolKey,
  MachineToolStatus,
  PersistedSessionsState,
  PersistedStreamSession,
  PtyHandle,
  PtySession,
  PtySpawner,
  ResolvedResumableSessionSource,
  SessionCreator,
  SessionType,
  SessionTransportType,
  StreamJsonEvent,
  StreamSession,
  StreamSessionCreateOptions,
  WorkerState,
  WorkerPhase,
  WorkerSummary,
  WorldAgent,
  WorldAgentPhase,
  WorldAgentRole,
  WorldAgentStatus,
} from './types.js'
import {
  DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
  MessageQueueFullError,
  type QueuedMessage,
  type QueuedMessageImage,
  type QueuedMessagePriority,
  SessionMessageQueue,
} from './message-queue.js'

export type {
  ActiveSkillInvocation,
  AgentSession,
  AgentType,
  AgentsRouterOptions,
  AgentsRouterResult,
  ClaudePermissionMode,
  CommanderSessionsInterface,
  MachineConfig,
  PtyHandle,
  PtySpawner,
  SessionType,
  WorldAgent,
} from './types.js'

// The approval-session types previously lived in both this file and ./types.ts
// — duplicate definitions. #921 Phase P4 removes the routes.ts copies and
// imports them from ./types.js (which is already the canonical location), then
// re-exports them so downstream consumers keep working unchanged.
import type {
  ApprovalSessionContext,
  ApprovalSessionsInterface,
  CodexApprovalQueueEvent,
  PendingCodexApprovalView,
} from './types.js'
export type {
  ApprovalSessionContext,
  ApprovalSessionsInterface,
  CodexApprovalQueueEvent,
  PendingCodexApprovalView,
} from './types.js'

// Codex approval-id helpers moved to ./codex-approval.ts in Phase P4. Both
// `parseCodexApprovalId` and the non-exported helpers are imported here for
// internal use, and `parseCodexApprovalId` is re-exported so existing test
// imports (`../routes`) keep working. New code should import from
// `./codex-approval.js` directly.
import {
  getCodexApprovalActionId,
  getCodexApprovalActionLabel,
  parseCodexApprovalId,
  serializeCodexApprovalId,
} from './codex-approval.js'
export { parseCodexApprovalId }
import { createCommanderSessionsInterface } from './commander-interface.js'
import { createApprovalSessionsInterface } from './approval-interface.js'
import { createPersistenceHelpers } from './persistence-helpers.js'
import { createStreamIoHelpers } from './stream-io-helpers.js'

const MESSAGE_QUEUE_RETRY_INITIAL_MS = 250
const MESSAGE_QUEUE_RETRY_MAX_MS = 5000

export function createAgentsRouter(options: AgentsRouterOptions = {}): AgentsRouterResult {
  const router = Router()
  const sessions = new Map<string, AnySession>()
  registerCodexProcessExitSessionMap(sessions)
  const sessionEventHandlers = new Map<string, Set<(event: StreamJsonEvent) => void>>()

  // Stream I/O helpers are created early so both route registrations and
  // downstream helpers can reference broadcastStreamEvent / writeToStdin
  // without forward-reference errors.
  const {
    broadcastStreamEvent,
    writeToStdin,
    resetActiveTurnState,
  } = createStreamIoHelpers({ sessionEventHandlers })

  const completedSessions = new Map<string, CompletedSession>()
  const exitedStreamSessions = new Map<string, ExitedStreamSessionState>()
  const maxSessions = parseMaxSessions(options.maxSessions)
  const taskDelayMs = parseTaskDelayMs(options.taskDelayMs)
  const wsKeepAliveIntervalMs = parseWsKeepAliveIntervalMs(options.wsKeepAliveIntervalMs)
  const autoRotateEntryThreshold = parseAutoRotateEntryThreshold(
    options.autoRotateEntryThreshold ?? process.env.AGENTS_AUTO_ROTATE_ENTRY_THRESHOLD,
  )
  const codexTurnWatchdogTimeoutMs = parseCodexTurnWatchdogTimeoutMs(options.codexTurnWatchdogTimeoutMs)
  const internalToken = options.internalToken
  const getActionPolicyGate = options.getActionPolicyGate
  const autoResumeSessions = options.autoResumeSessions ?? true
  const commanderDataDir = options.commanderSessionStorePath
    ? path.dirname(path.resolve(options.commanderSessionStorePath))
    : resolveCommanderDataDir()
  const sessionStorePath = options.sessionStorePath
    ? path.resolve(options.sessionStorePath)
    : path.join(resolveModuleDataDir('agents'), 'stream-sessions.json')
  const machinesFilePath = options.machinesFilePath
    ? path.resolve(options.machinesFilePath)
    : path.join(resolveHammurabiDataDir(), 'machines.json')
  const machineRegistry = createMachineRegistryStore(machinesFilePath)
  void ensureSshControlDir().catch((error) => {
    console.warn(
      `[agents] Failed to initialize SSH control directory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  })
  const commanderSessionStore = options.commanderSessionStorePath !== undefined
    ? new CommanderSessionStore(options.commanderSessionStorePath)
    : new CommanderSessionStore()
  const conversationStore = new ConversationStore(commanderDataDir)
  const runtimeConfig = loadCommanderRuntimeConfig()
  const prunerConfig = {
    enabled: runtimeConfig.agents?.pruner?.enabled ?? DEFAULT_AGENT_PRUNER_ENABLED,
    sweepIntervalMs: runtimeConfig.agents?.pruner?.sweepIntervalMs ?? DEFAULT_AGENT_PRUNER_SWEEP_INTERVAL_MS,
    staleSessionTtlMs: runtimeConfig.agents?.pruner?.staleSessionTtlMs ?? DEFAULT_AGENT_PRUNER_STALE_SESSION_TTL_MS,
    exitedSessionTtlMs: runtimeConfig.agents?.pruner?.exitedSessionTtlMs ?? DEFAULT_AGENT_PRUNER_EXITED_SESSION_TTL_MS,
  }
  const commanderTranscriptWriteQueues = new Map<string, Promise<void>>()
  const autoRotationQueues = new Map<string, Promise<StreamSession | null>>()
  const codexApprovalQueueSubscribers = new Set<(event: CodexApprovalQueueEvent) => void>()
  // restorePersistedSessionsReady + router.use middleware are attached AFTER
  // createPersistenceHelpers below, since they depend on `restorePersistedSessions`
  // which is produced by that factory (const destructure — no hoisting).

  let spawner: PtySpawner | null = options.ptySpawner ?? null

  function isInternalSessionRequest(req: Request): boolean {
    return Boolean(internalToken && req.header('x-hammurabi-internal-token') === internalToken)
  }

  function sessionCreatorIdFromUser(req: Request): string | undefined {
    const userId = req.user?.id?.trim()
    if (userId) {
      return userId
    }
    const email = req.user?.email?.trim()
    return email && email.length > 0 ? email : undefined
  }

  function getApprovalCommanderScopeId(session: StreamSession): string | undefined {
    if (session.sessionType === 'commander') {
      return session.name
    }
    if (session.creator.kind === 'commander' && session.creator.id) {
      return `${COMMANDER_SESSION_NAME_PREFIX}${session.creator.id}`
    }
    if (session.spawnedBy && sessions.get(session.spawnedBy)?.kind === 'stream' && sessions.get(session.spawnedBy)?.sessionType === 'commander') {
      return session.spawnedBy
    }
    return undefined
  }

  function toPendingCodexApprovalView(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): PendingCodexApprovalView {
    return {
      id: serializeCodexApprovalId(session.name, pendingRequest.requestId),
      sessionName: session.name,
      commanderScopeId: getApprovalCommanderScopeId(session),
      requestId: pendingRequest.requestId,
      actionId: getCodexApprovalActionId(pendingRequest.method),
      actionLabel: getCodexApprovalActionLabel(pendingRequest.method),
      requestedAt: pendingRequest.requestedAt,
      reason: pendingRequest.reason,
      risk: pendingRequest.risk,
      threadId: pendingRequest.threadId,
      itemId: pendingRequest.itemId,
      turnId: pendingRequest.turnId,
    }
  }

  function emitCodexApprovalQueueEvent(event: CodexApprovalQueueEvent): void {
    for (const subscriber of codexApprovalQueueSubscribers) {
      try {
        subscriber(event)
      } catch {
        // Approval queue subscribers must not interrupt session flow.
      }
    }
  }

  function clearCodexPendingApprovals(session: StreamSession): void {
    if (session.codexPendingApprovals.size > 0) {
      for (const pendingRequest of session.codexPendingApprovals.values()) {
        emitCodexApprovalQueueEvent({
          type: 'resolved',
          approval: toPendingCodexApprovalView(session, pendingRequest),
          delivered: false,
        })
      }
    }
    clearCodexPendingApprovalsFromHelper(session)
  }

  function appendCommanderTranscriptEvent(session: StreamSession, event: StreamJsonEvent): void {
    appendCommanderTranscriptEventToStore(
      session,
      event,
      commanderTranscriptWriteQueues,
      extractClaudeSessionId,
    )
  }

  function getWorkerStates(sourceSessionName: string): WorkerState[] {
    return getWorkerStatesFromState(
      sourceSessionName,
      sessions,
      exitedStreamSessions,
      completedSessions,
    )
  }

  async function getSpawner(): Promise<PtySpawner> {
    if (spawner) {
      return spawner
    }

    const nodePty = await import('@lydell/node-pty')
    spawner = {
      spawn: (file, args, opts) => nodePty.spawn(file, args, opts) as unknown as PtyHandle,
    }
    return spawner
  }

  async function readMachineRegistry(): Promise<MachineConfig[]> {
    return machineRegistry.readMachineRegistry()
  }

  async function resolveAgentSessionWorkspace(rawSessionName: unknown) {
    const sessionName = parseSessionName(rawSessionName)
    if (!sessionName) {
      throw new WorkspaceError(400, 'Invalid session name')
    }

    const session = sessions.get(sessionName)
    if (!session) {
      throw new WorkspaceError(404, `Session "${sessionName}" not found`)
    }

    const sourceHostRaw = session.host ?? (session.kind === 'external' ? session.machine : undefined)
    const sourceHost = typeof sourceHostRaw === 'string' ? sourceHostRaw.trim() : ''
    const machines = sourceHost.length > 0
      ? await readMachineRegistry()
      : []
    const machine = sourceHost.length > 0
      ? machines.find((entry) => entry.id === sourceHost || entry.host === sourceHost)
      : undefined
    if (sourceHost.length > 0 && !machine) {
      throw new WorkspaceError(400, `Unknown host machine "${sourceHost}"`)
    }
    const remoteMachine = isRemoteMachine(machine)
      ? {
        id: machine.id,
        label: machine.label,
        host: machine.host,
        user: machine.user,
        port: machine.port,
      }
      : undefined
    const runner = remoteMachine ? createWorkspaceSshCommandRunner(remoteMachine) : undefined
    const workspace = await resolveWorkspaceRoot({
      rootPath: session.cwd,
      source: {
        kind: 'agent-session',
        id: sessionName,
        label: sessionName,
        host: remoteMachine ? sourceHost : undefined,
      },
      machine: remoteMachine,
    }, runner)

    return {
      workspace,
      runner,
    }
  }

  async function writeMachineRegistry(machines: readonly MachineConfig[]): Promise<MachineConfig[]> {
    return machineRegistry.writeMachineRegistry(machines)
  }

  async function withMachineRegistryWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    return machineRegistry.withWriteLock(operation)
  }

  const {
    schedulePersistedSessionsWrite,
    readPersistedSessionsState,
    restorePersistedSessions,
    getStaleCronSessionCandidates,
    pruneStaleCronSessions,
    getStaleNonHumanSessionCandidates,
    pruneStaleNonHumanSessions,
  } = createPersistenceHelpers({
    sessionStorePath,
    maxSessions,
    machineRegistry,
    sessions,
    completedSessions,
    exitedStreamSessions,
    applyStreamUsageEvent,
    createClaudeSession: async (entry, machine) => createStreamSession(
      entry.name,
      entry.mode,
      '',
      entry.cwd,
      machine,
      'claude',
      {
        effort: entry.effort,
        adaptiveThinking: entry.adaptiveThinking,
        resumeSessionId: entry.claudeSessionId,
        createdAt: entry.createdAt,
        resumedFrom: entry.resumedFrom,
        sessionType: entry.sessionType,
        creator: entry.creator,
        conversationId: entry.conversationId,
        currentSkillInvocation: entry.currentSkillInvocation,
        spawnedBy: entry.spawnedBy,
        spawnedWorkers: entry.spawnedWorkers,
      },
    ),
    createCodexSession: async (entry, machine) => {
      if (!entry.codexThreadId) {
        throw new Error(`Codex session "${entry.name}" is missing a thread id`)
      }
      return resumeCodexAppServerSession(
        entry.name,
        entry.mode,
        entry.cwd,
        entry.codexThreadId,
        entry.createdAt,
        {
          resumedFrom: entry.resumedFrom,
          sessionType: entry.sessionType,
          creator: entry.creator,
          conversationId: entry.conversationId,
          currentSkillInvocation: entry.currentSkillInvocation,
          machine,
          spawnedBy: entry.spawnedBy,
          spawnedWorkers: entry.spawnedWorkers,
        },
      )
    },
    createGeminiSession: async (entry, machine) => {
      if (!entry.geminiSessionId) {
        throw new Error(`Gemini session "${entry.name}" is missing a session id`)
      }
      return createGeminiAcpSession(
        entry.name,
        entry.mode,
        '',
        entry.cwd,
        {
          resumeSessionId: entry.geminiSessionId,
          createdAt: entry.createdAt,
          resumedFrom: entry.resumedFrom,
          sessionType: entry.sessionType,
          creator: entry.creator,
          conversationId: entry.conversationId,
          currentSkillInvocation: entry.currentSkillInvocation,
          spawnedBy: entry.spawnedBy,
          spawnedWorkers: entry.spawnedWorkers,
          machine,
        },
      )
    },
    teardownCodexSessionRuntime,
    isExitedSessionResumeAvailable,
    isLiveSessionResumeAvailable,
  })

  async function runSessionPruners(nowMs: number = Date.now()): Promise<void> {
    pruneStaleCronSessions(nowMs)
    await pruneStaleNonHumanSessions(prunerConfig, nowMs)
  }

  const sessionPrunerTimer = prunerConfig.enabled
    ? setInterval(() => {
      void runSessionPruners()
    }, prunerConfig.sweepIntervalMs)
    : null
  const clearSessionPrunerTimer = () => {
    if (sessionPrunerTimer) {
      clearInterval(sessionPrunerTimer)
    }
  }
  const handleSessionPrunerSigterm = () => {
    clearSessionPrunerTimer()
  }

  if (sessionPrunerTimer) {
    process.on('SIGTERM', handleSessionPrunerSigterm)
  }

  for (const session of sessions.values()) {
    if (session.kind === 'stream') {
      initializeAutoRotationState(session)
    }
  }

  // Now that restorePersistedSessions is bound, set up the boot-gate so
  // every incoming request waits for the one-time restore to finish before
  // being handled.
  const restorePersistedSessionsReady = autoResumeSessions
    ? restorePersistedSessions().catch(() => undefined)
    : Promise.resolve()

  router.use((_req, _res, next) => {
    restorePersistedSessionsReady.then(() => next(), next)
  })

  const {
    requireReadAccess,
    requireWriteAccess,
    requireDispatchWorkerAccess,
    verifyWsAuth,
  } = createAgentsAuthContext(options)

  registerDiscoveryRoutes({
    router,
    requireReadAccess,
    requireWriteAccess,
    buildSshArgs,
    isRemoteMachine,
    readMachineRegistry,
    shellEscape,
  })

  registerMachineWorldRoutes({
    router,
    requireReadAccess,
    requireWriteAccess,
    commanderSessionStorePath: options.commanderSessionStorePath,
    conversationStore,
    sessions,
    buildSshArgs,
    isRemoteMachine,
    parseSessionName,
    pruneStaleCronSessions,
    pruneStaleNonHumanSessions: () => pruneStaleNonHumanSessions(prunerConfig),
    readMachineRegistry,
    resolveTailscaleHostname,
    validateMachineConfig,
    withMachineRegistryWriteLock,
    writeMachineRegistry,
  })

  registerWorkerDispatchRoutes({
    router,
    requireDispatchWorkerAccess,
    maxSessions,
    sessions,
    createCodexAppServerSession,
    createGeminiAcpSession,
    createStreamSession,
    readMachineRegistry,
    schedulePersistedSessionsWrite,
  })

  router.post('/sessions/sweep', requireWriteAccess, async (req, res) => {
    const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1'
    const nowMs = Date.now()
    const cronCandidates = getStaleCronSessionCandidates(nowMs)
    const nonHumanCandidates = await getStaleNonHumanSessionCandidates(prunerConfig, nowMs)

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

    const cron = pruneStaleCronSessions(nowMs)
    const nonHuman = await pruneStaleNonHumanSessions(prunerConfig, nowMs)
    res.json({ pruned: { cron, nonHuman } })
  })

  registerSessionQueryRoutes({
    router,
    requireReadAccess,
    commanderSessionStorePath: options.commanderSessionStorePath,
    sessions,
    completedSessions,
    exitedStreamSessions,
    isExitedSessionResumeAvailable,
    parseSessionName,
    pruneStaleCronSessions,
    pruneStaleNonHumanSessions: () => pruneStaleNonHumanSessions(prunerConfig),
    getWorkerStates,
  })

  registerWorkspaceRoutes({
    router,
    requireReadAccess,
    resolveAgentSessionWorkspace,
    listWorkspaceTree,
    readWorkspaceFilePreview,
    readWorkspaceGitStatus,
    readWorkspaceGitLog,
  })

  registerExternalSessionRoutes({
    router,
    requireWriteAccess,
    maxSessions,
    sessions,
    broadcastEvent: broadcastStreamEvent,
  })

  registerSessionControlRoutes({
    router,
    requireReadAccess,
    requireWriteAccess,
    maxSessions,
    sessions,
    completedSessions,
    exitedStreamSessions,
    sessionEventHandlers,
    applyCodexApprovalDecision,
    clearCodexResumeMetadata,
    createCodexAppServerSession,
    createGeminiAcpSession,
    createStreamSession,
    readMachineRegistry,
    readPersistedSessionsState,
    resolveResumableSessionSource,
    retireLiveCodexSessionForResume,
    schedulePersistedSessionsWrite,
    sendImmediateTextToStreamSession,
    queueTextToStreamSession,
    createQueuedMessage,
    enqueueQueuedMessage,
    getQueueSnapshot: (session) => {
      const queue = getQueueUpdatePayload(session).queue
      return {
        ...queue,
        items: queue.items ?? [],
        currentMessage: queue.currentMessage ?? null,
        maxSize: queue.maxSize ?? session.messageQueue.maxSize,
        totalCount: queue.totalCount ?? getQueuedBacklogCount(session),
      }
    },
    isQueueBackpressureError,
    reorderVisibleQueuedMessages,
    removeQueuedMessageById,
    clearVisibleQueuedMessages,
    broadcastQueueUpdate,
    clearQueuedMessageRetry,
    resetQueuedMessageRetryDelay,
    scheduleQueuedMessageDrain,
    applyRestoredQueueState: (session, source, queueOptions) => {
      const restoredCurrentMessage = queueOptions?.includeCurrentMessage === false
        ? undefined
        : source.currentQueuedMessage
      const restoredPendingDirectSends = source.pendingDirectSendMessages
        ? [...source.pendingDirectSendMessages]
        : []
      const restoredQueuedMessages = source.queuedMessages
        ? [...source.queuedMessages]
        : []

      if (restoredCurrentMessage) {
        if (restoredCurrentMessage.priority === 'high') {
          restoredPendingDirectSends.unshift(restoredCurrentMessage)
        } else {
          restoredQueuedMessages.unshift(restoredCurrentMessage)
        }
      }

      session.pendingDirectSendMessages = restoredPendingDirectSends.filter((message, index, messages) => {
        return message.priority === 'high'
          && messages.findIndex((candidate) => candidate.id === message.id) === index
      })
      session.messageQueue = new SessionMessageQueue(
        DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
        restoredQueuedMessages.filter((message, index, messages) => {
          return message.priority !== 'high'
            && messages.findIndex((candidate) => candidate.id === message.id) === index
        }),
      )
      session.currentQueuedMessage = undefined
      resetQueuedMessageRetryDelay(session)
      clearQueuedMessageRetry(session)
    },
    resumeRestoredQueueDrain: (session) => {
      if (getQueuedBacklogCount(session) === 0) {
        return
      }
      scheduleQueuedMessageDrain(session, { force: true })
    },
    initializeAutoRotationState,
    teardownCodexSessionRuntime,
    teardownGeminiSessionRuntime,
  })

  // ── Stream session helpers ──────────────────────────────────────
  // readFiniteNumber / readUsageNumber / applyStreamUsageEvent used to be
  // duplicated here AND in ./session/helpers.ts — identical implementations,
  // likely drift-risk across two call sites. In issue/921 Phase P6c the local
  // copies were deleted; the imported `applyStreamUsageEvent` at the top of
  // this file is now the single source of truth, called unchanged by
  // appendStreamEvent below.

  function appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void {
    session.lastEventAt = new Date().toISOString()
    session.events.push(event)
    if (session.events.length > MAX_STREAM_EVENTS) {
      session.events = session.events.slice(-MAX_STREAM_EVENTS)
    }

    // Track usage from message_delta and result events.
    //
    // message_delta.usage contains per-message token counts (cumulative within
    // that single message, not across the session). Across multiple turns we
    // must *accumulate* (`+=`) to build session totals. The `result` event at
    // the end carries session-level cumulative totals and overrides directly.
    const evtType = event.type as string
    if (evtType === 'message_start') {
      const wasCompleted = session.lastTurnCompleted
      // One-shot session types (`cron`, `sentinel`) are intentionally
      // single-turn. Once a `result` event has been stored on the session,
      // a subsequent `message_start` from stdout (e.g. emitted by newer
      // Claude CLI envelope formats after the result) must not clear the
      // completion state — the executor depends on it to detect completion
      // without waiting for process exit. See issue #1217 / PR #462 fix #1.
      const isCompletedOneShot =
        (session.sessionType === 'cron' || session.sessionType === 'sentinel') &&
        Boolean(session.finalResultEvent)
      if (!isCompletedOneShot) {
        session.lastTurnCompleted = false
        session.completedTurnAt = undefined
        session.finalResultEvent = undefined
        session.restoredIdle = false
      }
      if (session.agentType === 'codex') {
        clearCodexPendingApprovals(session)
        scheduleCodexTurnWatchdog(session)
      }
      if (wasCompleted && session.agentType === 'claude') {
        schedulePersistedSessionsWrite()
      }
    }
    if (evtType === 'result') {
      const wasCompleted = session.lastTurnCompleted
      session.lastTurnCompleted = true
      session.completedTurnAt = new Date().toISOString()
      session.finalResultEvent = event
      if (!wasCompleted) {
        session.conversationEntryCount += 1
      }
      if (!wasCompleted && session.agentType === 'claude') {
        schedulePersistedSessionsWrite()
      }
      if (session.agentType === 'codex') {
        clearCodexPendingApprovals(session)
        clearCodexTurnWatchdog(session)
        markCodexTurnHealthy(session)
      }
      if (
        !wasCompleted &&
        supportsAutoRotation(session) &&
        session.conversationEntryCount >= autoRotateEntryThreshold
      ) {
        session.autoRotatePending = true
      }
      if (session.currentQueuedMessage) {
        session.currentQueuedMessage = undefined
        clearQueuedMessageRetry(session)
        resetQueuedMessageRetryDelay(session)
        broadcastQueueUpdate(session)
        schedulePersistedSessionsWrite()
        if (session.autoRotatePending) {
          scheduleAutoRotationIfNeeded(session.name)
        }
        scheduleQueuedMessageDrain(session)
      } else if (getQueuedBacklogCount(session) > 0) {
        if (session.autoRotatePending) {
          scheduleAutoRotationIfNeeded(session.name)
        }
        scheduleQueuedMessageDrain(session)
      } else if (session.autoRotatePending) {
        scheduleAutoRotationIfNeeded(session.name)
      }
    }
    if (evtType === 'exit' && session.agentType === 'codex') {
      clearCodexPendingApprovals(session)
      clearCodexTurnWatchdog(session)
      markCodexTurnHealthy(session)
    }
    applyStreamUsageEvent(session, event)

    if (session.agentType === 'claude') {
      const sessionId = extractClaudeSessionId(event)
      if (sessionId && session.claudeSessionId !== sessionId) {
        session.claudeSessionId = sessionId
        schedulePersistedSessionsWrite()
      }
    }

    appendCommanderTranscriptEvent(session, event)
    appendGenericTranscriptEvent(session, event)
  }

  function supportsAutoRotation(session: StreamSession): boolean {
    if (session.sessionType === 'cron') {
      return false
    }
    return session.agentType === 'claude' || session.agentType === 'codex'
  }

  function initializeAutoRotationState(session: StreamSession): void {
    session.autoRotatePending = supportsAutoRotation(session)
      && session.conversationEntryCount >= autoRotateEntryThreshold
    if (session.autoRotatePending) {
      scheduleAutoRotationIfNeeded(session.name)
    }
  }

  function createAutoRotationEvent(
    session: StreamSession,
    fromBackingId: string | undefined,
    toBackingId: string | undefined,
  ): StreamJsonEvent {
    const backingLabel = session.agentType === 'codex' ? 'thread' : 'session'
    return {
      type: 'system',
      subtype: 'session_rotated',
      reason: 'auto-entry-threshold',
      entryCount: session.conversationEntryCount,
      threshold: autoRotateEntryThreshold,
      fromBackingId: fromBackingId ?? null,
      toBackingId: toBackingId ?? null,
      text: `Session auto-rotated after ${session.conversationEntryCount} entries (${backingLabel}: ${fromBackingId ?? 'unknown'} -> ${toBackingId ?? 'pending'}).`,
    }
  }

  async function resolveSessionMachine(session: StreamSession): Promise<MachineConfig | undefined> {
    if (!session.host) {
      return undefined
    }
    const machines = await readMachineRegistry()
    const machine = machines.find((candidate) => candidate.id === session.host)
    if (!machine) {
      throw new Error(`Host machine "${session.host}" is unavailable for session rotation`)
    }
    return machine
  }

  async function buildReplacementPromptOptions(
    sessionName: string,
    session: StreamSession,
  ): Promise<{ systemPrompt?: string; maxTurns?: number }> {
    if (session.sessionType !== 'commander' || session.creator.kind !== 'commander') {
      return {
        systemPrompt: session.systemPrompt,
        maxTurns: session.maxTurns,
      }
    }

    const commanderId = session.creator.id?.trim()
    if (!commanderId) {
      return {
        systemPrompt: session.systemPrompt,
        maxTurns: session.maxTurns,
      }
    }

    try {
      const commanderSession = await commanderSessionStore.get(commanderId)
      const conversationId = session.conversationId?.trim() || buildLegacyCommanderConversationId(commanderId)
      const conversation = await conversationStore.get(conversationId)
      const seeded = await buildCommanderSessionSeed({
        commanderId,
        cwd: commanderSession?.cwd ?? session.cwd,
        currentTask: conversation?.currentTask ?? null,
        taskSource: commanderSession?.taskSource ?? null,
        maxTurns: commanderSession?.maxTurns ?? session.maxTurns ?? DEFAULT_COMMANDER_MAX_TURNS,
        memoryBasePath: commanderDataDir,
      })
      return seeded
    } catch {
      return {
        systemPrompt: session.systemPrompt,
        maxTurns: session.maxTurns,
      }
    }
  }

  async function createReplacementStreamSession(
    sessionName: string,
    session: StreamSession,
  ): Promise<StreamSession> {
    const machine = await resolveSessionMachine(session)
    const promptOptions = await buildReplacementPromptOptions(sessionName, session)

    if (session.agentType === 'codex') {
      return createCodexAppServerSession(
        sessionName,
        session.mode,
        '',
        session.cwd,
        {
          createdAt: session.createdAt,
          spawnedBy: session.spawnedBy,
          spawnedWorkers: session.spawnedWorkers,
          sessionType: session.sessionType,
          creator: session.creator,
          conversationId: session.conversationId,
          currentSkillInvocation: session.currentSkillInvocation,
          resumedFrom: session.resumedFrom,
          systemPrompt: promptOptions.systemPrompt,
          model: session.model,
          machine,
        },
      )
    }

    return createStreamSession(
      sessionName,
      session.mode,
      '',
      session.cwd,
      machine,
      'claude',
      {
        effort: session.effort,
        adaptiveThinking: session.adaptiveThinking,
        model: session.model,
        createdAt: session.createdAt,
        spawnedBy: session.spawnedBy,
        spawnedWorkers: session.spawnedWorkers,
        resumedFrom: session.resumedFrom,
        sessionType: session.sessionType,
        creator: session.creator,
        conversationId: session.conversationId,
        currentSkillInvocation: session.currentSkillInvocation,
        systemPrompt: promptOptions.systemPrompt,
        maxTurns: promptOptions.maxTurns,
      },
    )
  }

  async function rotateStreamSessionIfNeeded(sessionName: string): Promise<StreamSession | null> {
    const current = sessions.get(sessionName)
    if (!current || current.kind !== 'stream') {
      return null
    }
    if (!current.autoRotatePending) {
      return current
    }
    if (!supportsAutoRotation(current)) {
      current.autoRotatePending = false
      return current
    }
    if (!current.lastTurnCompleted || current.currentQueuedMessage) {
      return current
    }

    try {
      const rotated = await createReplacementStreamSession(sessionName, current)
      const rotatedPreludeEvents = rotated.events.slice()
      const fromBackingId = current.agentType === 'codex' ? current.codexThreadId : current.claudeSessionId
      const toBackingId = rotated.agentType === 'codex' ? rotated.codexThreadId : rotated.claudeSessionId
      const rotationEvent = createAutoRotationEvent(current, fromBackingId, toBackingId)

      appendStreamEvent(current, rotationEvent)
      broadcastStreamEvent(current, rotationEvent)

      clearQueuedMessageRetry(current)
      rotated.messageQueue = new SessionMessageQueue(current.messageQueue.maxSize, current.messageQueue.list())
      rotated.pendingDirectSendMessages = [...current.pendingDirectSendMessages]
      rotated.events = [...current.events, ...rotatedPreludeEvents]
      rotated.usage = { ...current.usage }
      if (rotatedPreludeEvents.length === 0) {
        rotated.lastEventAt = current.lastEventAt
      }
      rotated.conversationEntryCount = 0
      rotated.autoRotatePending = false

      for (const client of current.clients) {
        rotated.clients.add(client)
      }
      current.clients.clear()

      sessions.set(sessionName, rotated)

      if (current.agentType === 'codex') {
        void teardownCodexSessionRuntime(current, `Auto-rotated session "${sessionName}"`).catch(() => undefined)
      } else {
        current.process.kill('SIGTERM')
      }

      for (const preludeEvent of rotatedPreludeEvents) {
        broadcastStreamEvent(rotated, preludeEvent)
      }

      schedulePersistedSessionsWrite()
      if (getQueuedBacklogCount(rotated) > 0 && rotated.lastTurnCompleted && !rotated.currentQueuedMessage) {
        scheduleQueuedMessageDrain(rotated, { force: true })
      }
      return rotated
    } catch (error) {
      const live = sessions.get(sessionName)
      if (!live || live.kind !== 'stream') {
        return null
      }
      const message = error instanceof Error ? error.message : String(error)
      const failureEvent: StreamJsonEvent = {
        type: 'system',
        subtype: 'session_rotation_failed',
        reason: 'auto-entry-threshold',
        text: `Session auto-rotation failed: ${message}`,
      }
      appendStreamEvent(live, failureEvent)
      broadcastStreamEvent(live, failureEvent)
      schedulePersistedSessionsWrite()
      return live
    }
  }

  function scheduleAutoRotationIfNeeded(sessionName: string): void {
    const existing = autoRotationQueues.get(sessionName)
    if (existing) {
      return
    }

    const task = rotateStreamSessionIfNeeded(sessionName)
      .catch(() => null)
      .finally(() => {
        if (autoRotationQueues.get(sessionName) === task) {
          autoRotationQueues.delete(sessionName)
        }
        const live = sessions.get(sessionName)
        if (
          live &&
          live.kind === 'stream' &&
          live.autoRotatePending &&
          live.lastTurnCompleted &&
          !live.currentQueuedMessage &&
          !autoRotationQueues.has(sessionName)
        ) {
          scheduleAutoRotationIfNeeded(sessionName)
        }
      })

    autoRotationQueues.set(sessionName, task)
  }

  async function awaitAutoRotationIfNeeded(sessionName: string): Promise<StreamSession | null> {
    const existing = autoRotationQueues.get(sessionName)
    if (existing) {
      return existing
    }
    return rotateStreamSessionIfNeeded(sessionName)
  }

  function createStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType: AgentType = 'claude',
    options: StreamSessionCreateOptions = {},
  ): StreamSession {
    if (agentType !== 'claude') {
      throw new Error(`Unsupported stream agent type "${agentType}" in Claude session launcher`)
    }

    return createClaudeStreamSession(
      sessionName,
      mode,
      task,
      cwd,
      machine,
      options,
      {
        appendEvent: appendStreamEvent,
        broadcastEvent: broadcastStreamEvent,
        clearExitedSession: (name) => {
          exitedStreamSessions.delete(name)
        },
        deleteLiveSession: (name) => {
          sessions.delete(name)
          sessionEventHandlers.delete(name)
        },
        getActiveSession: (name) => sessions.get(name),
        resetActiveTurnState,
        schedulePersistedSessionsWrite,
        setCompletedSession: (name, session) => {
          completedSessions.set(name, session)
        },
        setExitedSession: (name, session) => {
          exitedStreamSessions.set(name, session)
        },
        internalToken,
        writeToStdin,
        writeTranscriptMeta,
      },
    )
  }

  // ── Codex Session Runtime ────────────────────────────────────────
  function listActiveCodexSessionNames(): string[] {
    return [...sessions.entries()]
      .filter(([, candidate]) => candidate.kind === 'stream' && candidate.agentType === 'codex')
      .map(([sessionName]) => sessionName)
  }

  const codexSessionDeps = {
    appendEvent: appendStreamEvent,
    broadcastEvent: broadcastStreamEvent,
    clearExitedSession: (name: string) => {
      exitedStreamSessions.delete(name)
    },
    clearTurnWatchdog: clearCodexTurnWatchdog,
    deleteLiveSession: (name: string) => {
      sessions.delete(name)
    },
    deleteSessionEventHandlers: (name: string) => {
      sessionEventHandlers.delete(name)
    },
    getActiveSession: (name: string) => sessions.get(name),
    getAllSessions: () => sessions.values(),
    notifyApprovalEnqueued: (session: StreamSession, pendingRequest: CodexPendingApprovalRequest) => {
      emitCodexApprovalQueueEvent({
        type: 'enqueued',
        approval: toPendingCodexApprovalView(session, pendingRequest),
      })
    },
    notifyApprovalResolved: (
      session: StreamSession,
      pendingRequest: CodexPendingApprovalRequest,
      decision: CodexApprovalDecision,
      delivered: boolean,
    ) => {
      emitCodexApprovalQueueEvent({
        type: 'resolved',
        approval: toPendingCodexApprovalView(session, pendingRequest),
        decision: decision === 'accept' ? 'approve' : 'reject',
        delivered,
      })
    },
    resetActiveTurnState,
    runtimeFactory: (
      sessionName: string,
      machine: MachineConfig | undefined,
      handleOwningSessionFailure: (failure: CodexRuntimeFailure) => void,
    ) => new CodexSessionRuntime(
      sessionName,
      machine,
      listActiveCodexSessionNames,
      wsKeepAliveIntervalMs,
      handleOwningSessionFailure,
    ),
    schedulePersistedSessionsWrite,
    scheduleTurnWatchdog: scheduleCodexTurnWatchdog,
    setCompletedSession: (name: string, session: CompletedSession) => {
      completedSessions.set(name, session)
    },
    setExitedSession: (name: string, session: ExitedStreamSessionState) => {
      exitedStreamSessions.set(name, session)
    },
    writeTranscriptMeta,
    getActionPolicyGate,
  }

  function applyCodexApprovalDecision(
    session: StreamSession,
    requestId: number,
    decision: CodexApprovalDecision,
  ): { ok: true } | {
    ok: false
    code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
    reason: string
  } {
    return applyCodexApprovalDecisionAdapter(session, requestId, decision, codexSessionDeps)
  }

  function buildCodexResultFromThreadSnapshot(
    status: string,
    turn: Record<string, unknown>,
    thread: Record<string, unknown>,
  ): StreamJsonEvent {
    const turnUsage = extractCodexUsageTotals(asObject(turn.tokenUsage) ?? asObject(turn.usage))
    const threadUsage = extractCodexUsageTotals(asObject(thread.tokenUsage) ?? asObject(thread.usage))
    const usage = turnUsage.usage ?? threadUsage.usage
    const totalCostUsd = turnUsage.totalCostUsd ?? threadUsage.totalCostUsd

    if (status === 'failed') {
      const error = asObject(turn.error)
      const message = typeof error?.message === 'string' && error.message.trim().length > 0
        ? error.message.trim()
        : 'Codex turn failed'
      return {
        type: 'result',
        subtype: 'failed',
        is_error: true,
        result: message,
        ...(usage ? { usage } : {}),
        ...(totalCostUsd !== undefined ? { total_cost_usd: totalCostUsd } : {}),
      }
    }

    if (status === 'interrupted') {
      return {
        type: 'result',
        subtype: 'interrupted',
        is_error: false,
        result: 'Turn interrupted',
        ...(usage ? { usage } : {}),
        ...(totalCostUsd !== undefined ? { total_cost_usd: totalCostUsd } : {}),
      }
    }

    return {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Turn completed',
      ...(usage ? { usage } : {}),
      ...(totalCostUsd !== undefined ? { total_cost_usd: totalCostUsd } : {}),
    }
  }

  async function handleCodexTurnWatchdogTimeout(session: StreamSession): Promise<void> {
    if (sessions.get(session.name) !== session) {
      return
    }
    if (session.lastTurnCompleted || !session.codexThreadId) {
      clearCodexTurnWatchdog(session)
      markCodexTurnHealthy(session)
      return
    }

    clearCodexTurnWatchdog(session)

    if (hasPendingCodexApprovals(session)) {
      session.codexRuntime?.log('info', 'Codex watchdog paused while waiting for approval decision', {
        sessionName: session.name,
        threadId: session.codexThreadId,
        pendingApprovals: session.codexPendingApprovals.size,
      })
      return
    }

    let resolved = false
    try {
      const runtime = session.codexRuntime
      if (!runtime) {
        return
      }
      const readResult = await runtime.sendRequest('thread/read', {
        threadId: session.codexThreadId,
        includeTurns: true,
      })

      if (sessions.get(session.name) !== session || session.lastTurnCompleted) {
        return
      }

      const resultObj = asObject(readResult)
      const thread = asObject(resultObj?.thread)
      const turns = Array.isArray(thread?.turns) ? thread.turns : []
      let latestTurn: Record<string, unknown> | null = null
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = asObject(turns[i])
        if (turn) {
          latestTurn = turn
          break
        }
      }

      const status = typeof latestTurn?.status === 'string'
        ? latestTurn.status.trim().toLowerCase()
        : ''

      if (latestTurn && thread && (status === 'completed' || status === 'failed' || status === 'interrupted')) {
        const syntheticResult = buildCodexResultFromThreadSnapshot(status, latestTurn, thread)
        appendStreamEvent(session, syntheticResult)
        broadcastStreamEvent(session, syntheticResult)
        schedulePersistedSessionsWrite()
        resolved = true
      }
    } catch (error) {
      session.codexRuntime?.log('warn', 'Codex watchdog thread/read reconciliation failed', {
        sessionName: session.name,
        threadId: session.codexThreadId,
        error: truncateLogText(error instanceof Error ? error.message : String(error)),
      })
    }

    if (resolved || sessions.get(session.name) !== session || session.lastTurnCompleted) {
      return
    }

    const timeoutSeconds = Math.max(1, Math.round(codexTurnWatchdogTimeoutMs / 1000))
    session.codexTurnStaleAt = new Date().toISOString()
    const lastIncomingMethod = session.codexLastIncomingMethod
    const lastIncomingAt = session.codexLastIncomingAt
    const unclassifiedIncomingCount = session.codexUnclassifiedIncomingCount
    const diagnosticDetails = [
      lastIncomingMethod ? `last sidecar method: ${lastIncomingMethod}` : 'no sidecar method observed yet',
      lastIncomingAt ? `last sidecar event at: ${lastIncomingAt}` : null,
      unclassifiedIncomingCount > 0
        ? `${unclassifiedIncomingCount} unclassified incoming approval request(s) declined this turn`
        : null,
    ].filter((value): value is string => value !== null).join('; ')
    const staleEvent: StreamJsonEvent = {
      type: 'system',
      text: `Codex turn is stale (no sidecar events for ${timeoutSeconds}s). Session remains recoverable via resume. Diagnostics: ${diagnosticDetails}.`,
    }
    appendStreamEvent(session, staleEvent)
    broadcastStreamEvent(session, staleEvent)
    schedulePersistedSessionsWrite()
    session.codexRuntime?.log('warn', 'Codex turn marked stale after watchdog timeout', {
      sessionName: session.name,
      threadId: session.codexThreadId,
      timeoutSeconds,
      lastIncomingMethod: lastIncomingMethod ?? null,
      lastIncomingAt: lastIncomingAt ?? null,
      unclassifiedIncomingCount,
    })
  }

  function scheduleCodexTurnWatchdog(session: StreamSession): void {
    if (session.agentType !== 'codex' || session.lastTurnCompleted) {
      clearCodexTurnWatchdog(session)
      return
    }
    clearCodexTurnWatchdog(session)
    markCodexTurnHealthy(session)
    session.codexTurnWatchdogTimer = setTimeout(() => {
      void handleCodexTurnWatchdogTimeout(session)
    }, codexTurnWatchdogTimeoutMs)
  }

  async function teardownCodexSessionRuntime(
    session: StreamSession,
    reason: string,
  ): Promise<void> {
    await teardownCodexSessionRuntimeAdapter(session, reason)
  }

  async function shutdownCodexRuntimes(reason = 'Hammurabi shutdown'): Promise<void> {
    await shutdownCodexRuntimesAdapter(codexSessionDeps, reason)
  }

  async function failCodexSession(
    sessionName: string,
    session: StreamSession,
    reason: string,
    exitCode = 1,
    signal?: string,
  ): Promise<void> {
    await failCodexSessionAdapter(sessionName, session, reason, codexSessionDeps, exitCode, signal)
  }

  async function teardownGeminiSessionRuntime(
    session: StreamSession,
    reason: string,
  ): Promise<void> {
    if (session.geminiRuntimeTeardownPromise) {
      await session.geminiRuntimeTeardownPromise
      return
    }

    const runtime = session.geminiRuntime
    if (!runtime) {
      try {
        session.process.kill('SIGTERM')
      } catch {
        // Best-effort cleanup only.
      }
      return
    }

    session.geminiNotificationCleanup?.()
    session.geminiNotificationCleanup = undefined

    const teardownPromise = runtime.teardown({
      reason,
      timeoutMs: CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS,
    })
    session.geminiRuntimeTeardownPromise = teardownPromise
    try {
      await teardownPromise
    } finally {
      session.geminiRuntimeTeardownPromise = undefined
      session.geminiNotificationCleanup = undefined
      session.geminiRuntime = undefined
    }
  }

  async function shutdownGeminiRuntimes(reason = 'Hammurabi shutdown'): Promise<void> {
    const geminiSessions = [...sessions.values()].filter((session): session is StreamSession =>
      session.kind === 'stream' && session.agentType === 'gemini'
    )

    await Promise.allSettled(geminiSessions.map(async (session) => {
      for (const client of session.clients) {
        client.close(1001, 'Server shutting down')
      }
      await teardownGeminiSessionRuntime(session, reason)
    }))
  }

  async function createGeminiAcpSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options: GeminiSessionCreateOptions = {},
  ): Promise<StreamSession> {
    return await createGeminiAcpSessionAdapter(
      sessionName,
      mode,
      task,
      cwd,
      options,
      {
        appendEvent: appendStreamEvent,
        broadcastEvent: broadcastStreamEvent,
        clearExitedSession: (name) => {
          exitedStreamSessions.delete(name)
        },
        deleteLiveSession: (name) => {
          sessions.delete(name)
        },
        deleteSessionEventHandlers: (name) => {
          sessionEventHandlers.delete(name)
        },
        getActiveSession: (name) => sessions.get(name),
        resetActiveTurnState,
        schedulePersistedSessionsWrite,
        setCompletedSession: (name, session) => {
          completedSessions.set(name, session)
        },
        setExitedSession: (name, session) => {
          exitedStreamSessions.set(name, session)
        },
        writeTranscriptMeta,
        getActionPolicyGate,
      },
    )
  }

  function getQueuedBacklogItems(session: StreamSession): QueuedMessage[] {
    const pendingDirectSendMessages = session.currentQueuedMessage
      ? session.pendingDirectSendMessages
      : session.pendingDirectSendMessages.slice(1)
    return [...pendingDirectSendMessages, ...session.messageQueue.list()]
  }

  function getCurrentQueueMessage(session: StreamSession): QueuedMessage | null {
    return session.currentQueuedMessage ?? session.pendingDirectSendMessages[0] ?? null
  }

  function getQueuedBacklogCount(session: StreamSession): number {
    return session.pendingDirectSendMessages.length + session.messageQueue.size
  }

  function replaceQueuedBacklog(
    session: StreamSession,
    messages: readonly QueuedMessage[],
    options?: { preservePendingCurrentDirectSend?: boolean },
  ): void {
    const preservedCurrentDirectSend = options?.preservePendingCurrentDirectSend && !session.currentQueuedMessage
      ? session.pendingDirectSendMessages[0]
      : undefined
    session.pendingDirectSendMessages = [
      ...(preservedCurrentDirectSend ? [preservedCurrentDirectSend] : []),
      ...messages.filter((message) => message.priority === 'high'),
    ]
    session.messageQueue = new SessionMessageQueue(
      DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT,
      messages.filter((message) => message.priority !== 'high'),
    )
  }

  function removePendingDirectSendById(
    session: StreamSession,
    messageId: string,
    options?: { includeCurrentSlot?: boolean },
  ): QueuedMessage | undefined {
    const startIndex = options?.includeCurrentSlot || session.currentQueuedMessage
      ? 0
      : 1
    const index = session.pendingDirectSendMessages.findIndex((message, candidateIndex) => {
      return candidateIndex >= startIndex && message.id === messageId
    })
    if (index === -1) {
      return undefined
    }

    const [removed] = session.pendingDirectSendMessages.splice(index, 1)
    return removed
  }

  function getQueuedMessageById(session: StreamSession, messageId: string): QueuedMessage | undefined {
    return session.pendingDirectSendMessages.find((message) => message.id === messageId)
      ?? session.messageQueue.list().find((message) => message.id === messageId)
  }

  function getQueueUpdatePayload(session: StreamSession): Extract<StreamJsonEvent, { type: 'queue_update' }> {
    const queuedBacklogItems = getQueuedBacklogItems(session)
    return {
      type: 'queue_update',
      queue: {
        items: queuedBacklogItems,
        currentMessage: getCurrentQueueMessage(session),
        maxSize: session.messageQueue.maxSize,
        totalCount: getQueuedBacklogCount(session),
      },
    }
  }

  function broadcastQueueUpdate(session: StreamSession): void {
    broadcastStreamEvent(session, getQueueUpdatePayload(session))
  }

  type StreamSendAttemptResult =
    | { ok: true }
    | { ok: false; retryable: boolean; reason: string }

  function clearQueuedMessageRetry(session: StreamSession): void {
    if (session.queuedMessageRetryTimer) {
      clearTimeout(session.queuedMessageRetryTimer)
      session.queuedMessageRetryTimer = undefined
    }
    session.queuedMessageRetryMessageId = undefined
  }

  function scheduleQueuedMessageDrain(session: StreamSession, options?: { force?: boolean }): void {
    if (session.queuedMessageDrainScheduled) {
      session.queuedMessageDrainPending = true
      if (options?.force) {
        session.queuedMessageDrainPendingForce = true
      }
      return
    }

    session.queuedMessageDrainScheduled = true
    queueMicrotask(() => {
      void drainQueuedMessages(session, options)
        .catch((error) => {
          console.warn(
            `[agents] Failed to drain queued messages for ${session.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
        .finally(() => {
          const pendingDrain = session.queuedMessageDrainPending
          const pendingForce = session.queuedMessageDrainPendingForce
          session.queuedMessageDrainScheduled = false
          session.queuedMessageDrainPending = false
          session.queuedMessageDrainPendingForce = false
          if (pendingDrain) {
            scheduleQueuedMessageDrain(session, pendingForce ? { force: true } : undefined)
          }
        })
    })
  }

  function isQueueBackpressureError(error: string): boolean {
    return error.startsWith('Queue is full')
  }

  function scheduleQueuedMessageRetry(session: StreamSession, messageId: string): void {
    clearQueuedMessageRetry(session)
    session.queuedMessageRetryMessageId = messageId
    const retryTarget = getQueuedMessageById(session, messageId)
    const keepHot = retryTarget?.priority === 'high'
    // Direct-send follow-ups keep a dedicated preemption slot.
    // Keep their retry cadence hot so the next turn starts almost immediately
    // after Codex stops rejecting turn/start as "already in progress".
    const delayMs = keepHot
      ? MESSAGE_QUEUE_RETRY_INITIAL_MS
      : (session.queuedMessageRetryDelayMs ?? MESSAGE_QUEUE_RETRY_INITIAL_MS)
    session.queuedMessageRetryTimer = setTimeout(() => {
      session.queuedMessageRetryTimer = undefined
      session.queuedMessageRetryMessageId = undefined
      scheduleQueuedMessageDrain(session, { force: true })
    }, delayMs)
    session.queuedMessageRetryDelayMs = keepHot
      ? MESSAGE_QUEUE_RETRY_INITIAL_MS
      : Math.min(delayMs * 2, MESSAGE_QUEUE_RETRY_MAX_MS)
  }

  function resetQueuedMessageRetryDelay(session: StreamSession): void {
    session.queuedMessageRetryDelayMs = MESSAGE_QUEUE_RETRY_INITIAL_MS
  }

  function createQueuedMessage(
    text: string,
    priority: QueuedMessagePriority,
    images?: QueuedMessageImage[],
  ): QueuedMessage {
    return {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      images: images && images.length > 0 ? [...images] : undefined,
      priority,
      queuedAt: new Date().toISOString(),
    }
  }

  function removeQueuedMessageById(session: StreamSession, messageId: string): QueuedMessage | undefined {
    return removePendingDirectSendById(session, messageId) ?? session.messageQueue.remove(messageId)
  }

  function reorderVisibleQueuedMessages(session: StreamSession, order: readonly string[]): boolean {
    const queuedBacklogItems = getQueuedBacklogItems(session)
    if (order.length !== queuedBacklogItems.length) {
      return false
    }

    const visibleById = new Map(queuedBacklogItems.map((message) => [message.id, message]))
    if (new Set(order).size !== order.length || order.some((id) => !visibleById.has(id))) {
      return false
    }

    const reorderedVisibleMessages = order.map((id) => visibleById.get(id)!)
    const preservesVisiblePriorityBands = reorderedVisibleMessages.every(
      (message, index) => message.priority === queuedBacklogItems[index]?.priority,
    )
    if (!preservesVisiblePriorityBands) {
      return false
    }

    replaceQueuedBacklog(session, reorderedVisibleMessages, { preservePendingCurrentDirectSend: true })
    return true
  }

  function clearVisibleQueuedMessages(session: StreamSession): void {
    if (getQueuedBacklogCount(session) === 0) {
      return
    }

    session.pendingDirectSendMessages = []
    session.messageQueue = new SessionMessageQueue(DEFAULT_SESSION_MESSAGE_QUEUE_LIMIT)
    clearQueuedMessageRetry(session)
    resetQueuedMessageRetryDelay(session)
  }

  function buildPromptContent(
    text: string,
    images?: QueuedMessageImage[],
  ): string | Array<
    { type: 'text'; text: string } |
    { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > {
    if (!images || images.length === 0) {
      return text
    }

    return [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((image) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mediaType,
          data: image.data,
        },
      })),
    ]
  }

  function buildUserEvent(
    text: string,
    images?: QueuedMessageImage[],
    subtype?: string,
  ): StreamJsonEvent {
    return {
      type: 'user',
      ...(subtype ? { subtype } : {}),
      message: { role: 'user', content: buildPromptContent(text, images) },
    } as unknown as StreamJsonEvent
  }

  async function attemptSendPromptToStreamSession(
    session: StreamSession,
    prompt: Pick<QueuedMessage, 'text' | 'images'>,
    options: { userEventSubtype?: string } = {},
  ): Promise<StreamSendAttemptResult> {
    const text = prompt.text
    const images = prompt.images ?? []

    if (session.adapter) {
      const result = await session.adapter.dispatchSend(
        session,
        text,
        'live',
        images,
        options,
      )
      if (!result.ok) {
        return result
      }
      return { ok: true }
    }

    const userEvent = buildUserEvent(text, images, options.userEventSubtype)
    const sent = writeToStdin(session, `${JSON.stringify(userEvent)}\n`)
    if (!sent) {
      if (session.stdinDraining) {
        return { ok: false, retryable: true, reason: 'Process stdin is busy' }
      }
      return { ok: false, retryable: false, reason: 'Stream session unavailable' }
    }

    resetActiveTurnState(session)
    appendStreamEvent(session, userEvent)
    broadcastStreamEvent(session, userEvent)
    return { ok: true }
  }

  async function sendTextToStreamSession(session: StreamSession, text: string): Promise<boolean> {
    const result = await attemptSendPromptToStreamSession(session, { text })
    return result.ok
  }

  async function queueTextToStreamSession(
    session: StreamSession,
    text: string,
    images?: QueuedMessageImage[],
  ): Promise<{ ok: true; message: QueuedMessage; position: number } | { ok: false; status: number; error: string }> {
    if (session.adapter) {
      const result = await session.adapter.dispatchSend(session, text, 'queue', images)
      if (!result.ok) {
        const status = isQueueBackpressureError(result.reason) ? 409 : 400
        return { ok: false, status, error: result.reason }
      }
      if (result.delivered !== 'queued') {
        return { ok: false, status: 503, error: 'Stream session unavailable' }
      }
      broadcastQueueUpdate(session)
      schedulePersistedSessionsWrite()
      return {
        ok: true,
        message: result.message,
        position: result.position,
      }
    }

    const message = createQueuedMessage(text, 'normal', images)
    const queued = enqueueQueuedMessage(session, message)
    if (!queued.ok) {
      return queued
    }
    return {
      ok: true,
      message,
      position: queued.position,
    }
  }

  function enqueueQueuedMessage(
    session: StreamSession,
    message: QueuedMessage,
  ): { ok: true; position: number } | { ok: false; status: number; error: string } {
    if (getQueuedBacklogCount(session) >= session.messageQueue.maxSize) {
      return { ok: false, status: 409, error: `Queue is full (max ${session.messageQueue.maxSize} messages)` }
    }

    try {
      session.messageQueue.enqueue(message)
      const position = getQueuedBacklogItems(session).findIndex((entry) => entry.id === message.id) + 1
      broadcastQueueUpdate(session)
      schedulePersistedSessionsWrite()
      return { ok: true, position }
    } catch (error) {
      if (error instanceof MessageQueueFullError) {
        return { ok: false, status: 409, error: error.message }
      }
      throw error
    }
  }

  async function drainQueuedMessages(
    session: StreamSession,
    options?: { force?: boolean },
  ): Promise<void> {
    if (sessions.get(session.name) !== session || session.currentQueuedMessage) {
      return
    }

    const liveSession = await awaitAutoRotationIfNeeded(session.name)
    if (!liveSession || liveSession.kind !== 'stream') {
      return
    }
    if (liveSession !== session) {
      scheduleQueuedMessageDrain(liveSession, options)
      return
    }

    const nextMessage = session.pendingDirectSendMessages[0] ?? session.messageQueue.peek()
    if (!nextMessage) {
      return
    }

    if (session.agentType === 'codex' && !session.lastTurnCompleted && nextMessage.priority === 'high') {
      return
    }

    if (!session.lastTurnCompleted && nextMessage.priority !== 'high' && !options?.force) {
      return
    }

    session.currentQueuedMessage = nextMessage
    broadcastQueueUpdate(session)
    schedulePersistedSessionsWrite()

    const result = await attemptSendPromptToStreamSession(session, nextMessage, {
      userEventSubtype: nextMessage.priority === 'normal' ? 'queued_message' : undefined,
    })
    if (!result.ok) {
      if (session.currentQueuedMessage?.id === nextMessage.id) {
        session.currentQueuedMessage = undefined
      }
      if (result.retryable) {
        broadcastQueueUpdate(session)
        schedulePersistedSessionsWrite()
        scheduleQueuedMessageRetry(session, nextMessage.id)
        return
      }

      const removed = removePendingDirectSendById(session, nextMessage.id, { includeCurrentSlot: true })
        ?? session.messageQueue.remove(nextMessage.id)
      if (removed && removed.priority !== 'low') {
        const errorEvent: StreamJsonEvent = {
          type: 'system',
          text: `Queued message failed: ${result.reason}`,
        }
        appendStreamEvent(session, errorEvent)
        broadcastStreamEvent(session, errorEvent)
      }
      broadcastQueueUpdate(session)
      schedulePersistedSessionsWrite()
      return
    }

    clearQueuedMessageRetry(session)
    resetQueuedMessageRetryDelay(session)
    removePendingDirectSendById(session, nextMessage.id, { includeCurrentSlot: true })
      ?? session.messageQueue.remove(nextMessage.id)
    broadcastQueueUpdate(session)
    schedulePersistedSessionsWrite()
  }

  async function sendImmediateTextToStreamSession(
    session: StreamSession,
    text: string,
  ): Promise<{ ok: true; queued: boolean; message: QueuedMessage } | { ok: false; error: string }> {
    const liveSession = await awaitAutoRotationIfNeeded(session.name)
    if (!liveSession || liveSession.kind !== 'stream') {
      return { ok: false, error: 'Stream session unavailable' }
    }

    const message = createQueuedMessage(text, 'high')

    if (
      liveSession.lastTurnCompleted &&
      !liveSession.currentQueuedMessage &&
      liveSession.pendingDirectSendMessages.length === 0
    ) {
      liveSession.currentQueuedMessage = message
      broadcastQueueUpdate(liveSession)
      schedulePersistedSessionsWrite()
      const result = await attemptSendPromptToStreamSession(liveSession, message)
      if (result.ok) {
        clearQueuedMessageRetry(liveSession)
        resetQueuedMessageRetryDelay(liveSession)
        return { ok: true, queued: false, message }
      }
      liveSession.currentQueuedMessage = undefined
      broadcastQueueUpdate(liveSession)
      schedulePersistedSessionsWrite()
      if (!result.retryable) {
        return { ok: false, error: result.reason }
      }
    }

    if (
      !liveSession.lastTurnCompleted &&
      (
        liveSession.pendingDirectSendMessages.length === 0
        || liveSession.agentType === 'codex'
      )
    ) {
      const result = await attemptSendPromptToStreamSession(liveSession, message)
      if (result.ok) {
        clearQueuedMessageRetry(liveSession)
        resetQueuedMessageRetryDelay(liveSession)
        return { ok: true, queued: false, message }
      }
      if (!result.retryable) {
        return { ok: false, error: result.reason }
      }
    }

    if (getQueuedBacklogCount(liveSession) >= liveSession.messageQueue.maxSize) {
      return { ok: false, error: `Queue is full (max ${liveSession.messageQueue.maxSize} messages)` }
    }

    liveSession.pendingDirectSendMessages.unshift(message)
    broadcastQueueUpdate(liveSession)
    schedulePersistedSessionsWrite()
    scheduleQueuedMessageDrain(
      liveSession,
      liveSession.lastTurnCompleted ? { force: true } : undefined,
    )
    return { ok: true, queued: true, message }
  }

  async function createCodexAppServerSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    options: CodexSessionCreateOptions = {},
  ): Promise<StreamSession> {
    return await createCodexAppServerSessionAdapter(
      sessionName,
      mode,
      task,
      cwd,
      options,
      codexSessionDeps,
    )
  }

  async function resumeCodexAppServerSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    cwd: string,
    threadId: string,
    createdAt: string,
    options: {
      resumedFrom?: string
      sessionType?: SessionType
      creator?: SessionCreator
      conversationId?: string
      currentSkillInvocation?: ActiveSkillInvocation
      machine?: MachineConfig
      spawnedBy?: string
      spawnedWorkers?: string[]
    } = {},
  ): Promise<StreamSession> {
    return createCodexAppServerSession(sessionName, mode, '', cwd, {
      resumeSessionId: threadId,
      createdAt,
      resumedFrom: options.resumedFrom,
      sessionType: options.sessionType,
      creator: options.creator,
      conversationId: options.conversationId,
      currentSkillInvocation: options.currentSkillInvocation,
      machine: options.machine,
      spawnedBy: options.spawnedBy,
      spawnedWorkers: options.spawnedWorkers,
    })
  }

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
        persistedState = await readPersistedSessionsState()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load persisted sessions'
        res.status(500).json({ error: message })
        return
      }

      const resolved = resolveResumableSessionSource(resumeFromSession, persistedState)
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

    const internalSessionRequest = isInternalSessionRequest(req)
    const defaultHumanCreator: SessionCreator = {
      kind: 'human',
      ...(sessionCreatorIdFromUser(req) ? { id: sessionCreatorIdFromUser(req) } : {}),
    }
    const creator = resumeSource?.source.creator ?? requestedCreator ?? defaultHumanCreator
    if (!internalSessionRequest && creator.kind !== 'human') {
      // Issue #1223: Point external callers at the canonical commander-worker
      // dispatch route that bakes commander identity from the URL instead of
      // accepting a self-claimed creator on the body. Falling back to a silent
      // human-creator default would hide the attribution intent and produce
      // workers that never appear on the dispatching commander's TEAM panel.
      const errorMessage = creator.kind === 'commander'
        ? 'creator: commander requires the canonical /api/commanders/:id/workers route, which provides URL-baked commander identity'
        : `Only internal callers can create ${creator.kind} session creators`
      res.status(403).json({ error: errorMessage })
      return
    }

    const rawRequestedSessionType = req.body?.sessionType
    const requestedSessionType = parseSessionType(rawRequestedSessionType)
    const legacyTransportAliasRequested = rawRequestedSessionType === 'stream' || rawRequestedSessionType === 'pty'
    if (requestedSessionType === null && !legacyTransportAliasRequested) {
      res.status(400).json({
        error: 'Invalid sessionType. Expected one of: commander, worker, cron, sentinel',
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

    const agentType = resumeSource?.source.agentType ?? parseAgentType(req.body?.agentType)
    const effort = agentType === 'claude'
      ? (resumeSource?.source.effort ?? parsedEffort ?? DEFAULT_CLAUDE_EFFORT_LEVEL)
      : undefined
    const adaptiveThinking = agentType === 'claude'
      ? (
        resumeSource?.source.adaptiveThinking
        ?? parsedAdaptiveThinking
        ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
      )
      : undefined
    const transportType: Exclude<SessionTransportType, 'external'> = resumeSource || agentType === 'gemini'
      ? 'stream'
      : parseSessionTransportType(req.body?.transportType ?? req.body?.sessionType)
    const requestedHost = resumeSource?.source.host ?? parseOptionalHost(req.body?.host)
    if (requestedHost === null) {
      res.status(400).json({ error: 'Invalid host: expected machine ID string' })
      return
    }

    let machine: MachineConfig | undefined
    if (requestedHost !== undefined) {
      try {
        const machines = await readMachineRegistry()
        machine = machines.find((entry) => entry.id === requestedHost)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read machines registry'
        res.status(500).json({ error: message })
        return
      }

      if (!machine) {
        res.status(400).json({ error: `Unknown host machine "${requestedHost}"` })
        return
      }
    }

    const requestedMachineCwd = cwd ?? machine?.cwd
    const sessionCwd = requestedMachineCwd ?? process.env.HOME ?? '/tmp'
    const remoteMachine = isRemoteMachine(machine) ? machine : undefined

    if (
      resumeSource &&
      !resumeSource.liveSession &&
      resumeSource.source.agentType === 'codex' &&
      resumeSource.source.codexThreadId &&
      !resumeSource.source.host &&
      !(await hasCodexRolloutFile(resumeSource.source.codexThreadId, resumeSource.source.createdAt))
    ) {
      clearCodexResumeMetadata(resumeFromSession!)
      res.status(409).json({
        error: codexRolloutUnavailableMessage(resumeFromSession!),
      })
      return
    }

    if (transportType === 'stream') {
      try {
        const session = resumeSource
          ? (
              agentType === 'codex'
              ? await createCodexAppServerSession(sessionName, mode, task ?? '', requestedMachineCwd, {
                  resumeSessionId: resumeSource.source.codexThreadId,
                  resumedFrom: resumeFromSession,
                  sessionType,
                  creator,
                  currentSkillInvocation: resumeSource.source.currentSkillInvocation,
                  spawnedBy: resumeSource.source.spawnedBy,
                  machine,
                })
                : agentType === 'gemini'
                  ? await createGeminiAcpSession(sessionName, mode, task ?? '', requestedMachineCwd, {
                    resumeSessionId: resumeSource.source.geminiSessionId,
                    resumedFrom: resumeFromSession,
                    sessionType,
                    creator,
                    currentSkillInvocation: resumeSource.source.currentSkillInvocation,
                    spawnedBy: resumeSource.source.spawnedBy,
                    machine,
                  })
                  : createStreamSession(sessionName, mode, task ?? '', requestedMachineCwd, machine, agentType, {
                    effort,
                    adaptiveThinking,
                    resumeSessionId: resumeSource.source.claudeSessionId,
                    resumedFrom: resumeFromSession,
                    sessionType,
                    creator,
                    currentSkillInvocation: resumeSource.source.currentSkillInvocation,
                    spawnedBy: resumeSource.source.spawnedBy,
                  })
            )
          : (
              agentType === 'codex'
                ? await createCodexAppServerSession(sessionName, mode, task ?? '', requestedMachineCwd, {
                  sessionType,
                  creator,
                  currentSkillInvocation: requestedCurrentSkillInvocation,
                  machine,
                  model,
                })
                : agentType === 'gemini'
                  ? await createGeminiAcpSession(sessionName, mode, task ?? '', requestedMachineCwd, {
                  sessionType,
                  creator,
                  currentSkillInvocation: requestedCurrentSkillInvocation,
                  machine,
                  })
                : createStreamSession(sessionName, mode, task ?? '', requestedMachineCwd, machine, agentType, {
                  effort,
                  adaptiveThinking,
                  model,
                  sessionType,
                  creator,
                  currentSkillInvocation: requestedCurrentSkillInvocation,
                })
            )
        if (resumeSource?.liveSession) {
          retireLiveCodexSessionForResume(resumeFromSession!, resumeSource.liveSession)
        }
        sessions.set(sessionName, session)
        schedulePersistedSessionsWrite()
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
          clearCodexResumeMetadata(resumeFromSession)
          res.status(409).json({
            error: codexRolloutUnavailableMessage(resumeFromSession),
          })
          return
        }
        const message = err instanceof Error ? err.message : 'Failed to create stream session'
        res.status(500).json({ error: message })
      }
      return
    }

    // PTY session (default)
    try {
      const claudeEffort = effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      const ptySpawner = await getSpawner()
      const localSpawnCwd = process.env.HOME || '/tmp'
      const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
      // Use the remote user's default login shell (e.g. zsh on macOS) instead
      // of hardcoding bash, so that shell profile (PATH, etc.) is loaded correctly.
      const remoteShellCommand = buildLoginShellCommand(
        'exec "${SHELL:-/bin/bash}" -l',
        requestedMachineCwd,
        remoteMachine ? preparedLaunch.sourcedEnvFile : undefined,
      )
      const remoteApprovalBridge = remoteMachine && agentType === 'claude'
        ? {
            port: resolveClaudeApprovalPort(process.env),
            internalToken,
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
      const ptyEnv = agentType === 'claude'
        ? {
            ...preparedLaunch.env,
            HAMMURABI_PORT: resolveClaudeApprovalPort(process.env),
            ...(internalToken ? { HAMMURABI_INTERNAL_TOKEN: internalToken } : {}),
          }
        : preparedLaunch.env
      const pty = ptySpawner.spawn(ptyCommand, ptyArgs, {
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
        effort: agentType === 'claude' ? claudeEffort : undefined,
        adaptiveThinking: agentType === 'claude' ? adaptiveThinking : undefined,
        cwd: sessionCwd,
        host: remoteMachine?.id,
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
        schedulePersistedSessionsWrite()
      })

      sessions.set(sessionName, session)

      const command = agentType === 'codex'
        ? CODEX_MODE_COMMANDS[mode]
        : buildClaudePtyCommand(
          mode,
          claudeEffort,
          adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
        )
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

  /**
   * Dispatch a worker session attributed to a commander whose identity is
   * baked into the URL by the caller (typically the commanders router's
   * `POST /api/commanders/:id/workers` route, which authenticates with the
   * `agents:write` + `commanders:write` scope pair). Returns a discriminated
   * `{ status, body }` so the commanders router can forward the response
   * unchanged without coupling URL/auth concerns to session-spawn details.
   *
   * Issue #1223: this is the canonical external dispatch path for commander
   * attribution. Any external caller that tries to set `creator: commander`
   * on `POST /api/agents/sessions` is rejected with 403 and pointed at this
   * route; the URL-baked design prevents callers from self-claiming
   * commander attribution they have not been authorized for.
   */
  async function dispatchWorkerForCommander({
    commanderId,
    rawBody,
  }: {
    commanderId: string
    rawBody: unknown
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {}

    // Reject self-claimed creator: identity is baked from the URL on this
    // route. Per #1223's "no silent drop" constraint, treat KEY PRESENCE as
    // invalid regardless of value — `{ creator: null }` and `{ creator: "" }`
    // are treated the same as `{ creator: { kind: "...", id: "..." } }` so
    // client integration mistakes surface as 400s instead of being silently
    // overridden by the URL identity.
    if (Object.prototype.hasOwnProperty.call(body, 'creator')) {
      return {
        status: 400,
        body: {
          error: 'creator must not be provided on /api/commanders/:id/workers — commander identity is baked from the URL',
        },
      }
    }

    // Same key-presence rule for parentSession. Worker→commander attribution
    // is carried by `creator`, not `parentSession`; permitting any
    // `parentSession` value here would erode the explicit-fields invariant
    // even if the value is empty.
    if (Object.prototype.hasOwnProperty.call(body, 'parentSession')) {
      return {
        status: 400,
        body: {
          error: 'parentSession is not honored on this route. Commander attribution is carried by creator (URL-baked); parentSession is not a substitute.',
        },
      }
    }

    // Force sessionType to "worker" — a 4xx surfaces any caller intent that
    // would otherwise be silently rewritten.
    const rawSessionType = body.sessionType
    if (
      rawSessionType !== undefined
      && rawSessionType !== null
      && rawSessionType !== ''
      && rawSessionType !== 'worker'
    ) {
      return {
        status: 400,
        body: {
          error: `sessionType must be "worker" on /api/commanders/:id/workers (received "${String(rawSessionType)}")`,
        },
      }
    }

    const sessionName = parseSessionName(body.name)
    if (!sessionName) {
      return { status: 400, body: { error: 'Invalid session name' } }
    }

    const mode: ClaudePermissionMode = 'default'

    const parsedEffort = parseClaudeEffort(body.effort)
    if (parsedEffort === null) {
      return {
        status: 400,
        body: { error: 'Invalid effort. Expected one of: low, medium, high, max' },
      }
    }

    const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(body.adaptiveThinking)
    if (parsedAdaptiveThinking === null) {
      return {
        status: 400,
        body: { error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' },
      }
    }

    const task = parseOptionalTask(body.task)
    if (task === null) {
      return { status: 400, body: { error: 'Task must be a string' } }
    }

    const model = parseOptionalModel(body.model)
    if (model === null) {
      return { status: 400, body: { error: 'model must be a string when provided' } }
    }

    const requestedCurrentSkillInvocation = parseActiveSkillInvocation(body.currentSkillInvocation)
    if (requestedCurrentSkillInvocation === null) {
      return {
        status: 400,
        body: {
          error: 'Invalid currentSkillInvocation. Expected { skillId, displayName, startedAt, toolUseId? }',
        },
      }
    }

    if (sessions.has(sessionName)) {
      return { status: 409, body: { error: `Session "${sessionName}" already exists` } }
    }

    if (sessions.size >= maxSessions) {
      return { status: 429, body: { error: `Session limit reached (${maxSessions})` } }
    }

    const cwdParsed = parseCwd(body.cwd)
    if (cwdParsed === null) {
      return { status: 400, body: { error: 'Invalid cwd: must be an absolute path' } }
    }

    const agentType = parseAgentType(body.agentType)
    const effort = agentType === 'claude'
      ? (parsedEffort ?? DEFAULT_CLAUDE_EFFORT_LEVEL)
      : undefined
    const adaptiveThinking = agentType === 'claude'
      ? (parsedAdaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE)
      : undefined

    const requestedHost = parseOptionalHost(body.host)
    if (requestedHost === null) {
      return { status: 400, body: { error: 'Invalid host: expected machine ID string' } }
    }

    let machine: MachineConfig | undefined
    if (requestedHost !== undefined) {
      let machines: MachineConfig[]
      try {
        machines = await readMachineRegistry()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read machines registry'
        return { status: 500, body: { error: message } }
      }
      machine = machines.find((entry) => entry.id === requestedHost)
      if (!machine) {
        return {
          status: 400,
          body: { error: `Unknown host machine "${requestedHost}"` },
        }
      }
    }

    const requestedMachineCwd = cwdParsed ?? machine?.cwd

    const creator: SessionCreator = { kind: 'commander', id: commanderId }
    const sessionType: SessionType = 'worker'

    try {
      const session = agentType === 'codex'
        ? await createCodexAppServerSession(sessionName, mode, task ?? '', requestedMachineCwd, {
            sessionType,
            creator,
            currentSkillInvocation: requestedCurrentSkillInvocation,
            machine,
            model,
          })
        : agentType === 'gemini'
          ? await createGeminiAcpSession(sessionName, mode, task ?? '', requestedMachineCwd, {
              sessionType,
              creator,
              currentSkillInvocation: requestedCurrentSkillInvocation,
              machine,
            })
          : createStreamSession(sessionName, mode, task ?? '', requestedMachineCwd, machine, agentType, {
              effort,
              adaptiveThinking,
              model,
              sessionType,
              creator,
              currentSkillInvocation: requestedCurrentSkillInvocation,
            })

      sessions.set(sessionName, session)
      schedulePersistedSessionsWrite()

      return {
        status: 201,
        body: {
          sessionName,
          mode,
          sessionType: session.sessionType,
          creator: session.creator,
          transportType: 'stream',
          agentType,
          host: session.host,
          created: true,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create stream session'
      return { status: 500, body: { error: message } }
    }
  }

async function isExitedSessionResumeAvailable(entry: PersistedStreamSession): Promise<boolean> {
  if (!hasResumeIdentifier(entry)) {
    return false
  }

  if (entry.agentType !== 'codex' || !entry.codexThreadId || entry.host) {
    return true
  }

  return hasCodexRolloutFile(entry.codexThreadId, entry.createdAt)
}

async function isLiveSessionResumeAvailable(session: StreamSession): Promise<boolean> {
  if (session.agentType === 'claude') {
    return Boolean(session.claudeSessionId)
  }
  if (session.agentType === 'gemini') {
    return Boolean(session.geminiSessionId)
  }
  if (!session.codexThreadId) {
    return false
  }
  if (session.host) {
    return true
  }
  return hasCodexRolloutFile(session.codexThreadId, session.createdAt)
}

  function clearCodexResumeMetadata(sessionName: string): void {
    clearCodexResumeMetadataForStore(
      sessionName,
      sessions,
      exitedStreamSessions,
      schedulePersistedSessionsWrite,
    )
  }

  function retireLiveCodexSessionForResume(sessionName: string, session: StreamSession): void {
    retireLiveCodexSessionForResumeForStore(
      sessionName,
      session,
      exitedStreamSessions,
      sessions,
      sessionEventHandlers,
      clearCodexTurnWatchdog,
      markCodexTurnHealthy,
    )
  }

  function resolveResumableSessionSource(
    sessionName: string,
    persistedState: PersistedSessionsState,
  ): { source?: ResolvedResumableSessionSource; error?: { status: number; message: string } } {
    const liveSession = sessions.get(sessionName)
    if (liveSession) {
      if (liveSession.kind !== 'stream') {
        return {
          error: { status: 404, message: `Session "${sessionName}" is not resumable` },
        }
      }
      if (!canResumeLiveStreamSession(liveSession)) {
        return {
          error: { status: 409, message: `Session "${sessionName}" is not resumable right now` },
        }
      }
      return {
        source: {
          source: buildPersistedEntryFromLiveStreamSession(sessionName, liveSession),
          liveSession,
        },
      }
    }

    const exitedSession = exitedStreamSessions.get(sessionName)
    const persistedSource = persistedState.sessions.find((entry) => entry.name === sessionName)
    let source = exitedSession ? buildPersistedEntryFromExitedSession(sessionName, exitedSession) : undefined
    if ((!source || !hasResumeIdentifier(source)) && persistedSource) {
      source = persistedSource
    }

    if (!source) {
      return {
        error: { status: 404, message: `Session "${sessionName}" not found` },
      }
    }

    if (!hasResumeIdentifier(source)) {
      return {
        error: { status: 409, message: `Session "${sessionName}" is missing resume metadata` },
      }
    }

    return { source: { source } }
  }

  const { handleUpgrade } = createAgentsWebSocket({
    sessions,
    verifyWsAuth,
    wsKeepAliveIntervalMs,
    getQueueUpdatePayload,
    broadcastStreamEvent,
    sendImmediateTextToStreamSession,
    writeToStdin,
    appendStreamEvent,
    readMachineRegistry,
    createStreamSession,
    schedulePersistedSessionsWrite,
  })

  const baseSessionsInterface = createCommanderSessionsInterface({
    sessions,
    sessionEventHandlers,
    schedulePersistedSessionsWrite,
    createCodexAppServerSession,
    createGeminiAcpSession,
    createStreamSession,
    createQueuedMessage,
    enqueueQueuedMessage,
    scheduleQueuedMessageDrain,
    sendImmediateTextToStreamSession,
    teardownCodexSessionRuntime,
    teardownGeminiSessionRuntime,
    shutdownCodexRuntimes,
    shutdownGeminiRuntimes,
  })

  // Compose the worker-dispatch closure onto the commander interface so the
  // commanders router can attribute externally dispatched workers to a
  // commander without re-implementing session-spawn logic. See issue #1223.
  const sessionsInterface = {
    ...baseSessionsInterface,
    dispatchWorkerForCommander,
  }

  const approvalSessionsInterface = createApprovalSessionsInterface({
    sessions,
    codexApprovalQueueSubscribers,
    getApprovalCommanderScopeId,
    toPendingCodexApprovalView,
    applyCodexApprovalDecision,
  })

  const shutdownSessionsInterface = {
    ...sessionsInterface,
    async shutdown() {
      clearSessionPrunerTimer()
      if (sessionPrunerTimer) {
        process.off('SIGTERM', handleSessionPrunerSigterm)
      }
      await sessionsInterface.shutdown?.()
    },
  }

  return { router, handleUpgrade, sessionsInterface: shutdownSessionsInterface, approvalSessionsInterface }
}
