import { normalizeOpenCodeSessionUpdate } from '../../event-normalizers/opencode.js'
import { CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS } from '../../constants.js'
import { registerProvider } from '../../providers/registry-core.js'
import {
  asOpenCodeProviderContext,
  createOpenCodeProviderContext,
  ensureOpenCodeProviderContext,
  readOpenCodeNotificationCleanup,
  readOpenCodeRuntime,
  readOpenCodeRuntimeTeardownPromise,
} from '../../providers/provider-session-context.js'
import type {
  ProviderAdapter,
  ProviderAdapterDeps,
  ProviderCreateOptions,
} from '../../providers/provider-adapter.js'
import type {
  ExitedStreamSessionState,
  PersistedStreamSession,
  StreamSession,
} from '../../types.js'
import { opencodeMachineProvider } from './machine-adapter.js'
import { opencodeApprovalAdapter } from './approval-adapter.js'
import {
  createOpenCodeAcpSession,
  createOpenCodeSessionAdapter,
} from './session.js'

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function migrateLegacyOpenCodeProviderContext(rawProviderContext: unknown) {
  const raw = asObject(rawProviderContext)
  if (!raw) {
    return null
  }

  const nested = asObject(raw.providerContext)
  const agentType = readOptionalString(raw.agentType)
  const sessionId = readOptionalString(raw.opencodeSessionId)
    ?? readOptionalString(nested?.sessionId)

  if (agentType && agentType !== 'opencode') {
    return null
  }
  if (!sessionId) {
    return null
  }

  return createOpenCodeProviderContext({ sessionId })
}

function snapshotOpenCodeSession(session: StreamSession): PersistedStreamSession | null {
  const context = asOpenCodeProviderContext(session.providerContext)
  if (!context?.sessionId) {
    return null
  }

  return {
    name: session.name,
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation
      ? { ...session.currentSkillInvocation }
      : undefined,
    createdAt: session.createdAt,
    providerContext: createOpenCodeProviderContext({
      sessionId: context.sessionId,
    }),
    activeTurnId: session.activeTurnId,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    resumedFrom: session.resumedFrom,
    sessionState: 'active',
    hadResult: Boolean(session.finalResultEvent),
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

function snapshotExitedOpenCodeSession(session: StreamSession): ExitedStreamSessionState {
  const context = ensureOpenCodeProviderContext(session)
  return {
    phase: 'exited',
    hadResult: Boolean(session.finalResultEvent),
    sessionType: session.sessionType,
    creator: session.creator,
    conversationId: session.conversationId,
    agentType: session.agentType,
    mode: session.mode,
    cwd: session.cwd,
    host: session.host,
    currentSkillInvocation: session.currentSkillInvocation
      ? { ...session.currentSkillInvocation }
      : undefined,
    spawnedBy: session.spawnedBy,
    spawnedWorkers: [...session.spawnedWorkers],
    createdAt: session.createdAt,
    providerContext: createOpenCodeProviderContext({
      sessionId: context.sessionId,
    }),
    activeTurnId: session.activeTurnId,
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export const opencodeProvider: ProviderAdapter = registerProvider({
  id: 'opencode',
  label: 'OpenCode',
  eventProvider: 'opencode',
  approvalAdapter: opencodeApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
  },
  machineAuth: opencodeMachineProvider,
  uiCapabilities: {
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    supportsSkills: false,
    supportsLoginMode: false,
    forcedTransport: 'stream',
    permissionModes: [
      {
        value: 'default',
        label: 'default',
        description: 'opencode acp (mode: default)',
      },
    ],
    infoBanner: {
      variant: 'info',
      text: 'OpenCode uses ACP-backed stream sessions only.',
    },
  },
  preparePtyEnv() {
    return {}
  },
  buildStreamSessionAdapter(deps: ProviderAdapterDeps) {
    return createOpenCodeSessionAdapter(deps)
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    const cwd = options.cwd ?? process.env.HOME ?? '/tmp'
    return createOpenCodeAcpSession(
      options.sessionName,
      options.mode,
      options.task,
      cwd,
      {
        resumeSessionId: options.resumeSessionId,
        systemPrompt: options.systemPrompt,
        maxTurns: options.maxTurns,
        model: options.model,
        createdAt: options.createdAt,
        spawnedBy: options.spawnedBy,
        spawnedWorkers: options.spawnedWorkers,
        resumedFrom: options.resumedFrom,
        machine: options.machine,
        sessionType: options.sessionType,
        creator: options.creator,
        conversationId: options.conversationId,
        currentSkillInvocation: options.currentSkillInvocation,
      },
      deps,
    )
  },
  restore(entry, machine, deps) {
    const context = asOpenCodeProviderContext(entry.providerContext)
    return this.create({
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: context?.sessionId,
      systemPrompt: undefined,
      maxTurns: undefined,
      model: undefined,
      createdAt: entry.createdAt,
      spawnedBy: entry.spawnedBy,
      spawnedWorkers: entry.spawnedWorkers,
      resumedFrom: entry.resumedFrom,
      sessionType: entry.sessionType,
      creator: entry.creator,
      conversationId: entry.conversationId,
      currentSkillInvocation: entry.currentSkillInvocation,
    }, deps)
  },
  snapshotForPersist(session) {
    return snapshotOpenCodeSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedOpenCodeSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(asOpenCodeProviderContext(entry.providerContext)?.sessionId)
  },
  canResumeLiveSession(session) {
    return Boolean(asOpenCodeProviderContext(session.providerContext)?.sessionId)
  },
  getResumeId(session) {
    return asOpenCodeProviderContext(session.providerContext)?.sessionId
  },
  transcriptId(session) {
    return this.getResumeId(session) ?? session.name
  },
  async teardown(session, reason) {
    if (readOpenCodeRuntimeTeardownPromise(session)) {
      await readOpenCodeRuntimeTeardownPromise(session)
      return
    }

    const runtime = readOpenCodeRuntime(session)
    if (!runtime) {
      try {
        session.process.kill('SIGTERM')
      } catch {
        // Best-effort cleanup only.
      }
      return
    }

    readOpenCodeNotificationCleanup(session)?.()
    ensureOpenCodeProviderContext(session).notificationCleanup = undefined

    const teardownPromise = runtime.teardown({
      reason,
      timeoutMs: CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS,
    })
    ensureOpenCodeProviderContext(session).runtimeTeardownPromise = teardownPromise
    try {
      await teardownPromise
    } finally {
      const context = ensureOpenCodeProviderContext(session)
      context.runtimeTeardownPromise = undefined
      context.notificationCleanup = undefined
      context.runtime = undefined
    }
  },
  async shutdownFleet(sessions, reason) {
    await Promise.allSettled(
      [...sessions].map(async (session) => {
        for (const client of session.clients) {
          client.close(1001, 'Server shutting down')
        }
        await this.teardown(session, reason ?? 'Hammurabi shutdown')
      }),
    )
  },
  migrateLegacyContext(rawProviderContext) {
    return migrateLegacyOpenCodeProviderContext(rawProviderContext)
  },
})

void normalizeOpenCodeSessionUpdate
