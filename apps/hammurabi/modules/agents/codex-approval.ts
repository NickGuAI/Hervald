/**
 * Codex approval helpers.
 *
 * Serialization, parsing, and labeling helpers for Codex approval request
 * IDs. Extracted from `routes.ts` in #921 Phase P4 so the approval-id
 * namespace lives in one focused module rather than being buried inside
 * the agents router closure.
 *
 * Related types (`ApprovalSessionContext`, `PendingCodexApprovalView`,
 * `CodexApprovalQueueEvent`, `ApprovalSessionsInterface`) live in
 * `./types.ts` — import them from there. This module exports only the
 * behavior helpers.
 */
import { SESSION_NAME_PATTERN } from './constants.js'
import type { CodexApprovalMethod } from './types.js'

/**
 * Serialize a `(sessionName, requestId)` pair into the canonical Codex
 * approval ID format consumed by `resolvePendingCodexApproval` and friends.
 *
 * Format: `codex:<sessionName>:<requestId>`. The prefix is a hard marker
 * so non-Codex approval IDs cannot be confused with Codex IDs.
 *
 * Kept non-exported — only the router instantiates pending approvals, and
 * the router lives in the same package. If an external caller ever needs
 * this, add `export` deliberately rather than drifting by accident.
 */
export function serializeCodexApprovalId(sessionName: string, requestId: number): string {
  return `codex:${sessionName}:${requestId}`
}

/**
 * Inverse of `serializeCodexApprovalId`. Returns `null` when the input is
 * not a valid Codex approval ID — callers treat null as "not mine" and
 * try the next approval-type handler.
 *
 * Guards (all MUST hold for a valid parse):
 *   1. Prefix is `codex:`.
 *   2. Exactly three colon-separated parts.
 *   3. `sessionName` matches `SESSION_NAME_PATTERN`.
 *   4. `requestId` is a decimal integer (digits only, no sign, no leading
 *      spaces) — rejects negatives + non-numerics.
 *   5. Parsed requestId is a non-negative integer (`requestId >= 0`). A
 *      fresh Codex sidecar emits `requestId=0` on its first approval, so
 *      zero is valid.
 */
export function parseCodexApprovalId(rawApprovalId: string): { sessionName: string; requestId: number } | null {
  if (!rawApprovalId.startsWith('codex:')) {
    return null
  }

  const parts = rawApprovalId.split(':')
  if (parts.length !== 3) {
    return null
  }

  const [, sessionName, rawRequestId] = parts
  if (!sessionName || !SESSION_NAME_PATTERN.test(sessionName)) {
    return null
  }

  if (typeof rawRequestId !== 'string' || !/^\d+$/.test(rawRequestId)) {
    return null
  }

  const requestId = Number.parseInt(rawRequestId, 10)
  if (!Number.isInteger(requestId) || requestId < 0) {
    return null
  }

  return { sessionName, requestId }
}

/**
 * Stable action IDs for each Codex approval flavor. Consumers (UI
 * badges, telemetry, rules engines) key off these strings, so they are
 * intentionally de-duplicated from the `CodexApprovalMethod` literal
 * strings on the Codex protocol side.
 */
export function getCodexApprovalActionId(method: CodexApprovalMethod): string {
  if (method === 'item/commandExecution/requestApproval') {
    return 'codex-command-execution'
  }
  if (method === 'item/fileChange/requestApproval') {
    return 'codex-file-change'
  }
  if (method === 'item/mcpToolCall/requestApproval') {
    return 'codex-mcp-tool-call'
  }
  if (method === 'item/rules/requestApproval') {
    return 'codex-rules-consultation'
  }
  if (method === 'item/skill/requestApproval') {
    return 'codex-skill-execution'
  }
  return 'codex-permissions-request'
}

/**
 * Human-readable label for each approval flavor. Paired 1:1 with
 * `getCodexApprovalActionId` — if a new `CodexApprovalMethod` variant is
 * added, both helpers must be extended together, otherwise the UI and
 * the action-id namespace drift.
 */
export function getCodexApprovalActionLabel(method: CodexApprovalMethod): string {
  if (method === 'item/commandExecution/requestApproval') {
    return 'Command Execution'
  }
  if (method === 'item/fileChange/requestApproval') {
    return 'File Change'
  }
  if (method === 'item/mcpToolCall/requestApproval') {
    return 'MCP Tool Call'
  }
  if (method === 'item/rules/requestApproval') {
    return 'Rules Consultation'
  }
  if (method === 'item/skill/requestApproval') {
    return 'Skill Execution'
  }
  return 'Permission Expansion'
}
