import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  API_KEY_SCOPES,
  ApiKeyJsonStore,
  DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES,
  DEFAULT_BOOTSTRAP_MASTER_KEY_TTL_MS,
  hashApiKey,
} from '../store'

const testDirectories: string[] = []

async function createTempStoreFilePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-api-key-store-'))
  testDirectories.push(directory)
  return path.join(directory, 'keys.json')
}

async function readOnlyCorruptFile(directory: string, baseName: string): Promise<string> {
  const files = await readdir(directory)
  const corruptFile = files.find((file) => file.startsWith(`${baseName}.corrupt.`))
  if (!corruptFile) {
    throw new Error(`Expected ${baseName} corrupt quarantine file in ${directory}`)
  }
  return readFile(path.join(directory, corruptFile), 'utf8')
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('ApiKeyJsonStore', () => {
  it('creates, lists, and revokes API keys while storing only hashed values', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const now = new Date('2026-02-16T00:00:00.000Z')

    const created = await store.createKey({
      name: 'Telemetry Writer',
      scopes: ['telemetry:write'],
      createdBy: 'ops@gehirn.ai',
      now,
    })

    expect(created.key.startsWith('hmrb_')).toBe(true)
    expect(created.record.keyHash).toBe(hashApiKey(created.key))

    const persisted = await readFile(filePath, 'utf8')
    expect(persisted).not.toContain(created.key)

    const listed = await store.listKeys()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: created.record.id,
      name: 'Telemetry Writer',
      prefix: created.key.slice(0, 9),
      createdBy: 'ops@gehirn.ai',
      createdAt: now.toISOString(),
      lastUsedAt: null,
      scopes: ['telemetry:write'],
    })

    const revoked = await store.revokeKey(created.record.id)
    expect(revoked).toBe(true)
    expect(await store.listKeys()).toEqual([])
  })

  it('validates scopes and updates lastUsedAt on successful verification', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    const created = await store.createKey({
      name: 'Services Key',
      scopes: ['services:write'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-02-16T00:00:00.000Z'),
    })

    const denied = await store.verifyKey(created.key, {
      requiredScopes: ['telemetry:write'],
    })
    expect(denied).toEqual({
      ok: false,
      reason: 'insufficient_scope',
    })

    const verifiedAt = new Date('2026-02-16T00:05:00.000Z')
    const allowed = await store.verifyKey(created.key, {
      requiredScopes: ['services:write'],
      now: verifiedAt,
    })
    expect(allowed.ok).toBe(true)
    if (!allowed.ok) {
      return
    }

    expect(allowed.record.lastUsedAt).toBe(verifiedAt.toISOString())
  })

  it('rejects expired API keys without updating lastUsedAt', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    const created = await store.createKey({
      name: 'Mobile Pairing',
      scopes: ['agents:read'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-06-01T00:00:00.000Z'),
      expiresAt: new Date('2026-06-01T00:01:00.000Z'),
    })

    await expect(store.verifyKey(created.key, {
      requiredScopes: ['agents:read'],
      now: new Date('2026-06-01T00:00:59.000Z'),
    })).resolves.toMatchObject({ ok: true })

    await expect(store.verifyKey(created.key, {
      requiredScopes: ['agents:read'],
      now: new Date('2026-06-01T00:01:00.000Z'),
    })).resolves.toEqual({
      ok: false,
      reason: 'expired',
    })

    expect((await store.listKeys())[0]?.lastUsedAt).toBe('2026-06-01T00:00:59.000Z')
  })

  it('throttles lastUsedAt persistence instead of writing on every verification', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    const created = await store.createKey({
      name: 'Telemetry Key',
      scopes: ['telemetry:write'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-02-16T00:00:00.000Z'),
    })

    const firstVerifiedAt = new Date('2026-02-16T00:05:00.000Z')
    const firstVerification = await store.verifyKey(created.key, {
      requiredScopes: ['telemetry:write'],
      now: firstVerifiedAt,
    })
    expect(firstVerification).toMatchObject({
      ok: true,
      record: {
        lastUsedAt: firstVerifiedAt.toISOString(),
      },
    })
    expect((await store.listKeys())[0]?.lastUsedAt).toBe(firstVerifiedAt.toISOString())

    const secondVerifiedAt = new Date('2026-02-16T00:05:30.000Z')
    const secondVerification = await store.verifyKey(created.key, {
      requiredScopes: ['telemetry:write'],
      now: secondVerifiedAt,
    })
    expect(secondVerification).toMatchObject({
      ok: true,
      record: {
        lastUsedAt: firstVerifiedAt.toISOString(),
      },
    })
    expect((await store.listKeys())[0]?.lastUsedAt).toBe(firstVerifiedAt.toISOString())

    const thirdVerifiedAt = new Date('2026-02-16T00:06:05.000Z')
    const thirdVerification = await store.verifyKey(created.key, {
      requiredScopes: ['telemetry:write'],
      now: thirdVerifiedAt,
    })
    expect(thirdVerification).toMatchObject({
      ok: true,
      record: {
        lastUsedAt: thirdVerifiedAt.toISOString(),
      },
    })
    expect((await store.listKeys())[0]?.lastUsedAt).toBe(thirdVerifiedAt.toISOString())
  })

  it('serializes concurrent create and revoke operations', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    const created = await Promise.all(
      Array.from({ length: 12 }, (_value, index) =>
        store.createKey({
          name: `Key ${index + 1}`,
          scopes: ['telemetry:write'],
          createdBy: 'ops@gehirn.ai',
          now: new Date('2026-02-16T00:00:00.000Z'),
        }),
      ),
    )

    const listedAfterCreate = await store.listKeys()
    expect(listedAfterCreate).toHaveLength(12)
    const createdIds = new Set(created.map((item) => item.record.id))
    const listedIds = new Set(listedAfterCreate.map((item) => item.id))
    expect([...createdIds].every((id) => listedIds.has(id))).toBe(true)

    const idsToRevoke = created.slice(0, 5).map((item) => item.record.id)
    await Promise.all(idsToRevoke.map((id) => store.revokeKey(id)))

    const listedAfterRevoke = await store.listKeys()
    expect(listedAfterRevoke).toHaveLength(7)
    const remainingIds = new Set(listedAfterRevoke.map((item) => item.id))
    expect(idsToRevoke.every((id) => !remainingIds.has(id))).toBe(true)
  })

  it('handles missing JSON files gracefully', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    expect(await store.listKeys()).toEqual([])
    expect(await store.hasAnyKeys()).toBe(false)
  })

  it('fails closed and quarantines corrupt API key JSON before mutating', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    await store.createKey({
      name: 'Existing Key',
      scopes: ['telemetry:write'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-02-16T00:00:00.000Z'),
    })
    const original = await readFile(filePath, 'utf8')
    const truncated = original.slice(0, -2)
    await writeFile(filePath, truncated, 'utf8')

    await expect(store.createKey({
      name: 'New Key',
      scopes: ['agents:read'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-02-16T00:01:00.000Z'),
    })).rejects.toThrow(/Corrupt JSON file/)

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readOnlyCorruptFile(path.dirname(filePath), 'keys.json'))
      .resolves.toBe(truncated)
  })

  it('handles malformed persisted hashes without throwing during verification', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          keys: [
            {
              id: 'key-1',
              name: 'Malformed Hash Key',
              keyHash: 'short',
              prefix: 'hmrb_abcd',
              createdBy: 'ops@gehirn.ai',
              createdAt: '2026-02-16T00:00:00.000Z',
              lastUsedAt: null,
              scopes: ['telemetry:write'],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const verification = await store.verifyKey('hmrb_anything')
    expect(verification).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('backfills new scopes onto an existing seeded default key', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const rawKey = 'HAMMURABI!'

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          keys: [
            {
              id: 'key-1',
              name: 'Master Key',
              keyHash: hashApiKey(rawKey),
              prefix: rawKey.slice(0, 9),
              createdBy: 'system',
              createdAt: '2026-02-16T00:00:00.000Z',
              lastUsedAt: null,
              scopes: [
                'telemetry:read',
                'telemetry:write',
                'agents:read',
                'agents:write',
                'commanders:read',
                'commanders:write',
                'services:read',
                'services:write',
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    expect(await store.seedDefaultKey(rawKey)).toBeNull()

    const [refreshed] = await store.listKeys()
    expect(refreshed?.scopes).toEqual([...DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES])
    expect(refreshed?.expiresAt).toBe(
      new Date(
        new Date('2026-02-16T00:00:00.000Z').getTime() + DEFAULT_BOOTSTRAP_MASTER_KEY_TTL_MS,
      ).toISOString(),
    )
    // Backfill brings the on-disk key up to the current bootstrap shape, which
    // includes agents:admin so the founder can manage their own API keys.
    expect(refreshed?.scopes).toContain('agents:admin')

    const verification = await store.verifyKey(rawKey, {
      requiredScopes: ['skills:read'],
      now: new Date('2026-02-16T12:00:00.000Z'),
    })
    expect(verification).toMatchObject({ ok: true })
  })

  it('accepts agents:admin for explicit keys but keeps it out of default bootstrap scopes', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    const created = await store.createKey({
      name: 'Dangerous Session Key',
      scopes: ['agents:write', 'agents:admin'],
      createdBy: 'ops@gehirn.ai',
      now: new Date('2026-02-16T00:00:00.000Z'),
    })

    const verification = await store.verifyKey(created.key, {
      requiredScopes: ['agents:admin'],
    })
    expect(verification).toMatchObject({ ok: true })
    expect(API_KEY_SCOPES).toContain('agents:admin')
    // The bootstrap master key is the founder's full-admin key. It must include
    // agents:admin so the founder can manage their own API keys (rotate, mint
    // scoped keys, etc.) via the /keys management routes without hand-editing
    // the on-disk store.
    expect(DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES).toContain('agents:admin')
  })

  it('seeds bootstrap master keys with a short expiry', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)
    const rawKey = 'HAMMURABI!'
    const now = new Date('2026-06-10T00:00:00.000Z')

    expect(await store.seedDefaultKey(rawKey, 'Bootstrap Master Key', now)).toBe(rawKey)

    const [record] = await store.listKeys()
    expect(record?.expiresAt).toBe(
      new Date(now.getTime() + DEFAULT_BOOTSTRAP_MASTER_KEY_TTL_MS).toISOString(),
    )
    expect(await store.verifyKey(rawKey, {
      requiredScopes: ['agents:admin'],
      now: new Date(now.getTime() + DEFAULT_BOOTSTRAP_MASTER_KEY_TTL_MS - 1),
    })).toMatchObject({ ok: true })
    expect(await store.verifyKey(rawKey, {
      requiredScopes: ['agents:admin'],
      now: new Date(now.getTime() + DEFAULT_BOOTSTRAP_MASTER_KEY_TTL_MS),
    })).toEqual({ ok: false, reason: 'expired' })
  })
})
