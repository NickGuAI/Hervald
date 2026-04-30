import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CommanderContextMode } from './store.js'

export const COMMANDER_WORKFLOW_FILE = 'COMMANDER.md'
const MAX_WORKFLOW_TURNS = 10
const DEPRECATED_COMMANDER_WORKFLOW_KEYS = new Set([
  'heartbeat.interval',
  'heartbeat.message',
  'maxTurns',
  'contextMode',
  'fatPinInterval',
])

export interface CommanderWorkflow {
  heartbeatInterval?: string
  heartbeatMessage?: string
  maxTurns?: number
  contextMode?: CommanderContextMode
  fatPinInterval?: number
  systemPromptTemplate?: string
}

export function mergeWorkflows(
  base: CommanderWorkflow | null,
  override: CommanderWorkflow | null,
): CommanderWorkflow | null {
  if (!base && !override) {
    return null
  }

  if (!base) {
    return override ? { ...override } : null
  }

  if (!override) {
    return { ...base }
  }

  return {
    ...base,
    ...override,
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }
  return parsed
}

function parseContextMode(raw: string): CommanderContextMode | null {
  const value = parseQuotedScalar(raw)
  if (value === 'thin' || value === 'fat') {
    return value
  }
  return null
}

function parseQuotedScalar(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function applyKnownKey(
  workflow: CommanderWorkflow,
  key: string,
  rawValue: string,
): void {
  const value = parseQuotedScalar(rawValue)
  if (!value) {
    return
  }

  if (key === 'heartbeat.interval') {
    workflow.heartbeatInterval = value
    return
  }

  if (key === 'heartbeat.message') {
    workflow.heartbeatMessage = value
    return
  }

  if (key === 'maxTurns') {
    const parsedTurns = parsePositiveInt(value)
    if (parsedTurns !== null) {
      workflow.maxTurns = Math.min(parsedTurns, MAX_WORKFLOW_TURNS)
    }
    return
  }

  if (key === 'contextMode') {
    const parsedContextMode = parseContextMode(value)
    if (parsedContextMode) {
      workflow.contextMode = parsedContextMode
    }
    return
  }

  if (key === 'fatPinInterval') {
    const parsedFatPinInterval = parsePositiveInt(value)
    if (parsedFatPinInterval !== null) {
      workflow.fatPinInterval = parsedFatPinInterval
    }
    return
  }
}

function parseFrontMatter(frontMatter: string): CommanderWorkflow {
  const workflow: CommanderWorkflow = {}

  for (const rawLine of frontMatter.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.+)$/)
    if (!match) {
      continue
    }

    const key = match[1]
    const rawValue = match[2] ?? ''
    applyKnownKey(workflow, key, rawValue)
  }

  return workflow
}

export function parseCommanderWorkflowContent(content: string): CommanderWorkflow {
  const normalized = content.replace(/\r\n/g, '\n')
  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/)

  if (!frontMatterMatch) {
    const trimmed = normalized.trim()
    return trimmed.length > 0 ? { systemPromptTemplate: trimmed } : {}
  }

  const [, frontMatter, body] = frontMatterMatch
  const workflow = parseFrontMatter(frontMatter)
  const bodyTemplate = body.trim()
  if (bodyTemplate.length > 0) {
    workflow.systemPromptTemplate = bodyTemplate
  }
  return workflow
}

export function stripDeprecatedCommanderWorkflowFrontmatter(content: string): {
  content: string
  changed: boolean
  removedKeys: string[]
} {
  const normalized = content.replace(/\r\n/g, '\n')
  const hadTrailingNewline = normalized.endsWith('\n')
  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/)
  if (!frontMatterMatch) {
    return { content: normalized, changed: false, removedKeys: [] }
  }

  const [, frontMatter, body] = frontMatterMatch
  const removedKeys: string[] = []
  const keptLines = frontMatter
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        return true
      }

      const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.+)$/)
      if (!match) {
        return true
      }

      const key = match[1]
      if (!DEPRECATED_COMMANDER_WORKFLOW_KEYS.has(key)) {
        return true
      }

      removedKeys.push(key)
      return false
    })

  if (removedKeys.length === 0) {
    return { content: normalized, changed: false, removedKeys: [] }
  }

  const hasMeaningfulFrontMatter = keptLines.some((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#')
  })
  const normalizedBody = body.startsWith('\n') ? body.slice(1) : body
  const nextContent = hasMeaningfulFrontMatter
    ? `---\n${keptLines.join('\n')}\n---${normalizedBody.length > 0 ? '\n' : ''}${normalizedBody}`
    : normalizedBody

  const finalized = hadTrailingNewline && !nextContent.endsWith('\n')
    ? `${nextContent}\n`
    : nextContent

  return {
    content: finalized,
    changed: finalized !== normalized,
    removedKeys,
  }
}

export async function loadCommanderWorkflow(cwd: string): Promise<CommanderWorkflow | null> {
  const workflowPath = path.join(cwd, COMMANDER_WORKFLOW_FILE)
  let content: string
  try {
    content = await readFile(workflowPath, 'utf-8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
  return parseCommanderWorkflowContent(content)
}
