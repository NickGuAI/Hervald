import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryContextBuilder, type Message } from '../context-builder.js'
import type { PromptTask } from '../prompt-task.js'
import { WorkingMemoryStore } from '../working-memory.js'

describe('MemoryContextBuilder.build()', () => {
  let tmpDir: string
  let commanderId: string
  let memoryRoot: string
  let commanderRoot: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'context-builder-test-'))
    commanderId = '00000000-0000-4000-a000-000000000001'
    commanderRoot = join(tmpDir, commanderId)
    memoryRoot = join(commanderRoot, '.memory')
    await mkdir(memoryRoot, { recursive: true })
    await mkdir(join(memoryRoot, 'backlog'), { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('assembles current task, durable memory, working memory, goals, and recent conversation', async () => {
    await writeFile(
      join(memoryRoot, 'MEMORY.md'),
      '# Commander Memory\n\n- Keep auth middleware deterministic.\n- Certificate chain changes weekly.\n',
      'utf-8',
    )
    await writeFile(
      join(memoryRoot, 'LONG_TERM_MEM.md'),
      '# Commander Long-Term Memory\n\nValidated cert fallback behavior during the last outage.\n',
      'utf-8',
    )
    await writeFile(
      join(memoryRoot, 'GOALS.md'),
      [
        '# Active Goals',
        '',
        '## [ship-auth-fix] Ship auth fix',
        '- **Target:** 2026-04-01',
        '- **Current state:** Investigating token skew handling',
        '- **Intended state:** Regression fixed and deployed',
      ].join('\n'),
      'utf-8',
    )
    await writeFile(
      join(memoryRoot, 'backlog', 'thin-index.md'),
      '- #247 Fix auth token refresh\n- #252 Improve cert diagnostics',
      'utf-8',
    )

    const workingMemory = new WorkingMemoryStore(commanderId, tmpDir)
    await workingMemory.update({
      source: 'message',
      summary: 'Current hypothesis: token skew handling causes refresh failures.',
      hypothesis: 'Token skew in refresh middleware',
      files: ['modules/auth/middleware.ts'],
      tags: ['hypothesis'],
    })

    const issue: PromptTask = {
      number: 247,
      title: 'Fix auth token refresh',
      body: 'Refresh fails when cert rotates and token skew is high.',
      labels: [{ name: 'bug' }],
      owner: 'NickGuAI',
      repo: 'example-repo',
      comments: [
        {
          author: 'reviewer-1',
          createdAt: '2026-02-28T10:00:00.000Z',
          body: 'Please include recent comments and cert handling notes.',
        },
      ],
    }
    const recentConversation: Message[] = [
      { role: 'user', content: 'What did we learn from recent cert incidents?' },
      { role: 'assistant', content: 'Use cached key fallback and rotate certs safely.' },
    ]

    const builder = new MemoryContextBuilder(commanderId, tmpDir)
    const built = await builder.build({
      currentTask: issue,
      recentConversation,
    })

    expect(built.layersIncluded).toEqual([1, 1.5, 2, 3, 6])
    expect(built.systemPromptSection).toContain('## Commander Memory')
    expect(built.systemPromptSection).toContain('### Current Task')
    expect(built.systemPromptSection).toContain('### Backlog Overview')
    expect(built.systemPromptSection).toContain('### Active Goals')
    expect(built.systemPromptSection).toContain('### Long-term Memory')
    expect(built.systemPromptSection).toContain('### Working Memory Scratchpad')
    expect(built.systemPromptSection).toContain('### Recent Conversation')
    expect(built.systemPromptSection).not.toContain('### Recent Journal')
    expect(built.systemPromptSection).not.toContain('### Cue-based Recollection')
  })

  it('drops lower-priority layers when token budget is tight', async () => {
    const memoryLines = Array.from({ length: 80 }, (_, idx) => `- line ${idx + 1}`).join('\n')
    await writeFile(join(memoryRoot, 'MEMORY.md'), `# Commander Memory\n\n${memoryLines}\n`, 'utf-8')
    await writeFile(join(memoryRoot, 'LONG_TERM_MEM.md'), '# Narrative\n\n' + 'history '.repeat(200), 'utf-8')
    await writeFile(join(memoryRoot, 'backlog', 'thin-index.md'), '- #10 Small backlog item', 'utf-8')

    const builder = new MemoryContextBuilder(commanderId, tmpDir)
    const built = await builder.build({
      currentTask: {
        number: 10,
        title: 'Small backlog item',
        body: 'Keep the prompt small.',
        owner: 'NickGuAI',
        repo: 'example-repo',
      },
      recentConversation: [{ role: 'user', content: 'Keep only the important layers.' }],
      tokenBudget: 80,
    })

    expect(built.layersIncluded).toContain(1)
    expect(built.layersIncluded).toContain(2)
    expect(built.droppedLayers.length).toBeGreaterThan(0)
  })

  it('loads appended MEMORY.md facts from the tail of the file', async () => {
    const memoryLines = Array.from({ length: 240 }, (_, idx) => `- memory line ${idx + 1}`).join('\n')
    await writeFile(join(memoryRoot, 'MEMORY.md'), `# Commander Memory\n\n${memoryLines}\n`, 'utf-8')

    const builder = new MemoryContextBuilder(commanderId, tmpDir)
    const built = await builder.build({
      currentTask: null,
      recentConversation: [],
    })

    expect(built.systemPromptSection).toContain('- memory line 42\n')
    expect(built.systemPromptSection).toContain('- memory line 240')
    expect(built.systemPromptSection).toContain('_...truncated to last 200 lines._')
    expect(built.systemPromptSection).not.toContain('- memory line 40\n')
  })
})
