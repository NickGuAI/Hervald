import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Drift guard for issue #1561 (iOS app connects to user-selected instance).
 *
 * The native app must route every request through `getApiBase()` / `getWsBase()`
 * so a user can point the iOS bundle at any Hervald/Hammurabi instance. If a
 * future change reintroduces a hardcoded backend URL anywhere in the client
 * tree, this test fails before the regression ships.
 *
 * The only places these URLs are allowed to appear are:
 *   - `src/lib/api-base.ts` (the default-suggestion constant)
 *   - `src/components/ApiKeyLandingPage.tsx` (the Connect screen placeholder)
 *
 * Test files are excluded because they may use these hosts as test fixtures.
 */
const APP_ROOT = join(__dirname, '..', '..', '..')
const IOS_INFO_PLIST = join(APP_ROOT, 'ios', 'App', 'App', 'Info.plist')
const FORBIDDEN_HOSTS = [/hervald\.gehirn\.ai/, /hammurabi\.gehirn\.ai/]
const ALLOWED_RELATIVE_PATHS = new Set<string>([
  'src/lib/api-base.ts',
  'src/components/ApiKeyLandingPage.tsx',
])

function walkSourceFiles(rootDir: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(rootDir)) {
    const fullPath = join(rootDir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') {
        continue
      }
      walkSourceFiles(fullPath, collected)
      continue
    }
    if (!/\.(tsx?|jsx?)$/.test(entry)) continue
    if (/\.test\.(tsx?|jsx?)$/.test(entry)) continue
    collected.push(fullPath)
  }
  return collected
}

describe('instance URL drift detection', () => {
  it('client production source contains no hardcoded backend hosts', () => {
    const files = walkSourceFiles(join(APP_ROOT, 'src'))
    const offenders: string[] = []

    for (const file of files) {
      const relativePath = relative(APP_ROOT, file).replace(/\\/g, '/')
      if (ALLOWED_RELATIVE_PATHS.has(relativePath)) continue

      const contents = readFileSync(file, 'utf8')
      if (FORBIDDEN_HOSTS.some((pattern) => pattern.test(contents))) {
        offenders.push(relativePath)
      }
    }

    expect(offenders).toEqual([])
  })

  it.skipIf(!existsSync(IOS_INFO_PLIST))('iOS app declares camera permission for mobile pairing QR scanning', () => {
    const plist = readFileSync(IOS_INFO_PLIST, 'utf8')

    expect(plist).toContain('<key>NSCameraUsageDescription</key>')
    expect(plist).toContain('scan mobile pairing QR codes')
  })
})
