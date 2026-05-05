/**
 * Org chart read model — the shape returned by `GET /api/org`.
 *
 * `OrgNode` is server-owned. The `/org` UI consumes the read model directly;
 * no client-side ancestry inference, no derived classifiers (Constraint #5).
 *
 * Source of truth: #1198 [Spec v8] Domain model block.
 */

import type { Operator } from '../operators/types.js'
import type { AutomationTrigger } from '../automations/types.js'
import type { OrgIdentity } from '../org-identity/types.js'

export type OrgNodeKind = 'operator' | 'commander' | 'automation'
export type OrgCommanderRoleKey =
  | 'engineering'
  | 'research'
  | 'ops'
  | 'content'
  | 'validator'
  | 'ea'

/** Per-provider channel binding counts for a commander. Always populated. */
export interface OrgChannelsByProvider {
  whatsapp: number
  telegram: number
  discord: number
}

export interface OrgQuestsInFlight {
  active: number
  pending: number
}

export interface OrgCommanderCounts {
  activeQuests: number
  activeWorkers: number
  activeChats: number
}

export interface OrgNode {
  id: string
  kind: OrgNodeKind
  parentId: string | null
  displayName: string
  /** Commander only — closed enum from the `roleKey` doctrine. */
  roleKey?: OrgCommanderRoleKey
  /** Commander only — sourced from CommanderProfile, not Commander (Constraint #20). */
  avatarUrl?: string | null
  /**
   * Passthrough of the underlying entity status (Constraint #19).
   * Never invents new status values. Unknown values render neutral.
   */
  status: string
  /** Rolling-window cost; UI labels the window. Commander value comes from `aggregateCommanderWorldAgentSource`. */
  costUsd: number
  recentActivityAt?: string | null
  /** Commander only — always populated, even `{ active: 0, pending: 0 }` (Constraint #18). */
  questsInFlight?: OrgQuestsInFlight
  /** Commander only — always populated, even when all 0 (Constraint #22). */
  channels?: OrgChannelsByProvider
  /** Commander only — always populated, even 0 (Constraint #23). */
  activeUiChats?: number
  /** Commander only — precomputed status-card counts. */
  counts?: OrgCommanderCounts
  /** Commander only — archived commanders are hidden unless requested. */
  archived?: boolean
  archivedAt?: string
  templateId?: string | null
  /** Automation only — persisted trigger discriminator for explicit UI rendering. */
  trigger?: AutomationTrigger
  replicatedFromCommanderId?: string | null
}

export interface OrgTree {
  operator: Operator
  orgIdentity: OrgIdentity | null
  archivedCommandersCount: number
  commanders: OrgNode[]
  automations: OrgNode[]
}
