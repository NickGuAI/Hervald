import type { HammurabiEvent } from './hammurabi-events.js'
import type { TranscriptEnvelope } from './transcript-envelope.js'
import type { ClaudeAdaptiveThinkingMode } from '../../modules/claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../modules/claude-effort.js'
import type { ClaudeMaxThinkingTokens } from '../../modules/claude-max-thinking-tokens.js'
import type { HammurabiUiSurface } from './module-manifest.js'
export type { HammurabiEvent, HammurabiEventSource } from './hammurabi-events.js'
export type {
  TranscriptEnvelope,
  TranscriptEnvelopeEvent,
  TranscriptEnvelopeSource,
} from './transcript-envelope.js'

// Module system types
export interface FrontendModuleBinding {
  name: string
  routeId: string
  componentKey: string
  component: () => Promise<{ default: React.ComponentType }>
}

export interface FrontendNavItem {
  name: string
  routeId: string
  label: string
  icon: string
  path: string
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
  surfaces: readonly HammurabiUiSurface[]
  order?: number
  badge?: number
}

export interface FrontendModule extends FrontendNavItem, FrontendModuleBinding {
}

// Agents types
export type ProviderId = string
export type AgentType = ProviderId
export type SessionType = 'commander' | 'worker' | 'cron' | 'sentinel' | 'automation'
export type SessionTransportType = 'pty' | 'stream' | 'external'
export type SessionCreatorKind = 'human' | 'commander' | 'cron' | 'sentinel' | 'automation'
export type ClaudePermissionMode = 'default'
export type MachineAuthProvider = ProviderId
export type MachineAuthMode = 'setup-token' | 'api-key' | 'device-auth'
export type MachineAuthMethod = MachineAuthMode | 'login' | 'missing'

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
  forcedTransport?: Exclude<SessionTransportType, 'external'>
  permissionModes: ProviderPermissionModeOption[]
  infoBanner?: ProviderInfoBanner
}

export interface ProviderCapabilities {
  supportsAutomation: boolean
  supportsCommanderConversation: boolean
  supportsWorkerDispatch: boolean
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
  id: ProviderId
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
  defaultProviderId: ProviderId
}

export interface SessionCreator {
  kind: SessionCreatorKind
  id?: string
}

export type AgentSessionStatus = 'active' | 'idle' | 'stale' | 'completed' | 'exited'

export interface AgentWorkerSummary {
  total: number
  starting: number
  running: number
  down: number
  done: number
}

export type QueuedMessagePriority = 'high' | 'normal' | 'low'

export interface QueuedMessage {
  id: string
  text: string
  displayText?: string
  images?: Array<{
    mediaType: string
    data: string
  }>
  priority: QueuedMessagePriority
  queuedAt: string
}

export interface SessionQueueSnapshot {
  items: QueuedMessage[]
  currentMessage?: QueuedMessage | null
  maxSize?: number
  totalCount?: number
}

export interface AgentSession {
  name: string
  label?: string
  created: string
  pid: number
  sessionType?: SessionType
  transportType?: SessionTransportType
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  model?: string
  cwd?: string
  host?: string
  creator?: SessionCreator
  spawnedBy?: string
  spawnedWorkers?: string[]
  workerSummary?: AgentWorkerSummary
  processAlive?: boolean
  hadResult?: boolean
  resumedFrom?: string
  status?: AgentSessionStatus
  resumeAvailable?: boolean
  queuedMessageCount?: number
}

export type ProviderAuthStatus = 'ready' | 'auth_required' | 'unknown'
export type ProviderAuthMethod = 'oauth' | 'api-key' | 'login' | 'missing'

export interface ProviderAuthSnapshot {
  provider: AgentType
  scopeId: string
  host: string
  status: ProviderAuthStatus
  lastCheckedAt: string
  accountId?: string
  accountEmail?: string
  detail?: string
  reauthUrl?: string
  authMethod?: ProviderAuthMethod
}

export interface ProviderAuthSnapshotsResponse {
  snapshots: ProviderAuthSnapshot[]
}

export interface ProviderReauthStartResponse {
  provider: AgentType
  scopeId: string
  host: string
  state: string
  authorizationUrl: string
  callbackUrl: string
  expiresAt: string
}

// hamRPG world types
export const AGENT_PHASES = ['FORGE', 'LIBRARY', 'ARMORY', 'DUNGEON', 'THRONE_ROOM', 'GATE'] as const
export type AgentPhase = (typeof AGENT_PHASES)[number]

export type WorldAgentStatus = 'active' | 'idle' | 'stale' | 'completed'
export type WorldAgentRuntimePhase = 'idle' | 'executing' | 'editing' | 'researching' | 'delegating'

export interface WorldAgent {
  id: string
  transportType: SessionTransportType
  agentType: AgentType
  status: WorldAgentStatus
  phase: WorldAgentRuntimePhase
  zone?: AgentPhase
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
  quest: string
  lastUpdatedAt: string
  spawnPos: {
    x: number
    y: number
  }
}

