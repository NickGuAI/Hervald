import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyEmailAllowlist } from '../legacy-email-allowlist-migration'
import { PolicyStore } from '../store'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('legacy email allowlist migration', () => {
  it('keeps only permanent audited recipients and flags unresolved addresses', async () => {
    const now = new Date('2026-04-20T12:00:00.000Z')
    const rootDir = await createTempDir('hammurabi-email-allowlist-migration-')
    const sourceFilePath = path.join(rootDir, 'legacy-email-allowlist.json')
    const targetPolicyFilePath = path.join(rootDir, 'policies.json')

    await writeFile(sourceFilePath, JSON.stringify({
      standing_approval: [
        'yu.gu.columbia@gmail.com',
        'nickgu@pioneeringminds.ai',
        'mengzew.xieyi@gmail.com',
        'nickgu@google.com',
        'lonnnghy@gmail.com',
        'mystery@example.com',
      ],
      per_instance_approved: [],
    }, null, 2), 'utf8')

    const seedStore = new PolicyStore({
      filePath: targetPolicyFilePath,
      now: () => now,
    })
    await seedStore.putPolicy('global', 'send-email', {
      policy: 'block',
      allowlist: [],
      blocklist: ['ceo@example.com'],
      updatedBy: 'seed@example.com',
    })

    const result = await migrateLegacyEmailAllowlist({
      sourceFilePath,
      targetPolicyFilePath,
      now: () => now,
      addedBy: 'migration-test',
      resolveAddedAt: async (email) => (
        email === 'yu.gu.columbia@gmail.com'
          ? '2026-03-01T00:00:00.000Z'
          : '2026-04-10T00:00:00.000Z'
      ),
    })

    expect(result.kept.map((entry) => entry.email)).toEqual([
      'mengzew.xieyi@gmail.com',
      'nickgu@pioneeringminds.ai',
      'yu.gu.columbia@gmail.com',
    ])
    expect(result.purged).toEqual([
      {
        email: 'lonnnghy@gmail.com',
        reason: 'Purged after Gmail audit: Heyang / Pioneer Track Session 1 reminder on Apr 9-10, 2026.',
      },
      {
        email: 'nickgu@google.com',
        reason: 'Purged stale Apr 10 google.com approval-queue test mistake.',
      },
    ])
    expect(result.unresolved).toEqual(['mystery@example.com'])

    const store = new PolicyStore({
      filePath: targetPolicyFilePath,
      now: () => now,
    })
    const sendEmail = (await store.getGlobal()).records.find((record) => record.actionId === 'send-email')

    expect(sendEmail).toEqual(expect.objectContaining({
      actionId: 'send-email',
      policy: 'review',
      allowlist: [
        'mengzew.xieyi@gmail.com',
        'nickgu@pioneeringminds.ai',
        'yu.gu.columbia@gmail.com',
      ],
      blocklist: ['ceo@example.com'],
      standing_approval: [
        {
          email: 'mengzew.xieyi@gmail.com',
          added_at: '2026-04-10T00:00:00.000Z',
          added_by: 'migration-test',
          reason: 'Permanent standing approval: spouse.',
          permanent: true,
        },
        {
          email: 'nickgu@pioneeringminds.ai',
          added_at: '2026-04-10T00:00:00.000Z',
          added_by: 'migration-test',
          reason: 'Permanent standing approval: work inbox.',
          permanent: true,
        },
        {
          email: 'yu.gu.columbia@gmail.com',
          added_at: '2026-03-01T00:00:00.000Z',
          added_by: 'migration-test',
          reason: 'Permanent standing approval: personal inbox.',
          permanent: true,
        },
      ],
    }))
  })
})
