import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

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
  try {
    const raw = JSON.parse(await readFile(statePath, 'utf8')) as unknown
    if (!isObject(raw)) {
      throw new Error(`Remote sync state at "${statePath}" is invalid`)
    }
    const revision = parseNonNegativeInteger((raw as Partial<RemoteSyncState>).revision)
    if (revision === null) {
      throw new Error(`Remote sync state at "${statePath}" is invalid`)
    }
    return revision
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }
    throw error
  }
}

export async function writeRemoteSyncRevision(memoryRoot: string, revision: number): Promise<void> {
  const statePath = path.join(memoryRoot, REMOTE_SYNC_STATE_FILENAME)
  await writeFile(statePath, `${JSON.stringify({ revision }, null, 2)}\n`, 'utf8')
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
  await mkdir(memoryRoot, { recursive: true })

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
      await writeFile(memoryPath, memoryMd, 'utf8')
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
}
