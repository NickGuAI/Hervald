import type { ApprovalSessionContext, ApprovalSessionsInterface } from '../agents/types.js'
import { ApprovalCoordinator } from './pending-store.js'
import { resolveActionPolicy } from './resolver.js'
import { PolicyStore } from './store.js'
import {
  FALLBACK_ACTION_POLICY_ID,
  type ApprovalContext,
  type PendingApprovalSource,
} from './types.js'

export interface ActionPolicyGateOptions {
  approvalCoordinator: ApprovalCoordinator
  getApprovalSessionsInterface: () => ApprovalSessionsInterface | null
  policyStore: PolicyStore
}

export interface ActionPolicyGateRequest {
  source: PendingApprovalSource
  toolName: string
  toolInput?: unknown
  sessionName?: string
  providerContext?: unknown
  sessionContext?: ApprovalSessionContext | null
  fallbackSessionName?: string
}

export interface ActionPolicyGateResult {
  actionId: string
  actionLabel: string
  approvalId?: string
  decision: 'allow' | 'deny' | 'cancel'
  policyDecision: 'auto' | 'review' | 'block'
  reason?: string
  sessionContext: ApprovalSessionContext | null
}

export interface ActionPolicyGatePendingResult {
  actionId: string
  actionLabel: string
  approvalId: string
  decision: 'pending'
  policyDecision: 'review'
  retryAfterMs: number
  sessionContext: ApprovalSessionContext | null
}

export type ActionPolicyGateEvaluationResult = ActionPolicyGateResult | ActionPolicyGatePendingResult

export const DEFAULT_REVIEW_RETRY_AFTER_MS = 1_000

function getCurrentSkillPolicy(
  policyView: Awaited<ReturnType<PolicyStore['resolveEffective']>>,
  skillId: string,
): 'auto' | 'review' | 'block' {
  const normalizedSkillId = skillId.trim()
  if (!normalizedSkillId) {
    return policyView.fallbackPolicy
  }

  return policyView.records.find((record) => record.actionId === `skill:${normalizedSkillId}`)?.policy
    ?? policyView.fallbackPolicy
}

function toDeniedReason(reason: string | undefined, fallback: string): string {
  const trimmed = reason?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function addDetail(details: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    details[key] = String(value)
    return
  }
  if (typeof value !== 'string') {
    return
  }
  const trimmed = value.trim()
  if (trimmed) {
    details[key] = trimmed
  }
}

function enrichApprovalContext(
  context: ApprovalContext,
  request: ActionPolicyGateRequest,
  sessionContext: ApprovalSessionContext | null,
): ApprovalContext {
  const providerContext = asRecord(request.providerContext)
  const details = { ...context.details }

  addDetail(details, 'Provider', providerContext?.provider ?? request.source)
  addDetail(details, 'Connector', providerContext?.serverName ?? providerContext?.connector)
  addDetail(details, 'Tool', providerContext?.tool ?? request.toolName)
  addDetail(details, 'Request ID', providerContext?.requestId)
  addDetail(details, 'Thread ID', providerContext?.threadId)
  addDetail(details, 'Item ID', providerContext?.itemId)
  addDetail(details, 'Turn ID', providerContext?.turnId)
  addDetail(details, 'Session', sessionContext?.sessionName ?? request.fallbackSessionName)
  addDetail(details, 'CWD', sessionContext?.cwd)

  return {
    ...context,
    details,
  }
}

export class ActionPolicyGate {
  private readonly approvalCoordinator: ApprovalCoordinator

  private readonly getApprovalSessionsInterface: () => ApprovalSessionsInterface | null

  private readonly policyStore: PolicyStore

  constructor(options: ActionPolicyGateOptions) {
    this.approvalCoordinator = options.approvalCoordinator
    this.getApprovalSessionsInterface = options.getApprovalSessionsInterface
    this.policyStore = options.policyStore
  }

