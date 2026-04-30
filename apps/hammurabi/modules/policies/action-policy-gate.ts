import type { ApprovalSessionContext, ApprovalSessionsInterface } from '../agents/types.js'
import { ApprovalCoordinator } from './pending-store.js'
import { resolveActionPolicy } from './resolver.js'
import { PolicyStore } from './store.js'
import {
  FALLBACK_ACTION_POLICY_ID,
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
  decision: 'allow' | 'deny'
  policyDecision: 'auto' | 'review' | 'block'
  reason?: string
  sessionContext: ApprovalSessionContext | null
}

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

export class ActionPolicyGate {
  private readonly approvalCoordinator: ApprovalCoordinator

  private readonly getApprovalSessionsInterface: () => ApprovalSessionsInterface | null

  private readonly policyStore: PolicyStore

  constructor(options: ActionPolicyGateOptions) {
    this.approvalCoordinator = options.approvalCoordinator
    this.getApprovalSessionsInterface = options.getApprovalSessionsInterface
    this.policyStore = options.policyStore
  }

  async enforceAndWait(request: ActionPolicyGateRequest): Promise<ActionPolicyGateResult> {
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
          resolved.context.summary || `${actionLabel} is blocked by policy.`,
          `${actionLabel} is blocked by policy.`,
        ),
        sessionContext,
      }
    }

    const approval = await this.approvalCoordinator.enqueue(
      {
        source: request.source,
        sessionId: sessionContext?.sessionName ?? request.fallbackSessionName,
        commanderId: sessionContext?.commanderScopeId,
        actionId,
        actionLabel,
        toolName: request.toolName,
        toolInput: request.toolInput,
        context: resolved.context,
        currentSkillId: sessionContext?.currentSkillInvocation?.skillId,
        currentSkillName: sessionContext?.currentSkillInvocation?.displayName,
      },
    )

    const settings = await this.policyStore.getSettings()
    const outcome = await this.approvalCoordinator.waitForResolution(approval.id, {
      timeoutMs: settings.timeoutMinutes * 60_000,
      timeoutAction: settings.timeoutAction === 'auto' ? 'approve' : 'reject',
    })

    return {
      actionId,
      actionLabel,
      approvalId: approval.id,
      decision: outcome.allowed ? 'allow' : 'deny',
      policyDecision: resolved.decision,
      reason: outcome.reason,
      sessionContext,
    }
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
