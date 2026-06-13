import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../claude-effort.js'
import {
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  type ClaudeMaxThinkingTokens,
} from '../claude-max-thinking-tokens.js'
import {
  parseActiveSkillInvocation,
  parseClaudeAdaptiveThinking,
  parseClaudeEffort,
  parseClaudeMaxThinkingTokens,
  parseCwd,
  parseOptionalHost,
  parseOptionalModel,
  parseOptionalTask,
  parseSessionName,
  parseSessionType,
} from './session/input.js'
import { ProviderAuthRequiredError } from './provider-auth.js'
import {
  resolveProviderDefaults,
  type ProviderCreateOptions,
} from './providers/provider-adapter.js'
import { getProvider, parseProviderId } from './providers/registry.js'
import { validateModelForAgentType } from './providers/validate-model.js'
import type {
  ActiveSkillInvocation,
  AgentType,
  AnySession,
  ClaudePermissionMode,
  MachineConfig,
  SessionCreator,
  StreamSession,
} from './types.js'

type WorkerLaunchBody = Record<string, unknown>

export const COMMANDER_WORKER_LAUNCH_BODY_KEYS = new Set([
  'adaptiveThinking',
  'agentType',
  'currentSkillInvocation',
  'cwd',
  'effort',
  'host',
  'maxThinkingTokens',
  'model',
  'name',
  'sessionType',
  'task',
])

export const LEGACY_DISPATCH_WORKER_BODY_KEYS = new Set([
  'agentType',
  'currentSkillInvocation',
  'cwd',
  'host',
  'spawnedBy',
  'task',
])

interface WorkerLaunchSourceDefaults {
  agentType?: AgentType
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  currentSkillInvocation?: ActiveSkillInvocation
  cwd?: string
  effort?: ClaudeEffortLevel
  host?: string
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  mode?: ClaudePermissionMode
  model?: string
}

interface ParseWorkerLaunchRequestOptions {
  allowedBodyKeys: ReadonlySet<string>
  creator: SessionCreator
  currentSkillInvocationNull: 'clear' | 'invalid'
  fallbackCwd?: string
  generatedName?: string
  mode?: ClaudePermissionMode
  preferMachineCwd?: boolean
  rawBody: unknown
  requireName: boolean
  routeLabel: string
  sourceDefaults?: WorkerLaunchSourceDefaults
  spawnedBy?: string
  unknownKeyStyle: 'legacy' | 'quoted'
}

export interface ParsedWorkerLaunchRequest {
  agentType: AgentType
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  creator: SessionCreator
  currentSkillInvocation?: ActiveSkillInvocation
  effort?: ClaudeEffortLevel
  fallbackCwd?: string
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  mode: ClaudePermissionMode
  model?: string
  preferMachineCwd: boolean
  requestedCwd?: string
  requestedHost?: string
  sessionName: string
  spawnedBy?: string
  task: string
}

export type WorkerLaunchParseResult =
  | { ok: true; request: ParsedWorkerLaunchRequest }
  | { ok: false; status: number; body: Record<string, unknown> }

export type WorkerLaunchSessionResult =
  | { ok: true; session: StreamSession }
  | { ok: false; status: number; body: Record<string, unknown> }

export interface WorkerLaunchSessionDeps {
  createProviderStreamSession(
    sessionName: string,
    mode: ClaudePermissionMode,
    task: string,
    cwd: string | undefined,
    machine: MachineConfig | undefined,
    agentType?: AgentType,
    options?: Omit<ProviderCreateOptions, 'sessionName' | 'mode' | 'task' | 'cwd' | 'machine'>,
  ): Promise<StreamSession>
  maxSessions: number
  resolveDaemonLaunchReadiness?(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): { ok: true } | { ok: false; status: number; error: string }
  resolveMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  >
  schedulePersistedSessionsWrite(): void
  sessions: Map<string, AnySession>
  teardownProviderSession?(session: StreamSession, reason: string): Promise<void>
}

export function asWorkerLaunchBody(rawBody: unknown): WorkerLaunchBody {
  return rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as WorkerLaunchBody
    : {}
}