export interface Machine {
  id: string
  label: string
  host: string | null
  transport?: 'local' | 'ssh' | 'daemon'
  tailscaleHostname?: string
  user?: string
  port?: number
  cwd?: string
  envFile?: string
  daemon?: {
    pairedAt: string | null
    revokedAt: string | null
    lastSeenAt: string | null
    daemonVersion: string | null
  }
}

export interface MachineDaemonProviderHealth {
  provider: string
  installed: boolean
  authenticated: boolean
  version: string | null
  authMethod: string | null
  detail: string | null
  checkedAt: string | null
}

export type MachineDaemonConnectionState =
  | 'local'
  | 'ssh-local'
  | 'not-paired'
  | 'paired'
  | 'connected'

export type MachineDaemonProviderAuthState = 'ready' | 'missing' | 'not-checked'

export type MachineDaemonActionId = 'pair' | 'rotate' | 'revoke'

export interface MachineDaemonAction {
  id: MachineDaemonActionId
  label: string
}

export interface MachineDaemonPairCommand {
  shortCommand: string
  fullCommand: string
  disclosureLabel: string
}

export interface MachineDaemonStatus {
  machineId: string
  displayLabel: string
  paired: boolean
  connected: boolean
  connectionState: MachineDaemonConnectionState
  connectionLabel: string
  selectedTransport: 'local' | 'ssh' | 'daemon'
  providerAuthReady: boolean
  providerAuthState: MachineDaemonProviderAuthState
  providerAuthLabel: string
  launchable: boolean
  launchUnsupportedReason: string | null
  allowedActions: MachineDaemonAction[]
  pairedAt: string | null
  revokedAt: string | null
  connectedAt: string | null
  lastSeenAt: string | null
  connectionId: string | null
  daemonVersion: string | null
  protocolVersion: number | null
  pid: number | null
  platform: string | null
  arch: string | null
  activeProcesses: number | null
  providerHealth: Record<string, MachineDaemonProviderHealth>
}

export interface MachineDaemonPairResponse {
  machine: Machine
  pairing: {
    machineId: string
    token: string
    websocketPath: string
    pairedAt: string
    command: MachineDaemonPairCommand
  }
  status: MachineDaemonStatus
}

export interface MachineDaemonRevokeResponse {
  machine: Machine
  status: MachineDaemonStatus
  revokedAt: string
}

export interface CreateMachineInput {
  id: string
  label: string
  host: string
  user?: string
  port?: number
  cwd?: string
}

export interface MachineProviderAuthStatus {
  provider: MachineAuthProvider
  label: string
  installed: boolean
  version: string | null
  envConfigured: boolean
  envSourceKey: string | null
  loginConfigured: boolean
  configured: boolean
  currentMethod: MachineAuthMethod
  verificationCommand: string
}

export interface MachineAuthStatusReport {
  machineId: string
  envFile: string | null
  checkedAt: string
  providers: Record<MachineAuthProvider, MachineProviderAuthStatus>
}

export interface MachineAuthSetupInput {
  provider: MachineAuthProvider
  mode: MachineAuthMode
  secret?: string
}

export interface CreateSessionInput {
  name: string
  task?: string
  cwd?: string
  transportType?: Exclude<SessionTransportType, 'external'>
  sessionType?: SessionType
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  host?: string
  resumeFromSession?: string
}

// AskUserQuestion types
export interface AskOption {
  label: string
  description?: string
}

export interface AskQuestion {
  question: string
  header: string
  options: AskOption[]
  multiSelect: boolean
}

// Stream events in the agents UI can be historical Hammurabi events or v2 transcript envelopes.
export type StreamEvent = HammurabiEvent | TranscriptEnvelope

// Telemetry types
export type SessionStatus = 'active' | 'idle' | 'stale' | 'completed'

export interface TelemetrySession {
  id: string
  agentName: string
  model: string
  currentTask: string
  status: SessionStatus
  startedAt: string
  lastHeartbeat: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  callCount: number
}

export interface TelemetryCall {
  id: string
  sessionId: string
  timestamp: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
}

export interface TelemetrySummary {
  costToday: number
  costWeek: number
  costMonth: number
  costPeriod?: number
  inputTokensToday: number
  inputTokensWeek: number
  inputTokensMonth: number
  inputTokensPeriod?: number
  outputTokensToday: number
  outputTokensWeek: number
  outputTokensMonth: number
  outputTokensPeriod?: number
  totalTokensToday: number
  totalTokensWeek: number
  totalTokensMonth: number
  totalTokensPeriod?: number
  activeSessions: number
  totalSessions: number
  topModels: { model: string; cost: number; calls: number }[]
  topAgents: { agent: string; cost: number; sessions: number }[]
  dailyCosts: { date: string; costUsd: number }[]
  period?: string
  periodStartKey?: string
  periodEndKey?: string
  retentionDays?: number
  periodOutsideRetention?: boolean
}
