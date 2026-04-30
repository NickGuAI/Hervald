import { extractCommandText, isRecord, truncateText } from './shared.js'
import type { ActionCategoryDefinition, ApprovalContext } from './types.js'

function getCandidateObjects(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) {
    return []
  }

  const candidates: Array<Record<string, unknown>> = [value]
  for (const key of ['input', 'payload', 'params', 'arguments', 'body']) {
    const nested = value[key]
    if (isRecord(nested)) {
      candidates.push(nested)
    }
  }

  return candidates
}

function readStringField(
  candidates: Array<Record<string, unknown>>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
      if (Array.isArray(value)) {
        const collected = value
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
        if (collected.length > 0) {
          return collected.join(', ')
        }
      }
    }
  }

  return undefined
}

function readObjectStringField(
  candidates: Array<Record<string, unknown>>,
  keys: string[],
  nestedKeys: string[],
): string | undefined {
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate[key]
      if (isRecord(value)) {
        const nested = readStringField([value], nestedKeys)
        if (nested) {
          return nested
        }
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (isRecord(entry)) {
            const nested = readStringField([entry], nestedKeys)
            if (nested) {
              return nested
            }
          }
        }
      }
    }
  }

  return undefined
}

function readFlag(command: string | undefined, flags: string[]): string | undefined {
  if (!command) {
    return undefined
  }

  for (const flag of flags) {
    const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(?:^|\\s)${escapedFlag}(?:=|\\s+)(\"([^\"]+)\"|'([^']+)'|(\\S+))`,
      'i',
    )
    const match = command.match(pattern)
    if (match) {
      return (match[2] ?? match[3] ?? match[4] ?? '').trim() || undefined
    }
  }

  return undefined
}

function joinSummary(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' | ')
}

function extractEmailContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const recipient = readStringField(candidates, ['to', 'recipient', 'email', 'address'])
    ?? readObjectStringField(candidates, ['recipient', 'to'], ['email', 'address', 'name'])
    ?? readFlag(command, ['--to', '--recipient', '--email'])
  const subject = readStringField(candidates, ['subject', 'title'])
    ?? readFlag(command, ['--subject', '--title'])
  const body = readStringField(candidates, ['body', 'message', 'text', 'content'])
  const details: Record<string, string> = {}
  if (recipient) {
    details.To = recipient
  }
  if (subject) {
    details.Subject = subject
  }
  if (command) {
    details.Command = command
  }

  return {
    summary: joinSummary([
      recipient ? `To ${recipient}` : undefined,
      subject ? `Subject: ${subject}` : undefined,
    ]) || action.label,
    details,
    preview: body ? truncateText(body, 220) : undefined,
    primaryTarget: recipient
      ? { label: action.primaryTargetLabel ?? 'Recipient', value: recipient }
      : undefined,
    command,
  }
}

function extractMessageContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const target = readStringField(candidates, ['channel', 'recipient', 'target', 'thread', 'room'])
    ?? readFlag(command, ['--channel', '--to', '--recipient', '--room'])
  const message = readStringField(candidates, ['message', 'text', 'body', 'content'])
    ?? readFlag(command, ['--message', '--text'])
  const details: Record<string, string> = {}
  if (target) {
    details.Target = target
  }
  if (command) {
    details.Command = command
  }

  return {
    summary: joinSummary([
      target ? `To ${target}` : undefined,
      message ? truncateText(message, 80) : undefined,
    ]) || action.label,
    details,
    preview: message ? truncateText(message, 220) : undefined,
    primaryTarget: target
      ? { label: action.primaryTargetLabel ?? 'Channel / Recipient', value: target }
      : undefined,
    command,
  }
}

function extractSocialContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const platform = readStringField(candidates, ['platform', 'platforms', 'target'])
    ?? readFlag(command, ['--platform', '--platforms', '--target'])
  const preview = readStringField(candidates, ['text', 'body', 'content', 'message', 'post'])
  const details: Record<string, string> = {}
  if (platform) {
    details.Platform = platform
  }
  if (command) {
    details.Command = command
  }

  return {
    summary: joinSummary([
      platform ? `Platform: ${platform}` : undefined,
      preview ? truncateText(preview, 80) : undefined,
    ]) || action.label,
    details,
    preview: preview ? truncateText(preview, 220) : undefined,
    primaryTarget: platform
      ? { label: action.primaryTargetLabel ?? 'Platform', value: platform }
      : undefined,
    command,
  }
}

function extractPushContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const repository = readStringField(candidates, ['repo', 'repository'])
    ?? readFlag(command, ['--repo', '-R'])
  const branch = readStringField(candidates, ['branch', 'head'])
    ?? readFlag(command, ['--head', '--branch'])
  const title = readStringField(candidates, ['title'])
    ?? readFlag(command, ['--title'])
  const details: Record<string, string> = {}

  if (command?.startsWith('git push')) {
    const tokens = command.split(/\s+/)
    if (!branch && tokens.length >= 4) {
      details.Branch = tokens[3]
    }
    if (!repository && tokens.length >= 3) {
      details.Remote = tokens[2]
    }
  }

  if (repository) {
    details.Repository = repository
  }
  if (branch) {
    details.Branch = branch
  }
  if (title) {
    details.Title = title
  }
  if (command) {
    details.Command = command
  }

  const remote = details.Remote
  const target = repository ?? branch ?? remote
  return {
    summary: joinSummary([
      target ? `Target: ${target}` : undefined,
      title ? `Title: ${title}` : undefined,
    ]) || action.label,
    details,
    primaryTarget: target
      ? { label: action.primaryTargetLabel ?? 'Repo / Branch', value: target }
      : undefined,
    command,
  }
}

function extractDeployContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const service = readStringField(candidates, ['service', 'platform', 'target'])
    ?? readFlag(command, ['--service', '--target'])
    ?? command?.split(/\s+/)[0]
  const environment = readStringField(candidates, ['environment', 'env'])
    ?? readFlag(command, ['--environment', '--env'])
    ?? (command?.includes('--prod') ? 'production' : undefined)
  const details: Record<string, string> = {}
  if (service) {
    details.Service = service
  }
  if (environment) {
    details.Environment = environment
  }
  if (command) {
    details.Command = command
  }

  const target = joinSummary([service, environment])
  return {
    summary: target || action.label,
    details,
    primaryTarget: target
      ? { label: action.primaryTargetLabel ?? 'Service / Environment', value: target }
      : undefined,
    command,
  }
}

function extractPublishContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const target = readStringField(candidates, ['platform', 'target', 'destination'])
    ?? readFlag(command, ['--platform', '--target', '--destination'])
  const title = readStringField(candidates, ['title', 'name'])
    ?? readFlag(command, ['--title', '--name'])
  const preview = readStringField(candidates, ['text', 'content', 'body'])
  const details: Record<string, string> = {}
  if (target) {
    details.Target = target
  }
  if (title) {
    details.Title = title
  }
  if (command) {
    details.Command = command
  }

  return {
    summary: joinSummary([
      target ? `Target: ${target}` : undefined,
      title ? `Title: ${title}` : undefined,
    ]) || action.label,
    details,
    preview: preview ? truncateText(preview, 220) : undefined,
    primaryTarget: target
      ? { label: action.primaryTargetLabel ?? 'Target Platform', value: target }
      : undefined,
    command,
  }
}

function extractCalendarContext(
  action: ActionCategoryDefinition,
  toolInput: unknown,
  command: string | undefined,
): ApprovalContext {
  const candidates = getCandidateObjects(toolInput)
  const calendar = readStringField(candidates, ['calendar', 'calendarId'])
    ?? readFlag(command, ['--calendar', '--calendar-id'])
  const title = readStringField(candidates, ['title', 'summary', 'event'])
    ?? readFlag(command, ['--title', '--summary'])
  const startTime = readStringField(candidates, ['start', 'startTime', 'time'])
    ?? readFlag(command, ['--start', '--time'])
  const details: Record<string, string> = {}
  if (calendar) {
    details.Calendar = calendar
  }
  if (title) {
    details.Event = title
  }
  if (startTime) {
    details.Start = startTime
  }
  if (command) {
    details.Command = command
  }

  const target = joinSummary([calendar, title])
  return {
    summary: joinSummary([
      title ? `Event: ${title}` : undefined,
      calendar ? `Calendar: ${calendar}` : undefined,
    ]) || action.label,
    details,
    primaryTarget: target
      ? { label: action.primaryTargetLabel ?? 'Calendar / Event', value: target }
      : undefined,
    command,
  }
}

export function extractApprovalContext(
  action: ActionCategoryDefinition | null,
  toolName: string,
  toolInput?: unknown,
): ApprovalContext {
  const command = extractCommandText(toolInput)

  if (!action) {
    return {
      summary: command ? truncateText(command, 120) : toolName,
      details: command ? { Command: command } : { Tool: toolName },
      command,
    }
  }

  switch (action.id) {
    case 'send-email':
      return extractEmailContext(action, toolInput, command)
    case 'send-message':
      return extractMessageContext(action, toolInput, command)
    case 'post-social':
      return extractSocialContext(action, toolInput, command)
    case 'push-code-prs':
      return extractPushContext(action, toolInput, command)
    case 'deploy':
      return extractDeployContext(action, toolInput, command)
    case 'publish-content':
      return extractPublishContext(action, toolInput, command)
    case 'calendar-changes':
      return extractCalendarContext(action, toolInput, command)
    default:
      return {
        summary: action.label,
        details: command ? { Command: command } : { Tool: toolName },
        command,
      }
  }
}
