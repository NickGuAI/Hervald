import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const agentsRoot = path.join(repoRoot, 'modules', 'agents')

const allowedFiles = new Set([
  path.join(agentsRoot, 'legacy-session-source-migration.ts'),
])

const bannedPrefixAlternation = String.raw`(?:command-room-|commander-|worker-|automation-|sentinel-)`
const bannedPatterns = [
  {
    kind: 'startsWith literal session-name prefix',
    pattern: new RegExp(String.raw`\.startsWith\(\s*['"]${bannedPrefixAlternation}`),
  },
  {
    kind: 'startsWith COMMANDER_SESSION_NAME_PREFIX',
    pattern: /\.startsWith\(\s*COMMANDER_SESSION_NAME_PREFIX\b/,
  },
  {
    kind: 'anchored regex session-name prefix',
    pattern: new RegExp(String.raw`\/\^${bannedPrefixAlternation}`),
  },
]

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath)
}

function shouldScan(filePath: string): boolean {
  if (!filePath.endsWith('.ts')) {
    return false
  }
  if (filePath.includes(`${path.sep}__tests__${path.sep}`) || filePath.endsWith('.test.ts')) {
    return false
  }
  return !allowedFiles.has(filePath)
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(entryPath))
      continue
    }
    if (entry.isFile() && shouldScan(entryPath)) {
      files.push(entryPath)
    }
  }
  return files
}

const failures: string[] = []

for (const filePath of await walk(agentsRoot)) {
  const source = await readFile(filePath, 'utf8')
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const { kind, pattern } of bannedPatterns) {
      if (!pattern.test(line)) {
        continue
      }
      failures.push(`${relative(filePath)}:${index + 1}: ${kind}: ${line.trim()}`)
    }
  }
}

if (failures.length > 0) {
  console.error(
    [
      'Agent runtime must not classify sessions by name prefix.',
      'Use persisted creator/sessionType/source fields instead. Only legacy-session-source-migration.ts may backfill old records from prefixes.',
      '',
      ...failures,
    ].join('\n'),
  )
  process.exitCode = 1
}
