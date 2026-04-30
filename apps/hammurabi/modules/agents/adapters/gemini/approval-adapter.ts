import type { ActionPolicyGateResult } from '../../../policies/action-policy-gate.js'
import type { ProviderApprovalAdapter } from '../../../policies/provider-approval-adapter.js'
import { registerApprovalAdapter } from '../../../policies/types.js'
import type { StreamJsonEvent, StreamSession } from '../../types.js'

interface GeminiApprovalReplyDeps {
  appendEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastEvent(session: StreamSession, event: StreamJsonEvent): void
  schedulePersistedSessionsWrite(): void
}

export interface GeminiApprovalRawEvent {
  requestId: number | string
  method: string
  params: Record<string, unknown>
  toolCall: Record<string, unknown>
  toolSnapshot?: Record<string, unknown>
  replyDeps: GeminiApprovalReplyDeps
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function pickToolValue(rawEvent: GeminiApprovalRawEvent, key: string): unknown {
  return rawEvent.toolCall[key] ?? rawEvent.toolSnapshot?.[key]
}

function readToolKind(rawEvent: GeminiApprovalRawEvent): string | undefined {
  return readTrimmedString(pickToolValue(rawEvent, 'kind'))
}

function readToolTitle(rawEvent: GeminiApprovalRawEvent): string | undefined {
  return readTrimmedString(pickToolValue(rawEvent, 'title'))
}

function readToolLocations(rawEvent: GeminiApprovalRawEvent): unknown[] {
  const direct = pickToolValue(rawEvent, 'locations')
  return Array.isArray(direct) ? direct : []
}

function deriveGeminiToolName(rawEvent: GeminiApprovalRawEvent): string {
  const title = readToolTitle(rawEvent)
  switch (readToolKind(rawEvent)) {
    case 'edit':
      return 'Edit'
    case 'execute':
    case 'exec':
      return 'Bash'
    case 'search':
      return 'Grep'
    case 'fetch':
      return 'WebFetch'
    case 'read':
      return 'Read'
    case 'mcp':
      return title ?? 'McpTool'
    default:
      return title ?? 'Tool'
  }
}

function deriveGeminiToolInput(rawEvent: GeminiApprovalRawEvent): unknown {
  const kind = readToolKind(rawEvent)
  const title = readToolTitle(rawEvent)
  const content = Array.isArray(pickToolValue(rawEvent, 'content'))
    ? pickToolValue(rawEvent, 'content') as unknown[]
    : []

  if (kind === 'edit') {
    for (const item of content) {
      const diff = asRecord(item)
      if (!diff || diff.type !== 'diff') {
        continue
      }
      return {
        ...(readTrimmedString(diff.path) ? { file_path: readTrimmedString(diff.path) } : {}),
        ...(typeof diff.oldText === 'string' ? { old_string: diff.oldText } : {}),
        ...(typeof diff.newText === 'string' ? { new_string: diff.newText } : {}),
      }
    }

    const firstLocation = asRecord(readToolLocations(rawEvent)[0])
    return {
      ...(readTrimmedString(firstLocation?.path) ? { file_path: readTrimmedString(firstLocation?.path) } : {}),
    }
  }

  if (kind === 'execute' || kind === 'exec') {
    return title ? { command: title } : {}
  }

  if (kind === 'mcp') {
    // Gemini ACP permission requests currently expose kind/title/content/locations,
    // but not the structured MCP server + tool identifiers Hammurabi needs for
    // exact outbound classification. We route the request through the unified
    // gate with the best available payload and track the missing structure
    // upstream rather than adding a parallel interception layer.
    return {
      ...(title ? { title } : {}),
      content,
      locations: readToolLocations(rawEvent),
    }
  }

  return {
    ...(title ? { title } : {}),
    content,
    locations: readToolLocations(rawEvent),
  }
}

function readPermissionOptions(rawEvent: GeminiApprovalRawEvent): Array<Record<string, unknown>> {
  const options = rawEvent.params.options
  return Array.isArray(options)
    ? options.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => entry !== null)
    : []
}

function findPermissionOptionId(
  options: Array<Record<string, unknown>>,
  desiredKinds: string[],
): string | undefined {
  for (const desiredKind of desiredKinds) {
    const match = options.find((option) => readTrimmedString(option.kind) === desiredKind)
    const optionId = readTrimmedString(match?.optionId)
    if (optionId) {
      return optionId
    }
  }

  return undefined
}

export const geminiApprovalAdapter = registerApprovalAdapter<ProviderApprovalAdapter<GeminiApprovalRawEvent, void>>({
  source: 'gemini',

  toUnifiedRequest(rawEvent, session) {
    return {
      source: 'gemini',
      toolName: deriveGeminiToolName(rawEvent),
      toolInput: deriveGeminiToolInput(rawEvent),
      sessionName: session.name,
      fallbackSessionName: session.name,
      providerContext: {
        requestId: rawEvent.requestId,
        method: rawEvent.method,
        toolCallId: readTrimmedString(rawEvent.toolCall.toolCallId),
      },
    }
  },

  async sendReply(result: ActionPolicyGateResult, rawEvent: GeminiApprovalRawEvent, session: StreamSession): Promise<void> {
    if (result.decision === 'deny' && result.reason) {
      const policyEvent: StreamJsonEvent = {
        type: 'system',
        text: result.reason,
      }
      rawEvent.replyDeps.appendEvent(session, policyEvent)
      rawEvent.replyDeps.broadcastEvent(session, policyEvent)
      rawEvent.replyDeps.schedulePersistedSessionsWrite()
    }

    const runtime = session.geminiRuntime
    if (!runtime) {
      throw new Error('Gemini runtime is unavailable')
    }

    const options = readPermissionOptions(rawEvent)
    const allowOptionId = findPermissionOptionId(options, ['allow_once', 'allow_always'])
    const rejectOptionId = findPermissionOptionId(options, ['reject_once'])

    if (result.decision === 'allow' && allowOptionId) {
      runtime.sendResponse(rawEvent.requestId, {
        outcome: {
          outcome: 'selected',
          optionId: allowOptionId,
        },
      })
      return
    }

    if (result.decision === 'deny' && rejectOptionId) {
      runtime.sendResponse(rawEvent.requestId, {
        outcome: {
          outcome: 'selected',
          optionId: rejectOptionId,
        },
      })
      return
    }

    runtime.sendResponse(rawEvent.requestId, {
      outcome: {
        outcome: 'cancelled',
      },
    })
  },
})
