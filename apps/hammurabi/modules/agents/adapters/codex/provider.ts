import { normalizeCodexEvent } from '../../event-normalizers/codex.js'
import { registerProvider } from '../../providers/registry-core.js'
import {
  asCodexProviderContext,
  createCodexProviderContext,
  ensureCodexProviderContext,
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
import { codexMachineProvider } from './machine-adapter.js'
import { codexApprovalAdapter } from './approval-adapter.js'
import { clearCodexTurnWatchdog } from './helpers.js'
import {
  createCodexSessionAdapter,
  createCodexAppServerSession,
  shutdownCodexRuntimes,
  teardownCodexSessionRuntime,
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

function migrateLegacyCodexProviderContext(rawProviderContext: unknown) {
  const raw = asObject(rawProviderContext)
  if (!raw) {
    return null
  }

  const nested = asObject(raw.providerContext)
  const agentType = readOptionalString(raw.agentType)
  const threadId = readOptionalString(raw.codexThreadId)
    ?? readOptionalString(nested?.threadId)

  if (agentType && agentType !== 'codex') {
    return null
  }
  if (!threadId) {
    return null
  }

  return createCodexProviderContext({ threadId })
}

function snapshotCodexSession(
  session: StreamSession,
): PersistedStreamSession | null {
  const context = asCodexProviderContext(session.providerContext)
  if (!context?.threadId) {
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
    providerContext: createCodexProviderContext({
      threadId: context.threadId,
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

function snapshotExitedCodexSession(session: StreamSession): ExitedStreamSessionState {
  const context = ensureCodexProviderContext(session)
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
    providerContext: createCodexProviderContext({
      threadId: context.threadId,
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

export const codexProvider: ProviderAdapter = registerProvider({
  id: 'codex',
  label: 'Codex',
  eventProvider: 'codex',
  approvalAdapter: codexApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
  },
  machineAuth: codexMachineProvider,
  uiCapabilities: {
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    supportsSkills: false,
    supportsLoginMode: true,
    permissionModes: [
      {
        value: 'default',
        label: 'default',
        description: 'Codex approval requests route through Hammurabi action policies',
      },
    ],
  },
  skillScanPaths: ['~/.codex/skills'],
  buildStreamSessionAdapter(deps: ProviderAdapterDeps) {
    return createCodexSessionAdapter(deps)
  },
  preparePtyEnv() {
    return {}
  },
  runtimeWatchdog(session) {
    return {
      teardown: () => {
        clearCodexTurnWatchdog(session)
      },
    }
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    const cwd = options.cwd ?? process.env.HOME ?? '/tmp'
    return createCodexAppServerSession(
      options.sessionName,
      options.mode,
      options.task,
      cwd,
      {
        resumeSessionId: options.resumeSessionId,
        systemPrompt: options.systemPrompt,
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
    const context = asCodexProviderContext(entry.providerContext)
    return this.create({
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: context?.threadId,
      systemPrompt: undefined,
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
    return snapshotCodexSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedCodexSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(asCodexProviderContext(entry.providerContext)?.threadId)
  },
  canResumeLiveSession(session) {
    const context = asCodexProviderContext(session.providerContext)
    return Boolean(context?.threadId && session.codexTurnStaleAt)
  },
  getResumeId(session) {
    return asCodexProviderContext(session.providerContext)?.threadId
  },
  transcriptId(session) {
    return this.getResumeId(session) ?? session.name
  },
  teardown(session, reason) {
    return teardownCodexSessionRuntime(session, reason)
  },
  async shutdownFleet(sessions, reason) {
    await Promise.allSettled(
      [...sessions]
        .filter((session) => session.agentType === 'codex')
        .map(async (session) => teardownCodexSessionRuntime(session, reason ?? 'Hammurabi shutdown')),
    )
  },
  migrateLegacyContext(rawProviderContext) {
    return migrateLegacyCodexProviderContext(rawProviderContext)
  },
})

void normalizeCodexEvent
