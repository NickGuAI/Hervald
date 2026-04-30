import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { CODEX_SIDECAR_LOG_TEXT_LIMIT } from '../../constants.js'
import { buildRemoteCommand } from '../../machines.js'
import { asObject } from '../../session/state.js'
import type {
  CodexApprovalDecision,
  CodexApprovalMethod,
  CodexPendingApprovalRequest,
  PersistedStreamSession,
  StreamJsonEvent,
  StreamSession,
} from '../../types.js'

function truncateLogText(value: string, maxChars = CODEX_SIDECAR_LOG_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return value
}

function readUsageNumber(usage: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readFiniteNumber(usage[key])
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

export function buildCodexAppServerInvocation(listenUrl = 'stdio://'): string {
  return buildRemoteCommand('codex', ['app-server', '--listen', listenUrl])
}

export function parseCodexApprovalMethod(method: string): CodexApprovalMethod | null {
  if (
    method === 'item/commandExecution/requestApproval'
    || method === 'item/fileChange/requestApproval'
    || method === 'item/permissions/requestApproval'
    || method === 'item/mcpToolCall/requestApproval'
    || method === 'item/rules/requestApproval'
    || method === 'item/skill/requestApproval'
  ) {
    return method
  }
  return null
}

export function isCodexApprovalLikeMethod(method: string): boolean {
  return method.startsWith('item/') && method.endsWith('/requestApproval')
}

export function getCodexApprovalTargetLabel(method: CodexApprovalMethod): string {
  if (method === 'item/commandExecution/requestApproval') {
    return 'command execution'
  }
  if (method === 'item/fileChange/requestApproval') {
    return 'file change'
  }
  if (method === 'item/mcpToolCall/requestApproval') {
    return 'MCP tool call'
  }
  if (method === 'item/rules/requestApproval') {
    return 'rules consultation'
  }
  if (method === 'item/skill/requestApproval') {
    return 'skill execution'
  }
  return 'permission expansion'
}

export function getCodexApprovalRequestDetails(params: unknown): {
  threadId?: string
  itemId?: string
  turnId?: string
  cwd?: string
  reason?: string
  risk?: string
  permissions?: unknown
} {
  const payload = asObject(params)
  if (!payload) {
    return {}
  }

  const threadId = typeof payload.threadId === 'string' && payload.threadId.trim().length > 0
    ? payload.threadId.trim()
    : undefined
  const itemId = typeof payload.itemId === 'string' && payload.itemId.trim().length > 0
    ? payload.itemId.trim()
    : undefined
  const turnId = typeof payload.turnId === 'string' && payload.turnId.trim().length > 0
    ? payload.turnId.trim()
    : undefined
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim().length > 0
    ? payload.cwd.trim()
    : undefined
  const reason = typeof payload.reason === 'string' && payload.reason.trim().length > 0
    ? truncateLogText(payload.reason.trim(), 300)
    : undefined
  const risk = typeof payload.risk === 'string' && payload.risk.trim().length > 0
    ? truncateLogText(payload.risk.trim(), 300)
    : undefined
  const permissions = payload.permissions

  return { threadId, itemId, turnId, cwd, reason, risk, permissions }
}

export function getCodexApprovalToolCall(
  threadReadResult: unknown,
  request: Pick<CodexPendingApprovalRequest, 'cwd' | 'itemId' | 'method' | 'permissions'>,
): { toolName: string; toolInput: unknown } | null {
  const payload = asObject(threadReadResult)
  const thread = asObject(payload?.thread)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asObject(turns[turnIndex])
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = asObject(items[itemIndex])
      if (!item) {
        continue
      }
      if (request.itemId) {
        const itemId = typeof item.id === 'string' ? item.id.trim() : ''
        if (!itemId || itemId !== request.itemId) {
          continue
        }
      }

      if (item.type === 'commandExecution') {
        const command = typeof item.command === 'string'
          ? item.command.trim()
          : (typeof item.input === 'string' ? item.input.trim() : '')
        if (command) {
          return {
            toolName: 'Bash',
            toolInput: { command },
          }
        }
      }

      if (item.type === 'fileChange') {
        const filePath = typeof item.filePath === 'string'
          ? item.filePath.trim()
          : (typeof item.file === 'string' ? item.file.trim() : '')
        const nextContent = typeof item.content === 'string'
          ? item.content
          : (typeof item.patch === 'string' ? item.patch : '')
        if (filePath || nextContent) {
          return {
            toolName: 'Edit',
            toolInput: {
              ...(filePath ? { file_path: filePath } : {}),
              ...(nextContent ? { new_string: nextContent } : {}),
            },
          }
        }
      }

      if (item.type === 'mcpToolCall') {
        const server = typeof item.server === 'string' && item.server.trim().length > 0
          ? item.server.trim()
          : 'unknown'
        const tool = typeof item.tool === 'string' && item.tool.trim().length > 0
          ? item.tool.trim()
          : 'unknown'
        return {
          toolName: `mcp__${server}__${tool}`,
          toolInput: item.arguments,
        }
      }
    }
  }

  if (request.method === 'item/commandExecution/requestApproval') {
    return {
      toolName: 'Bash',
      toolInput: {},
    }
  }

  if (request.method === 'item/fileChange/requestApproval') {
    return {
      toolName: 'Edit',
      toolInput: {},
    }
  }

  if (request.method === 'item/mcpToolCall/requestApproval') {
    return {
      toolName: 'mcp__unknown__unknown',
      toolInput: {
        ...(request.itemId ? { itemId: request.itemId } : {}),
      },
    }
  }

  if (request.method === 'item/rules/requestApproval') {
    return {
      toolName: 'CodexRulesConsultation',
      toolInput: {
        ...(request.itemId ? { itemId: request.itemId } : {}),
        ...(request.cwd ? { cwd: request.cwd } : {}),
      },
    }
  }

  if (request.method === 'item/skill/requestApproval') {
    return {
      toolName: 'CodexSkillExecution',
      toolInput: {
        ...(request.itemId ? { itemId: request.itemId } : {}),
        ...(request.cwd ? { cwd: request.cwd } : {}),
      },
    }
  }

  return {
    toolName: 'PermissionExpansion',
    toolInput: {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.permissions !== undefined ? { permissions: request.permissions } : {}),
    },
  }
}

