import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GEMINI_IMAGE_GENERATION_PROVIDER_ID,
  OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
  ProviderSecretsStore,
} from '../provider-secrets-store'

const testDirectories: string[] = []

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-provider-secrets-store-'))
  testDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('ProviderSecretsStore', () => {
  it('stores, reads, lists, and deletes multiple provider secrets', async () => {
    const directory = await createTempDirectory()
    const filePath = path.join(directory, 'provider-secrets.json')
    const keyFilePath = path.join(directory, 'provider-secrets.key')
    const store = new ProviderSecretsStore({
      filePath,
      keyFilePath,
      encryptionKey: 'test-secret',
    })

    expect(await store.getSecretStatus(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)).toEqual({
      configured: false,
      updatedAt: null,
    })
    expect(await store.getSecretStatus(GEMINI_IMAGE_GENERATION_PROVIDER_ID)).toEqual({
      configured: false,
      updatedAt: null,
    })

    const openAiUpdatedAt = new Date('2026-05-05T04:15:00.000Z')
    const geminiUpdatedAt = new Date('2026-05-05T04:16:00.000Z')
    await store.setSecret(
      OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
      'sk-test-openai-key',
      { now: openAiUpdatedAt },
    )
    await store.setSecret(
      GEMINI_IMAGE_GENERATION_PROVIDER_ID,
      'AIza-test-gemini-key',
      { now: geminiUpdatedAt },
    )

    expect(await store.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)).toBe(
      'sk-test-openai-key',
    )
    expect(await store.getSecret(GEMINI_IMAGE_GENERATION_PROVIDER_ID)).toBe(
      'AIza-test-gemini-key',
    )
    expect(await store.listSecrets()).toEqual([
      {
        providerId: GEMINI_IMAGE_GENERATION_PROVIDER_ID,
        status: 'configured',
        updatedAt: geminiUpdatedAt.toISOString(),
      },
      {
        providerId: OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
        status: 'configured',
        updatedAt: openAiUpdatedAt.toISOString(),
      },
    ])

    const persisted = await readFile(filePath, 'utf8')
    expect(persisted).not.toContain('sk-test-openai-key')
    expect(persisted).not.toContain('AIza-test-gemini-key')
    expect(persisted).toContain('ciphertext')

    await store.deleteSecret(GEMINI_IMAGE_GENERATION_PROVIDER_ID)
    expect(await store.getSecret(GEMINI_IMAGE_GENERATION_PROVIDER_ID)).toBeNull()
    expect(await store.getSecretStatus(GEMINI_IMAGE_GENERATION_PROVIDER_ID)).toEqual({
      configured: false,
      updatedAt: null,
    })
  })

  it('migrates legacy transcription secret files to provider secret files on first load', async () => {
    const directory = await createTempDirectory()
    const legacyFilePath = path.join(directory, 'transcription-secrets.json')
    const legacyKeyFilePath = path.join(directory, 'transcription-secrets.key')
    const providerFilePath = path.join(directory, 'provider-secrets.json')
    const providerKeyFilePath = path.join(directory, 'provider-secrets.key')

    const seedDirectory = await createTempDirectory()
    const seedFilePath = path.join(seedDirectory, 'provider-secrets.json')
    const seedKeyFilePath = path.join(seedDirectory, 'provider-secrets.key')
    const seedStore = new ProviderSecretsStore({
      filePath: seedFilePath,
      keyFilePath: seedKeyFilePath,
      envKeyName: 'UNSET_PROVIDER_SECRETS_MIGRATION_KEY_FOR_TEST',
    })
    const updatedAt = new Date('2026-05-05T05:00:00.000Z')
    await seedStore.setSecret(
      OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID,
      'sk-migrated-openai-key',
      { now: updatedAt },
    )

    await rename(seedFilePath, legacyFilePath)
    await rename(seedKeyFilePath, legacyKeyFilePath)

    const store = new ProviderSecretsStore({
      filePath: providerFilePath,
      keyFilePath: providerKeyFilePath,
      envKeyName: 'UNSET_PROVIDER_SECRETS_MIGRATION_KEY_FOR_TEST',
    })

    expect(await store.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)).toBe(
      'sk-migrated-openai-key',
    )
    expect(await store.getSecretStatus(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)).toEqual({
      configured: true,
      updatedAt: updatedAt.toISOString(),
    })

    const migratedFileContents = await readFile(providerFilePath, 'utf8')
    expect(migratedFileContents).toContain(updatedAt.toISOString())
    await expect(readFile(legacyFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(legacyKeyFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('generates and persists a local encryption key file when no env key is configured', async () => {
    const directory = await createTempDirectory()
    const keyFilePath = path.join(directory, 'provider-secrets.key')
    const store = new ProviderSecretsStore({
      filePath: path.join(directory, 'provider-secrets.json'),
      keyFilePath,
      envKeyName: 'UNSET_PROVIDER_SECRETS_ENCRYPTION_KEY_FOR_TEST',
    })

    await store.setSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID, 'sk-generated-file-key')
    const persistedKey = (await readFile(keyFilePath, 'utf8')).trim()
    const decoded = Buffer.from(persistedKey, 'base64')
    expect(decoded).toHaveLength(32)
    expect(await store.getSecret(OPENAI_REALTIME_TRANSCRIPTION_PROVIDER_ID)).toBe(
      'sk-generated-file-key',
    )
  })
})
