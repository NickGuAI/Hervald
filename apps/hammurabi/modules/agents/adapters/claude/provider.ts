import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  getClaudeDisableAdaptiveThinkingEnvValue,
  isClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  isClaudeEffortLevel,
} from '../../../claude-effort.js'
import {
  normalizeClaudeEvent,
} from '../../event-normalizers/claude.js'
import { registerProvider } from '../../providers/registry-core.js'
import {
  asClaudeProviderContext,
  createClaudeProviderContext,
  ensureClaudeProviderContext,
} from '../../providers/provider-session-context.js'
import type {
  ProviderAdapter,
  ProviderAdapterDeps,
  ProviderCreateOptions,
} from '../../providers/provider-adapter.js'
import type {
  ExitedStreamSessionState,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'
import { claudeMachineProvider } from './machine-adapter.js'
import { claudeApprovalAdapter } from './approval-adapter.js'
import { createClaudeSessionAdapter, createClaudeStreamSession } from './session.js'

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

function migrateLegacyClaudeProviderContext(rawProviderContext: unknown) {
  const raw = asObject(rawProviderContext)
  if (!raw) {
    return null
  }

  const nested = asObject(raw.providerContext)
  const agentType = readOptionalString(raw.agentType)
  const sessionId = readOptionalString(raw.claudeSessionId)
    ?? readOptionalString(nested?.sessionId)
  const effort = isClaudeEffortLevel(nested?.effort)
    ? nested.effort
    : (isClaudeEffortLevel(raw.effort) ? raw.effort : undefined)
  const adaptiveThinking = isClaudeAdaptiveThinkingMode(nested?.adaptiveThinking)
    ? nested.adaptiveThinking
    : (
        isClaudeAdaptiveThinkingMode(raw.adaptiveThinking)
          ? raw.adaptiveThinking
          : undefined
      )

  if (agentType && agentType !== 'claude') {
    return null
  }
  if (!sessionId && !effort && !adaptiveThinking) {
    return null
  }

  return createClaudeProviderContext({
    ...(sessionId ? { sessionId } : {}),
    ...(effort ? { effort } : {}),
    ...(adaptiveThinking ? { adaptiveThinking } : {}),
  })
}

function extractClaudeSessionId(event: StreamJsonEvent | undefined): string | undefined {
  if (!event) {
    return undefined
  }
  const direct = typeof (event as Record<string, unknown>).session_id === 'string'
    ? (event as Record<string, unknown>).session_id as string
    : undefined
  if (direct?.trim()) {
    return direct.trim()
  }
  const camel = typeof (event as Record<string, unknown>).sessionId === 'string'
    ? (event as Record<string, unknown>).sessionId as string
    : undefined
  if (camel?.trim()) {
    return camel.trim()
  }
  return undefined
}

function snapshotClaudeSession(session: StreamSession): PersistedStreamSession | null {
  const context = asClaudeProviderContext(session.providerContext)
  const sessionId = session.lastTurnCompleted ? context?.sessionId : undefined
  if (!sessionId) {
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
    providerContext: createClaudeProviderContext({
      sessionId,
      effort: context?.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
      adaptiveThinking: context?.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
    }),
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

function snapshotExitedClaudeSession(session: StreamSession): ExitedStreamSessionState {
  const context = ensureClaudeProviderContext(session)
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
    providerContext: createClaudeProviderContext({
      sessionId: context.sessionId,
      effort: context.effort,
      adaptiveThinking: context.adaptiveThinking,
    }),
    resumedFrom: session.resumedFrom,
    conversationEntryCount: session.conversationEntryCount,
    events: [...session.events],
    queuedMessages: session.messageQueue.list(),
    currentQueuedMessage: session.currentQueuedMessage,
    pendingDirectSendMessages: [...session.pendingDirectSendMessages],
  }
}

export const claudeProvider: ProviderAdapter = registerProvider({
  id: 'claude',
  label: 'Claude',
  eventProvider: 'claude',
  approvalAdapter: claudeApprovalAdapter,
  capabilities: {
    supportsAutomation: true,
    supportsCommanderConversation: true,
    supportsWorkerDispatch: true,
  },
  machineAuth: claudeMachineProvider,
  uiCapabilities: {
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    supportsSkills: true,
    supportsLoginMode: true,
    permissionModes: [
      { value: 'default', label: 'default', description: 'claude' },
    ],
  },
  skillScanPaths: ['~/.claude/skills', '~/.openclaw/skills'],
  buildStreamSessionAdapter(deps: ProviderAdapterDeps) {
    return createClaudeSessionAdapter(deps)
  },
  preparePtyEnv() {
    return {
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: getClaudeDisableAdaptiveThinkingEnvValue(
        DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
      ),
    }
  },
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps) {
    return createClaudeStreamSession(
      options.sessionName,
      options.mode,
      options.task,
      options.cwd,
      options.machine,
      {
        resumeSessionId: options.resumeSessionId,
        systemPrompt: options.systemPrompt,
        maxTurns: options.maxTurns,
        model: options.model,
        effort: options.effort,
        adaptiveThinking: options.adaptiveThinking,
        createdAt: options.createdAt,
        spawnedBy: options.spawnedBy,
        spawnedWorkers: options.spawnedWorkers,
        resumedFrom: options.resumedFrom,
        sessionType: options.sessionType,
        creator: options.creator,
        conversationId: options.conversationId,
        currentSkillInvocation: options.currentSkillInvocation,
      },
      deps,
    )
  },
  restore(entry, machine, deps) {
    const context = asClaudeProviderContext(entry.providerContext)
    return this.create({
      sessionName: entry.name,
      mode: entry.mode,
      task: '',
      cwd: entry.cwd,
      machine,
      resumeSessionId: context?.sessionId,
      createdAt: entry.createdAt,
      spawnedBy: entry.spawnedBy,
      spawnedWorkers: entry.spawnedWorkers,
      resumedFrom: entry.resumedFrom,
      sessionType: entry.sessionType,
      creator: entry.creator,
      conversationId: entry.conversationId,
      currentSkillInvocation: entry.currentSkillInvocation,
      effort: context?.effort,
      adaptiveThinking: context?.adaptiveThinking,
    }, deps)
  },
  snapshotForPersist(session) {
    return snapshotClaudeSession(session)
  },
  snapshotExited(session) {
    return snapshotExitedClaudeSession(session)
  },
  hasResumeIdentifier(entry) {
    return Boolean(asClaudeProviderContext(entry.providerContext)?.sessionId)
  },
  canResumeLiveSession() {
    return false
  },
  getResumeId(session, event) {
    const context = asClaudeProviderContext(session.providerContext)
    return context?.sessionId ?? extractClaudeSessionId(event) ?? session.name
  },
  transcriptId(session, event) {
    return this.getResumeId(session, event)
  },
  teardown(session) {
    try {
      session.process.kill('SIGTERM')
    } catch {
      // Best effort only.
    }
  },
  migrateLegacyContext(rawProviderContext) {
    return migrateLegacyClaudeProviderContext(rawProviderContext)
  },
})

void normalizeClaudeEvent