export function getCodexCompletedItemId(params: unknown): string | undefined {
  const payload = asObject(params)
  const item = asObject(payload?.item)
  if (!item) {
    return undefined
  }
  const itemId = item.id
  if (typeof itemId !== 'string' || itemId.trim().length === 0) {
    return undefined
  }
  return itemId.trim()
}

export function buildCodexApprovalRequestSystemEvent(request: CodexPendingApprovalRequest): StreamJsonEvent {
  const approvalTarget = getCodexApprovalTargetLabel(request.method)
  const extras = [request.reason ? `Reason: ${request.reason}` : null, request.risk ? `Risk: ${request.risk}` : null]
    .filter((value): value is string => value !== null)
    .join(' ')
  return {
    type: 'system',
    text: `Codex is waiting for ${approvalTarget} approval (request ${request.requestId}). Awaiting accept/decline decision.${extras ? ` ${extras}` : ''}`,
  }
}

export function buildCodexApprovalMissingIdSystemEvent(method: CodexApprovalMethod, params: unknown): StreamJsonEvent {
  const approvalTarget = getCodexApprovalTargetLabel(method)
  const { reason, risk } = getCodexApprovalRequestDetails(params)
  const extras = [reason ? `Reason: ${reason}` : null, risk ? `Risk: ${risk}` : null]
    .filter((value): value is string => value !== null)
    .join(' ')
  return {
    type: 'system',
    text: `Codex requested ${approvalTarget} approval, but the request id was missing. This approval cannot be resolved from Hammurabi.${extras ? ` ${extras}` : ''}`,
  }
}

