import type { ProviderCreateOptions } from '../providers/provider-adapter.js'
import {
  COMMANDER_WORKER_LAUNCH_BODY_KEYS,
  launchProviderWorkerSession,
  parseWorkerLaunchRequest,
} from '../worker-launch.js'
import type {
  AgentType,
  AnySession,
  ClaudePermissionMode,
  MachineConfig,
  StreamSession,
} from '../types.js'

type ProviderStreamSessionOptions = Omit<
  ProviderCreateOptions,
  'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'
>

interface CommanderWorkerDispatcherDeps {
  maxSessions: number
  sessions: Map<string, AnySession>
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
  teardownProviderSession(session: StreamSession, reason: string): Promise<void>
  schedulePersistedSessionsWrite(): void
}

export function createCommanderWorkerDispatcher(deps: CommanderWorkerDispatcherDeps) {
  return async function dispatchWorkerForCommander({
    commanderId,
    abortSignal,
    rawBody,
  }: {
    commanderId: string
    abortSignal?: AbortSignal
    rawBody: unknown
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const parsed = parseWorkerLaunchRequest({
      allowedBodyKeys: COMMANDER_WORKER_LAUNCH_BODY_KEYS,
      creator: { kind: 'commander', id: commanderId },
      currentSkillInvocationNull: 'invalid',
      fallbackCwd: process.env.HOME ?? '/tmp',
      rawBody,
      requireName: true,
      routeLabel: '/api/commanders/:id/workers',
      unknownKeyStyle: 'quoted',
    })
    if (!parsed.ok) {
      return { status: parsed.status, body: parsed.body }
    }

    const launched = await launchProviderWorkerSession(
      {
        createProviderStreamSession: deps.createProviderStreamSession,
        maxSessions: deps.maxSessions,
        resolveDaemonLaunchReadiness: deps.resolveDaemonLaunchReadiness,
        resolveMachine: deps.resolveLaunchMachine,
        schedulePersistedSessionsWrite: deps.schedulePersistedSessionsWrite,
        sessions: deps.sessions,
        teardownProviderSession: deps.teardownProviderSession,
      },
      parsed.request,
      {
        abortSignal,
        missingCwdError: 'Provide cwd or host when dispatching a commander worker',
      },
    )
    if (!launched.ok) {
      return { status: launched.status, body: launched.body }
    }

    return {
      status: 201,
      body: {
        sessionName: parsed.request.sessionName,
        mode: parsed.request.mode,
        sessionType: launched.session.sessionType,
        creator: launched.session.creator,
        transportType: 'stream',
        agentType: parsed.request.agentType,
        host: launched.session.host,
        created: true,
      },
    }
  }
}
