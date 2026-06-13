import path from 'node:path'
import {
  acquireFileLock,
  type HeldFileLock,
} from '../modules/durable-file.js'
import { resolveHammurabiDataDir } from '../modules/data-dir.js'

const MALFORMED_LOCK_STALE_MS = 60 * 60 * 1000

export function resolveHammurabiStoreLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHammurabiDataDir(env), '.store-writer.lock')
}

export async function acquireHammurabiStoreProcessLock(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HeldFileLock> {
  return acquireFileLock(resolveHammurabiStoreLockPath(env), {
    staleMs: MALFORMED_LOCK_STALE_MS,
  })
}
