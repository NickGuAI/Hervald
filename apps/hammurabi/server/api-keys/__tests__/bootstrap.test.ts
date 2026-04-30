import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  bootstrapDefaultMasterKey,
  DEFAULT_BOOTSTRAP_KEY_FILENAME,
  DEFAULT_MASTER_KEY_OPT_IN_ENV,
} from '../bootstrap'
import { ApiKeyJsonStore } from '../store'

const testDirectories: string[] = []

async function createTempStoreFilePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-bootstrap-key-'))
  testDirectories.push(directory)
  return path.join(directory, 'keys.json')
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('bootstrapDefaultMasterKey', () => {
  it('does not seed a key when the keystore is empty and opt-in is disabled', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const warnings: string[] = []
    const randomBytesImpl = vi.fn()

    const seeded = await bootstrapDefaultMasterKey(store, {
      env: {},
      keystorePath: filePath,
      logWarn: (message) => warnings.push(message),
      randomBytesImpl,
    })

    expect(seeded).toBeNull()
    expect(await store.listKeys()).toEqual([])
    expect(randomBytesImpl).not.toHaveBeenCalled()
    expect(warnings.join('\n')).toContain(filePath)
    expect(warnings.join('\n')).toContain(`${DEFAULT_MASTER_KEY_OPT_IN_ENV}=1`)
  })

  it('seeds a random plaintext key when explicit opt-in is enabled', async () => {
    const filePath = await createTempStoreFilePath()
    const bootstrapKeyPath = path.join(path.dirname(filePath), DEFAULT_BOOTSTRAP_KEY_FILENAME)
    const store = new ApiKeyJsonStore(filePath)
    const randomKeyBytes = Buffer.from('0123456789abcdef'.repeat(4), 'hex')

    const seeded = await bootstrapDefaultMasterKey(store, {
      env: { [DEFAULT_MASTER_KEY_OPT_IN_ENV]: '1' },
      keystorePath: filePath,
      bootstrapKeyPath,
      randomBytesImpl: vi.fn().mockReturnValue(randomKeyBytes),
    })

    expect(seeded).toBe(randomKeyBytes.toString('hex'))
    expect(seeded).toHaveLength(64)
    expect(await readFile(bootstrapKeyPath, 'utf8')).toBe(`${seeded}\n`)
    const mode = (await stat(bootstrapKeyPath)).mode & 0o777
    expect(mode).toBe(0o600)

    const verification = await store.verifyKey(seeded ?? '', {
      requiredScopes: ['services:write'],
    })
    expect(verification).toMatchObject({ ok: true })

    const [record] = await store.listKeys()
    expect(record?.name).toBe('Bootstrap Master Key')
    expect(record?.createdBy).toBe('system')
    expect(record?.scopes).not.toContain('agents:admin')
  })

  it('logs the random plaintext exactly once for operator retrieval', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const warnings: string[] = []
    const randomKeyBytes = Buffer.from('89abcdef01234567'.repeat(4), 'hex')

    const seeded = await bootstrapDefaultMasterKey(store, {
      env: { [DEFAULT_MASTER_KEY_OPT_IN_ENV]: '1' },
      keystorePath: filePath,
      logWarn: (message) => warnings.push(message),
      randomBytesImpl: vi.fn().mockReturnValue(randomKeyBytes),
    })

    expect(seeded).toBe(randomKeyBytes.toString('hex'))

    const retrievalLogs = warnings.filter((message) => message.includes(seeded ?? ''))
    expect(retrievalLogs).toHaveLength(0)
    expect(warnings.join('\n')).toContain('Bootstrap master key saved to')
  })

  it('falls back to logging the plaintext once when key-file persistence fails', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const warnings: string[] = []
    const randomKeyBytes = Buffer.from('fedcba9876543210'.repeat(4), 'hex')

    const seeded = await bootstrapDefaultMasterKey(store, {
      env: { [DEFAULT_MASTER_KEY_OPT_IN_ENV]: '1' },
      keystorePath: filePath,
      bootstrapKeyPath: path.join(filePath, 'not-a-directory', DEFAULT_BOOTSTRAP_KEY_FILENAME),
      logWarn: (message) => warnings.push(message),
      randomBytesImpl: vi.fn().mockReturnValue(randomKeyBytes),
    })

    expect(seeded).toBe(randomKeyBytes.toString('hex'))
    const retrievalLogs = warnings.filter((message) => message.includes(seeded ?? ''))
    expect(retrievalLogs).toHaveLength(1)
    expect(retrievalLogs[0]).toContain('fallback, logged once')
  })
})
