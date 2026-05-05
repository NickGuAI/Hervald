import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'

export const MEMORY_CONTEXT_CACHE_TTL_MS = 30_000

const MEMORY_CONTEXT_CACHE_MAX_ENTRIES = 128

export interface CachedBuiltContext {
  systemPromptSection: string
  layersIncluded: number[]
  skillsMatched: string[]
  tokenEstimate: number
  droppedLayers: number[]
}

interface MemoryContextCacheEntry {
  expiresAt: number
  value: CachedBuiltContext
}

interface MemoryContextCacheKeyParts {
  commanderId: string
  currentTaskId: string
  tokenBudget: number
  recentConversationKey: string
  memoryMtimeKey: string
}

async function readMtimeMs(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath)
    return info.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }
    throw error
  }
}

export async function buildMemoryContextMtimeKey(memoryRoot: string): Promise<string> {
  const targets = [
    path.join(memoryRoot, 'MEMORY.md'),
    path.join(memoryRoot, 'LONG_TERM_MEM.md'),
    path.join(memoryRoot, 'GOALS.md'),
    path.join(memoryRoot, 'working-memory.json'),
    path.join(memoryRoot, 'backlog', 'thin-index.md'),
  ]
  const mtimes = await Promise.all(targets.map((target) => readMtimeMs(target)))
  return mtimes.join(':')
}

export function buildCurrentTaskCacheId(
  currentTask: { number?: number; repository?: string | null; owner?: string; repo?: string } | null,
): string {
  if (!currentTask) {
    return 'none'
  }
  const repository = currentTask.owner && currentTask.repo
    ? `${currentTask.owner}/${currentTask.repo}`
    : (currentTask.repository ?? 'unknown/unknown')
  return `${repository}#${currentTask.number ?? 'unknown'}`
}

export function buildRecentConversationCacheKey(
  recentConversation: Array<{ role: string; content: string }>,
): string {
  const hash = createHash('sha1')
  for (const message of recentConversation) {
    hash.update(message.role ?? '')
    hash.update('\u0000')
    hash.update(message.content ?? '')
    hash.update('\u0001')
  }
  return hash.digest('hex')
}

function toCacheKey(parts: MemoryContextCacheKeyParts): string {
  return [
    parts.commanderId,
    parts.currentTaskId,
    String(parts.tokenBudget),
    parts.recentConversationKey,
    parts.memoryMtimeKey,
  ].join('::')
}

function cloneBuiltContext(value: CachedBuiltContext): CachedBuiltContext {
  return {
    systemPromptSection: value.systemPromptSection,
    layersIncluded: [...value.layersIncluded],
    skillsMatched: [...value.skillsMatched],
    tokenEstimate: value.tokenEstimate,
    droppedLayers: [...value.droppedLayers],
  }
}

class MemoryContextLruCache {
  private readonly entries = new Map<string, MemoryContextCacheEntry>()

  get(parts: MemoryContextCacheKeyParts): CachedBuiltContext | null {
    const key = toCacheKey(parts)
    const entry = this.entries.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return null
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return cloneBuiltContext(entry.value)
  }

  set(parts: MemoryContextCacheKeyParts, value: CachedBuiltContext): void {
    const key = toCacheKey(parts)
    this.entries.delete(key)
    this.entries.set(key, {
      expiresAt: Date.now() + MEMORY_CONTEXT_CACHE_TTL_MS,
      value: cloneBuiltContext(value),
    })

    while (this.entries.size > MEMORY_CONTEXT_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value
      if (!oldestKey) {
        break
      }
      this.entries.delete(oldestKey)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const memoryContextCache = new MemoryContextLruCache()
