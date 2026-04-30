import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SentinelStore } from '../store'

// Targeted regression tests for example-repo#1222: legacy permissionMode literals
// (bypassPermissions / dangerouslySkipPermissions / acceptEdits) on sentinel
// records on disk used to be silently dropped by parseSentinel because the
// strict parser returns null for those values. Now they migrate to 'default',
// emit a structured warn, and the upgraded collection persists back to disk.

describe('SentinelStore: legacy permissionMode migration', () => {
  let tmpDir = ''
  let storePath = ''
  let store: SentinelStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sentinel-store-test-'))
    storePath = join(tmpDir, 'sentinels.json')
    store = new SentinelStore({ filePath: storePath })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  function makeLegacySentinel(legacyLiteral: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'sentinel-test-id',
      name: 'test-sentinel',
      instruction: 'do the thing',
      schedule: '0 4 * * *',
      status: 'active',
      parentCommanderId: 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
      memoryPath: '/tmp/sentinel-memory.md',
      outputDir: '/tmp/sentinel-out',
      workDir: '/home/builder',
      createdAt: '2026-04-01T00:00:00.000Z',
      lastRun: null,
      totalRuns: 0,
      totalCostUsd: 0,
      history: [],
      skills: [],
      seedMemory: '',
      permissionMode: legacyLiteral,
      agentType: 'claude',
      ...overrides,
    }
  }

  it('migrates a sentinel with bypassPermissions to default + warns once', async () => {
    await writeFile(
      storePath,
      `${JSON.stringify({ sentinels: [makeLegacySentinel('bypassPermissions')] }, null, 2)}\n`,
      'utf8',
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const sentinels = await store.list()
      expect(sentinels).toHaveLength(1)
      expect(sentinels[0]?.permissionMode).toBe('default')
      expect(sentinels[0]?.id).toBe('sentinel-test-id')

      const migrationWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(migrationWarns).toHaveLength(1)
      expect(migrationWarns[0]?.[1]).toMatchObject({
        sentinelId: 'sentinel-test-id',
        from: 'bypassPermissions',
        to: 'default',
      })

      const onDisk = JSON.parse(await readFile(storePath, 'utf8')) as { sentinels: Array<Record<string, unknown>> }
      expect(onDisk.sentinels[0]?.permissionMode).toBe('default')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('also handles dangerouslySkipPermissions and acceptEdits aliases', async () => {
    await writeFile(
      storePath,
      `${JSON.stringify({
        sentinels: [
          makeLegacySentinel('dangerouslySkipPermissions', { id: 'sentinel-a', name: 'a' }),
          makeLegacySentinel('acceptEdits', { id: 'sentinel-b', name: 'b' }),
        ],
      }, null, 2)}\n`,
      'utf8',
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const sentinels = await store.list()
      expect(sentinels).toHaveLength(2)
      expect(sentinels.every((s) => s.permissionMode === 'default')).toBe(true)

      const migrationWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(migrationWarns).toHaveLength(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('is idempotent — second load on already-upgraded file produces no warn and no churn', async () => {
    await writeFile(
      storePath,
      `${JSON.stringify({ sentinels: [makeLegacySentinel('bypassPermissions')] }, null, 2)}\n`,
      'utf8',
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await store.list()
      const firstWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(firstWarns).toBe(1)

      const afterFirst = await readFile(storePath, 'utf8')

      warnSpy.mockClear()
      await store.list()
      const secondWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      ).length
      expect(secondWarns).toBe(0)

      const afterSecond = await readFile(storePath, 'utf8')
      expect(afterSecond).toBe(afterFirst)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('passes through default values without warning', async () => {
    await writeFile(
      storePath,
      `${JSON.stringify({ sentinels: [makeLegacySentinel('default')] }, null, 2)}\n`,
      'utf8',
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await store.list()
      const migrationWarns = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('migrated legacy permissionMode'),
      )
      expect(migrationWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
