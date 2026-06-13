import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EvalRunStore } from '../store'
import type { EvalRunConfig, EvalRunResult } from '../types'

const tempDirectories: string[] = []

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-eval-store-'))
  tempDirectories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('EvalRunStore', () => {
  it('publishes eval run artifacts from a complete staged directory', async () => {
    const root = await createTempRoot()
    const store = new EvalRunStore(root)
    const config: EvalRunConfig = {
      runId: 'run-1',
      bench: 'terminal-bench',
      source: 'terminal-bench',
      profile: 'smoke',
      runnerMode: 'api-key',
      authMode: 'api-key',
      createdAt: '2026-06-10T00:00:00.000Z',
    }
    const result: EvalRunResult = {
      runId: 'run-1',
      bench: 'terminal-bench',
      status: 'completed',
      score: 1,
      failures: [],
      tasks: [],
      completedAt: '2026-06-10T00:05:00.000Z',
    }

    const manifest = await store.writeRunArtifacts({
      config,
      result,
      summaryMarkdown: '# Summary\n\nPassed.',
    })

    expect(manifest).toMatchObject({
      runId: 'run-1',
      status: 'completed',
      score: 1,
    })
    await expect(readFile(manifest.configPath, 'utf8')).resolves.toContain('"runId": "run-1"')
    await expect(readFile(manifest.resultPath, 'utf8')).resolves.toContain('"status": "completed"')
    await expect(readFile(manifest.summaryPath, 'utf8')).resolves.toBe('# Summary\n\nPassed.\n')

    const benchDir = path.dirname(manifest.rootPath)
    const entries = await readdir(benchDir)
    expect(entries.filter((entry) => entry.includes('.staging') || entry.includes('.replace'))).toEqual([])
  })
})
