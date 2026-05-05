import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import {
  migrateProviderContext,
  migratedProviderContextChanged,
} from '../../migrations/provider-context.js'
import { writeJsonFileAtomically } from '../../migrations/write-json-file-atomically.js'

export interface TranscriptEvent {
  type: string
  [key: string]: unknown
}

export type TranscriptMeta = Record<string, unknown>

import { resolveModuleDataDir } from '../data-dir.js'

const SESSION_NAME_PATTERN = /^[\w-]+$/

function defaultTranscriptRoot(): string {
  return path.join(resolveModuleDataDir('agents'), 'sessions')
}

let transcriptRoot: string | null = null
const writeQueues = new Map<string, Promise<void>>()

function assertSessionName(sessionName: string): string {
  const trimmed = sessionName.trim()
  if (!SESSION_NAME_PATTERN.test(trimmed)) {
    throw new Error(`Invalid session name: ${sessionName}`)
  }
  return trimmed
}

function resolveSessionDir(sessionName: string): string {
  return path.join(transcriptRoot ?? defaultTranscriptRoot(), assertSessionName(sessionName))
}

function resolveTranscriptPath(sessionName: string): string {
  return path.join(resolveSessionDir(sessionName), 'transcript.v1.jsonl')
}

function resolveMetaPath(sessionName: string): string {
  return path.join(resolveSessionDir(sessionName), 'meta.json')
}

async function queueWrite(filePath: string, write: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve()
  let currentResolve!: () => void
  let currentReject!: (error: unknown) => void
  const current = new Promise<void>((resolve, reject) => {
    currentResolve = resolve
    currentReject = reject
  })

  writeQueues.set(filePath, current)

  void previous
    .catch(() => undefined)
    .then(async () => {
      await write()
      currentResolve()
    })
    .catch((error) => {
      currentReject(error)
    })
    .finally(() => {
      if (writeQueues.get(filePath) === current) {
        writeQueues.delete(filePath)
      }
    })

  return current
}

function parseTranscriptEvent(raw: Buffer): TranscriptEvent | null {
  const trimmed = raw.toString('utf8').trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string'
      ? parsed as TranscriptEvent
      : null
  } catch {
    return null
  }
}

export function setTranscriptStoreRoot(rootDir: string): void {
  transcriptRoot = path.resolve(rootDir)
}

export function resetTranscriptStoreRoot(): void {
  transcriptRoot = null
}

export function getTranscriptStoreRoot(): string {
  return transcriptRoot ?? defaultTranscriptRoot()
}

export async function deleteSessionTranscript(sessionName: string): Promise<void> {
  await rm(resolveSessionDir(sessionName), { recursive: true, force: true })
}

export async function appendTranscriptEvent(sessionName: string, event: TranscriptEvent): Promise<void> {
  const transcriptPath = resolveTranscriptPath(sessionName)
  const line = `${JSON.stringify(event)}\n`

  await queueWrite(transcriptPath, async () => {
    await mkdir(path.dirname(transcriptPath), { recursive: true })
    await appendFile(transcriptPath, line, 'utf8')
  })
}

export async function readTranscriptTail(sessionName: string, maxTurns: number): Promise<TranscriptEvent[]> {
  const transcriptPath = resolveTranscriptPath(sessionName)
  const turnsToKeep = Math.max(0, Math.floor(maxTurns))
  try {
    const fileHandle = await open(transcriptPath, 'r')
    try {
      const { size } = await fileHandle.stat()
      if (size === 0) {
        return []
      }

      const chunkSize = 64 * 1024
      const eventsInReverse: TranscriptEvent[] = []
      let completedTurnsKept = 0
      let position = size
      let remainder = Buffer.alloc(0)
      let reachedBoundary = false

      while (position > 0 && !reachedBoundary) {
        const bytesToRead = Math.min(chunkSize, position)
        position -= bytesToRead
        const chunk = Buffer.allocUnsafe(bytesToRead)
        const { bytesRead } = await fileHandle.read(chunk, 0, bytesToRead, position)
        let combined = Buffer.concat([chunk.subarray(0, bytesRead), remainder])
        let lineEnd = combined.length

        for (let idx = combined.length - 1; idx >= 0; idx -= 1) {
          if (combined[idx] !== 0x0a) {
            continue
          }

          const parsed = parseTranscriptEvent(combined.subarray(idx + 1, lineEnd))
          lineEnd = idx
          if (!parsed) {
            continue
          }
          if (parsed.type === 'result') {
            if (completedTurnsKept >= turnsToKeep) {
              reachedBoundary = true
              break
            }
            completedTurnsKept += 1
          }
          eventsInReverse.push(parsed)
        }

        remainder = combined.subarray(0, lineEnd)
      }

      if (!reachedBoundary && remainder.length > 0) {
        const parsed = parseTranscriptEvent(remainder)
        if (parsed) {
          if (parsed.type !== 'result' || completedTurnsKept < turnsToKeep) {
            if (parsed.type === 'result') {
              completedTurnsKept += 1
            }
            eventsInReverse.push(parsed)
          }
        }
      }

      return eventsInReverse.reverse()
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function writeSessionMeta(sessionName: string, meta: TranscriptMeta): Promise<void> {
  const metaPath = resolveMetaPath(sessionName)

  await queueWrite(metaPath, async () => {
    await writeJsonFileAtomically(metaPath, meta, { trailingNewline: true })
  })
}

export async function readSessionMeta(sessionName: string): Promise<TranscriptMeta | null> {
  const metaPath = resolveMetaPath(sessionName)
  let raw = ''
  try {
    raw = await readFile(metaPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const { cleaned } = migrateProviderContext(parsed as Record<string, unknown>)
    if (migratedProviderContextChanged(parsed as Record<string, unknown>, cleaned)) {
      await queueWrite(metaPath, async () => {
        await writeJsonFileAtomically(metaPath, cleaned, {
          backup: true,
          trailingNewline: true,
        })
      })
      console.warn(`[agents][migration] Migrated providerContext in "${metaPath}" (records=1)`)
    }
    return cleaned as TranscriptMeta
  } catch {
    return null
  }
}
