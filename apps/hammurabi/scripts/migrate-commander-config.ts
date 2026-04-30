#!/usr/bin/env tsx
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { migrateLegacyCommanderConfig } from '../modules/commanders/config-migration.js'
import {
  resolveCommanderDataDir,
  resolveCommanderSessionStorePath,
} from '../modules/commanders/paths.js'
import { CommanderSessionStore } from '../modules/commanders/store.js'

export interface ParsedCommanderConfigMigrationCliArgs {
  dataDir: string
  dryRun: boolean
  help: boolean
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

export function parseCommanderConfigMigrationCliArgs(
  args: string[] = process.argv.slice(2),
): ParsedCommanderConfigMigrationCliArgs {
  const dataDir = parseArgValue(args, '--data-dir') ?? resolveCommanderDataDir()
  return {
    dataDir: path.resolve(dataDir),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
  }
}

export async function migrateCommanderConfig(options: {
  dataDir?: string
  dryRun?: boolean
} = {}) {
  const dataDir = path.resolve(options.dataDir ?? resolveCommanderDataDir())
  const sessionStore = new CommanderSessionStore(resolveCommanderSessionStorePath(dataDir))
  return migrateLegacyCommanderConfig(sessionStore, {
    commanderBasePath: dataDir,
    dryRun: options.dryRun,
  })
}

function printHelp(): void {
  console.log([
    'Usage: tsx apps/hammurabi/scripts/migrate-commander-config.ts [options]',
    '',
    'Options:',
    '  --data-dir <path>  Commander data directory (defaults to resolveCommanderDataDir())',
    '  --dry-run          Report planned changes without rewriting sessions.json or COMMANDER.md',
    '  -h, --help         Show this help text',
  ].join('\n'))
}

async function main(): Promise<void> {
  const args = parseCommanderConfigMigrationCliArgs()
  if (args.help) {
    printHelp()
    return
  }

  const summary = await migrateCommanderConfig({
    dataDir: args.dataDir,
    dryRun: args.dryRun,
  })
  console.log(JSON.stringify(summary, null, 2))
}

const entryPoint = process.argv[1]
if (entryPoint) {
  const entryHref = pathToFileURL(path.resolve(entryPoint)).href
  if (import.meta.url === entryHref) {
    void main().catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