export function buildCodexApprovalDecisionEvent(
  request: CodexPendingApprovalRequest,
  decision: CodexApprovalDecision,
): StreamJsonEvent {
  const approvalTarget = getCodexApprovalTargetLabel(request.method)
  return {
    type: 'system',
    text: decision === 'accept'
      ? `Accepted Codex ${approvalTarget} approval request ${request.requestId}.`
      : `Declined Codex ${approvalTarget} approval request ${request.requestId}.`,
  }
}

export function hasPendingCodexApprovals(session: StreamSession): boolean {
  return session.codexPendingApprovals.size > 0
}

export function clearCodexPendingApprovals(session: StreamSession): void {
  if (session.codexPendingApprovals.size > 0) {
    session.codexPendingApprovals.clear()
  }
}

export function clearCodexPendingApprovalByItemId(session: StreamSession, itemId: string | undefined): void {
  if (!itemId) {
    return
  }
  for (const [requestId, request] of session.codexPendingApprovals.entries()) {
    if (request.itemId === itemId) {
      session.codexPendingApprovals.delete(requestId)
    }
  }
}

export function clearCodexTurnWatchdog(session: StreamSession): void {
  if (session.codexTurnWatchdogTimer) {
    clearTimeout(session.codexTurnWatchdogTimer)
    session.codexTurnWatchdogTimer = undefined
  }
}

export function markCodexTurnHealthy(session: StreamSession): void {
  session.codexTurnStaleAt = undefined
}

export function extractCodexUsageTotals(payload: unknown): {
  usage?: { input_tokens?: number; output_tokens?: number }
  totalCostUsd?: number
} {
  const usagePayload = asObject(payload)
  if (!usagePayload) {
    return {}
  }
  const inputTokens = readUsageNumber(usagePayload, ['input_tokens', 'inputTokens', 'input'])
  const outputTokens = readUsageNumber(usagePayload, ['output_tokens', 'outputTokens', 'output'])
  const totalCostUsd = readUsageNumber(usagePayload, ['total_cost_usd', 'totalCostUsd', 'cost_usd', 'costUsd'])
  return {
    usage: (inputTokens !== undefined || outputTokens !== undefined)
      ? {
          ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
          ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
        }
      : undefined,
    totalCostUsd,
  }
}

export function parseCodexSidecarError(error: unknown): { code?: number; message?: string } | null {
  if (!(error instanceof Error)) {
    return null
  }

  try {
    const parsed = JSON.parse(error.message) as { code?: unknown; message?: unknown }
    return {
      code: typeof parsed.code === 'number' ? parsed.code : undefined,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
    }
  } catch {
    return null
  }
}

export function isMissingCodexRolloutError(error: unknown): boolean {
  const parsed = parseCodexSidecarError(error)
  return parsed?.code === -32600 && Boolean(parsed.message?.includes('no rollout found for thread id'))
}

export function codexRolloutUnavailableMessage(sessionName: string): string {
  return `Session "${sessionName}" can no longer be resumed because its Codex rollout is unavailable`
}

export function codexRolloutDirectoryForCreatedAt(createdAt: string): string | null {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const iso = date.toISOString()
  return path.join(homedir(), '.codex', 'sessions', iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10))
}

export async function hasCodexRolloutFile(threadId: string, createdAt: string): Promise<boolean> {
  const directory = codexRolloutDirectoryForCreatedAt(createdAt)
  if (!directory) {
    return true
  }

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.some((entry) => entry.isFile() && entry.name.includes(threadId))
  } catch {
    return false
  }
}

export function isExitedSessionResumeAvailableLocal(entry: PersistedStreamSession): boolean {
  return entry.agentType !== 'codex' || Boolean(entry.host)
}
