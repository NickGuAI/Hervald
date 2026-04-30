import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendWorkingMemory,
  applyRemoteMemorySnapshot,
  buildCommanderSessionSeedFromResolvedWorkflow,
  clearWorkingMemory,
  exportRemoteMemorySnapshot,
  readWorkingMemory,
  saveFacts,
} from '../module.js'
import type { ResolvedCommanderWorkflow } from '../../workflow-resolution.js'

const COMMANDER_ID = '00000000-0000-4000-8000-000000000222'

describe('commander memory module facade', () => {
  let tmpDir: string
  let memoryRoot: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'commander-memory-module-test-'))
    memoryRoot = join(tmpDir, COMMANDER_ID, '.memory')
    await mkdir(join(memoryRoot, 'backlog'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('preserves working-memory read/append/clear behavior through the facade', async () => {
    let nowValue = new Date('2026-04-25T10:00:00.000Z')

    await expect(readWorkingMemory(COMMANDER_ID, tmpDir, { now: () => nowValue })).resolves.toBe('')

    const appended = await appendWorkingMemory(
      COMMANDER_ID,
      'Investigate lifecycle cleanup.',
      tmpDir,
      { now: () => nowValue },
    )
    expect(appended).toContain('Investigate lifecycle cleanup.')

    nowValue = new Date('2026-04-25T10:05:00.000Z')
    await clearWorkingMemory(COMMANDER_ID, tmpDir, { now: () => nowValue })
    await expect(readWorkingMemory(COMMANDER_ID, tmpDir, { now: () => nowValue })).resolves.toBe('')

    const state = await readFile(join(memoryRoot, 'working-memory.json'), 'utf8')
    expect(state).toContain('"checkpoints": []')
  })

  it('bumps remote revision only when saveFacts appends new facts', async () => {
    const first = await saveFacts(COMMANDER_ID, ['Use append-only durable fact writes'], tmpDir)
    expect(first).toMatchObject({ factsAdded: 1 })

    const afterFirst = await exportRemoteMemorySnapshot(COMMANDER_ID, tmpDir)
    expect(afterFirst.syncRevision).toBe(1)
    expect(afterFirst.memoryMd).toContain('Use append-only durable fact writes')

    const second = await saveFacts(COMMANDER_ID, ['Use append-only durable fact writes'], tmpDir)
    expect(second).toMatchObject({ factsAdded: 0 })

    const afterSecond = await exportRemoteMemorySnapshot(COMMANDER_ID, tmpDir)
    expect(afterSecond.syncRevision).toBe(1)
  })

  it('exports and applies remote memory snapshots with stale-revision conflict semantics', async () => {
    const applied = await applyRemoteMemorySnapshot(
      COMMANDER_ID,
      0,
      '# Commander Memory\n\n- exported fact',
      tmpDir,
    )
    expect(applied).toEqual({
      status: 'applied',
      appliedRevision: 1,
      memoryUpdated: true,
    })

    await expect(exportRemoteMemorySnapshot(COMMANDER_ID, tmpDir)).resolves.toEqual({
      syncRevision: 1,
      memoryMd: '# Commander Memory\n\n- exported fact',
    })

    const stale = await applyRemoteMemorySnapshot(
      COMMANDER_ID,
      0,
      '# Commander Memory\n\n- stale overwrite attempt',
      tmpDir,
    )
    expect(stale).toEqual({
      status: 'conflict',
      currentSyncRevision: 1,
    })
  })

  it('builds commander session seeds through the extracted memory boundary', async () => {
    await writeFile(
      join(memoryRoot, 'MEMORY.md'),
      '# Commander Memory\n\n- Prefer deterministic fixes.\n',
      'utf8',
    )
    await writeFile(join(memoryRoot, 'LONG_TERM_MEM.md'), '# Commander Long-Term Memory\n\n- Prior note.\n', 'utf8')
    await writeFile(join(memoryRoot, 'backlog', 'thin-index.md'), '- #77 Fix auth bug\n', 'utf8')

    const resolvedWorkflow: ResolvedCommanderWorkflow = {
      exists: true,
      workflow: {
        systemPromptTemplate: 'You are the workflow prompt.',
      },
    }

    const built = await buildCommanderSessionSeedFromResolvedWorkflow(
      {
        commanderId: COMMANDER_ID,
        cwd: tmpDir,
        currentTask: {
          issueNumber: 77,
          issueUrl: 'https://github.com/NickGuAI/Hervald/issues/77',
          startedAt: '2026-04-25T11:00:00.000Z',
        },
        taskSource: {
          owner: 'NickGuAI',
          repo: 'monorepo-g',
          label: 'bug',
        },
        maxTurns: 12,
        memoryBasePath: tmpDir,
      },
      resolvedWorkflow,
    )

    expect(built.maxTurns).toBe(12)
    expect(built.systemPrompt).toContain('You are the workflow prompt.')
    expect(built.systemPrompt).toContain('# Hammurabi Quest Board')
    expect(built.systemPrompt).toContain('# Commander Memory Workflow')
    expect(built.systemPrompt).toContain('## Commander Memory')
    expect(built.systemPrompt).toContain('**Issue #77**: Issue #77 — NickGuAI/Hervald')
  })
})
