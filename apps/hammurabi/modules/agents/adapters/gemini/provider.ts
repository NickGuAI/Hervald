import { normalizeGeminiSessionUpdate } from '../../event-normalizers/gemini.js'
import { CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS } from '../../constants.js'
import { registerProvider } from '../../providers/registry-core.js'
import {
  asGeminiProviderContext,
  createGeminiProviderContext,
  ensureGeminiProviderContext,
  readGeminiNotificationCleanup,
  readGeminiRuntime,
  readGeminiRuntimeTeardownPromise,
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
import { geminiMachineProvider } from './machine-adapter.js'
import { geminiApprovalAdapter } from './approval-adapter.js'
import {
  createGeminiAcpSession,
  createGeminiSessionAdapter,
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

function migrateLegacyGeminiProviderContext(rawProviderContext: unknown) {
  const raw = asObject(rawProviderContext)
  if (!raw) {
    return null
  }

  const nested = asObject(raw.providerContext)
  const agentType = readOptionalString(raw.agentType)
  const sessionId = readOptionalString(raw.geminiSessionId)
    ?? readOptionalString(nested?.sessionId)

  if (agentType && agentType !== 'gemini') {
    return null
  }
  if (!sessionId) {
    return null
  }

  return createGeminiProviderContext({ sessionId })
}

function snapshotGeminiSession(session: StreamSession): PersistedStreamSession | null {
  const context = asGeminiProviderContext(session.providerContext)
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
    providerContext: createGeminiProviderContext({
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

function snapshotExitedGeminiSession(session: StreamSession): ExitedStreamSessionState {
  const context = ensureGeminiProviderContext(session)
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
    providerContext: createGeminiProviderContext({
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

export const geminiProvider: ProviderAdapter = registerProvider({
  id: 'gemini',
  label: 'Gemini',
  eventProvider: 'gemini',
  approvalAdapter: geminiApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
  },
  machineAuth: geminiMachineProvider,
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
        description: 'gemini --acp (mode: default)',
      },
    ],
    infoBanner: {
      variant: 'info',
      text: 'Gemini uses ACP-backed stream sessions only.',
    },
  },
  preparePtyEnv() {
    return {}
  },
  buildStreamSessionAdapter(deps: ProviderAdapterDeps) {
    return createGeminiSessionAdapter(deps)
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    const cwd = options.cwd ?? process.env.HOME ?? '/tmp'
    return createGeminiAcpSession(
      options.sessionName,
      options.mode,
      options.task,
      cwd,
      {
        resumeSessionId: options.resumeSessionId,
        systemPrompt: options.systemPrompt,
        maxTurns: options.maxTurns,
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
    const context = asGeminiProviderContext(entry.providerContext)
    return this.create({
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: context?.sessionId,
      systemPrompt: undefined,
      maxTurns: undefined,
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
    return snapshotGeminiSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedGeminiSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(asGeminiProviderContext(entry.providerContext)?.sessionId)
  },
  canResumeLiveSession(session) {
    return Boolean(asGeminiProviderContext(session.providerContext)?.sessionId)
  },
  getResumeId(session) {
    return asGeminiProviderContext(session.providerContext)?.sessionId
  },
  transcriptId(session) {
    return this.getResumeId(session) ?? session.name
  },
  async teardown(session, reason) {
    if (readGeminiRuntimeTeardownPromise(session)) {
      await readGeminiRuntimeTeardownPromise(session)
      return
    }

    const runtime = readGeminiRuntime(session)
    if (!runtime) {
      try {
        session.process.kill('SIGTERM')
      } catch {
        // Best-effort cleanup only.
      }
      return
    }

    readGeminiNotificationCleanup(session)?.()
    ensureGeminiProviderContext(session).notificationCleanup = undefined

    const teardownPromise = runtime.teardown({
      reason,
      timeoutMs: CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS,
    })
    ensureGeminiProviderContext(session).runtimeTeardownPromise = teardownPromise
    try {
      await teardownPromise
    } finally {
      const context = ensureGeminiProviderContext(session)
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
    return migrateLegacyGeminiProviderContext(rawProviderContext)
  },
})

void normalizeGeminiSessionUpdate
