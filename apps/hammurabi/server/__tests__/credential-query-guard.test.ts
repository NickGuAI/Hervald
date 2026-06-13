import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoots = ['src', 'server', 'modules']
const sourceExtensions = new Set(['.ts', '.tsx'])
const skippedDirectories = new Set([
  '__tests__',
  'dist',
  'dist-server',
  'node_modules',
])

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) {
        return []
      }
      return collectSourceFiles(fullPath)
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
      return []
    }
    return [fullPath]
  }))
  return nested.flat()
}

describe('credential query guard', () => {
  it('does not accept or construct long-lived route credentials in query strings', async () => {
    const files = (
      await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.join(appRoot, root))))
    ).flat()
    const forbiddenPatterns = [
      /\.searchParams\.get\(\s*['"]api_key['"]\s*\)/u,
      /\.searchParams\.get\(\s*['"]access_token['"]\s*\)/u,
      /\.set\(\s*['"]api_key['"]\s*,/u,
      /\.set\(\s*['"]access_token['"]\s*,/u,
      /[?&]api_key=/u,
      /[?&]access_token=/u,
    ]
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(appRoot, file)} matched ${pattern}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
