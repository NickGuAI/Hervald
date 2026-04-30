import { extractApprovalContext } from './context-extractor.js'
import { findFirstMatchingGlob } from './glob.js'
import {
  BUILT_IN_ACTIONS,
  INTERNAL_EDIT_IN_CWD_ACTION,
  INTERNAL_SAFE_BASH_ACTION,
  INTERNAL_SAFE_MCP_ACTION,
  SAFE_BASH_PATTERNS,
} from './registry.js'
import {
  extractCommandText,
  extractToolPath,
  isPathWithinCwd,
  normalizeMatcherToken,
} from './shared.js'
import type {
  ActionCategoryDefinition,
  ActionPolicyRecord,
  ActionPolicyValue,
  EffectiveActionPolicyView,
  ResolveActionPolicyInput,
  ResolvedActionPolicy,
} from './types.js'

const POLICY_RANK: Record<ActionPolicyValue, number> = {
  auto: 0,
  review: 1,
  block: 2,
}

function stricterPolicy(a: ActionPolicyValue, b: ActionPolicyValue): ActionPolicyValue {
  return POLICY_RANK[a] >= POLICY_RANK[b] ? a : b
}

function getPolicyRecord(
  policyView: EffectiveActionPolicyView,
  actionId: string,
): ActionPolicyRecord | null {
  return policyView.records.find((record) => record.actionId === actionId) ?? null
}

function parseMcpServerName(toolName: string): string | null {
  if (!toolName.startsWith('mcp__')) {
    return null
  }

  const stripped = toolName.slice(5)
  const separatorIndex = stripped.indexOf('__')
  if (separatorIndex === -1) {
    return normalizeMatcherToken(stripped)
  }

  return normalizeMatcherToken(stripped.slice(0, separatorIndex))
}

