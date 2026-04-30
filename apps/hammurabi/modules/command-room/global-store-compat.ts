import { access } from 'node:fs/promises'
import path from 'node:path'

export interface LegacyCompatibleGlobalStore {
  canonicalPath: string
  legacyPath: string
  fallbackEnabled: boolean
}

export const LEGACY_COMMAND_ROOM_DATA_DIR_WARNING =
  '[hammurabi] command-room data dir deprecated, migrated to automation/'

let hasWarnedLegacyCommandRoomDataDir = false

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (
      isObject(error) &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'ENOENT'
    ) {
      return false
    }
    throw error
  }
}

function warnLegacyCommandRoomDataDirOnce(): void {
  if (hasWarnedLegacyCommandRoomDataDir) {
    return
  }
  hasWarnedLegacyCommandRoomDataDir = true
  console.warn(LEGACY_COMMAND_ROOM_DATA_DIR_WARNING)
}

export async function resolveLegacyCompatibleGlobalReadPath(
  store: LegacyCompatibleGlobalStore,
): Promise<string> {
  const canonicalPath = path.resolve(store.canonicalPath)
  if (!store.fallbackEnabled) {
    return canonicalPath
  }

  if (await pathExists(canonicalPath)) {
    return canonicalPath
  }

  const legacyPath = path.resolve(store.legacyPath)
  if (await pathExists(legacyPath)) {
    warnLegacyCommandRoomDataDirOnce()
    return legacyPath
  }

  return canonicalPath
}

export function resolveLegacyCompatibleGlobalWritePath(
  store: LegacyCompatibleGlobalStore,
  filePath: string,
): string {
  const resolvedFilePath = path.resolve(filePath)
  if (!store.fallbackEnabled) {
    return resolvedFilePath
  }

  const resolvedLegacyPath = path.resolve(store.legacyPath)
  if (resolvedFilePath === resolvedLegacyPath) {
    return path.resolve(store.canonicalPath)
  }

  return resolvedFilePath
}

export function resetLegacyCommandRoomDataDirWarningForTests(): void {
  hasWarnedLegacyCommandRoomDataDir = false
}
