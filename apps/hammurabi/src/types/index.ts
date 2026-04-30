import type { HammurabiEvent } from './hammurabi-events.js'
import type { ClaudeAdaptiveThinkingMode } from '../../modules/claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../modules/claude-effort.js'
export type { HammurabiEvent, HammurabiEventSource } from './hammurabi-events.js'

// Module system types
export interface FrontendModule {
  name: string
  label: string
  icon: string
  path: string
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
  component: () => Promise<{ default: React.ComponentType }>
}

// Agents types
export type AgentType = 'claude' | 'codex' | 'gemini'
export type SessionType = 'commander' | 'worker' | 'cron' | 'sentinel'
export type SessionTransportType = 'pty' | 'stream' | 'external'
export type SessionCreatorKind = 'human' | 'commander' | 'cron' | 'sentinel'

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
  tailscaleHostname?: string
  user?: string
  port?: number
  cwd?: string
  envFile?: string
}

export interface CreateMachineInput {
  id: string
  label: string
  host: string
  user?: string
  port?: number
  cwd?: string
}

export type MachineAuthProvider = 'claude' | 'codex' | 'gemini'
export type MachineAuthMode = 'setup-token' | 'api-key' | 'device-auth'
export type MachineAuthMethod = MachineAuthMode | 'login' | 'missing'

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

export type ClaudePermissionMode = 'default'

export interface CreateSessionInput {
  name: string
  task?: string
  cwd?: string
  transportType?: Exclude<SessionTransportType, 'external'>
  sessionType?: SessionType
  agentType?: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
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

// Stream events in the agents UI now use the shared Hammurabi contract.
export type StreamEvent = HammurabiEvent

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

// Services types
export type ServiceStatus = 'running' | 'degraded' | 'stopped'

export interface ServiceInfo {
  name: string
  port: number
  script: string
  status: ServiceStatus
  healthy: boolean
  listening: boolean
  healthUrl: string
  lastChecked: string
}

export interface SystemMetrics {
  cpuCount: number
  loadAvg: [number, number, number]
  memTotalBytes: number
  memFreeBytes: number
  memUsedPercent: number
}

export type VercelDeploymentStatus =
  | 'READY'
  | 'BUILDING'
  | 'ERROR'
  | 'QUEUED'
  | 'CANCELED'
  | 'INITIALIZING'
  | 'UNKNOWN'

export interface VercelDeploymentInfo {
  id: string
  name: string
  url: string | null
  status: VercelDeploymentStatus
  branch: string | null
  commitSha: string | null
  createdAt: string | null
}

export interface VercelProjectInfo {
  id: string
  name: string
  framework: string | null
  productionBranch: string | null
  latestDeployment: VercelDeploymentInfo | null
}
