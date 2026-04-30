import type { StreamEvent } from '@/types'
import type { MsgItem } from './model'

export type PlanningToolName = 'EnterPlanMode' | 'ExitPlanMode'

export function isPlanningToolName(value: string | undefined): value is PlanningToolName {
  return value === 'EnterPlanMode' || value === 'ExitPlanMode'
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function parsePlanningPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    try {
      return asObject(JSON.parse(trimmed))
    } catch {
      return null
    }
  }

  return asObject(value)
}

function extractNestedText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractNestedText(entry))
      .filter((entry): entry is string => Boolean(entry))
    return parts.length > 0 ? parts.join('\n') : undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (typeof record.text === 'string' && record.text.trim()) {
    return record.text.trim()
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }
  if ('content' in record) {
    return extractNestedText(record.content)
  }

  return undefined
}

export function toPlanningMessage(
  id: string,
  event: Extract<StreamEvent, { type: 'planning' }>,
): MsgItem {
  return {
    id,
    kind: 'planning',
    text: event.action === 'proposed' ? event.plan ?? '' : event.message ?? '',
    planningAction: event.action,
    planningPlan: event.action === 'proposed' ? event.plan : undefined,
    planningApproved: event.action === 'decision' ? event.approved : undefined,
    planningMessage: event.action === 'decision' ? event.message : undefined,
  }
}

export function parsePlanningToolResult(
  content: unknown,
  isError?: boolean,
): Extract<StreamEvent, { type: 'planning' }> | null {
  const parsed = parsePlanningPayload(content)

  if (typeof parsed?.plan === 'string' && parsed.plan.trim()) {
    return {
      type: 'planning',
      action: 'proposed',
      plan: parsed.plan.trim(),
    }
  }

  const approvedValue = parsed?.approved
  const approved =
    approvedValue === null || typeof approvedValue === 'boolean' ? approvedValue : undefined
  const message = extractNestedText(parsed?.message)
  if (approved !== undefined || message) {
    return {
      type: 'planning',
      action: 'decision',
      approved: approved ?? null,
      ...(message ? { message } : {}),
    }
  }

  const fallbackMessage = extractNestedText(content)
  return {
    type: 'planning',
    action: 'decision',
    approved: isError ? false : true,
    ...(fallbackMessage ? { message: fallbackMessage } : {}),
  }
}
