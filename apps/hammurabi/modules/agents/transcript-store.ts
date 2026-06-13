import { mkdir, open, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import {
  migrateProviderContext,
  migratedProviderContextChanged,
} from './providers/provider-context-migration.js'
import { writeJsonFileAtomically } from '../json-file.js'
import { appendFileDurably, writeFileAtomically } from '../durable-file.js'
import {
  isTranscriptEnvelope,
  type TranscriptEnvelope,
} from '../../src/types/transcript-envelope.js'
import type { StreamJsonEvent } from './types.js'
import { isTranscriptTurnEndRecord } from './transcript-records.js'

export type TranscriptEvent = {
  type?: string
  [key: string]: unknown
} | TranscriptEnvelope

export type TranscriptMeta = Record<string, unknown>

export interface TranscriptTailPage {
  events: TranscriptEvent[]
  hasMore: boolean
}

export interface TranscriptPruneResult {
  pruned: boolean
  eventsKept: number
}

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

async function queueWrite<T>(filePath: string, write: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve()
  let currentResolve!: (value: T) => void
  let currentReject!: (error: unknown) => void
  const current = new Promise<T>((resolve, reject) => {
    currentResolve = resolve
    currentReject = reject
  })

  const currentTail = current.then(
    () => undefined,
    () => undefined,
  )
  writeQueues.set(filePath, currentTail)

  void previous
    .catch(() => undefined)
    .then(async () => {
      currentResolve(await write())
    })
    .catch((error) => {
      currentReject(error)
    })
    .finally(() => {
      if (writeQueues.get(filePath) === currentTail) {
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
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (typeof (parsed as { type?: unknown }).type === 'string') {
      return parsed as TranscriptEvent
    }
    return isTranscriptEnvelope(parsed) ? parsed : null
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
    await appendFileDurably(transcriptPath, line)
  })
}

async function readTranscriptTailPageInternal(
  sessionName: string,
  maxTurns: number,
  maxEvents?: number,
): Promise<TranscriptTailPage> {
  const transcriptPath = resolveTranscriptPath(sessionName)
  const turnsToKeep = Math.max(0, Math.floor(maxTurns))
  const eventsToKeep = maxEvents === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(maxEvents))
  try {
    const fileHandle = await open(transcriptPath, 'r')
    try {
      const { size } = await fileHandle.stat()
      if (size === 0) {
        return { events: [], hasMore: false }
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
          if (isTranscriptTurnEndRecord(parsed as StreamJsonEvent)) {
            if (completedTurnsKept >= turnsToKeep) {
              reachedBoundary = true
              break
            }
            completedTurnsKept += 1
          }
          eventsInReverse.push(parsed)
          if (eventsInReverse.length >= eventsToKeep) {
            reachedBoundary = true
            break
          }
        }

        remainder = combined.subarray(0, lineEnd)
      }

      if (!reachedBoundary && remainder.length > 0) {
        const parsed = parseTranscriptEvent(remainder)
        if (parsed) {
          if (!isTranscriptTurnEndRecord(parsed as StreamJsonEvent) || completedTurnsKept < turnsToKeep) {
            if (isTranscriptTurnEndRecord(parsed as StreamJsonEvent)) {
              completedTurnsKept += 1
            }
            eventsInReverse.push(parsed)
          }
        }
      }

      return {
        events: eventsInReverse.reverse(),
        hasMore: reachedBoundary,
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], hasMore: false }
    }
    throw error
  }
}

export async function readTranscriptTail(sessionName: string, maxTurns: number): Promise<TranscriptEvent[]> {
  return (await readTranscriptTailPageInternal(sessionName, maxTurns)).events
}

export async function readTranscriptTailPage(
  sessionName: string,
  options: {
    maxTurns: number
    maxEvents: number
  },
): Promise<TranscriptTailPage> {
  return readTranscriptTailPageInternal(sessionName, options.maxTurns, options.maxEvents)
}

export async function pruneSessionTranscript(
  sessionName: string,
  options: {
    maxTurns: number
    maxEvents: number
  },
): Promise<TranscriptPruneResult> {
  const transcriptPath = resolveTranscriptPath(sessionName)
  return queueWrite(transcriptPath, async () => {
    const page = await readTranscriptTailPageInternal(
      sessionName,
      options.maxTurns,
      options.maxEvents,
    )
    if (!page.hasMore) {
      return {
        pruned: false,
        eventsKept: page.events.length,
      }
    }

    const contents = page.events.length > 0
      ? `${page.events.map((event) => JSON.stringify(event)).join('\n')}\n`
      : ''
    await writeFileAtomically(transcriptPath, contents)
    return {
      pruned: true,
      eventsKept: page.events.length,
    }
  })
}

export async function readTranscriptEvents(sessionName: string): Promise<TranscriptEvent[]> {
  const transcriptPath = resolveTranscriptPath(sessionName)
  let raw = ''
  try {
    raw = await readFile(transcriptPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const events: TranscriptEvent[] = []
  for (const line of raw.split('\n')) {
    const parsed = parseTranscriptEvent(Buffer.from(line))
    if (parsed) {
      events.push(parsed)
    }
  }
  return events
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
