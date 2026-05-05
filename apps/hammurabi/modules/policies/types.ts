import type { ProviderApprovalAdapter } from './provider-approval-adapter.js'

export const ACTION_POLICY_VALUES = ['auto', 'review', 'block'] as const

export type ActionPolicyDecision = (typeof ACTION_POLICY_VALUES)[number]
export type ActionPolicyValue = ActionPolicyDecision

export const FALLBACK_ACTION_POLICY_ID = 'everything-else'

export interface ActionCategoryMatcherDefinition {
  mcpServers: string[]
  bashPatterns: RegExp[]
  skillIds?: string[]
}

export interface ActionCategoryDefinition {
  id: string
  label: string
  group: string
  description?: string
  primaryTargetLabel?: string
  primaryTargetKey?: string
  matchers: ActionCategoryMatcherDefinition
}

export type ActionPolicyScope = 'global' | { commanderId: string }

export interface StandingApprovalEntry {
  email: string
  added_at: string
  added_by: string
  reason: string
  expires_at?: string
  permanent?: boolean
}

export interface ActionPolicyRecord {
  actionId: string
  policy: ActionPolicyValue
  allowlist: string[]
  blocklist: string[]
  standing_approval?: StandingApprovalEntry[]
  updatedAt?: string
  updatedBy?: string
}

export interface EffectiveActionPolicyView {
  scope: ActionPolicyScope
  fallbackPolicy: ActionPolicyValue
  records: ActionPolicyRecord[]
}

export interface ActionPolicySettings {
  timeoutMinutes: number
  timeoutAction: 'auto' | 'block'
  standingApprovalExpiryDays: number
}

export interface ApprovalContextTarget {
  label: string
  value: string
}

export interface ApprovalContext {
  summary: string
  details: Record<string, string>
  preview?: string
  primaryTarget?: ApprovalContextTarget
  command?: string
}

export type PendingApprovalSource = string
export type PendingApprovalResolution = 'approve' | 'reject'

export type PendingApprovalResolverRef =
  | {
    kind: 'claude'
    sessionId?: string
  }
  | {
    kind: 'codex'
    requestId: number
    threadId?: string
    itemId?: string
    turnId?: string
  }

export interface PendingApproval {
  id: string
  commanderId?: string
  sessionId?: string
  actionId: string
  actionLabel: string
  toolName: string
  toolInput?: unknown
  context: ApprovalContext
  requestedAt: string
  source: PendingApprovalSource
  resolverRef?: PendingApprovalResolverRef
  currentSkillId?: string
  currentSkillName?: string
  expiresAt?: string
  timeoutAction?: PendingApprovalResolution
  resolvedAt?: string
  resolution?: ApprovalResolutionOutcome
  deliveredAt?: string
}

export type PendingApprovalStatus =
  | {
    state: 'pending'
    approval: PendingApproval
  }
  | {
    state: 'resolved'
    approval: PendingApproval
    outcome: ApprovalResolutionOutcome
    delivered: boolean
  }

export interface ApprovalCoordinatorEvent {
  type: 'enqueued' | 'resolved'
  approval: PendingApproval
  decision?: PendingApprovalResolution
  delivered?: boolean
}

export interface ApprovalResolutionOutcome {
  decision: PendingApprovalResolution
  allowed: boolean
  reason?: string
  timedOut?: boolean
}

// Approval history has separate defaults for what operators see versus what
// stays on disk: `/api/approvals/history` surfaces the last 24h by default,
// while `audit.jsonl` retention defaults to 7 days before pruning.
export interface ApprovalHistoryEntry {
  timestamp: string
  type: 'approval.enqueued' | 'approval.resolved'
  approvalId: string
  actionId?: string
  actionLabel?: string
  commanderId?: string
  sessionId?: string
  source?: PendingApprovalSource
  toolName?: string
  summary?: string
  decision?: PendingApprovalResolution
  delivered?: boolean
  outcome?: ApprovalResolutionOutcome
}

export interface ApprovalHistoryFilter {
  commanderId?: string
  actionId?: string
  source?: PendingApprovalSource
  from?: string
  to?: string
  limit?: number
}

export interface ActionPolicySessionContext {
  commanderId?: string
  sessionId?: string
  cwd?: string
  currentSkillId?: string
  currentSkillName?: string
  currentSkillPolicy?: ActionPolicyValue | null
}

export interface ResolveActionPolicyInput {
  toolName: string
  toolInput?: unknown
  policyView: EffectiveActionPolicyView
  session?: ActionPolicySessionContext
  actions?: ActionCategoryDefinition[]
}

export interface ResolvedActionPolicy {
  action: ActionCategoryDefinition | null
  record: ActionPolicyRecord | null
  decision: ActionPolicyDecision
  basePolicy: ActionPolicyValue
  matchedBy: 'skill' | 'mcp' | 'bash' | 'tool' | 'fallback'
  matchedPattern?: string
  context: ApprovalContext
}

export interface PendingApprovalFilter {
  commanderId?: string
  sessionId?: string
  actionId?: string
  source?: PendingApprovalSource
}

export type PendingApprovalRecord = PendingApproval
export type PendingApprovalContext = ApprovalContext
export type ApprovalEventMessage = ApprovalCoordinatorEvent

export function isCommanderActionPolicyScope(
  scope: ActionPolicyScope,
): scope is { commanderId: string } {
  return typeof scope === 'object' && scope !== null && typeof scope.commanderId === 'string'
}

export function serializeActionPolicyScope(scope: ActionPolicyScope): string {
  return isCommanderActionPolicyScope(scope) ? `commander:${scope.commanderId}` : 'global'
}

const approvalAdapterRegistry = new Map<string, ProviderApprovalAdapter<unknown, unknown>>()

export function registerApprovalAdapter<T extends ProviderApprovalAdapter<unknown, unknown>>(adapter: T): T {
  const source = adapter.source.trim()
  if (!source) {
    throw new Error('Approval adapters must declare a non-empty source')
  }

  const existing = approvalAdapterRegistry.get(source)
  if (existing && existing !== adapter) {
    throw new Error(`Approval adapter "${source}" is already registered`)
  }

  approvalAdapterRegistry.set(source, adapter)
  return adapter
}

export function getApprovalAdapter(source: string): ProviderApprovalAdapter<unknown, unknown> | undefined {
  return approvalAdapterRegistry.get(source.trim())
}

export function listApprovalAdapters(): ProviderApprovalAdapter<unknown, unknown>[] {
  return [...approvalAdapterRegistry.values()]
}
