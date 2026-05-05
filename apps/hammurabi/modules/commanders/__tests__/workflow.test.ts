import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadCommanderWorkflow,
  mergeWorkflows,
} from '../workflow'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  )
})

describe('commander workflow helpers', () => {
  it('returns null when both workflows are absent', () => {
    expect(mergeWorkflows(null, null)).toBeNull()
  })

  it('returns a copy of the base workflow when override is absent', () => {
    const base = {
      systemPromptTemplate: 'Base prompt',
    }

    expect(mergeWorkflows(base, null)).toEqual(base)
    expect(mergeWorkflows(base, null)).not.toBe(base)
  })

  it('returns a copy of the override workflow when base is absent', () => {
    const override = {
      systemPromptTemplate: 'Override prompt',
    }

    expect(mergeWorkflows(null, override)).toEqual(override)
    expect(mergeWorkflows(null, override)).not.toBe(override)
  })

  it('prefers non-undefined override fields while preserving base fields', () => {
    const merged = mergeWorkflows(
      {
        systemPromptTemplate: 'Base prompt',
      },
      {
        systemPromptTemplate: 'Override prompt',
      },
    )

    expect(merged).toEqual({
      systemPromptTemplate: 'Override prompt',
    })
  })

  it('loads COMMANDER.md body from disk and ignores unrelated frontmatter', async () => {
    const dir = await createTempDir('hammurabi-workflow-test-')
    await writeFile(
      join(dir, 'COMMANDER.md'),
      [
        '---',
        'customTag: keep-me',
        '---',
        '',
        'You are the test commander.',
      ].join('\n'),
      'utf8',
    )

    await expect(loadCommanderWorkflow(dir)).resolves.toEqual({
      systemPromptTemplate: 'You are the test commander.',
    })
  })

  it('rejects removed runtime frontmatter keys on read', async () => {
    const dir = await createTempDir('hammurabi-workflow-strict-test-')
    await writeFile(
      join(dir, 'COMMANDER.md'),
      [
        '---',
        'heartbeat.interval: 2500',
        'maxTurns: 4',
        '---',
        '',
        'You are the test commander.',
      ].join('\n'),
      'utf8',
    )

    await expect(loadCommanderWorkflow(dir)).rejects.toThrow(
      'COMMANDER.md uses removed runtime frontmatter keys: heartbeat.interval, maxTurns',
    )
  })
})
