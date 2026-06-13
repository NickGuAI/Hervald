import { existsSync, realpathSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { findFirstMatchingGlob } from './glob.js'
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

interface PathScopeOptions {
  allowlist?: string[]
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir()
  }
  if (value.startsWith('~/')) {
    return path.join(homedir(), value.slice(2))
  }
  return value
}

function normalizeAllowlistPattern(pattern: string, cwd: string): string {
  const expanded = expandHomePath(pattern.trim())
  if (!expanded) {
    return expanded
  }
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded)
  }
  return path.resolve(cwd, expanded)
}

function resolveCandidatePath(candidatePath: string, cwd: string): {
  raw: string
  normalized: string
  real: string
} | null {
  const raw = candidatePath.trim()
  if (!raw || raw.includes('\0')) {
    return null
  }

  const expanded = expandHomePath(raw)
  const normalized = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(cwd, expanded)

  try {
    if (existsSync(normalized)) {
      return {
        raw,
        normalized,
        real: realpathSync(normalized),
      }
    }

    const parent = path.dirname(normalized)
    if (!existsSync(parent)) {
      return null
    }

    return {
      raw,
      normalized,
      real: path.join(realpathSync(parent), path.basename(normalized)),
    }
  } catch {
    return null
  }
}

function isAllowlistedPath(
  candidate: { raw: string; normalized: string; real: string },
  cwd: string,
  allowlist: string[],
): boolean {
  const patterns = allowlist
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (patterns.length === 0) {
    return false
  }

  const normalizedPatterns = patterns.map((entry) => normalizeAllowlistPattern(entry, cwd))
  const candidateValues = [
    candidate.raw,
    expandHomePath(candidate.raw),
    candidate.normalized,
    candidate.real,
  ]

  return candidateValues.some((value) => {
    return findFirstMatchingGlob(value, patterns) !== null
      || findFirstMatchingGlob(value, normalizedPatterns) !== null
  })
}

export function isPathWithinCwd(
  candidatePath: string,
  cwd: string,
  options: PathScopeOptions = {},
): boolean {
  let normalizedCwd: string
  try {
    normalizedCwd = realpathSync(path.resolve(cwd))
  } catch {
    return false
  }

  const candidate = resolveCandidatePath(candidatePath, normalizedCwd)
  if (!candidate) {
    return false
  }

  if (isAllowlistedPath(candidate, normalizedCwd, options.allowlist ?? [])) {
    return true
  }

  const relative = path.relative(normalizedCwd, candidate.real)
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
