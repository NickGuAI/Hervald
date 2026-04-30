import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommanderManager } from '../manager.js'
import type { SubagentResult } from '../memory/index.js'
import type { GHIssue } from '../memory/handoff.js'

const COMMANDER_ID = '00000000-0000-4000-8000-000000000121'

describe('CommanderManager', () => {
  let tmpDir: string
  let manager: CommanderManager

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'commander-manager-test-'))
    manager = new CommanderManager(COMMANDER_ID, tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns a Commander with the correct id and creates primitive storage roots', async () => {
    const commander = await manager.init()
    expect(commander.id).toBe(COMMANDER_ID)
    await expect(readFile(join(tmpDir, COMMANDER_ID, '.memory', 'working-memory.md'), 'utf8')).resolves.toContain('# Working Memory')
  })

  it('builds formatted subagent system context', async () => {
    await manager.init()
    await writeFile(
      join(tmpDir, COMMANDER_ID, '.memory', 'MEMORY.md'),
      [
        '# Commander Standing Orders',
        '- Keep diffs surgical.',
        '',
        '## Repo Notes',
        '- monorepo-g uses pnpm workspaces.',
      ].join('\n'),
      'utf-8',
    )
    const skillDir = join(tmpDir, COMMANDER_ID, 'skills', 'lint-fix')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '# Lint Fix Skill\n\nUse this when fixing lint regressions.\n',
      'utf-8',
    )

    const task: GHIssue = {
      number: 167,
      title: 'Fix lint regression in monorepo-g',
      body: 'Need to resolve eslint issues in commander memory modules.',
      repo: 'NickGuAI/Hervald',
      comments: ['Please include tests', 'Verify with package lint'],
    }
    const context = await manager.buildSubagentSystemContext(task)

    expect(context).toContain(`## Handoff from Commander ${COMMANDER_ID}`)
    expect(context).toContain('**Issue #167**: Fix lint regression in monorepo-g')
    expect(context).toContain('### Standing Instructions')
    expect(context).toContain('Report durable conventions or pitfalls back to the commander')
    expect(context).not.toContain('### Suggested Skills (manual invoke only)')
    expect(context).not.toContain('### Relevant Memory Recollection')
  })

  it('allows processSubagentCompletion without writing harness-owned journal state', async () => {
    await manager.init()
    const task: GHIssue = {
      number: 168,
      title: 'Patch websocket reconnect',
      body: 'Investigate intermittent reconnect failures.',
      repo: 'NickGuAI/Hervald',
    }
    const result: SubagentResult = {
      status: 'SUCCESS',
      finalComment: 'Found an unexpected race condition in reconnect path.',
      filesChanged: 3,
      durationMin: 14,
      subagentSessionId: 'sess-123',
    }

    await expect(manager.processSubagentCompletion(task, result)).resolves.toBeUndefined()
  })

  it('delegates a sub-task through session tool with memory handoff', async () => {
    const createSession = vi.fn(async () => ({
      sessionId: 'sess-subagent-167',
      raw: { created: true },
    }))
    const monitorSession = vi.fn(async () => ({
      sessionId: 'sess-subagent-167',
      status: 'SUCCESS' as const,
      finalComment: 'Implemented requested orchestration updates.',
      filesChanged: 4,
      durationMin: 18,
      raw: { done: true },
    }))
    manager = new CommanderManager(COMMANDER_ID, tmpDir, {
      agentSessions: {
        createSession,
        monitorSession,
      },
    })
    await manager.init()

    const task: GHIssue = {
      number: 167,
      title: 'Commander: agent orchestration capabilities',
      body: 'Wire sub-agent execution from Commander manager.',
      repo: 'NickGuAI/Hervald',
      comments: ['Include memory handoff context.'],
    }

    const result = await manager.delegateSubagentTask(task, {
      sessionName: 'subagent-167',
      instruction: 'Implement issue #167 and report learnings.',
    })

    expect(createSession).toHaveBeenCalledTimes(1)
    const createInput = createSession.mock.calls[0]?.[0]
    expect(createInput).toMatchObject({
      name: 'subagent-167',
    })
    expect(createInput.systemPrompt).toContain(`## Handoff from Commander ${COMMANDER_ID}`)
    expect(createInput.task).toContain('### Sub-task Instruction')
    expect(createInput.task).toContain('Implement issue #167 and report learnings.')

    expect(monitorSession).toHaveBeenCalledWith('sess-subagent-167', undefined)
    expect(result).toMatchObject({
      status: 'SUCCESS',
      subagentSessionId: 'sess-subagent-167',
      filesChanged: 4,
      durationMin: 18,
    })
  })
})
