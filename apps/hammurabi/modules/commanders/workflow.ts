import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const COMMANDER_WORKFLOW_FILE = 'COMMANDER.md'
const REMOVED_COMMANDER_FRONTMATTER_KEYS = new Set([
  'heartbeat.interval',
  'heartbeat.message',
  'maxTurns',
  'contextMode',
  'fatPinInterval',
])

export interface CommanderWorkflow {
  systemPromptTemplate?: string
}

interface ParseCommanderWorkflowOptions {
  allowRemovedRuntimeFrontmatterKeys?: boolean
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

function findRemovedFrontmatterKeys(frontMatter: string): string[] {
  const removedKeys = new Set<string>()
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
    if (REMOVED_COMMANDER_FRONTMATTER_KEYS.has(key)) {
      removedKeys.add(key)
    }
  }

  return [...removedKeys]
}

export function parseCommanderWorkflowContent(
  content: string,
  options: ParseCommanderWorkflowOptions = {},
): CommanderWorkflow {
  const normalized = content.replace(/\r\n/g, '\n')
  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/)

  if (!frontMatterMatch) {
    const trimmed = normalized.trim()
    return trimmed.length > 0 ? { systemPromptTemplate: trimmed } : {}
  }

  const [, frontMatter, body] = frontMatterMatch
  const removedKeys = findRemovedFrontmatterKeys(frontMatter)
  if (removedKeys.length > 0 && !options.allowRemovedRuntimeFrontmatterKeys) {
    throw new Error(
      `COMMANDER.md uses removed runtime frontmatter keys: ${removedKeys.join(', ')}`,
    )
  }
  const bodyTemplate = body.trim()
  return bodyTemplate.length > 0 ? { systemPromptTemplate: bodyTemplate } : {}
}

export async function loadCommanderWorkflow(
  cwd: string,
  options: ParseCommanderWorkflowOptions = {},
): Promise<CommanderWorkflow | null> {
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
  return parseCommanderWorkflowContent(content, options)
}
