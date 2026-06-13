import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acquireHammurabiStoreProcessLock } from '../store-process-lock'

const tempDirectories: string[] = []

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-store-lock-'))
  tempDirectories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('Hammurabi store process lock', () => {
  it('refuses a second server writer while the lock is held', async () => {
    const dataDir = await createTempDataDir()
    const env = {
      ...process.env,
      HAMMURABI_DATA_DIR: dataDir,
    }
    const firstLock = await acquireHammurabiStoreProcessLock(env)

    try {
      await expect(acquireHammurabiStoreProcessLock(env))
        .rejects.toMatchObject({ code: 'ELOCKED' })
    } finally {
      await firstLock.release()
    }
  })
})