function hasOwn(body: WorkerLaunchBody, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function renderUnknownKeys(keys: string[], style: 'legacy' | 'quoted'): string {
  if (style === 'legacy') {
    return keys.join(', ')
  }
  return keys.map((key) => `"${key}"`).join(', ')
}

function unknownBodyPropertiesError(
  keys: string[],
  style: 'legacy' | 'quoted',
): Record<string, unknown> {
  const noun = style === 'legacy' || keys.length !== 1 ? 'properties' : 'property'
  return {
    error: `Unknown request body ${noun}: ${renderUnknownKeys(keys, style)}`,
  }
}

export function parseWorkerLaunchRequest(
  options: ParseWorkerLaunchRequestOptions,
): WorkerLaunchParseResult {
  const body = asWorkerLaunchBody(options.rawBody)
  if (hasOwn(body, 'creator')) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `creator must not be provided on ${options.routeLabel} - worker creator is supplied by the authenticated route context`,
      },
    }
  }

  if (hasOwn(body, 'parentSession')) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'parentSession is not honored on worker launch routes. Commander attribution is carried by creator, supplied by the route context.',
      },
    }
  }

  const unknownKeys = Object.keys(body).filter((key) => !options.allowedBodyKeys.has(key))
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      body: unknownBodyPropertiesError(unknownKeys, options.unknownKeyStyle),
    }
  }

  const rawSessionType = body.sessionType
  const parsedSessionType = parseSessionType(rawSessionType)
  if (parsedSessionType === null) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Invalid sessionType. Expected one of: commander, worker, cron, sentinel, automation',
      },
    }
  }
  if (parsedSessionType !== undefined && parsedSessionType !== 'worker') {
    return {
      ok: false,
      status: 400,
      body: {
        error: `sessionType must be "worker" on ${options.routeLabel} (received "${String(rawSessionType)}")`,
      },
    }
  }

  const bodySessionName = hasOwn(body, 'name') ? parseSessionName(body.name) : undefined
  const sessionName = bodySessionName ?? options.generatedName
  if (!sessionName || (options.requireName && !bodySessionName)) {
    return { ok: false, status: 400, body: { error: 'Invalid session name' } }
  }

  const parsedEffort = parseClaudeEffort(body.effort)
  if (parsedEffort === null) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid effort. Expected one of: low, medium, high, max' },
    }
  }

  const parsedAdaptiveThinking = parseClaudeAdaptiveThinking(body.adaptiveThinking)
  if (parsedAdaptiveThinking === null) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid adaptiveThinking. Expected one of: enabled, disabled' },
    }
  }

  const parsedMaxThinkingTokens = parseClaudeMaxThinkingTokens(body.maxThinkingTokens)
  if (parsedMaxThinkingTokens === null) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid maxThinkingTokens. Expected integer 1024..256000' },
    }
  }

  const task = parseOptionalTask(body.task)
  if (task === null) {
    return { ok: false, status: 400, body: { error: 'Task must be a string' } }
  }

  const model = parseOptionalModel(body.model)
  if (model === null) {
    return { ok: false, status: 400, body: { error: 'model must be a string when provided' } }
  }

  const currentSkillInvocationOverrideRequested = hasOwn(body, 'currentSkillInvocation')
  const rawCurrentSkillInvocation = body.currentSkillInvocation
  const parsedCurrentSkillInvocation =
    rawCurrentSkillInvocation === null && options.currentSkillInvocationNull === 'clear'
      ? undefined
      : parseActiveSkillInvocation(rawCurrentSkillInvocation)
  if (currentSkillInvocationOverrideRequested && parsedCurrentSkillInvocation === null) {
    return {
      ok: false,
      status: 400,
      body: {
        error: options.currentSkillInvocationNull === 'clear'
          ? 'Invalid currentSkillInvocation. Expected { skillId, displayName, startedAt, toolUseId? } or null'
          : 'Invalid currentSkillInvocation. Expected { skillId, displayName, startedAt, toolUseId? }',
      },
    }
  }
  const requestedCurrentSkillInvocation = parsedCurrentSkillInvocation ?? undefined

  const requestedCwd = parseCwd(body.cwd)
  if (requestedCwd === null) {
    return { ok: false, status: 400, body: { error: 'Invalid cwd: must be an absolute path' } }
  }

  const requestedHost = parseOptionalHost(body.host)
  if (requestedHost === null) {
    return { ok: false, status: 400, body: { error: 'Invalid host: expected machine ID string' } }
  }

  const hasRequestedAgentType = hasOwn(body, 'agentType')
    && typeof body.agentType === 'string'
    && body.agentType.trim().length > 0
  const parsedAgentType = parseProviderId(body.agentType)
  if (hasRequestedAgentType && parsedAgentType === null) {
    return {
      ok: false,
      status: 400,
      body: { error: `Unknown provider: ${String(body.agentType)}` },
    }
  }
  const agentType = (parsedAgentType ?? options.sourceDefaults?.agentType ?? 'claude') as AgentType
  const provider = getProvider(agentType)
  if (!provider?.capabilities.supportsWorkerDispatch) {
    return {
      ok: false,
      status: 400,
      body: { error: `Provider ${agentType} cannot dispatch worker sessions` },
    }
  }

  const effectiveModel = model ?? options.sourceDefaults?.model
  const modelValidation = validateModelForAgentType(agentType, effectiveModel ?? null)
  if (!modelValidation.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: modelValidation.error, validIds: modelValidation.validIds },
    }
  }

  const providerDefaults = resolveProviderDefaults(provider)
  const effort = provider.uiCapabilities.supportsEffort
    ? (
      parsedEffort
      ?? options.sourceDefaults?.effort
      ?? providerDefaults.effort
      ?? DEFAULT_CLAUDE_EFFORT_LEVEL
    )
    : undefined
  const adaptiveThinking = provider.uiCapabilities.supportsAdaptiveThinking
    ? (
      parsedAdaptiveThinking
      ?? options.sourceDefaults?.adaptiveThinking
      ?? providerDefaults.adaptiveThinking
      ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
    )
    : undefined
  const maxThinkingTokens = provider.uiCapabilities.supportsMaxThinkingTokens
    ? (
      parsedMaxThinkingTokens
      ?? options.sourceDefaults?.maxThinkingTokens
      ?? providerDefaults.maxThinkingTokens
      ?? DEFAULT_CLAUDE_MAX_THINKING_TOKENS
    )
    : undefined

  return {
    ok: true,
    request: {
      agentType,
      creator: options.creator,
      mode: options.mode ?? options.sourceDefaults?.mode ?? 'default',
      preferMachineCwd: options.preferMachineCwd ?? false,
      sessionName,
      task: task ?? '',
      ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
      ...(currentSkillInvocationOverrideRequested
        ? (
          requestedCurrentSkillInvocation !== undefined
            ? { currentSkillInvocation: requestedCurrentSkillInvocation }
            : {}
        )
        : (
          options.sourceDefaults?.currentSkillInvocation !== undefined
            ? { currentSkillInvocation: options.sourceDefaults.currentSkillInvocation }
            : {}
        )),
      ...(effort !== undefined ? { effort } : {}),
      ...(options.fallbackCwd !== undefined ? { fallbackCwd: options.fallbackCwd } : {}),
      ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      ...(requestedCwd !== undefined ? { requestedCwd } : {}),
      ...(requestedHost ?? options.sourceDefaults?.host
        ? { requestedHost: requestedHost ?? options.sourceDefaults?.host }
        : {}),
      ...(options.spawnedBy ? { spawnedBy: options.spawnedBy } : {}),
    },
  }
}

