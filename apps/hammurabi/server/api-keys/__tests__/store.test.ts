import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  API_KEY_SCOPES,
  ApiKeyJsonStore,
  DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES,
  hashApiKey,
} from '../store'

const testDirectories: string[] = []

async function createTempStoreFilePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-api-key-store-'))
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

  it('handles missing and corrupt JSON files gracefully', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new ApiKeyJsonStore(filePath)

    expect(await store.listKeys()).toEqual([])
    expect(await store.hasAnyKeys()).toBe(false)

    await writeFile(filePath, '{broken json', 'utf8')

    expect(await store.listKeys()).toEqual([])
    expect(await store.hasAnyKeys()).toBe(false)

    const verification = await store.verifyKey('hmrb_does-not-exist')
    expect(verification).toEqual({
      ok: false,
      reason: 'not_found',
    })
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
    expect(refreshed?.scopes).not.toContain('agents:admin')

    const verification = await store.verifyKey(rawKey, {
      requiredScopes: ['skills:read'],
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
    expect(DEFAULT_BOOTSTRAP_MASTER_KEY_SCOPES).not.toContain('agents:admin')
  })
})
