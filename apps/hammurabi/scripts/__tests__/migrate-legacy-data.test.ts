import { afterEach, describe, expect, it } from 'vitest'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrateLegacyData } from '../migrate-legacy-data'

const FIXED_NOW = new Date('2026-04-21T12:00:00.000Z')
const FIXED_ARCHIVE_DATE = FIXED_NOW.toISOString().slice(0, 10)
const tempDirectories: string[] = []

interface MigrationHarness {
  sourceRoot: string
  targetRoot: string
}

async function createHarness(): Promise<MigrationHarness> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hammurabi-legacy-data-migration-'))
  tempDirectories.push(rootDir)
  const sourceRoot = path.join(rootDir, 'source')
  const targetRoot = path.join(rootDir, 'target')
  await mkdir(sourceRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  return {
    sourceRoot,
    targetRoot,
  }
}

async function writeFixture(
  rootDir: string,
  relativePath: string,
  contents: string,
  mtime: Date = FIXED_NOW,
): Promise<string> {
  const filePath = path.join(rootDir, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents, 'utf8')
  await utimes(filePath, mtime, mtime)
  return filePath
}

async function readText(rootDir: string, relativePath: string): Promise<string> {
  return readFile(path.join(rootDir, relativePath), 'utf8')
}

async function pathExists(rootDir: string, relativePath: string): Promise<boolean> {
  try {
    await access(path.join(rootDir, relativePath), constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function collectRelativeFiles(rootDir: string, relativeDir = ''): Promise<string[]> {
  const directoryPath = path.join(rootDir, relativeDir)
  try {
    const directoryStat = await stat(directoryPath)
    if (!directoryStat.isDirectory()) {
      return []
    }
  } catch {
    return []
  }

  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryRelativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectRelativeFiles(rootDir, entryRelativePath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryRelativePath)
    }
  }

  return files
}

async function snapshotTree(rootDir: string): Promise<Record<string, { size: number; mtimeMs: number }>> {
  const files = await collectRelativeFiles(rootDir)
  const entries = await Promise.all(
    files.map(async (relativePath) => {
      const fileStat = await stat(path.join(rootDir, relativePath))
      return [
        relativePath,
        {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        },
      ] as const
    }),
  )

  return Object.fromEntries(entries)
}

async function seedIntegrationFixture(harness: MigrationHarness): Promise<void> {
  await writeFixture(
    harness.sourceRoot,
    'telemetry/events.jsonl',
    '{"type":"otel_log","recordedAt":"2026-04-18T00:00:00.000Z"}\n',
    new Date('2026-04-18T00:00:00.000Z'),
  )
  await writeFixture(
    harness.targetRoot,
    'telemetry/events.jsonl',
    '{"type":"ingest","recordedAt":"2026-04-19T00:00:00.000Z"}\n',
    new Date('2026-04-19T00:00:00.000Z'),
  )
  await writeFixture(
    harness.sourceRoot,
    'agents/sessions/session-beta/transcript.v1.jsonl',
    '{"type":"message","text":"legacy beta"}\n',
    new Date('2026-04-18T01:00:00.000Z'),
  )
  await writeFixture(
    harness.sourceRoot,
    'policies/policies.json',
    '{"version":"legacy"}\n',
    new Date('2026-04-18T02:00:00.000Z'),
  )
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('migrateLegacyData', () => {
  it('concatenates legacy telemetry events into the canonical target file and discards regenerable cache files', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    const targetLine = JSON.stringify({ type: 'ingest', recordedAt: '2026-04-20T00:00:00.000Z' })
    const sourceLine = JSON.stringify({ type: 'otel_log', recordedAt: '2026-04-19T00:00:00.000Z' })

    await writeFixture(targetRoot, 'telemetry/events.jsonl', `${targetLine}\n`)
    await writeFixture(sourceRoot, 'telemetry/events.jsonl', `${sourceLine}\n`)
    await writeFixture(sourceRoot, 'telemetry/cost-summary-cache.json', '{"updatedAt":1}\n')

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'telemetry/events.jsonl')).toBe(`${targetLine}\n${sourceLine}\n`)
    expect(await pathExists(targetRoot, 'telemetry/cost-summary-cache.json')).toBe(false)
    expect(summary.categories.telemetry.migratedFiles).toBe(1)
    expect(summary.categories.telemetry.discardedFiles).toBe(1)
  })

  it('keeps the newer telemetry scan-state file that already exists in the target tree', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'telemetry/scan-state.json',
      '{"cursor":"legacy"}\n',
      new Date('2026-04-20T00:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'telemetry/scan-state.json',
      '{"cursor":"canonical"}\n',
      new Date('2026-04-21T00:00:00.000Z'),
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'telemetry/scan-state.json')).toBe('{"cursor":"canonical"}\n')
    expect(summary.categories.telemetry.skippedFiles).toBe(1)
  })

  it('keeps newer stream session registries in the target tree', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'agents/stream-sessions.json',
      '{"sessions":[{"id":"legacy"}]}\n',
      new Date('2026-04-20T00:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'agents/stream-sessions.json',
      '{"sessions":[{"id":"canonical"}]}\n',
      new Date('2026-04-21T00:00:00.000Z'),
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'agents/stream-sessions.json')).toBe('{"sessions":[{"id":"canonical"}]}\n')
    expect(summary.categories.agents.skippedFiles).toBe(1)
  })

  it('archives legacy agent session directories instead of trying to remap transcript schemas', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'agents/sessions/session-alpha/transcript.v1.jsonl',
      '{"type":"message","text":"legacy transcript"}\n',
    )
    await writeFixture(
      sourceRoot,
      'agents/sessions/session-alpha/meta.json',
      '{"createdAt":"2026-04-20T00:00:00.000Z"}\n',
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(
      targetRoot,
      `.migration-archive/${FIXED_ARCHIVE_DATE}/agents/sessions/session-alpha/transcript.v1.jsonl`,
    )).toBe('{"type":"message","text":"legacy transcript"}\n')
    expect(await readText(
      targetRoot,
      `.migration-archive/${FIXED_ARCHIVE_DATE}/agents/sessions/session-alpha/meta.json`,
    )).toBe('{"createdAt":"2026-04-20T00:00:00.000Z"}\n')
    expect(summary.categories.agents.archivedFiles).toBe(2)
  })

  it('migrates unique commander directories while keeping canonical duplicates', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    const duplicateCommanderId = '11111111-2222-3333-4444-555555555555'
    const uniqueCommanderId = 'wizard-48067de20c364eefb1a6f707703b0045'

    await writeFixture(
      sourceRoot,
      `commanders/${duplicateCommanderId}/profile.json`,
      '{"name":"legacy"}\n',
      new Date('2026-04-20T00:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      `commander/${duplicateCommanderId}/profile.json`,
      '{"name":"canonical"}\n',
      new Date('2026-04-21T00:00:00.000Z'),
    )
    await writeFixture(
      sourceRoot,
      `commanders/${uniqueCommanderId}/wizard.json`,
      '{"name":"legacy-wizard"}\n',
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, `commander/${duplicateCommanderId}/profile.json`)).toBe('{"name":"canonical"}\n')
    expect(await readText(targetRoot, `commander/${uniqueCommanderId}/wizard.json`)).toBe('{"name":"legacy-wizard"}\n')
    expect(summary.categories.commanders.migratedFiles).toBe(1)
    expect(summary.categories.commanders.skippedFiles).toBe(1)
  })

  it('migrates command-room files into automation when the canonical target is stale', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'command-room/runs.json',
      '{"runs":[{"id":"source-run"}]}\n',
      new Date('2026-04-21T01:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'automation/runs.json',
      '{"runs":[{"id":"target-run"}]}\n',
      new Date('2026-04-20T01:00:00.000Z'),
    )
    await writeFixture(
      sourceRoot,
      'command-room/tasks.json',
      '{"tasks":[{"id":"task-1"}]}\n',
      new Date('2026-04-21T01:00:00.000Z'),
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'automation/runs.json')).toBe('{"runs":[{"id":"source-run"}]}\n')
    expect(await readText(targetRoot, 'automation/tasks.json')).toBe('{"tasks":[{"id":"task-1"}]}\n')
    expect(summary.categories.commandRoom.migratedFiles).toBe(2)
    expect(summary.categories.commandRoom.conflictsResolved).toBe(1)
  })

  it('migrates API key artifacts with newer-target and missing-target policies applied per file', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'api-keys/keys.json',
      '{"keys":[{"id":"legacy-key"}]}\n',
      new Date('2026-04-20T00:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'api-keys/keys.json',
      '{"keys":[{"id":"canonical-key"}]}\n',
      new Date('2026-04-21T00:00:00.000Z'),
    )
    await writeFixture(sourceRoot, 'api-keys/transcription-secrets.json', '{"secrets":{"legacy":true}}\n')
    await writeFixture(sourceRoot, 'api-keys/transcription-secrets.key', 'legacy-key-material\n')
    await writeFixture(sourceRoot, 'api-keys/pmai-dev.pem', '-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----\n')

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'api-keys/keys.json')).toBe('{"keys":[{"id":"canonical-key"}]}\n')
    expect(await readText(targetRoot, 'api-keys/transcription-secrets.json')).toBe('{"secrets":{"legacy":true}}\n')
    expect(await readText(targetRoot, 'api-keys/transcription-secrets.key')).toBe('legacy-key-material\n')
    expect(await readText(targetRoot, 'api-keys/pmai-dev.pem')).toBe('-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----\n')
    expect(summary.categories.apiKeys.migratedFiles).toBe(3)
    expect(summary.categories.apiKeys.skippedFiles).toBe(1)
  })

  it('resolves policy file conflicts by keeping the newer file on each side independently', async () => {
    const { sourceRoot, targetRoot } = await createHarness()
    await writeFixture(
      sourceRoot,
      'policies/policies.json',
      '{"version":"legacy"}\n',
      new Date('2026-04-21T02:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'policies/policies.json',
      '{"version":"canonical"}\n',
      new Date('2026-04-20T02:00:00.000Z'),
    )
    await writeFixture(
      sourceRoot,
      'policies/pending.json',
      '{"pending":["legacy"]}\n',
      new Date('2026-04-20T03:00:00.000Z'),
    )
    await writeFixture(
      targetRoot,
      'policies/pending.json',
      '{"pending":["canonical"]}\n',
      new Date('2026-04-21T03:00:00.000Z'),
    )

    const summary = await migrateLegacyData({
      sourceRoot,
      targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(targetRoot, 'policies/policies.json')).toBe('{"version":"legacy"}\n')
    expect(await readText(targetRoot, 'policies/pending.json')).toBe('{"pending":["canonical"]}\n')
    expect(summary.categories.policies.migratedFiles).toBe(1)
    expect(summary.categories.policies.skippedFiles).toBe(1)
  })

  it('is idempotent when run twice against the same unchanged source and target trees', async () => {
    const harness = await createHarness()
    await seedIntegrationFixture(harness)

    await migrateLegacyData({
      sourceRoot: harness.sourceRoot,
      targetRoot: harness.targetRoot,
      now: () => FIXED_NOW,
    })

    const firstPassEvents = await readText(harness.targetRoot, 'telemetry/events.jsonl')
    const secondSummary = await migrateLegacyData({
      sourceRoot: harness.sourceRoot,
      targetRoot: harness.targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await readText(harness.targetRoot, 'telemetry/events.jsonl')).toBe(firstPassEvents)
    expect(secondSummary.totals.migratedFiles).toBe(0)
    expect(secondSummary.totals.migratedBytes).toBe(0)
    expect(secondSummary.totals.archivedFiles).toBe(0)
    expect(secondSummary.totals.archivedBytes).toBe(0)
  })

  it('reports the same work in dry-run mode without mutating either tree', async () => {
    const dryRunHarness = await createHarness()
    const realRunHarness = await createHarness()
    await seedIntegrationFixture(dryRunHarness)
    await seedIntegrationFixture(realRunHarness)

    const sourceBefore = await snapshotTree(dryRunHarness.sourceRoot)
    const targetBefore = await snapshotTree(dryRunHarness.targetRoot)

    const dryRunSummary = await migrateLegacyData({
      sourceRoot: dryRunHarness.sourceRoot,
      targetRoot: dryRunHarness.targetRoot,
      dryRun: true,
      now: () => FIXED_NOW,
    })
    const realRunSummary = await migrateLegacyData({
      sourceRoot: realRunHarness.sourceRoot,
      targetRoot: realRunHarness.targetRoot,
      now: () => FIXED_NOW,
    })

    expect(await snapshotTree(dryRunHarness.sourceRoot)).toEqual(sourceBefore)
    expect(await snapshotTree(dryRunHarness.targetRoot)).toEqual(targetBefore)
    expect(dryRunSummary.dryRun).toBe(true)
    expect(realRunSummary.dryRun).toBe(false)
    expect(dryRunSummary.totals).toEqual(realRunSummary.totals)
    expect(dryRunSummary.categories).toEqual(realRunSummary.categories)
    expect(JSON.parse(JSON.stringify(dryRunSummary))).toEqual(dryRunSummary)
  })
})
