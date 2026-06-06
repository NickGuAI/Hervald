import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BENCHMARK_COMMANDER_CWD,
  BENCHMARK_COMMANDER_DISPLAY_NAME,
  BENCHMARK_COMMANDER_FAT_PIN_INTERVAL,
  BENCHMARK_COMMANDER_MAX_TURNS,
  BENCHMARK_COMMANDER_TASK_SOURCE,
  buildBenchmarkCommanderDefaultAutomations,
  bootstrapBenchmarkCommanderFiles,
} from '../benchmark-bootstrap.js'
import { findCommanderArchetype } from '../archetypes.js'

const tempDirs: string[] = []
const COMMANDER_ID = '77777777-7777-4777-8777-777777777777'

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('benchmark commander archetype', () => {
  it('exposes benchmark issue defaults', () => {
    const archetype = findCommanderArchetype('benchmark')

    expect(archetype).toEqual(expect.objectContaining({
      id: 'benchmark',
      defaultDisplayName: BENCHMARK_COMMANDER_DISPLAY_NAME,
      defaultAgentType: 'codex',
      defaultCwd: BENCHMARK_COMMANDER_CWD,
      defaultHeartbeatMinutes: 30,
      defaultMaxTurns: BENCHMARK_COMMANDER_MAX_TURNS,
      defaultContextMode: 'fat',
      defaultContextConfig: {
        fatPinInterval: BENCHMARK_COMMANDER_FAT_PIN_INTERVAL,
      },
      suggestedTaskSource: BENCHMARK_COMMANDER_TASK_SOURCE,
    }))
  })
})

describe('benchmark commander bootstrap', () => {
  it('defines the default benchmark automations as commander-scoped tasks', () => {
    const automations = buildBenchmarkCommanderDefaultAutomations({
      commanderId: COMMANDER_ID,
      host: 'benchmark-worker',
      model: 'gpt-5.3-codex',
    })

    expect(automations).toHaveLength(4)
    expect(automations.map((automation) => automation.templateId)).toEqual([
      'benchmark-smoke',
      'benchmark-weekly-baseline',
      'benchmark-release-gate',
      'benchmark-dashboard-refresh',
    ])
    expect(automations).toEqual([
      expect.objectContaining({
        parentCommanderId: COMMANDER_ID,
        name: 'Benchmark smoke benchmark',
        trigger: 'schedule',
        schedule: '0 3 * * *',
        agentType: 'codex',
        machine: 'benchmark-worker',
        model: 'gpt-5.3-codex',
      }),
      expect.objectContaining({
        parentCommanderId: COMMANDER_ID,
        name: 'Benchmark weekly baseline',
        trigger: 'schedule',
        schedule: '0 4 * * 1',
      }),
      expect.objectContaining({
        parentCommanderId: COMMANDER_ID,
        name: 'Benchmark release gate',
        trigger: 'manual',
      }),
      expect.objectContaining({
        parentCommanderId: COMMANDER_ID,
        name: 'Benchmark dashboard refresh',
        trigger: 'manual',
      }),
    ])
  })

  it('seeds benchmark files without runtime frontmatter', async () => {
    const dir = await createTempDir('hammurabi-benchmark-bootstrap-')
    const result = await bootstrapBenchmarkCommanderFiles(COMMANDER_ID, dir)

    expect(result.written.sort()).toEqual([
      '.memory/MEMORY.md',
      '.memory/working-memory.md',
      'COMMANDER.md',
      'SKILLS.md',
      'WORKSPACE.md',
    ])
    expect(result.skipped).toEqual([])

    const commanderMd = await readFile(join(dir, COMMANDER_ID, 'COMMANDER.md'), 'utf8')
    expect(commanderMd).toContain('You are Benchmark Commander.')
    expect(commanderMd).toContain(BENCHMARK_COMMANDER_CWD)
    expect(commanderMd).toContain('Benchmark-only commander.')
    expect(commanderMd).not.toMatch(/^---\n/)
    expect(commanderMd).not.toContain('maxTurns:')
    expect(commanderMd).not.toContain('contextMode:')
    expect(commanderMd).not.toContain('fatPinInterval:')

    await expect(readFile(
      join(dir, COMMANDER_ID, 'WORKSPACE.md'),
      'utf8',
    )).resolves.toContain('Issue label: `benchmark`')
    await expect(readFile(
      join(dir, COMMANDER_ID, 'SKILLS.md'),
      'utf8',
    )).resolves.toContain('benchmark-runner')
    await expect(readFile(
      join(dir, COMMANDER_ID, '.memory', 'MEMORY.md'),
      'utf8',
    )).resolves.toContain('Durable eval facts only')
    await expect(readFile(
      join(dir, COMMANDER_ID, '.memory', 'working-memory.md'),
      'utf8',
    )).resolves.toContain('Active benchmark scratch notes')
  })

  it('does not overwrite existing files on repeated bootstrap', async () => {
    const dir = await createTempDir('hammurabi-benchmark-bootstrap-existing-')
    const commanderDir = join(dir, COMMANDER_ID)
    await bootstrapBenchmarkCommanderFiles(COMMANDER_ID, dir)
    await writeFile(join(commanderDir, 'COMMANDER.md'), 'custom commander\n', 'utf8')
    await writeFile(join(commanderDir, '.memory', 'working-memory.md'), 'custom scratch\n', 'utf8')

    const result = await bootstrapBenchmarkCommanderFiles(COMMANDER_ID, dir)

    expect(result.written).toEqual([])
    expect(result.skipped.sort()).toEqual([
      '.memory/MEMORY.md',
      '.memory/working-memory.md',
      'COMMANDER.md',
      'SKILLS.md',
      'WORKSPACE.md',
    ])
    await expect(readFile(join(commanderDir, 'COMMANDER.md'), 'utf8')).resolves.toBe('custom commander\n')
    await expect(readFile(
      join(commanderDir, '.memory', 'working-memory.md'),
      'utf8',
    )).resolves.toBe('custom scratch\n')
  })
})
