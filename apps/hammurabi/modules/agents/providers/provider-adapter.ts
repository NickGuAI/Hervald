import type { ProviderApprovalAdapter } from '../../policies/provider-approval-adapter.js'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { ClaudeStreamSessionDeps } from '../adapters/claude/session.js'
import type { CodexSessionDeps } from '../adapters/codex/session.js'
import type { GeminiSessionDeps } from '../adapters/gemini/session.js'
import type { OpenCodeSessionDeps } from '../adapters/opencode/session.js'
import type {
  ActiveSkillInvocation,
  AgentType,
  ClaudePermissionMode,
  MachineConfig,
  PersistedStreamSession,
  SessionCreator,
  SessionType,
  StreamJsonEvent,
  StreamSession,
  StreamSessionAdapter,
  ExitedStreamSessionState,
} from '../types.js'
import type {
  MachineAuthMode,
  MachineProviderAdapter,
} from './machine-provider-adapter-core.js'
import type { ProviderSessionContext } from './provider-session-context.js'

export interface ProviderPermissionModeOption {
  value: ClaudePermissionMode
  label: string
  description: string
}

export interface ProviderInfoBanner {
  variant: 'info' | 'warn'
  text: string
}

export interface ProviderUiCapabilities {
  supportsEffort: boolean
  supportsAdaptiveThinking: boolean
  supportsSkills: boolean
  supportsLoginMode: boolean
  forcedTransport?: 'stream'
  permissionModes: ProviderPermissionModeOption[]
  infoBanner?: ProviderInfoBanner
}

export interface ProviderCapabilities {
  /** Allowed as Automation entity agentType. */
  supportsAutomation: boolean
  /** Allowed as Commander conversation agentType. */
  supportsCommanderConversation: boolean
  /** Allowed as worker dispatch agentType. */
  supportsWorkerDispatch: boolean
}

export interface ProviderMachineAuthDescriptor {
  cliBinaryName: string
  installPackageName?: string
  authEnvKeys: string[]
  supportedAuthModes: MachineAuthMode[]
  requiresSecretModes: MachineAuthMode[]
  loginStatusCommand: string | null
}

export interface ProviderRegistryEntry {
  id: AgentType
  label: string
  eventProvider: string
  capabilities: ProviderCapabilities
  uiCapabilities: ProviderUiCapabilities
  machineAuth?: ProviderMachineAuthDescriptor
}

export interface ProviderRegistryResponse {
  providers: ProviderRegistryEntry[]
}

export type ProviderAdapterDeps =
  & ClaudeStreamSessionDeps
  & CodexSessionDeps
  & GeminiSessionDeps
  & OpenCodeSessionDeps

export interface ProviderResumeSource {
  providerContext: ProviderSessionContext
  name?: string
}

export interface ProviderCreateOptions {
  sessionName: string
  mode: ClaudePermissionMode
  task: string
  cwd?: string
  machine?: MachineConfig
  resumeSessionId?: string
  systemPrompt?: string
  maxTurns?: number
  model?: string
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  createdAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  resumedFrom?: string
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  currentSkillInvocation?: ActiveSkillInvocation
}

export interface ProviderAdapter {
  readonly id: AgentType
  readonly label: string
  readonly eventProvider: string
  readonly approvalAdapter: ProviderApprovalAdapter<unknown, unknown>
  readonly capabilities: ProviderCapabilities
  readonly uiCapabilities: ProviderUiCapabilities
  readonly machineAuth?: MachineProviderAdapter
  /** Provider-specific PTY env overrides. Route-managed env still wins. */
  preparePtyEnv?(args: {
    mode: ClaudePermissionMode
    effort?: ClaudeEffortLevel
  }): Record<string, string>
  /**
   * Optional runtime watchdog hook for long-lived stream transports.
   * Used by providers such as Codex to detect stale runtime connections.
   */
  runtimeWatchdog?(session: StreamSession): { teardown: () => void } | undefined
  /** Skill scan roots exposed by this provider, if any. */
  readonly skillScanPaths?: readonly string[]
  /**
   * Provider-owned migration for legacy persisted context shapes that predate
   * the canonical `providerContext.providerId` discriminator.
   */
  migrateLegacyContext?(rawProviderContext: unknown): ProviderSessionContext | null
  buildStreamSessionAdapter(deps: ProviderAdapterDeps): StreamSessionAdapter
  create(options: ProviderCreateOptions, deps: ProviderAdapterDeps): Promise<StreamSession> | StreamSession
  restore(
    entry: PersistedStreamSession,
    machine: MachineConfig | undefined,
    deps: ProviderAdapterDeps,
  ): Promise<StreamSession> | StreamSession
  snapshotForPersist(session: StreamSession): PersistedStreamSession | null
  snapshotExited(session: StreamSession): ExitedStreamSessionState
  hasResumeIdentifier(entry: PersistedStreamSession): boolean
  canResumeLiveSession(session: StreamSession): boolean
  getResumeId(session: ProviderResumeSource, event?: StreamJsonEvent): string | undefined
  transcriptId(session: StreamSession, event?: StreamJsonEvent): string | undefined
  teardown(session: StreamSession, reason: string): Promise<void> | void
  shutdownFleet?(sessions: Iterable<StreamSession>, reason?: string): Promise<void> | void
}
