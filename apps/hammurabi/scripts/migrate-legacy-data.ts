#!/usr/bin/env tsx
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { resolveHammurabiDataDir } from '../modules/data-dir.js'

export type MigrationCategoryKey =
  | 'telemetry'
  | 'agents'
  | 'commanders'
  | 'commandRoom'
  | 'apiKeys'
  | 'policies'

export interface MigrationCategorySummary {
  migratedFiles: number
  migratedBytes: number
  archivedFiles: number
  archivedBytes: number
  skippedFiles: number
  skippedBytes: number
  discardedFiles: number
  discardedBytes: number
  conflictsResolved: number
}

export interface MigrationSummary {
  dryRun: boolean
  sourceRoot: string
  targetRoot: string
  archiveDate: string
  totals: MigrationCategorySummary
  categories: Record<MigrationCategoryKey, MigrationCategorySummary>
}

export interface MigrateLegacyDataOptions {
  sourceRoot?: string
  targetRoot?: string
  dryRun?: boolean
  now?: () => Date
}

export interface ParsedMigrationCliArgs extends MigrateLegacyDataOptions {
  help: boolean
  report: boolean
}

interface AppendedSourceRecord {
  size: number
  mtimeMs: number
  targetRelativePath: string
}

interface MigrationManifest {
  version: 1
  appendedJsonl: Record<string, AppendedSourceRecord>
}

interface MigrationContext {
  dryRun: boolean
  sourceRoot: string
  targetRoot: string
  archiveDate: string
  summary: MigrationSummary
  manifest: MigrationManifest
  manifestDirty: boolean
}

interface CopyByMtimeOptions {
  category: MigrationCategoryKey
  sourceRelativePath: string
  targetRelativePath?: string
  outcomeKind?: 'migrated' | 'archived'
}

function emptyCategorySummary(): MigrationCategorySummary {
  return {
    migratedFiles: 0,
    migratedBytes: 0,
    archivedFiles: 0,
    archivedBytes: 0,
    skippedFiles: 0,
    skippedBytes: 0,
    discardedFiles: 0,
    discardedBytes: 0,
    conflictsResolved: 0,
  }
}

function emptySummary(
  options: Required<Pick<MigrateLegacyDataOptions, 'sourceRoot' | 'targetRoot' | 'dryRun'>>,
  now: Date,
): MigrationSummary {
  return {
    dryRun: options.dryRun,
    sourceRoot: options.sourceRoot,
    targetRoot: options.targetRoot,
    archiveDate: now.toISOString().slice(0, 10),
    totals: emptyCategorySummary(),
    categories: {
      telemetry: emptyCategorySummary(),
      agents: emptyCategorySummary(),
      commanders: emptyCategorySummary(),
      commandRoom: emptyCategorySummary(),
      apiKeys: emptyCategorySummary(),
      policies: emptyCategorySummary(),
    },
  }
}

function expandHome(value: string): string {
  if (!value.startsWith('~/')) {
    return value
  }

  const homeDir = process.env.HOME?.trim()
  return homeDir ? path.join(homeDir, value.slice(2)) : value
}

function manifestPathFor(targetRoot: string): string {
  return path.join(targetRoot, '.migration-manifest', 'legacy-data.json')
}

function parseArgValue(args: string[], flag: string): string | undefined {
  const inlinePrefix = `${flag}=`
  const inline = args.find((arg) => arg.startsWith(inlinePrefix))
  if (inline) {
    return inline.slice(inlinePrefix.length)
  }

  const index = args.indexOf(flag)
  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}

export function parseMigrationCliArgs(args: string[] = process.argv.slice(2)): ParsedMigrationCliArgs {
  const defaultSourceRoot = path.resolve(import.meta.dirname, '../data')
  return {
    sourceRoot: path.resolve(expandHome(parseArgValue(args, '--source') ?? defaultSourceRoot)),
    targetRoot: path.resolve(expandHome(parseArgValue(args, '--target') ?? resolveHammurabiDataDir())),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
    report: true,
  }
}

