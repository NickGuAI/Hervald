import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ActionPolicyValue } from './types.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null)
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function normalizeStringArray(values: unknown): string[] {
  return uniqueStrings(asStringArray(values))
}

export function normalizeActionPolicyValue(
  value: unknown,
  fallback: ActionPolicyValue = 'review',
): ActionPolicyValue {
  return value === 'auto' || value === 'review' || value === 'block' ? value : fallback
}

export function normalizeMatcherToken(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '')
}

export function truncateText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 3)}...`
}

export function extractCommandText(toolInput: unknown): string | undefined {
  if (typeof toolInput === 'string' && toolInput.trim().length > 0) {
    return toolInput.trim()
  }

  if (!isRecord(toolInput)) {
    return undefined
  }

  const candidates = [
    toolInput.command,
    toolInput.cmd,
    toolInput.argv,
    toolInput.text,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  if (Array.isArray(toolInput.argv)) {
    const tokens = toolInput.argv
      .map((entry) => asTrimmedString(entry))
      .filter((entry): entry is string => entry !== null)
    if (tokens.length > 0) {
      return tokens.join(' ')
    }
  }

  return undefined
}

export function extractToolPath(toolInput: unknown): string | undefined {
  if (!isRecord(toolInput)) {
    return undefined
  }

  const candidates = [
    toolInput.file_path,
    toolInput.path,
    toolInput.filePath,
    toolInput.target_file,
    toolInput.destination,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return undefined
}

export function isPathWithinCwd(candidatePath: string, cwd: string): boolean {
  const normalizedCwd = path.resolve(cwd)
  const normalizedCandidate = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(normalizedCwd, candidatePath)
  const relative = path.relative(normalizedCwd, normalizedCandidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

export async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T]
        } catch {
          return []
        }
      })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

export function toJsonSafe(value: unknown, depth = 6): unknown {
  if (depth < 0) {
    return '[depth-exceeded]'
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafe(entry, depth - 1))
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'function' || typeof entry === 'symbol' || entry === undefined) {
        continue
      }
      next[key] = toJsonSafe(entry, depth - 1)
    }
    return next
  }

  return String(value)
}
