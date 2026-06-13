import { spawn } from 'node:child_process'
import type { ActionPolicyGate } from '../../policies/action-policy-gate.js'
import type { QuestStore } from '../../commanders/quest-store.js'
import { truncateLogText } from './helpers.js'
import {
  clearCodexTurnWatchdog,
  extractCodexUsageTotals,
  hasPendingCodexApprovals,
  markCodexTurnHealthy,
} from '../adapters/codex/helpers.js'
import {
  applyCodexApprovalDecision as applyCodexApprovalDecisionAdapter,
} from '../adapters/codex/index.js'
import { CodexSessionRuntime, GeminiAcpRuntime, OpenCodeAcpRuntime } from '../launchers/runtimes.js'
import {
  prepareProviderSpawnAuth,
  ProviderAuthRequiredError,
  resolveProviderAuthScopeId,
  type ProviderAuthStore,
  type ProviderAuthSnapshot,
  type ProviderSpawnAuth,
} from '../provider-auth.js'
import {
  readCodexRuntime,
  readCodexThreadId,
} from '../providers/provider-session-context.js'
import {
  getProvider,
  listProviders,
} from '../providers/registry.js'
import type {
  ProviderAdapterDeps,
  ProviderCreateOptions,
} from '../providers/provider-adapter.js'
import { asObject } from './state.js'
import type { MachineDaemonRegistry } from '../daemon/registry.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  CodexApprovalDecision,
  CodexPendingApprovalRequest,
  CodexRuntimeFailure,
  CompletedSession,
  ExitedStreamSessionState,
  MachineConfig,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'

type ProviderStreamSessionOptions = Omit<
  ProviderCreateOptions,
  'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'
>

interface ProviderRuntimeApprovalQueue {
  notifyApprovalEnqueued(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
  ): void
  notifyApprovalResolved(
    session: StreamSession,
    pendingRequest: CodexPendingApprovalRequest,
    decision: CodexApprovalDecision,
    delivered: boolean,
  ): void
}

interface ProviderSessionRuntimeDeps {
  sessions: Map<string, AnySession>
  completedSessions: Map<string, CompletedSession>
  exitedStreamSessions: Map<string, ExitedStreamSessionState>
  sessionEventHandlers: Map<string, Set<(event: StreamJsonEvent) => void>>
  providerAuthStore: ProviderAuthStore
  questStore?: QuestStore
  daemonRegistry: MachineDaemonRegistry
  approvalQueue: ProviderRuntimeApprovalQueue
  wsKeepAliveIntervalMs: number
  codexTurnWatchdogTimeoutMs: number
  internalToken?: string
  getActionPolicyGate?: () => ActionPolicyGate | null
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  resetActiveTurnState(session: StreamSession): void
  schedulePersistedSessionsWrite(): void
  writeToStdin(session: StreamSession, data: string): boolean
  writeTranscriptMeta(session: StreamSession): void
  markProviderAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<ProviderAuthSnapshot>
}

export interface ProviderSessionRuntime {
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: AgentType,
    sessionOptions?: ProviderStreamSessionOptions,
  ): Promise<StreamSession>
  restoreProviderStreamSession(
    entry: PersistedStreamSession,
    machine: MachineConfig | undefined,
  ): Promise<StreamSession>
  teardownProviderSession(session: StreamSession, reason: string): Promise<void>
  shutdownProviderRuntimes(reason?: string): Promise<void>
  applyCodexApprovalDecision(
    session: StreamSession,
    requestId: number,
    decision: CodexApprovalDecision,
  ): { ok: true } | {
    ok: false
    code: 'invalid_session' | 'unavailable' | 'not_found' | 'protocol_error'
    reason: string
  }
  scheduleCodexTurnWatchdog(session: StreamSession): void
}