export async function launchProviderWorkerSession(
  deps: WorkerLaunchSessionDeps,
  request: ParsedWorkerLaunchRequest,
  options: {
    abortSignal?: AbortSignal
    missingCwdError: string
  },
): Promise<WorkerLaunchSessionResult> {
  if (options.abortSignal?.aborted) {
    return { ok: false, status: 499, body: { error: 'Worker dispatch was cancelled before launch' } }
  }

  if (deps.sessions.has(request.sessionName)) {
    return { ok: false, status: 409, body: { error: `Session "${request.sessionName}" already exists` } }
  }

  if (deps.sessions.size >= deps.maxSessions) {
    return { ok: false, status: 429, body: { error: `Session limit reached (${deps.maxSessions})` } }
  }

  const resolvedMachine = await deps.resolveMachine(request.requestedHost)
  if (!resolvedMachine.ok) {
    return { ok: false, status: resolvedMachine.status, body: { error: resolvedMachine.error } }
  }
  const machine = resolvedMachine.machine
  const daemonReadiness = deps.resolveDaemonLaunchReadiness?.(machine, request.agentType)
  if (daemonReadiness && !daemonReadiness.ok) {
    return { ok: false, status: daemonReadiness.status, body: { error: daemonReadiness.error } }
  }

  const workerCwd = request.requestedCwd
    ?? (
      request.preferMachineCwd
        ? (machine?.cwd ?? request.fallbackCwd)
        : (request.fallbackCwd ?? machine?.cwd)
    )
  if (!workerCwd) {
    return { ok: false, status: 400, body: { error: options.missingCwdError } }
  }

  try {
    const session = await deps.createProviderStreamSession(
      request.sessionName,
      request.mode,
      request.task,
      workerCwd,
      machine,
      request.agentType,
      {
        sessionType: 'worker',
        creator: request.creator,
        ...(request.adaptiveThinking !== undefined ? { adaptiveThinking: request.adaptiveThinking } : {}),
        ...(request.currentSkillInvocation !== undefined
          ? { currentSkillInvocation: request.currentSkillInvocation }
          : {}),
        ...(request.effort !== undefined ? { effort: request.effort } : {}),
        ...(request.maxThinkingTokens !== undefined ? { maxThinkingTokens: request.maxThinkingTokens } : {}),
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.spawnedBy ? { spawnedBy: request.spawnedBy } : {}),
      },
    )

    if (options.abortSignal?.aborted) {
      await deps.teardownProviderSession?.(session, 'Worker dispatch was cancelled before registration')
      return {
        ok: false,
        status: 499,
        body: { error: 'Worker dispatch was cancelled before registration' },
      }
    }

    deps.sessions.set(request.sessionName, session)
    deps.schedulePersistedSessionsWrite()
    return { ok: true, session }
  } catch (err) {
    if (err instanceof ProviderAuthRequiredError) {
      return {
        ok: false,
        status: 424,
        body: {
          code: 'AUTH_REQUIRED',
          provider: err.provider,
          status: err.snapshot.status,
          authMethod: err.snapshot.authMethod,
          scopeId: err.snapshot.scopeId,
          host: err.snapshot.host,
          reauthUrl: err.snapshot.reauthUrl,
          error: err.message,
        },
      }
    }
    const message = err instanceof Error ? err.message : 'Failed to create stream session'
    return { ok: false, status: 500, body: { error: message } }
  }
}
