import type { ProviderApprovalAdapter } from '../../policies/provider-approval-adapter.js'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { ClaudeMaxThinkingTokens } from '../../claude-max-thinking-tokens.js'
import type { ClaudeStreamSessionDeps } from '../adapters/claude/session.js'
import type { CodexSessionDeps } from '../adapters/codex/session.js'
import type { GeminiSessionDeps } from '../adapters/gemini/session.js'
import type { OpenCodeSessionDeps } from '../adapters/opencode/session.js'
import type {
  ActiveSkillInvocation,
  AgentType,
  ClaudePermissionMode,
  MachineConfig,
  PersistedDaemonProcess,
  PersistedStreamSession,
  SessionCreator,
  SessionType,
  SessionTransportType,
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
  supportsMaxThinkingTokens: boolean
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
  /** Accepts image attachments as first-class message input. */
  supportsMessageImages: boolean
}

export interface ProviderMachineAuthDescriptor {
  cliBinaryName: string
  installPackageName?: string
  authEnvKeys: string[]
  supportedAuthModes: MachineAuthMode[]
  requiresSecretModes: MachineAuthMode[]
  loginStatusCommand: string | null
}

export interface ProviderModelOption {
  id: string
  label: string
  description?: string
  default?: boolean
}

export interface ProviderDefaults {
  transportType: Exclude<SessionTransportType, 'external'>
  permissionMode: ClaudePermissionMode
  model: string | null
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
}

export interface ProviderRegistryEntry {
  id: AgentType
  label: string
  eventProvider: string
  capabilities: ProviderCapabilities
  uiCapabilities: ProviderUiCapabilities
  availableModels: ProviderModelOption[]
  supportedTransports: Exclude<SessionTransportType, 'external'>[]
  defaults: ProviderDefaults
  disabledReason: string | null
  machineAuth?: ProviderMachineAuthDescriptor
}

export interface ProviderRegistryResponse {
  providers: ProviderRegistryEntry[]
  defaultProviderId: AgentType
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
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  createdAt?: string
  spawnedBy?: string
  spawnedWorkers?: string[]
  resumedFrom?: string
  sessionType?: SessionType
  creator?: SessionCreator
  conversationId?: string
  currentSkillInvocation?: ActiveSkillInvocation
  daemonProcess?: PersistedDaemonProcess
}

export interface ProviderAdapter {
  readonly id: AgentType
  readonly label: string
  readonly eventProvider: string
  readonly approvalAdapter: ProviderApprovalAdapter<unknown, unknown>
  readonly capabilities: ProviderCapabilities
  readonly uiCapabilities: ProviderUiCapabilities
  readonly availableModels: readonly ProviderModelOption[]
  readonly defaults?: Partial<ProviderDefaults>
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

export function resolveProviderDefaults(provider: ProviderAdapter): ProviderDefaults {
  const availableModels = Array.isArray(provider.availableModels) ? provider.availableModels : []
  const configured = provider.defaults ?? {}
  const hasConfiguredModel = Object.prototype.hasOwnProperty.call(configured, 'model')

  const defaults: ProviderDefaults = {
    transportType: configured.transportType ?? 'stream',
    permissionMode: configured.permissionMode ?? 'default',
    model: hasConfiguredModel
      ? configured.model ?? null
      : availableModels.find((model) => model.default)?.id ?? null,
  }

  if (provider.uiCapabilities.supportsEffort && configured.effort !== undefined) {
    defaults.effort = configured.effort
  }
  if (
    provider.uiCapabilities.supportsAdaptiveThinking
    && configured.adaptiveThinking !== undefined
  ) {
    defaults.adaptiveThinking = configured.adaptiveThinking
  }
  if (
    provider.uiCapabilities.supportsMaxThinkingTokens
    && configured.maxThinkingTokens !== undefined
  ) {
    defaults.maxThinkingTokens = configured.maxThinkingTokens
  }

  return defaults
}
