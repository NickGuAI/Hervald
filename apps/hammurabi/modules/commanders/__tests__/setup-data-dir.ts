import { afterAll, beforeAll } from 'vitest'

const isBrowserLike = typeof document !== 'undefined'

if (!isBrowserLike) {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const originalHammurabiDataDir = process.env.HAMMURABI_DATA_DIR
  const originalCommanderDataDir = process.env.COMMANDER_DATA_DIR
  const originalLegacyCommanderDataDir = process.env.HAMMURABI_COMMANDER_MEMORY_DIR
  const isolatedHammurabiDataDir = await mkdtemp(
    join(tmpdir(), 'hammurabi-commanders-suite-data-'),
  )

  function installIsolatedCommanderDataDir(): void {
    process.env.HAMMURABI_DATA_DIR = isolatedHammurabiDataDir
    delete process.env.COMMANDER_DATA_DIR
    delete process.env.HAMMURABI_COMMANDER_MEMORY_DIR
  }

  installIsolatedCommanderDataDir()

  beforeAll(() => {
    installIsolatedCommanderDataDir()
  })

  afterAll(async () => {
    if (originalHammurabiDataDir === undefined) {
      delete process.env.HAMMURABI_DATA_DIR
    } else {
      process.env.HAMMURABI_DATA_DIR = originalHammurabiDataDir
    }

    if (originalCommanderDataDir === undefined) {
      delete process.env.COMMANDER_DATA_DIR
    } else {
      process.env.COMMANDER_DATA_DIR = originalCommanderDataDir
    }

    if (originalLegacyCommanderDataDir === undefined) {
      delete process.env.HAMMURABI_COMMANDER_MEMORY_DIR
    } else {
      process.env.HAMMURABI_COMMANDER_MEMORY_DIR = originalLegacyCommanderDataDir
    }

    await rm(isolatedHammurabiDataDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
}
