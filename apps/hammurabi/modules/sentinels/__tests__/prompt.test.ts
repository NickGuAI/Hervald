import { describe, expect, it } from 'vitest'
import { assemblePrompt } from '../prompt'
import type { Sentinel } from '../types'

function buildSentinel(): Sentinel {
  return {
    id: '0518cd5b-5e3b-4639-a838-f360dcbdde93',
    name: 'venue-monitor',
    instruction: 'Monitor replies and keep notes current.',
    schedule: '0 */6 * * *',
    status: 'active',
    agentType: 'claude',
    permissionMode: 'default',
    parentCommanderId: 'd285cab7-b685-45c6-94f6-e689231e4924',
    skills: [],
    seedMemory: '',
    memoryPath: '/home/builder/.hammurabi/sentinels/0518cd5b-5e3b-4639-a838-f360dcbdde93/memory.md',
    outputDir: '/home/builder/.hammurabi/sentinels/0518cd5b-5e3b-4639-a838-f360dcbdde93',
    workDir: '/home/builder/App/apps/hammurabi',
    createdAt: '2026-04-16T00:00:00.000Z',
    lastRun: null,
    totalRuns: 0,
    totalCostUsd: 0,
    history: [],
  }
}

describe('assemblePrompt', () => {
  it('tells sentinels to keep their docs inside their own directory', () => {
    const sentinel = buildSentinel()

    const prompt = assemblePrompt({
      sentinel,
      memoryContent: '',
      resolvedSkills: new Map(),
      now: new Date('2026-04-16T12:00:00.000Z'),
    })

    expect(prompt).toContain('## File Ownership Rules')
    expect(prompt).toContain(`Your private working directory is: ${sentinel.outputDir}`)
    expect(prompt).toContain(`Keep sentinel-owned docs, config, scratch notes, and generated artifacts inside ${sentinel.outputDir}`)
    expect(prompt).toContain(`Prefer files under ${sentinel.outputDir}/artifacts/`)
    expect(prompt).toContain('Do not create ad hoc root-level files under ~/.hammurabi/')
  })
})
