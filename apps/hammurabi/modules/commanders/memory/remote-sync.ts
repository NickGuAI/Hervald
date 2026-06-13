import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  readJsonFileFailClosed,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from '../../json-file.js'
import { withMemoryMutationLock } from './mutation-lock.js'

const DEFAULT_MEMORY_MD = '# Commander Memory\n\n'

export const REMOTE_SYNC_STATE_FILENAME = '.remote-sync-state.json'

interface RemoteSyncState {
  revision: number
}

export interface RemoteMemorySnapshot {
  syncRevision: number
  memoryMd: string
}

export interface RemoteMemorySnapshotApplyConflict {
  status: 'conflict'
  currentSyncRevision: number
}

export interface RemoteMemorySnapshotApplySuccess {
  status: 'applied'
  appliedRevision: number
  memoryUpdated: boolean
}

export type RemoteMemorySnapshotApplyResult =
  | RemoteMemorySnapshotApplyConflict
  | RemoteMemorySnapshotApplySuccess

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseNonNegativeInteger(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return null
  }
  return raw
}

async function readMemoryMd(memoryRoot: string): Promise<string> {
  const memoryPath = path.join(memoryRoot, 'MEMORY.md')
  try {
    return await readFile(memoryPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_MEMORY_MD
    }
    throw error
  }
}

export async function readRemoteSyncRevision(memoryRoot: string): Promise<number> {
  const statePath = path.join(memoryRoot, REMOTE_SYNC_STATE_FILENAME)
  const raw = await readJsonFileFailClosed(statePath)
  if (raw === null) {
    return 0
  }
  if (!isObject(raw)) {
    throw new Error(`Remote sync state at "${statePath}" is invalid`)
  }
  const revision = parseNonNegativeInteger((raw as Partial<RemoteSyncState>).revision)
  if (revision === null) {
    throw new Error(`Remote sync state at "${statePath}" is invalid`)
  }
  return revision
}

export async function writeRemoteSyncRevision(memoryRoot: string, revision: number): Promise<void> {
  const statePath = path.join(memoryRoot, REMOTE_SYNC_STATE_FILENAME)
  await writeJsonFileAtomically(statePath, { revision }, { trailingNewline: true })
}

export async function advanceRemoteSyncRevision(
  memoryRoot: string,
  currentRevision?: number,
): Promise<number> {
  const nextRevision = (currentRevision ?? await readRemoteSyncRevision(memoryRoot)) + 1
  await writeRemoteSyncRevision(memoryRoot, nextRevision)
  return nextRevision
}

export async function exportRemoteMemorySnapshot(memoryRoot: string): Promise<RemoteMemorySnapshot> {
  const [syncRevision, memoryMd] = await Promise.all([
    readRemoteSyncRevision(memoryRoot),
    readMemoryMd(memoryRoot),
  ])

  return {
    syncRevision,
    memoryMd,
  }
}

export async function applyRemoteMemorySnapshot(
  memoryRoot: string,
  baseRevision: number,
  memoryMd?: string,
): Promise<RemoteMemorySnapshotApplyResult> {
  return withMemoryMutationLock(memoryRoot, async () => {
    const currentRevision = await readRemoteSyncRevision(memoryRoot)
    if (baseRevision !== currentRevision) {
      return {
        status: 'conflict',
        currentSyncRevision: currentRevision,
      }
    }

    let memoryUpdated = false
    if (memoryMd !== undefined) {
      const currentMemoryMd = await readMemoryMd(memoryRoot)
      if (currentMemoryMd !== memoryMd) {
        const memoryPath = path.join(memoryRoot, 'MEMORY.md')
        await writeTextFileAtomically(memoryPath, memoryMd)
        memoryUpdated = true
      }
    }

    return {
      status: 'applied',
      appliedRevision: memoryUpdated
        ? await advanceRemoteSyncRevision(memoryRoot, currentRevision)
        : currentRevision,
      memoryUpdated,
    }
  })
}