function addSummary(
  summary: MigrationSummary,
  category: MigrationCategoryKey,
  delta: Partial<MigrationCategorySummary>,
): void {
  const categorySummary = summary.categories[category]
  const totalSummary = summary.totals

  for (const [key, value] of Object.entries(delta) as Array<[keyof MigrationCategorySummary, number | undefined]>) {
    if (!value) {
      continue
    }
    categorySummary[key] += value
    totalSummary[key] += value
  }
}

async function statOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function readManifest(targetRoot: string): Promise<MigrationManifest> {
  const filePath = manifestPathFor(targetRoot)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MigrationManifest> | null
    if (parsed?.version === 1 && parsed.appendedJsonl && typeof parsed.appendedJsonl === 'object') {
      return {
        version: 1,
        appendedJsonl: Object.fromEntries(
          Object.entries(parsed.appendedJsonl).filter((entry): entry is [string, AppendedSourceRecord] => {
            const value = entry[1]
            return Boolean(
              value
              && typeof value.size === 'number'
              && Number.isFinite(value.size)
              && typeof value.mtimeMs === 'number'
              && Number.isFinite(value.mtimeMs)
              && typeof value.targetRelativePath === 'string'
              && value.targetRelativePath.length > 0,
            )
          }),
        ),
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return {
    version: 1,
    appendedJsonl: {},
  }
}

async function writeManifest(targetRoot: string, manifest: MigrationManifest): Promise<void> {
  const filePath = manifestPathFor(targetRoot)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function transferWithMtimePolicy(
  context: MigrationContext,
  options: CopyByMtimeOptions,
): Promise<void> {
  const sourcePath = path.join(context.sourceRoot, options.sourceRelativePath)
  const targetRelativePath = options.targetRelativePath ?? options.sourceRelativePath
  const targetPath = path.join(context.targetRoot, targetRelativePath)
  const migratedKey = options.outcomeKind === 'archived' ? 'archivedFiles' : 'migratedFiles'
  const migratedBytesKey = options.outcomeKind === 'archived' ? 'archivedBytes' : 'migratedBytes'

  const sourceStat = await statOrNull(sourcePath)
  if (!sourceStat?.isFile()) {
    return
  }

  const targetStat = await statOrNull(targetPath)
  if (!targetStat) {
    if (!context.dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
    }
    addSummary(context.summary, options.category, {
      [migratedKey]: 1,
      [migratedBytesKey]: sourceStat.size,
    })
    return
  }

  if (targetStat.mtimeMs >= sourceStat.mtimeMs) {
    addSummary(context.summary, options.category, {
      skippedFiles: 1,
      skippedBytes: sourceStat.size,
      conflictsResolved: 1,
    })
    return
  }

  if (!context.dryRun) {
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }
  addSummary(context.summary, options.category, {
    [migratedKey]: 1,
    [migratedBytesKey]: sourceStat.size,
    conflictsResolved: 1,
  })
}

async function copyWithMtimePolicy(
  context: MigrationContext,
  options: CopyByMtimeOptions,
): Promise<void> {
  await transferWithMtimePolicy(context, {
    ...options,
    outcomeKind: options.outcomeKind ?? 'migrated',
  })
}

async function lastByteIsNewline(filePath: string, fileStat: Stats): Promise<boolean> {
  if (fileStat.size === 0) {
    return false
  }

  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(1)
    await handle.read(buffer, 0, 1, fileStat.size - 1)
    return buffer[0] === 0x0a
  } finally {
    await handle.close()
  }
}

async function appendJsonlFile(sourcePath: string, targetPath: string): Promise<number> {
  const sourceStat = await stat(sourcePath)
  const targetStat = await statOrNull(targetPath)
  const targetExists = Boolean(targetStat?.isFile())
  const shouldInsertNewline = Boolean(
    targetExists
    && targetStat
    && targetStat.size > 0
    && sourceStat.size > 0
    && !await lastByteIsNewline(targetPath, targetStat),
  )

  await mkdir(path.dirname(targetPath), { recursive: true })

  if (shouldInsertNewline) {
    const writeHandle = await open(targetPath, 'a')
    try {
      await writeHandle.writeFile('\n')
    } finally {
      await writeHandle.close()
    }
  }

  await pipeline(
    createReadStream(sourcePath),
    createWriteStream(targetPath, { flags: targetExists ? 'a' : 'w' }),
  )

  return sourceStat.size + (shouldInsertNewline ? 1 : 0)
}

async function appendTelemetryEvents(context: MigrationContext): Promise<void> {
  const sourceRelativePath = path.join('telemetry', 'events.jsonl')
  const sourcePath = path.join(context.sourceRoot, sourceRelativePath)
  const targetPath = path.join(context.targetRoot, sourceRelativePath)
  const sourceStat = await statOrNull(sourcePath)
  if (!sourceStat?.isFile()) {
    return
  }

  const appendedRecord = context.manifest.appendedJsonl[sourceRelativePath]
  const alreadyAppended = Boolean(
    appendedRecord
    && appendedRecord.size === sourceStat.size
    && appendedRecord.mtimeMs === sourceStat.mtimeMs
    && appendedRecord.targetRelativePath === sourceRelativePath
    && await statOrNull(targetPath),
  )

  if (alreadyAppended) {
    addSummary(context.summary, 'telemetry', {
      skippedFiles: 1,
      skippedBytes: sourceStat.size,
    })
    return
  }

  const migratedBytes = context.dryRun ? sourceStat.size : await appendJsonlFile(sourcePath, targetPath)
  addSummary(context.summary, 'telemetry', {
    migratedFiles: 1,
    migratedBytes,
  })

  if (!context.dryRun) {
    context.manifest.appendedJsonl[sourceRelativePath] = {
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      targetRelativePath: sourceRelativePath,
    }
    context.manifestDirty = true
  }
}

async function discardRegenerableTelemetryCache(context: MigrationContext): Promise<void> {
  const sourcePath = path.join(context.sourceRoot, 'telemetry', 'cost-summary-cache.json')
  const sourceStat = await statOrNull(sourcePath)
  if (!sourceStat?.isFile()) {
    return
  }

  addSummary(context.summary, 'telemetry', {
    discardedFiles: 1,
    discardedBytes: sourceStat.size,
  })
}

async function migrateTelemetry(context: MigrationContext): Promise<void> {
  await appendTelemetryEvents(context)
  await copyWithMtimePolicy(context, {
    category: 'telemetry',
    sourceRelativePath: path.join('telemetry', 'scan-state.json'),
  })
  await discardRegenerableTelemetryCache(context)
}

async function collectRelativeFiles(
  rootDir: string,
  relativeDir = '',
): Promise<string[]> {
  const directoryPath = path.join(rootDir, relativeDir)
  const directoryStat = await statOrNull(directoryPath)
  if (!directoryStat?.isDirectory()) {
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

async function archiveLegacyAgentSessions(context: MigrationContext): Promise<void> {
  const sessionFiles = await collectRelativeFiles(context.sourceRoot, path.join('agents', 'sessions'))
  for (const sessionFile of sessionFiles) {
    await transferWithMtimePolicy(context, {
      category: 'agents',
      outcomeKind: 'archived',
      sourceRelativePath: sessionFile,
      targetRelativePath: path.join(
        '.migration-archive',
        context.archiveDate,
        sessionFile,
      ),
    })
  }
}

async function migrateAgents(context: MigrationContext): Promise<void> {
  await copyWithMtimePolicy(context, {
    category: 'agents',
    sourceRelativePath: path.join('agents', 'stream-sessions.json'),
  })
  await archiveLegacyAgentSessions(context)
}

async function migrateCommanders(context: MigrationContext): Promise<void> {
  const commanderFiles = await collectRelativeFiles(context.sourceRoot, 'commanders')
  for (const relativePath of commanderFiles) {
    const targetRelativePath = path.join(
      'commander',
      path.relative('commanders', relativePath),
    )
    await copyWithMtimePolicy(context, {
      category: 'commanders',
      sourceRelativePath: relativePath,
      targetRelativePath,
    })
  }
}

async function migrateCommandRoom(context: MigrationContext): Promise<void> {
  await copyWithMtimePolicy(context, {
    category: 'commandRoom',
    sourceRelativePath: path.join('command-room', 'runs.json'),
    targetRelativePath: path.join('automation', 'runs.json'),
  })
  await copyWithMtimePolicy(context, {
    category: 'commandRoom',
    sourceRelativePath: path.join('command-room', 'tasks.json'),
    targetRelativePath: path.join('automation', 'tasks.json'),
  })
}

async function migrateApiKeys(context: MigrationContext): Promise<void> {
  await copyWithMtimePolicy(context, {
    category: 'apiKeys',
    sourceRelativePath: path.join('api-keys', 'keys.json'),
  })
  await copyWithMtimePolicy(context, {
    category: 'apiKeys',
    sourceRelativePath: path.join('api-keys', 'transcription-secrets.json'),
  })
  await copyWithMtimePolicy(context, {
    category: 'apiKeys',
    sourceRelativePath: path.join('api-keys', 'transcription-secrets.key'),
  })

  const apiKeyFiles = await collectRelativeFiles(context.sourceRoot, 'api-keys')
  for (const relativePath of apiKeyFiles) {
    if (!relativePath.endsWith('.pem')) {
      continue
    }
    await copyWithMtimePolicy(context, {
      category: 'apiKeys',
      sourceRelativePath: relativePath,
    })
  }
}

async function migratePolicies(context: MigrationContext): Promise<void> {
  await copyWithMtimePolicy(context, {
    category: 'policies',
    sourceRelativePath: path.join('policies', 'policies.json'),
  })
  await copyWithMtimePolicy(context, {
    category: 'policies',
    sourceRelativePath: path.join('policies', 'pending.json'),
  })
}

export async function migrateLegacyData(options: MigrateLegacyDataOptions = {}): Promise<MigrationSummary> {
  const now = options.now?.() ?? new Date()
  const sourceRoot = path.resolve(options.sourceRoot ?? path.resolve(import.meta.dirname, '../data'))
  const targetRoot = path.resolve(options.targetRoot ?? resolveHammurabiDataDir())
  const summary = emptySummary(
    {
      sourceRoot,
      targetRoot,
      dryRun: options.dryRun ?? false,
    },
    now,
  )
  const context: MigrationContext = {
    dryRun: summary.dryRun,
    sourceRoot,
    targetRoot,
    archiveDate: summary.archiveDate,
    summary,
    manifest: await readManifest(targetRoot),
    manifestDirty: false,
  }

  await migrateTelemetry(context)
  await migrateAgents(context)
  await migrateCommanders(context)
  await migrateCommandRoom(context)
  await migrateApiKeys(context)
  await migratePolicies(context)

  if (!context.dryRun && context.manifestDirty) {
    await writeManifest(targetRoot, context.manifest)
  }

  return summary
}

function renderHelp(): string {
  return [
    'Usage: tsx apps/hammurabi/scripts/migrate-legacy-data.ts [options]',
    '',
    'Options:',
    '  --source <path>  Override the legacy data source root.',
    '  --target <path>  Override the target Hammurabi data root.',
    '  --dry-run        Report planned actions without changing disk.',
    '  --report         Print the JSON migration summary (default).',
    '  --help           Show this help text.',
  ].join('\n')
}

function isMainModule(): boolean {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }

  return pathToFileURL(path.resolve(entryPath)).href === import.meta.url
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseMigrationCliArgs(args)
  if (parsed.help) {
    process.stdout.write(`${renderHelp()}\n`)
    return
  }

  const summary = await migrateLegacyData(parsed)
  if (parsed.report) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
