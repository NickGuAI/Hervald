import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SubagentHandoff,
  type GHIssue,
  type HandoffPackage,
  type SubagentResult,
} from '../handoff.js'

describe('SubagentHandoff.buildHandoffPackage()', () => {
  let tmpDir: string
  let handoff: SubagentHandoff

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'subagent-handoff-test-'))
    handoff = new SubagentHandoff('00000000-0000-4000-a000-000000000001', tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('assembles task-only handoff context without packaged memory', async () => {
    const task: GHIssue = {
      number: 247,
      title: 'Fix auth token refresh regression',
      body: 'Sub-agent should patch the failing refresh flow and add tests.',
      repo: 'example-org/example-repo',
      comments: [
        'First comment to ignore',
        { author: 'reviewer', body: 'Please include regression tests' },
        'Watch for middleware side effects',
        'Last comment should be included',
      ],
    }

    const pkg = await handoff.buildHandoffPackage(task)

    expect(pkg.sourceCommanderId).toBe('00000000-0000-4000-a000-000000000001')
    expect(pkg.taskContext).toContain('**Issue #247**: Fix auth token refresh regression')
    expect(pkg.taskContext).toContain('Repo: example-org/example-repo')
    expect(pkg.taskContext).toContain('reviewer: Please include regression tests')
    expect(pkg.taskContext).toContain('Watch for middleware side effects')
    expect(pkg.taskContext).toContain('Last comment should be included')
    expect(pkg.taskContext).not.toContain('First comment to ignore')
  })
})

describe('SubagentHandoff.formatAsSystemContext()', () => {
  it('formats task-only markdown for sub-agent injection', () => {
    const handoff = new SubagentHandoff('00000000-0000-4000-a000-000000000001')
    const pkg: HandoffPackage = {
      taskContext: '**Issue #10**: Fix parser\nRepo: example-org/example-repo\n\nIssue body',
      sourceCommanderId: '00000000-0000-4000-a000-000000000001',
    }

    const formatted = handoff.formatAsSystemContext(pkg)
    expect(formatted).toContain('## Handoff from Commander 00000000-0000-4000-a000-000000000001')
    expect(formatted).toContain('### Task')
    expect(formatted).toContain('Repo: example-org/example-repo')
    expect(formatted).toContain('### Standing Instructions')
    expect(formatted).toContain('Report durable conventions or pitfalls back to the commander')
    expect(formatted).not.toContain('### Suggested Skills (manual invoke only)')
    expect(formatted).not.toContain('### Working Memory Scratchpad')
    expect(formatted).not.toContain('### Relevant Memory Recollection')
  })
})

describe('SubagentHandoff.processCompletion()', () => {
  const task: GHIssue = {
    number: 501,
    title: 'Investigate telemetry gap',
    body: 'Need a focused sub-agent pass.',
    repo: 'example-org/example-repo',
  }

  const makeResult = (overrides: Partial<SubagentResult> = {}): SubagentResult => ({
    status: 'SUCCESS',
    finalComment: 'Completed as expected',
    filesChanged: 2,
    durationMin: 11,
    subagentSessionId: 'sess-abc',
    ...overrides,
  })

  it('returns without writing harness-owned journal state', async () => {
    const handoff = new SubagentHandoff('00000000-0000-4000-a000-000000000001')

    await expect(handoff.processCompletion(task, makeResult())).resolves.toBeUndefined()
    await expect(
      handoff.processCompletion(task, makeResult({ status: 'PARTIAL' })),
    ).resolves.toBeUndefined()
    await expect(
      handoff.processCompletion(
        task,
        makeResult({ finalComment: 'Found an unexpected race condition in prod path.' }),
      ),
    ).resolves.toBeUndefined()
  })
})