  async enforce(
    request: ActionPolicyGateRequest,
    options: { waitForReview?: boolean } = {},
  ): Promise<ActionPolicyGateEvaluationResult> {
    const approvalSessionsInterface = this.getApprovalSessionsInterface()
    const sessionContext = this.resolveSessionContext(request, approvalSessionsInterface)
    const policyView = await this.policyStore.resolveEffective(sessionContext?.commanderScopeId)
    const resolved = resolveActionPolicy({
      toolName: request.toolName,
      toolInput: request.toolInput,
      policyView,
      session: sessionContext?.currentSkillInvocation
        ? {
          commanderId: sessionContext.commanderScopeId,
          sessionId: sessionContext.sessionName,
          cwd: sessionContext.cwd,
          currentSkillId: sessionContext.currentSkillInvocation.skillId,
          currentSkillName: sessionContext.currentSkillInvocation.displayName,
          currentSkillPolicy: getCurrentSkillPolicy(
            policyView,
            sessionContext.currentSkillInvocation.skillId,
          ),
        }
        : {
          commanderId: sessionContext?.commanderScopeId,
          sessionId: sessionContext?.sessionName,
          cwd: sessionContext?.cwd,
        },
    })

    const actionId = resolved.action?.id ?? FALLBACK_ACTION_POLICY_ID
    const actionLabel = resolved.action?.label ?? request.toolName
    const context = enrichApprovalContext(resolved.context, request, sessionContext)

    if (resolved.decision === 'auto') {
      return {
        actionId,
        actionLabel,
        decision: 'allow',
        policyDecision: resolved.decision,
        sessionContext,
      }
    }

    if (resolved.decision === 'block') {
      return {
        actionId,
        actionLabel,
        decision: 'deny',
        policyDecision: resolved.decision,
        reason: toDeniedReason(
          context.summary || `${actionLabel} is blocked by policy.`,
          `${actionLabel} is blocked by policy.`,
        ),
        sessionContext,
      }
    }

    const settings = await this.policyStore.getSettings()
    const approval = await this.approvalCoordinator.enqueue(
      {
        source: request.source,
        sessionId: sessionContext?.sessionName ?? request.fallbackSessionName,
        commanderId: sessionContext?.commanderScopeId,
        actionId,
        actionLabel,
        toolName: request.toolName,
        toolInput: request.toolInput,
        context,
        currentSkillId: sessionContext?.currentSkillInvocation?.skillId,
        currentSkillName: sessionContext?.currentSkillInvocation?.displayName,
      },
      {
        timeoutMs: settings.timeoutMinutes * 60_000,
        timeoutAction: settings.timeoutAction === 'auto' ? 'approve' : 'reject',
      },
    )

    if (options.waitForReview === false) {
      return {
        actionId,
        actionLabel,
        approvalId: approval.id,
        decision: 'pending',
        policyDecision: resolved.decision,
        retryAfterMs: DEFAULT_REVIEW_RETRY_AFTER_MS,
        sessionContext,
      }
    }

    const outcome = await this.approvalCoordinator.waitForResolution(approval.id, {
      timeoutMs: settings.timeoutMinutes * 60_000,
      timeoutAction: settings.timeoutAction === 'auto' ? 'approve' : 'reject',
    })

    return {
      actionId,
      actionLabel,
      approvalId: approval.id,
      decision: outcome.decision === 'cancel' ? 'cancel' : outcome.allowed ? 'allow' : 'deny',
      policyDecision: resolved.decision,
      reason: outcome.reason,
      sessionContext,
    }
  }

  async enforceAndWait(request: ActionPolicyGateRequest): Promise<ActionPolicyGateResult> {
    const result = await this.enforce(request)
    if (result.decision === 'pending') {
      throw new Error('Expected a terminal approval decision')
    }
    return result
  }

  private resolveSessionContext(
    request: ActionPolicyGateRequest,
    approvalSessionsInterface: ApprovalSessionsInterface | null,
  ): ApprovalSessionContext | null {
    if (request.sessionContext !== undefined) {
      return request.sessionContext
    }

    if (!approvalSessionsInterface) {
      return null
    }

    const sessionName = request.sessionName?.trim()
    if (sessionName) {
      const sessionContext = approvalSessionsInterface.getSessionContext(sessionName)
      if (sessionContext) {
        return sessionContext
      }
    }

    return null
  }
}
