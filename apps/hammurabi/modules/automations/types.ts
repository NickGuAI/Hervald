/**
 * Automation entity — unifies scheduled, quest, and manual automations.
 *
 * One entity, three trigger discriminators (`schedule | quest | manual`).
 * Two ownership levels: operator-level (`parentCommanderId=null`) and
 * commander-scoped (`parentCommanderId=<id>`). Both shapes live in the same
 * Automation table.
 *
 * Source of truth: #1198 [Spec v8] Domain model block + #1296 unification scope.
 *
 * NOTE: `agentType` is currently typed as the closed `AgentType` union from
 * `../agents/types`. After #1294 (provider adapter registry) ships, this
 * field will widen to `ProviderId` (string) — see
 * `../agents/adapters/provider-registry-types.ts`. The migration is
 * mechanical (single-line type alias swap).
 */

import type { AgentType, ClaudePermissionMode } from '../agents/types.js'

export type AutomationTrigger = 'schedule' | 'quest' | 'manual'
export type AutomationQuestEvent = 'completed'
export type AutomationStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type AutomationExecutionSource = AutomationTrigger
export type AutomationSessionType = 'stream' | 'pty'

export interface AutomationQuestTrigger {
  event: AutomationQuestEvent
  /**
   * When set, the automation only fires on quests completed by this specific
   * commander. When absent, the automation fires on quests completed by any
   * commander.
   */
  commanderId?: string
}

export interface AutomationHistoryEntry {
  timestamp: string
  action: string
  result: string
  costUsd: number
  durationSec: number
  sessionId?: string
  runFile?: string
  memoryUpdated?: boolean
  source?: AutomationExecutionSource
}

export interface AutomationRunMetadata {
  automationId: string
  automationName: string
  runNumber: number
  timestamp: string
  action: string
  result: string
  costUsd: number
  durationSec: number
  sessionId: string
  memoryUpdated: boolean
  status: 'complete' | 'failed' | 'timeout'
  source: AutomationExecutionSource
}

export interface Automation {
  id: string
  /** REQUIRED — never derived. Multi-operator never requires data migration. */
  operatorId: string
  /** Optional. `null` = operator-level, set = commander-scoped. */
  parentCommanderId?: string | null
  name: string
  trigger: AutomationTrigger
  /** Required when `trigger === 'schedule'`; cron expression. */
  schedule?: string
  /** Required when `trigger === 'quest'`. */
  questTrigger?: AutomationQuestTrigger
  instruction: string
  agentType: AgentType
  permissionMode: ClaudePermissionMode
  /** Workspace `.config/` skill names (no per-automation skill binding). */
  skills: string[]
  templateId?: string | null
  status: AutomationStatus
  description?: string
  timezone?: string
  machine?: string
  workDir?: string
  model?: string
  sessionType?: AutomationSessionType
  createdAt?: string
  lastRun?: string | null
  totalRuns?: number
  totalCostUsd?: number
  history?: AutomationHistoryEntry[]
  observations?: string[]
  seedMemory?: string
  memoryPath?: string
  outputDir?: string
  maxRuns?: number
}