function splitCompoundCommand(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function matchAction(
  toolName: string,
  toolInput: unknown,
  actions: ActionCategoryDefinition[],
  sessionCwd?: string,
): {
  action: ActionCategoryDefinition | null
  matchedBy: 'mcp' | 'bash' | 'tool' | 'fallback'
  matchedPattern?: string
} {
  const mcpServerName = parseMcpServerName(toolName)
  if (mcpServerName) {
    for (const action of actions) {
      if (
        action.id === INTERNAL_EDIT_IN_CWD_ACTION.id
        || action.id === INTERNAL_SAFE_BASH_ACTION.id
        || action.id === INTERNAL_SAFE_MCP_ACTION.id
      ) {
        continue
      }
      for (const server of action.matchers.mcpServers) {
        if (normalizeMatcherToken(server) === mcpServerName) {
          return {
            action,
            matchedBy: 'mcp',
            matchedPattern: server,
          }
        }
      }
    }
  }

  const command = toolName === 'Bash' ? extractCommandText(toolInput) : undefined
  if (command) {
    const segments = splitCompoundCommand(command)
    for (const segment of segments) {
      for (const action of actions) {
        if (
          action.id === INTERNAL_EDIT_IN_CWD_ACTION.id
          || action.id === INTERNAL_SAFE_BASH_ACTION.id
          || action.id === INTERNAL_SAFE_MCP_ACTION.id
        ) {
          continue
        }
        for (const pattern of action.matchers.bashPatterns) {
          if (pattern.test(segment)) {
            return {
              action,
              matchedBy: 'bash',
              matchedPattern: pattern.toString(),
            }
          }
        }
      }
    }
  }

  if (sessionCwd && (toolName === 'Edit' || toolName === 'Write')) {
    const targetPath = extractToolPath(toolInput)
    if (targetPath && isPathWithinCwd(targetPath, sessionCwd)) {
      return {
        action: actions.find((candidate) => candidate.id === INTERNAL_EDIT_IN_CWD_ACTION.id) ?? INTERNAL_EDIT_IN_CWD_ACTION,
        matchedBy: 'tool',
        matchedPattern: targetPath,
      }
    }
  }

  if (command) {
    const segments = splitCompoundCommand(command)
    for (const segment of segments) {
      for (const pattern of SAFE_BASH_PATTERNS) {
        if (pattern.test(segment)) {
          return {
            action: actions.find((candidate) => candidate.id === INTERNAL_SAFE_BASH_ACTION.id) ?? INTERNAL_SAFE_BASH_ACTION,
            matchedBy: 'bash',
            matchedPattern: pattern.toString(),
          }
        }
      }
    }
  }

  if (mcpServerName) {
    return {
      action: actions.find((candidate) => candidate.id === INTERNAL_SAFE_MCP_ACTION.id) ?? INTERNAL_SAFE_MCP_ACTION,
      matchedBy: 'mcp',
      matchedPattern: mcpServerName,
    }
  }

  return {
    action: null,
    matchedBy: 'fallback',
  }
}

function getBasePolicy(
  policyView: EffectiveActionPolicyView,
  action: ActionCategoryDefinition | null,
): { record: ActionPolicyRecord | null; policy: ActionPolicyValue } {
  if (!action) {
    return {
      record: null,
      policy: policyView.fallbackPolicy,
    }
  }

  const record = getPolicyRecord(policyView, action.id)
  return {
    record,
    policy: record?.policy ?? policyView.fallbackPolicy,
  }
}

function buildSkillResolution(
  input: ResolveActionPolicyInput,
  skillPolicy: ActionPolicyValue,
): ResolvedActionPolicy {
  const label = input.session?.currentSkillName?.trim()
    ? input.session.currentSkillName.trim()
    : input.session?.currentSkillId?.trim()
      ? `/${input.session.currentSkillId.trim()}`
      : 'Skill Invocation'
  const action: ActionCategoryDefinition = {
    id: input.session?.currentSkillId?.trim()
      ? `skill:${input.session.currentSkillId.trim()}`
      : 'skill:current',
    label,
    group: 'Skills',
    primaryTargetLabel: 'Skill',
    primaryTargetKey: 'skill',
    matchers: {
      mcpServers: [],
      bashPatterns: [],
    },
  }

  return {
    action,
    record: {
      actionId: action.id,
      policy: skillPolicy,
      allowlist: [],
      blocklist: [],
    },
    decision: skillPolicy,
    basePolicy: skillPolicy,
    matchedBy: 'skill',
    context: {
      summary: label,
      details: {
        Skill: label,
      },
    },
  }
}

export function resolveActionPolicy(input: ResolveActionPolicyInput): ResolvedActionPolicy {
  const actions = input.actions ?? BUILT_IN_ACTIONS
  const skillPolicy = input.session?.currentSkillPolicy ?? undefined

  const matched = matchAction(input.toolName, input.toolInput, actions, input.session?.cwd)
  const base = getBasePolicy(input.policyView, matched.action)
  const context = extractApprovalContext(matched.action, input.toolName, input.toolInput)
  const targetValue = context.primaryTarget?.value

  let actionDecision: ActionPolicyValue = base.policy
  let actionMatchedPattern: string | undefined = matched.matchedPattern
  if (base.record && targetValue) {
    const blockedBy = findFirstMatchingGlob(targetValue, base.record.blocklist)
    if (blockedBy) {
      actionDecision = 'block'
      actionMatchedPattern = blockedBy
    } else {
      const allowedBy = findFirstMatchingGlob(targetValue, base.record.allowlist)
      if (allowedBy) {
        actionDecision = 'auto'
        actionMatchedPattern = allowedBy
      }
    }
  }
  if (!matched.action) {
    actionDecision = input.policyView.fallbackPolicy
  }

  if (skillPolicy) {
    const decision = stricterPolicy(skillPolicy, actionDecision)
    if (decision === actionDecision && decision !== skillPolicy) {
      return {
        action: matched.action,
        record: base.record,
        decision,
        basePolicy: base.policy,
        matchedBy: matched.matchedBy,
        matchedPattern: actionMatchedPattern,
        context,
      }
    }

    const skillResolution = buildSkillResolution(input, skillPolicy)
    return {
      ...skillResolution,
      decision,
      basePolicy: skillPolicy,
    }
  }

  return {
    action: matched.action,
    record: base.record,
    decision: actionDecision,
    basePolicy: base.policy,
    matchedBy: matched.matchedBy,
    matchedPattern: actionMatchedPattern,
    context,
  }
}
