import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkingMemory, WorkingMemoryStore } from '../working-memory.js'

const COMMANDER_ID = '00000000-0000-4000-8000-000000000111'

describe('WorkingMemoryStore', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'working-memory-store-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates default scratchpad state and markdown representation', async () => {
    let nowValue = new Date('2026-03-10T10:00:00.000Z')
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    await store.ensure()
    const state = await store.readState()
    expect(state.version).toBe(1)
    expect(state.activeHypothesis).toBeNull()
    expect(state.filesInFocus).toEqual([])
    expect(state.checkpoints).toEqual([])

    const markdownPath = join(
      tmpDir,
      COMMANDER_ID,
      '.memory',
      'working-memory.md',
    )
    const markdown = await readFile(markdownPath, 'utf-8')
    expect(markdown).toContain('# Working Memory')
    expect(markdown).toContain('Active hypothesis: _none_')

    nowValue = new Date('2026-03-10T10:10:00.000Z')
    await store.update({
      source: 'append',
      summary: 'Investigate auth refresh path and verify middleware ordering',
      hypothesis: 'Middleware order bug',
      files: ['modules/auth/middleware.ts', './modules/auth/middleware.ts'],
      tags: ['Auth', 'auth', 'hypothesis'],
    })

    const updated = await store.readState()
    expect(updated.activeHypothesis).toBe('Middleware order bug')
    expect(updated.filesInFocus).toContain('modules/auth/middleware.ts')
    expect(updated.checkpoints).toHaveLength(1)
    expect(updated.checkpoints[0]).toMatchObject({
      source: 'append',
      summary: 'Investigate auth refresh path and verify middleware ordering',
      tags: ['auth', 'hypothesis'],
    })
  })

  it('normalizes legacy lifecycle sources into generic system checkpoints', async () => {
    let nowValue = new Date('2026-03-11T09:00:00.000Z')
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    await store.update({
      source: 'heartbeat',
      summary: 'Commander heartbeat summary',
      tags: ['heartbeat'],
    })

    const state = await store.readState()
    expect(state.checkpoints).toHaveLength(1)
    expect(state.checkpoints[0]).toMatchObject({
      source: 'system',
      summary: 'Commander heartbeat summary',
      tags: ['heartbeat'],
    })
  })

  it('retains duplicate checkpoints instead of deduplicating them', async () => {
    let nowValue = new Date('2026-03-11T09:00:00.000Z')
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    await store.update({
      source: 'append',
      summary: 'Scratchpad note',
      tags: ['observation'],
    })

    nowValue = new Date('2026-03-11T09:01:00.000Z')
    await store.update({
      source: 'append',
      summary: 'Scratchpad note',
      tags: ['observation'],
    })

    const state = await store.readState()
    expect(state.checkpoints).toHaveLength(2)
    expect(state.checkpoints.filter((entry) => entry.summary === 'Scratchpad note')).toHaveLength(2)
  })

  it('trims checkpoints as a FIFO queue capped at 100 entries', async () => {
    let nowValue = new Date('2026-03-11T09:00:00.000Z')
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    for (let index = 0; index < 105; index += 1) {
      nowValue = new Date(Date.UTC(2026, 2, 11, 9, index, 0))
      await store.update({
        source: 'append',
        summary: `Checkpoint ${index + 1}`,
        tags: ['observation'],
      })
    }

    const state = await store.readState()
    expect(state.checkpoints).toHaveLength(100)
    expect(state.checkpoints[0]?.summary).toBe('Checkpoint 6')
    expect(state.checkpoints.at(-1)?.summary).toBe('Checkpoint 105')
  })

  it('renders checkpoint details for commander context injection', async () => {
    let nowValue = new Date('2026-03-12T07:30:00.000Z')
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    await store.update({
      source: 'api',
      summary: 'Auth issue scratchpad opened with refresh-token hypothesis',
      issueNumber: 247,
      repo: 'example-org/example-repo',
      hypothesis: 'Token skew mismatch',
      files: ['apps/hammurabi/modules/commanders/routes.ts'],
      tags: ['task-linked'],
    })

    nowValue = new Date('2026-03-12T07:45:00.000Z')
    await store.update({
      source: 'append',
      summary: 'Validate refresh middleware tests before patching',
      issueNumber: 247,
      repo: 'example-org/example-repo',
      tags: ['instruction'],
    })

    const rendered = await store.render(8)
    expect(rendered).toContain('### Working Memory Scratchpad')
    expect(rendered).toContain('# Working Memory')
    expect(rendered).toContain('Active hypothesis: Token skew mismatch')
    expect(rendered).toContain('## Files In Focus')
    expect(rendered).toContain('- apps/hammurabi/modules/commanders/routes.ts')
    expect(rendered).toContain('(api) #247 [example-org/example-repo] {task-linked}')
    expect(rendered).toContain('(append) #247 [example-org/example-repo] {instruction}')
  })

  it('honors the checkpoint cap when rendering', async () => {
    const store = new WorkingMemoryStore(COMMANDER_ID, tmpDir)

    await store.update({ source: 'append', summary: 'Oldest checkpoint' })
    await store.update({ source: 'append', summary: 'Middle checkpoint' })
    await store.update({ source: 'append', summary: 'Newest checkpoint' })

    const rendered = await store.render(2)

    expect(rendered).toContain('Middle checkpoint')
    expect(rendered).toContain('Newest checkpoint')
    expect(rendered).not.toContain('Oldest checkpoint')
  })
})

describe('WorkingMemory', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'working-memory-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('supports append/read/clear scratchpad primitives', async () => {
    let nowValue = new Date('2026-03-13T08:00:00.000Z')
    const workingMemory = new WorkingMemory(COMMANDER_ID, tmpDir, {
      now: () => nowValue,
    })

    await workingMemory.append('Investigating websocket replay ordering.')
    nowValue = new Date('2026-03-13T08:05:00.000Z')
    await workingMemory.append('Noticed race around message listener setup.')

    const content = await workingMemory.read()
    expect(content).toContain('Investigating websocket replay ordering.')
    expect(content).toContain('Noticed race around message listener setup.')

    const statePath = join(tmpDir, COMMANDER_ID, '.memory', 'working-memory.json')
    const beforeClearState = await readFile(statePath, 'utf-8')
    expect(beforeClearState).toContain('"source": "append"')

    await workingMemory.clear()
    const cleared = await workingMemory.read()
    expect(cleared).toBe('')

    const state = await readFile(statePath, 'utf-8')
    expect(state).toContain('"checkpoints": []')
  })
})