export function createProviderSessionRuntime(
  deps: ProviderSessionRuntimeDeps,
): ProviderSessionRuntime {
  function listActiveCodexSessionNames(): string[] {
    return [...deps.sessions.entries()]
      .filter(([, candidate]) => (
        candidate.kind === 'stream'
        && getProvider(candidate.agentType)?.id === 'codex'
      ))
      .map(([sessionName]) => sessionName)
  }

  const providerSessionBaseDeps = {
    appendEvent: deps.appendStreamEvent,
    broadcastEvent: deps.broadcastStreamEvent,
    clearExitedSession: (name: string) => {
      deps.exitedStreamSessions.delete(name)
    },
    deleteLiveSession: (name: string) => {
      deps.sessions.delete(name)
    },
    deleteSessionEventHandlers: (name: string) => {
      deps.sessionEventHandlers.delete(name)
    },
    getActiveSession: (name: string) => deps.sessions.get(name),
    resetActiveTurnState: deps.resetActiveTurnState,
    schedulePersistedSessionsWrite: deps.schedulePersistedSessionsWrite,
    setCompletedSession: (name: string, session: CompletedSession) => {
      deps.completedSessions.set(name, session)
    },
    setExitedSession: (name: string, session: ExitedStreamSessionState) => {
      deps.exitedStreamSessions.set(name, session)
    },
    spawnImpl: spawn,
    daemonRegistry: deps.daemonRegistry,
    internalToken: deps.internalToken,
    writeToStdin: deps.writeToStdin,
    writeTranscriptMeta: deps.writeTranscriptMeta,
    getActionPolicyGate: deps.getActionPolicyGate,
    markProviderAuthRequired: deps.markProviderAuthRequired,
  }

  function getProviderSessionDeps(agentType: AgentType): ProviderAdapterDeps {
    const providerId = getProvider(agentType)?.id
    if (providerId === 'codex') {
      return {
        ...providerSessionBaseDeps,
        clearTurnWatchdog: clearCodexTurnWatchdog,
        getAllSessions: () => deps.sessions.values(),
        notifyApprovalEnqueued: deps.approvalQueue.notifyApprovalEnqueued,
        notifyApprovalResolved: deps.approvalQueue.notifyApprovalResolved,
        runtimeFactory: (
          sessionName: string,
          machine: MachineConfig | undefined,
          handleOwningSessionFailure: (failure: CodexRuntimeFailure) => void,
          providerAuth?: ProviderSpawnAuth,
        ) => new CodexSessionRuntime(
          sessionName,
          machine,
          listActiveCodexSessionNames,
          deps.wsKeepAliveIntervalMs,
          handleOwningSessionFailure,
          spawn,
          deps.daemonRegistry,
          providerAuth,
        ),
        scheduleTurnWatchdog: scheduleCodexTurnWatchdog,
      } as unknown as ProviderAdapterDeps
    }

    if (providerId === 'gemini') {
      return {
        ...providerSessionBaseDeps,
        runtimeFactory: (
          sessionName: string,
          machine?: MachineConfig,
          model?: string,
          providerAuth?: ProviderSpawnAuth,
        ) =>
          new GeminiAcpRuntime(sessionName, machine, model, deps.daemonRegistry, providerAuth),
      } as unknown as ProviderAdapterDeps
    }

    if (providerId === 'opencode') {
      return {
        ...providerSessionBaseDeps,
        runtimeFactory: (
          sessionName: string,
          machine?: MachineConfig,
          model?: string,
          providerAuth?: ProviderSpawnAuth,
        ) =>
          new OpenCodeAcpRuntime(sessionName, machine, model, deps.daemonRegistry, providerAuth),
      } as unknown as ProviderAdapterDeps
    }

    return providerSessionBaseDeps as unknown as ProviderAdapterDeps
  }

  async function createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType: AgentType = 'claude',
    sessionOptions: ProviderStreamSessionOptions = {},
  ): Promise<StreamSession> {
    const provider = getProvider(agentType)
    if (!provider) {
      throw new Error(`Unknown provider: ${agentType}`)
    }

    let providerAuth
    try {
      providerAuth = await prepareProviderSpawnAuth({
        provider: agentType,
        scopeId: resolveProviderAuthScopeId(sessionOptions.creator),
        machine,
        store: deps.providerAuthStore,
        env: process.env,
      })
    } catch (error) {
      if (
        error instanceof ProviderAuthRequiredError
        && sessionOptions.creator?.kind === 'commander'
        && sessionOptions.creator.id
      ) {
        await deps.questStore?.blockActiveForAuthRequired(sessionOptions.creator.id, error.message)
      }
      throw error
    }

    return await provider.create({
      sessionName,
      mode,
      task,
      cwd,
      machine,
      ...sessionOptions,
      providerAuth,
    }, getProviderSessionDeps(agentType))
  }

  async function restoreProviderStreamSession(
    entry: PersistedStreamSession,
    machine: MachineConfig | undefined,
  ): Promise<StreamSession> {
    const provider = getProvider(entry.agentType)
    if (!provider) {
      throw new Error(`Unknown provider: ${entry.agentType}`)
    }
    return await provider.restore(entry, machine, getProviderSessionDeps(entry.agentType))
  }

  async function teardownProviderSession(
    session: StreamSession,
    reason: string,
  ): Promise<void> {
    const provider = getProvider(session.agentType)
    if (!provider) {
      return
    }
    await provider.teardown(session, reason)
  }

  async function shutdownProviderRuntimes(reason = 'Hervald shutdown'): Promise<void> {
    await Promise.allSettled(
      listProviders().map(async (provider) => {
        const providerSessions = [...deps.sessions.values()].filter((session): session is StreamSession => (
          session.kind === 'stream' && session.agentType === provider.id
        ))
        if (provider.shutdownFleet) {
          await provider.shutdownFleet(providerSessions, reason)
          return
        }
        // Preserve resumable live-session snapshots on server shutdown for
        // providers that do not own a fleet-level runtime hook.
        for (const session of providerSessions) {
          for (const client of session.clients) {
            client.close(1001, 'Server shutting down')
          }
        }
      }),
    )
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
    return applyCodexApprovalDecisionAdapter(
      session,
      requestId,
      decision,
      getProviderSessionDeps('codex') as Parameters<typeof applyCodexApprovalDecisionAdapter>[3],
    )
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
    if (deps.sessions.get(session.name) !== session) {
      return
    }
    const threadId = readCodexThreadId(session)
    if (session.lastTurnCompleted || !threadId) {
      clearCodexTurnWatchdog(session)
      markCodexTurnHealthy(session)
      return
    }

    clearCodexTurnWatchdog(session)

    if (hasPendingCodexApprovals(session)) {
      readCodexRuntime(session)?.log('info', 'Codex watchdog paused while waiting for approval decision', {
        sessionName: session.name,
        threadId,
        pendingApprovals: session.codexPendingApprovals.size,
      })
      return
    }

    let resolved = false
    try {
      const runtime = readCodexRuntime(session)
      if (!runtime) {
        return
      }
      const runtimeThreadId = readCodexThreadId(session)
      if (!runtimeThreadId) {
        return
      }
      const readResult = await runtime.sendRequest('thread/read', {
        threadId: runtimeThreadId,
        includeTurns: true,
      })

      if (deps.sessions.get(session.name) !== session || session.lastTurnCompleted) {
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
        deps.appendStreamEvent(session, syntheticResult)
        deps.broadcastStreamEvent(session, syntheticResult)
        deps.schedulePersistedSessionsWrite()
        resolved = true
      }
    } catch (error) {
      readCodexRuntime(session)?.log('warn', 'Codex watchdog thread/read reconciliation failed', {
        sessionName: session.name,
        threadId: readCodexThreadId(session),
        error: truncateLogText(error instanceof Error ? error.message : String(error)),
      })
    }

    if (resolved || deps.sessions.get(session.name) !== session || session.lastTurnCompleted) {
      return
    }

    const timeoutSeconds = Math.max(1, Math.round(deps.codexTurnWatchdogTimeoutMs / 1000))
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
    deps.appendStreamEvent(session, staleEvent)
    deps.broadcastStreamEvent(session, staleEvent)
    deps.schedulePersistedSessionsWrite()
    readCodexRuntime(session)?.log('warn', 'Codex turn marked stale after watchdog timeout', {
      sessionName: session.name,
      threadId: readCodexThreadId(session),
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
    }, deps.codexTurnWatchdogTimeoutMs)
  }

  return {
    createProviderStreamSession,
    restoreProviderStreamSession,
    teardownProviderSession,
    shutdownProviderRuntimes,
    applyCodexApprovalDecision,
    scheduleCodexTurnWatchdog,
  }
}
