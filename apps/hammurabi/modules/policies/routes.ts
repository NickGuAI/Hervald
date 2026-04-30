import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import {
  buildFallbackClaudeApprovalSession,
  claudeApprovalAdapter,
} from '../agents/adapters/claude/approval-adapter.js'
import type { ApprovalSessionsInterface } from '../agents/routes.js'
import { ActionPolicyGate } from './action-policy-gate.js'
import { getBuiltInAction } from './registry.js'
import { ApprovalCoordinator } from './pending-store.js'
import { handleProviderApproval } from './provider-approval-adapter.js'
import { PolicyStore } from './store.js'
import {
  FALLBACK_ACTION_POLICY_ID,
  serializeActionPolicyScope,
  type ActionCategoryDefinition,
  type ActionPolicyRecord,
  type ActionPolicyScope,
  type ActionPolicyValue,
} from './types.js'

export interface PoliciesRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  policyStore: PolicyStore
  approvalCoordinator: ApprovalCoordinator
  approvalSessionsInterface: ApprovalSessionsInterface
  actionPolicyGate: ActionPolicyGate
}

function parseScope(raw: unknown): ActionPolicyScope | null {
  if (raw === undefined || raw === null || raw === '') {
    return 'global'
  }
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed === 'global') {
    return 'global'
  }
  if (trimmed.startsWith('commander:')) {
    const commanderId = trimmed.slice('commander:'.length).trim()
    if (commanderId.length > 0) {
      return { commanderId }
    }
  }
  return null
}

