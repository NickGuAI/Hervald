/**
 * Surface architecture invariants.
 *
 * `src/surfaces/**` owns viewport chrome only. Feature pages, feature
 * controllers, and backend access belong to `modules/**`.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.resolve(__dirname, '..', '..', '..')
const SURFACES_ROOT = path.resolve(APP_ROOT, 'src', 'surfaces')
const MODULES_ROOT = path.resolve(APP_ROOT, 'modules')
const ALLOWED_SURFACE_ROOTS = new Set(['desktop', 'mobile'])
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[tj]sx?$/
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const FEATURE_SURFACE_FILE_PATTERNS = [
  /(?:^|\/)[A-Za-z0-9-]*Page\.[tj]sx?$/,
  /(?:^|\/)[A-Za-z0-9-]*CommandRoom[A-Za-z0-9-]*\.[tj]sx?$/,
  /(?:^|\/)Mobile(?:ApprovalSheet|Automations|ChatView|CommanderSwitcherSheet|Inbox|OrgPage|SessionsList|Settings|TeamSheet|WorkspaceSheet)\.[tj]sx?$/,
  /(?:^|\/)(?:ConfirmDelete|EditCommander|NewAutomationWizard|ReplicateCommander|RunNow)\.[tj]sx?$/,
  /(?:^|\/)orderMobileConversations\.ts$/,
]
const DIRECT_BACKEND_PATTERNS = [
  { label: 'fetch', pattern: /\b(?:globalThis\.|window\.)?fetch\s*\(/ },
  { label: 'axios', pattern: /\b(?:import\s+axios\b|from\s+['"]axios['"]|axios\s*(?:\.|\())/ },
  { label: 'hardcoded /api/', pattern: /['"`][^'"`]*\/api\// },
]
const SURFACE_IMPORT_PATTERN =
  /\b(?:from\s+|import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?|import\s*\(|require\s*\(|vi\.mock\s*\()\s*['"][^'"]*(?:@\/surfaces(?:\/|['"])|src\/surfaces\/)/

function toRepoPath(filePath: string): string {
  return path.relative(APP_ROOT, filePath).split(path.sep).join('/')
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function isTestFile(filePath: string): boolean {
  return filePath.split(path.sep).includes('__tests__') || TEST_FILE_PATTERN.test(filePath)
}

function walkFiles(root: string, options: { skipTests?: boolean } = {}): string[] {
  if (!existsSync(root)) {
    return []
  }

  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (options.skipTests && entry.name === '__tests__') {
        continue
      }
      files.push(...walkFiles(entryPath, options))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function productionSurfaceFiles(): string[] {
  return walkFiles(SURFACES_ROOT, { skipTests: true })
    .filter((filePath) => isSourceFile(filePath) && !isTestFile(filePath))
}

function sourceLinesMatching(
  files: string[],
  matchLine: (line: string) => string | null,
): string[] {
  const violations: string[] = []
  for (const filePath of files) {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return
      }

      const label = matchLine(line)
      if (label) {
        violations.push(`${toRepoPath(filePath)}:${index + 1}: ${label}: ${trimmed}`)
      }
    })
  }
  return violations
}

describe('surface architecture invariants', () => {
  it('keeps production src/surfaces entries limited to desktop/ and mobile/', () => {
    const violations = existsSync(SURFACES_ROOT)
      ? readdirSync(SURFACES_ROOT, { withFileTypes: true })
        .filter((entry) => entry.name !== '__tests__')
        .filter((entry) => !entry.isDirectory() || !ALLOWED_SURFACE_ROOTS.has(entry.name))
        .map((entry) => `src/surfaces/${entry.name}`)
      : []

    expect(
      violations,
      `Only src/surfaces/desktop/** and src/surfaces/mobile/** may contain production surface code.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('contains no feature pages or feature-owned surface files', () => {
    const violations = productionSurfaceFiles()
      .map(toRepoPath)
      .filter((filePath) => FEATURE_SURFACE_FILE_PATTERNS.some((pattern) => pattern.test(filePath)))

    expect(
      violations,
      `Viewport surfaces must stay shell/chrome-only. Move feature pages and feature-owned UI to modules/**.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('contains no direct backend fetches or hardcoded API calls', () => {
    const violations = sourceLinesMatching(productionSurfaceFiles(), (line) => {
      const match = DIRECT_BACKEND_PATTERNS.find(({ pattern }) => pattern.test(line))
      return match?.label ?? null
    })

    expect(
      violations,
      `Surface code must not call backend APIs directly. Use module-owned hooks/services instead.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('is never imported by modules/**', () => {
    const moduleSourceFiles = walkFiles(MODULES_ROOT)
      .filter(isSourceFile)
    const violations = sourceLinesMatching(moduleSourceFiles, (line) => (
      SURFACE_IMPORT_PATTERN.test(line)
        ? 'surface import'
        : null
    ))

    expect(
      violations,
      `Feature modules must not import src/surfaces/**. Move shared code to modules/** or src/styles/**.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
