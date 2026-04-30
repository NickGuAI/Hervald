import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { access, constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const appRoot = fileURLToPath(new URL('../../../', import.meta.url))
const childTestPath = join(
  appRoot,
  'modules/commanders/__tests__/create-route-env-isolation.child.test.ts',
)

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

// This test spawns a child `vitest run` process to assert env-isolation
// boundaries. Under full-suite load on slower hosts, process-startup +
// child-test wall-clock can exceed vitest's 5s default per-test timeout.
// Clean-isolation runtime is ~3-4s; the child execFileAsync below already
// carries its own 120s timeout. Bump the vitest per-test budget so
// load-sensitive flakes don't surface on CI / dev machines under contention.
const ENV_ISOLATION_TIMEOUT_MS = 30_000

describe('commander suite env isolation', () => {
  it('keeps externally configured commander data files untouched when default routes are exercised', { timeout: ENV_ISOLATION_TIMEOUT_MS }, async () => {
    const realDataRoot = await createTempDir('hammurabi-real-env-data-')
    const realCommanderDataDir = join(realDataRoot, 'commander')
    const realNamesPath = join(realCommanderDataDir, 'names.json')
    const realSessionsPath = join(realCommanderDataDir, 'sessions.json')
    const sentinelNames = {
      '00000000-0000-4000-a000-000000000123': 'Existing Commander',
    }

    await mkdir(realCommanderDataDir, { recursive: true })
    await writeFile(realNamesPath, JSON.stringify(sentinelNames, null, 2), 'utf8')

    try {
      await execFileAsync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        [
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.config.ts',
          childTestPath,
        ],
        {
          cwd: appRoot,
          env: {
            ...process.env,
            HAMMURABI_DATA_DIR: realDataRoot,
            COMMANDER_DATA_DIR: realCommanderDataDir,
            HAMMURABI_COMMANDER_MEMORY_DIR: realCommanderDataDir,
            HAMMURABI_TEST_ISOLATION_CHILD: '1',
            HAMMURABI_TEST_EXPECT_REAL_DATA_DIR: realDataRoot,
          },
          timeout: 120_000,
        },
      )
    } catch (error) {
      const execError = error as Error & {
        stdout?: string
        stderr?: string
      }
      throw new Error(
        [
          execError.message,
          execError.stdout ? `stdout:\n${execError.stdout}` : null,
          execError.stderr ? `stderr:\n${execError.stderr}` : null,
        ].filter(Boolean).join('\n\n'),
      )
    }

    const realNames = JSON.parse(await readFile(realNamesPath, 'utf8')) as Record<string, string>
    expect(realNames).toEqual(sentinelNames)
    expect(await pathExists(realSessionsPath)).toBe(false)
  })
})
