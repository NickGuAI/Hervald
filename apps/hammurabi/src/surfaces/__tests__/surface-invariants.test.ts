/**
 * Hervald + mobile surface invariants.
 *
 * These tests are the mechanical enforcement of the layout-only doctrine
 * documented in `apps/hammurabi/.claude/rules/hervald.md`. Every new PR
 * that touches `src/surfaces/**` runs against these assertions; any file
 * under the surface tree that reintroduces raw backend calls, mutations,
 * or parallel feature subtrees will fail the suite and block merge.
 *
 * The invariant is architectural, not stylistic — surfaces compose
 * canonical feature components, they never own backend behavior.
 */
import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.resolve(__dirname, '..', '..', '..')
const SURFACES_ROOT = path.resolve(APP_ROOT, 'src', 'surfaces')
const MODULES_ROOT = path.resolve(APP_ROOT, 'modules')
const API_PATH_FRAGMENT = ['/', 'api', '/'].join('')
const FETCH_CALL_PATTERN = String.raw`(^|[^a-zA-Z_])fe${'tch'}\(`

function grepLines(pattern: string, root: string = SURFACES_ROOT): string[] {
  if (!existsSync(root)) {
    return []
  }
  try {
    const out = execSync(
      `grep -rnE ${JSON.stringify(pattern)} ${JSON.stringify(root)} --include='*.ts' --include='*.tsx'`,
      { encoding: 'utf8' },
    )
    return out
      .split('\n')
      .filter(Boolean)
      // Surface-invariants test itself mentions these patterns. Exclude it.
      .filter((line) => !line.includes('surface-invariants.test.ts'))
      // Doctrine file explicitly spells out the banned patterns as examples.
      .filter((line) => !line.includes('/.claude/rules/hervald.md'))
      // Test files legitimately reference production URL patterns as test
      // fixtures (for example avatar routes in render assertions)
      // assertion). The invariant is about production behavior, not test
      // scaffolding — skip anything under a `__tests__/` directory.
      .filter((line) => !/\/__tests__\//.test(line))
      // Comments describing architectural context are allowed to reference
      // endpoints by path. The invariant targets CODE that calls the API,
      // not documentation. Skip lines whose match lives inside a `//`
      // single-line comment, a `/*`-leading comment, or a `*` continuation
      // of a multi-line comment.
      .filter((line) => {
        // Line shape from ripgrep/grep: `path:N:  contents`
        const contentMatch = line.match(/^[^:]+:\d+:(.*)$/)
        if (!contentMatch) {
          return true
        }
        const content = contentMatch[1]
        return !/^\s*(\/\/|\*|\/\*)/.test(content)
      })
  } catch (err) {
    // grep exits 1 when no matches — that's the happy path.
    const typedErr = err as { status?: number }
    if (typedErr.status === 1) {
      return []
    }
    throw err
  }
}

function findDirectories(pattern: RegExp): string[] {
  if (!existsSync(MODULES_ROOT)) {
    return []
  }
  try {
    const out = execSync(
      `find ${JSON.stringify(MODULES_ROOT)} -type d -name hervald -o -type d -name mobile`,
      { encoding: 'utf8' },
    )
    return out
      .split('\n')
      .filter(Boolean)
      .filter((p) => pattern.test(p))
  } catch {
    return []
  }
}

describe('Hervald + mobile surface invariants', () => {
  it('contains no raw backend path fragments under src/surfaces/', () => {
    const violations = grepLines(API_PATH_FRAGMENT)
    expect(
      violations,
      `Surface files must not embed ${API_PATH_FRAGMENT} strings. Use canonical hooks from modules/ or src/hooks/ instead.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('contains no direct fetch calls under src/surfaces/', () => {
    const violations = grepLines(FETCH_CALL_PATTERN)
    expect(
      violations,
      'Surface files must not call fetch directly. Use canonical hooks from modules/ or src/hooks/ instead.\n'
        + `Violations:\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('contains no React Query useMutation() under src/surfaces/', () => {
    const violations = grepLines('useMutation\\(')
    expect(
      violations,
      `Surface files must not own mutations directly. Canonical hooks (useApprovalDecision, useCommander, useCommandRoom, etc.) wrap the mutations.\nViolations:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

describe('Single-implementation file-placement invariant', () => {
  it('has no modules/*/hervald/ or modules/*/mobile/ subtrees', () => {
    const offenders = findDirectories(/.+\/modules\/[^/]+\/(hervald|mobile)\/?$/)
    expect(
      offenders,
      `Feature code is single-implementation. modules/*/hervald/ and modules/*/mobile/ subtrees should not exist. Surface layout belongs in src/surfaces/{hervald,mobile}/, not under modules/.\nOffending directories:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
