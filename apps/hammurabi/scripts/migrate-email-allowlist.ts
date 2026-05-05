#!/usr/bin/env tsx
import path from 'node:path'
import process from 'node:process'
import { migrateLegacyEmailAllowlist } from '../modules/policies/legacy-email-allowlist-migration.js'

function expandHome(value: string): string {
  if (!value.startsWith('~/')) {
    return value
  }
  const homeDir = process.env.HOME?.trim()
  return homeDir ? path.join(homeDir, value.slice(2)) : value
}

function parseArg(flag: string): string | undefined {
  const flagPrefix = `${flag}=`
  const inline = process.argv.find((arg) => arg.startsWith(flagPrefix))
  if (inline) {
    return inline.slice(flagPrefix.length)
  }

  const flagIndex = process.argv.indexOf(flag)
  if (flagIndex === -1) {
    return undefined
  }

  return process.argv[flagIndex + 1]
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, '../../..')
  const sourceFilePath = path.resolve(
    expandHome(parseArg('--source') ?? '~/.config/gehirn/guards/data/email-allowlist.json'),
  )
  const targetPolicyFilePath = path.resolve(
    expandHome(parseArg('--target') ?? path.join(import.meta.dirname, '../data/policies/policies.json')),
  )

  const result = await migrateLegacyEmailAllowlist({
    sourceFilePath,
    targetPolicyFilePath,
    repoRoot: path.resolve(expandHome(parseArg('--repo-root') ?? repoRoot)),
    addedBy: parseArg('--added-by') ?? 'email-allowlist-migration',
  })

  process.stdout.write(`Source: ${result.sourceFilePath}\n`)
  process.stdout.write(`Target: ${result.targetPolicyFilePath}\n`)
  process.stdout.write(`Kept (${result.kept.length}): ${result.kept.map((entry) => entry.email).join(', ') || 'none'}\n`)
  process.stdout.write(`Purged (${result.purged.length}): ${result.purged.map((entry) => entry.email).join(', ') || 'none'}\n`)

  if (result.unresolved.length > 0) {
    process.stderr.write(`Unresolved (${result.unresolved.length}): ${result.unresolved.join(', ')}\n`)
    process.exit(1)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