function normalizePolicyValue(value: unknown): ActionPolicyValue | null {
  return value === 'auto' || value === 'review' || value === 'block' ? value : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizeTimeoutMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function normalizeTimeoutAction(value: unknown): 'auto' | 'block' | null {
  return value === 'auto' || value === 'block' ? value : null
}

function normalizeStandingApprovalExpiryDays(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

function toActionMetadata(actionId: string): ActionCategoryDefinition {
  if (actionId === FALLBACK_ACTION_POLICY_ID) {
    return {
      id: actionId,
      label: 'Everything Else',
      group: 'Default',
      description: 'Fallback policy for actions that do not match a built-in category or skill.',
      primaryTargetLabel: 'Target',
      matchers: {
        mcpServers: [],
        bashPatterns: [],
      },
    }
  }

  if (actionId.startsWith('skill:')) {
    const skillName = actionId.slice('skill:'.length)
    return {
      id: actionId,
      label: `/${skillName}`,
      group: 'Skills',
      primaryTargetLabel: 'Skill',
      matchers: {
        mcpServers: [],
        bashPatterns: [],
      },
    }
  }

  return getBuiltInAction(actionId) ?? {
    id: actionId,
    label: actionId,
    group: 'Custom',
    primaryTargetLabel: 'Target',
    matchers: {
      mcpServers: [],
      bashPatterns: [],
    },
  }
}

function toPolicyResponse(
  actionId: string,
  scope: ActionPolicyScope,
  sourceScope: string,
  record: Pick<ActionPolicyRecord, 'actionId' | 'policy' | 'allowlist' | 'blocklist' | 'standing_approval'>,
) {
  const metadata = toActionMetadata(actionId)
  return {
    actionId,
    id: actionId,
    name: metadata.label,
    kind: actionId.startsWith('skill:') ? 'skill' : 'action',
    policy: record.policy,
    allowlist: record.allowlist,
    blocklist: record.blocklist,
    ...(record.standing_approval ? { standing_approval: record.standing_approval } : {}),
    description: metadata.description,
    group: metadata.group,
    category: metadata.group,
    targetLabel: metadata.primaryTargetLabel,
    scope: serializeActionPolicyScope(scope),
    sourceScope,
  }
}

export function createPoliciesRouter(options: PoliciesRouterOptions): { router: Router } {
  const router = Router()

  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    internalToken: options.internalToken,
    verifyToken: options.verifyAuth0Token,
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    internalToken: options.internalToken,
    verifyToken: options.verifyAuth0Token,
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
  })

  router.get('/action-policies', requireReadAccess, async (req, res) => {
    const scope = parseScope(req.query.scope)
    if (!scope) {
      res.status(400).json({ error: 'scope must be "global" or "commander:<id>"' })
      return
    }

    const commanderId = typeof scope === 'object' ? scope.commanderId : undefined
    const effective = await options.policyStore.resolveEffective(commanderId)
    const overrides = commanderId
      ? await options.policyStore.getCommanderOverrides(commanderId)
      : { records: [] as typeof effective.records }
    const overrideIds = new Set(overrides.records.map((record) => record.actionId))
    const serializedScope = serializeActionPolicyScope(scope)
    const policies = effective.records.map((record) => toPolicyResponse(
      record.actionId,
      scope,
      commanderId
        ? (overrideIds.has(record.actionId) ? serializedScope : 'global')
        : 'global',
      record,
    ))

    policies.push(
      toPolicyResponse(
        FALLBACK_ACTION_POLICY_ID,
        scope,
        commanderId && overrides.fallbackPolicy !== undefined ? serializedScope : 'global',
        {
          actionId: FALLBACK_ACTION_POLICY_ID,
          policy: effective.fallbackPolicy,
          allowlist: [],
          blocklist: [],
        },
      ),
    )

    res.json(policies)
  })

  router.put('/action-policies', requireWriteAccess, async (req, res) => {
    const scope = parseScope(req.body?.scope)
    if (!scope) {
      res.status(400).json({ error: 'scope must be "global" or "commander:<id>"' })
      return
    }

    const actionId = typeof req.body?.actionId === 'string'
      ? req.body.actionId.trim()
      : typeof req.body?.id === 'string'
        ? req.body.id.trim()
        : ''
    const policy = normalizePolicyValue(req.body?.policy)
    if (!actionId || !policy) {
      res.status(400).json({ error: 'actionId/id and policy are required' })
      return
    }

    const record = await options.policyStore.putPolicy(scope, actionId, {
      policy,
      allowlist: normalizeStringArray(req.body?.allowlist),
      blocklist: normalizeStringArray(req.body?.blocklist),
      updatedBy: req.user?.email ?? req.user?.id,
    })

    if (!record) {
      res.json({ ok: true })
      return
    }

    res.json([
      toPolicyResponse(
        actionId,
        scope,
        serializeActionPolicyScope(scope),
        record,
      ),
    ])
  })

  router.get('/action-policies/settings', requireReadAccess, async (_req, res) => {
    res.json({
      settings: await options.policyStore.getSettings(),
    })
  })

  router.put('/action-policies/settings', requireWriteAccess, async (req, res) => {
    const timeoutMinutes = normalizeTimeoutMinutes(req.body?.timeoutMinutes)
    const timeoutAction = normalizeTimeoutAction(req.body?.timeoutAction)
    const standingApprovalExpiryDays = normalizeStandingApprovalExpiryDays(req.body?.standingApprovalExpiryDays)

    if (timeoutMinutes === null && timeoutAction === null && standingApprovalExpiryDays === null) {
      res.status(400).json({ error: 'timeoutMinutes, timeoutAction, or standingApprovalExpiryDays is required' })
      return
    }

    const settings = await options.policyStore.putSettings({
      ...(timeoutMinutes !== null ? { timeoutMinutes } : {}),
      ...(timeoutAction !== null ? { timeoutAction } : {}),
      ...(standingApprovalExpiryDays !== null ? { standingApprovalExpiryDays } : {}),
    })

    res.json({ settings })
  })

  router.post('/approval/check', requireWriteAccess, async (req, res) => {
    const payload = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : null
    const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name.trim() : ''
    if (!toolName) {
      res.json({ decision: 'allow' })
      return
    }

    const resolvedSessionName = typeof payload?.hammurabi_session_name === 'string'
      && payload.hammurabi_session_name.trim().length > 0
      ? payload.hammurabi_session_name.trim()
      : undefined
    const resolvedClaudeSessionId = typeof payload?.session_id === 'string'
      && payload.session_id.trim().length > 0
      ? payload.session_id.trim()
      : undefined
    const liveSession = (
      resolvedSessionName
        ? options.approvalSessionsInterface.getLiveSession(resolvedSessionName)
        : null
    ) ?? (
      resolvedClaudeSessionId
        ? options.approvalSessionsInterface.findLiveSessionByClaudeSessionId(resolvedClaudeSessionId)
        : null
    ) ?? buildFallbackClaudeApprovalSession(resolvedSessionName ?? 'claude-hook')

    await handleProviderApproval(
      claudeApprovalAdapter,
      {
        payload: payload ?? {},
        respond(body) {
          res.json(body)
        },
      },
      liveSession,
      { actionPolicyGate: options.actionPolicyGate },
    )
  })

  router.post('/approval/decide', requireWriteAccess, async (req, res) => {
    const approvalId = typeof req.body?.id === 'string'
      ? req.body.id.trim()
      : typeof req.body?.id === 'number'
        ? String(req.body.id)
        : ''
    const decision = req.body?.decision === 'approve' || req.body?.decision === 'reject'
      ? req.body.decision
      : null
    if (!approvalId || !decision) {
      res.status(400).json({ error: 'id and decision are required' })
      return
    }

    const resolved = await options.approvalCoordinator.resolvePendingApproval(approvalId, decision)
    if (resolved.ok) {
      res.json({
        ok: true,
        id: approvalId,
        decision,
      })
      return
    }

    const codexResolved = options.approvalSessionsInterface.resolvePendingCodexApproval(
      approvalId,
      decision === 'approve' ? 'accept' : 'decline',
    )
    if (!codexResolved.ok) {
      res.status(codexResolved.code === 'not_found' ? 404 : 503).json({
        error: resolved.error ?? codexResolved.reason ?? 'Approval was not found',
      })
      return
    }

    res.json({
      ok: true,
      id: approvalId,
      decision,
    })
  })

  return { router }
}
