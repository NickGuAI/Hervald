/**
 * Remove commander display-name rows whose IDs are no longer present in
 * sessions.json.
 *
 * Usage:
 *   pnpm exec tsx apps/hammurabi/scripts/prune-orphan-commander-names.ts
 *   pnpm exec tsx apps/hammurabi/scripts/prune-orphan-commander-names.ts --data-dir /path/to/commander
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  pruneOrphanCommanderNames,
  type PruneOrphanCommanderNamesResult,
} from '../modules/commanders/names-lock.js'
import { resolveCommanderDataDir } from '../modules/commanders/paths.js'

interface CliOptions {
  dataDir: string
  help: boolean
}

function parseCliArgs(args: string[]): CliOptions {
  let dataDir = resolveCommanderDataDir(process.env)
  let help = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help') {
      help = true
      continue
    }

    if (arg === '--data-dir') {
      const rawPath = args[index + 1]
      if (!rawPath) {
        throw new Error('--data-dir requires a path value')
      }
      dataDir = path.resolve(rawPath)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    dataDir,
    help,
  }
}

function renderHelp(): string {
  return [
    'Usage: pnpm exec tsx apps/hammurabi/scripts/prune-orphan-commander-names.ts [options]',
    '',
    'Options:',
    '  --data-dir <path>  Override the commander data directory to clean.',
    '  --help             Show this help text.',
  ].join('\n')
}

function isMainModule(): boolean {
  const entryPath = process.argv[1]
  if (!entryPath) {
    return false
  }

  return pathToFileURL(path.resolve(entryPath)).href === import.meta.url
}

export async function pruneOrphanCommanderNamesScript(
  dataDir: string,
): Promise<PruneOrphanCommanderNamesResult> {
  return pruneOrphanCommanderNames(dataDir)
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args)
  if (parsed.help) {
    process.stdout.write(`${renderHelp()}\n`)
    return
  }

  const result = await pruneOrphanCommanderNamesScript(parsed.dataDir)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
