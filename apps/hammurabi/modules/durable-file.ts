import { randomUUID } from 'node:crypto'
import { closeSync, readFileSync, rmSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'

export const DEFAULT_BACKUP_RETENTION = 5

export interface AtomicFileWriteOptions {
  backup?: boolean
  backupRetention?: number
  mode?: number
}

export interface FileLockOptions {
  staleMs?: number
}

export interface HeldFileLock {
  lockPath: string
  release(): Promise<void>
  releaseSync(): void
}

interface LockMetadata {
  token: string
  pid: number
  hostname: string
  acquiredAt: string
}

export class FileLockConflictError extends Error {
  readonly code = 'ELOCKED'

  constructor(
    readonly lockPath: string,
    readonly holder: LockMetadata | null,
  ) {
    const holderLabel = holder
      ? `pid ${holder.pid} on ${holder.hostname}`
      : 'an unknown process'
    super(`File lock "${lockPath}" is held by ${holderLabel}`)
    this.name = 'FileLockConflictError'
  }
}

const mutationQueues = new Map<string, Promise<void>>()

function isErrnoCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

function buildLockMetadata(token: string): LockMetadata {
  return {
    token,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return true
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isErrnoCode(error, 'ESRCH')
  }
}

async function readLockMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as LockMetadata).token === 'string' &&
      typeof (parsed as LockMetadata).pid === 'number' &&
      typeof (parsed as LockMetadata).hostname === 'string' &&
      typeof (parsed as LockMetadata).acquiredAt === 'string'
    ) {
      return parsed as LockMetadata
    }
  } catch {
    return null
  }
  return null
}

async function shouldBreakLock(lockPath: string, options: FileLockOptions): Promise<boolean> {
  const metadata = await readLockMetadata(lockPath)
  if (metadata && !isPidAlive(metadata.pid)) {
    return true
  }

  if (!metadata && options.staleMs !== undefined) {
    try {
      const lockStat = await stat(lockPath)
      return Date.now() - lockStat.mtimeMs > options.staleMs
    } catch {
      return false
    }
  }

  return false
}

async function removeLockIfOwned(lockPath: string, token: string): Promise<void> {
  try {
    const metadata = await readLockMetadata(lockPath)
    if (metadata?.token !== token) {
      return
    }
    await rm(lockPath, { force: true })
    await fsyncDirectory(path.dirname(lockPath))
  } catch {
    // Lock cleanup is best-effort during shutdown and failure paths.
  }
}

function removeLockIfOwnedSync(lockPath: string, token: string): void {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { token?: unknown }).token !== token
    ) {
      return
    }
    rmSync(lockPath, { force: true })
  } catch {
    // Synchronous process-exit cleanup is best-effort.
  }
}

export async function fsyncDirectory(dirPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(dirPath, 'r')
    await handle.sync()
  } catch (error) {
    if (
      isErrnoCode(error, 'EINVAL') ||
      isErrnoCode(error, 'EISDIR') ||
      isErrnoCode(error, 'EPERM') ||
      isErrnoCode(error, 'EACCES')
    ) {
      return
    }
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function writeFileDurably(
  filePath: string,
  data: string | Buffer,
  options: { mode?: number } = {},
): Promise<void> {
  const handle = await open(filePath, 'w', options.mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncExistingFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function appendFileDurably(
  filePath: string,
  data: string | Buffer,
  options: { mode?: number } = {},
): Promise<void> {
  await withFileMutationLock(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    const handle = await open(filePath, 'a', options.mode)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsyncDirectory(path.dirname(filePath))
  })
}

export async function acquireFileLock(
  lockPath: string,
  options: FileLockOptions = {},
): Promise<HeldFileLock> {
  await mkdir(path.dirname(lockPath), { recursive: true })
  const token = randomUUID()

  const create = async () => {
    const handle = await open(lockPath, 'wx', 0o600)
    try {
      const metadata = buildLockMetadata(token)
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
      await handle.sync()
      await fsyncDirectory(path.dirname(lockPath))
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(lockPath, { force: true }).catch(() => undefined)
      await fsyncDirectory(path.dirname(lockPath)).catch(() => undefined)
      throw error
    }

    let released = false
    return {
      lockPath,
      async release() {
        if (released) {
          return
        }
        released = true
        await handle.close().catch(() => undefined)
        await removeLockIfOwned(lockPath, token)
      },
      releaseSync() {
        if (released) {
          return
        }
        released = true
        try {
          closeSync(handle.fd)
        } catch {
          // The descriptor may already be closed by async shutdown.
        }
        removeLockIfOwnedSync(lockPath, token)
      },
    } satisfies HeldFileLock
  }

  try {
    return await create()
  } catch (error) {
    if (!isErrnoCode(error, 'EEXIST')) {
      throw error
    }
  }

  if (await shouldBreakLock(lockPath, options)) {
    await rm(lockPath, { force: true })
    await fsyncDirectory(path.dirname(lockPath))
    try {
      return await create()
    } catch (error) {
      if (!isErrnoCode(error, 'EEXIST')) {
        throw error
      }
    }
  }

  throw new FileLockConflictError(lockPath, await readLockMetadata(lockPath))
}

export async function withFileMutationLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`
  const queueKey = path.resolve(lockPath)
  const previous = mutationQueues.get(queueKey) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    const lock = await acquireFileLock(lockPath)
    try {
      return await operation()
    } finally {
      await lock.release()
    }
  })
  const queueTail = run.then(
    () => undefined,
    () => undefined,
  )
  mutationQueues.set(queueKey, queueTail)

  try {
    return await run
  } finally {
    if (mutationQueues.get(queueKey) === queueTail) {
      mutationQueues.delete(queueKey)
    }
  }
}

function buildBackupPath(filePath: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.(\d{3})Z$/, '$1Z')
  return `${filePath}.bak.${stamp}.${randomUUID()}`
}

async function pruneBackups(filePath: string, retention: number): Promise<void> {
  const keepCount = Math.max(0, Math.floor(retention))
  const dirPath = path.dirname(filePath)
  const backupPrefix = `${path.basename(filePath)}.bak.`
  let backupNames: string[]
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    backupNames = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(backupPrefix))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return
    }
    throw error
  }

  const deleteNames = backupNames.slice(keepCount)
  if (deleteNames.length === 0) {
    return
  }

  await Promise.all(deleteNames.map((name) =>
    rm(path.join(dirPath, name), { force: true }),
  ))
  await fsyncDirectory(dirPath)
}

export async function writeFileAtomically(
  filePath: string,
  data: string | Buffer,
  options: AtomicFileWriteOptions = {},
): Promise<string | null> {
  return withFileMutationLock(filePath, async () => {
    const dirPath = path.dirname(filePath)
    await mkdir(dirPath, { recursive: true })

    let backupPath: string | null = null
    if (options.backup) {
      backupPath = buildBackupPath(filePath)
      try {
        await copyFile(filePath, backupPath)
        await syncExistingFile(backupPath)
      } catch (error) {
        if (!isErrnoCode(error, 'ENOENT')) {
          throw error
        }
        backupPath = null
      }
    }

    const tempPath = path.join(
      dirPath,
      `${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )

    try {
      await writeFileDurably(tempPath, data, { mode: options.mode })
      await rename(tempPath, filePath)
      await fsyncDirectory(dirPath)
      if (options.backup) {
        await pruneBackups(filePath, options.backupRetention ?? DEFAULT_BACKUP_RETENTION)
      }
      return backupPath
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  })
}
