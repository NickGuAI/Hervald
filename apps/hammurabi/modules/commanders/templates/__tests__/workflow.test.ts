import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMMANDER_WORKFLOW_TEMPLATE_FILE,
  renderCommanderWorkflow,
  scaffoldCommanderWorkflow,
} from '../workflow.js'

const tempDirs: string[] = []

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

describe('commander workflow template scaffolding', () => {
  it('renders commander-specific memory commands from the template', () => {
    const rendered = renderCommanderWorkflow(
      [
        'Workspace: [WORKSPACE_CWD]',
        'hammurabi memory save --commander [COMMANDER_ID] "<fact>"',
      ].join('\n'),
      {
        commanderId: '33333333-3333-4333-8333-333333333333',
        cwd: '/workspace/monorepo-g',
      },
    )

    expect(rendered).toContain('Workspace: /workspace/monorepo-g')
    expect(rendered).toContain('hammurabi memory save --commander 33333333-3333-4333-8333-333333333333 "<fact>"')
  })

  it('scaffolds both the shared template and per-commander COMMANDER.md', async () => {
    const dir = await createTempDir('hammurabi-workflow-template-')
    const commanderId = '44444444-4444-4444-8444-444444444444'
    const workflowPath = await scaffoldCommanderWorkflow(
      commanderId,
      {
        cwd: '/workspace/forge',
      },
      dir,
    )

    expect(workflowPath).toBe(join(dir, commanderId, 'COMMANDER.md'))

    const template = await readFile(join(dir, COMMANDER_WORKFLOW_TEMPLATE_FILE), 'utf8')
    expect(template).toContain('[COMMANDER_ID]')
    expect(template).toContain('## Shared Knowledge Bootstrap')
    expect(template).toContain('Global runtime defaults and limits come from `~/.hammurabi/config.yaml`.')
    expect(template).toContain('Per-commander runtime settings such as heartbeat cadence')
    expect(template).toContain('~/.hammurabi/shared-knowledge/DOCTRINES.md')
    expect(template).toContain('~/.hammurabi/shared-knowledge/COMMANDER_GUIDE.md')
    expect(template).toContain('~/.hammurabi/shared-knowledge/LEARNINGS.md')
    expect(template).toContain('## Memory')
    expect(template).toContain('Commander memory search/recollection is not a Hammurabi runtime feature.')
    expect(template).toContain('## Session Transcripts')
    expect(template).toContain('hammurabi commander transcripts search --commander [COMMANDER_ID] "<query>"')
    expect(template).not.toContain('hammurabi memory find')

    const written = await readFile(workflowPath, 'utf8')
    expect(written).not.toContain('heartbeat.interval')
    expect(written).not.toContain('maxTurns:')
    expect(written).toContain('/workspace/forge')
    expect(written).toContain(`hammurabi memory save --commander ${commanderId} "<fact>"`)
    expect(written).toContain('.memory/working-memory.md')
    expect(written).toContain(`hammurabi memory --type=working_memory read --commander ${commanderId}`)
    expect(written).toContain(`hammurabi commander transcripts search --commander ${commanderId} "<query>"`)
    expect(written).not.toContain(`hammurabi memory find --commander ${commanderId}`)
  })

  it('uses an existing shared template when present', async () => {
    const dir = await createTempDir('hammurabi-workflow-existing-template-')
    await writeFile(
      join(dir, COMMANDER_WORKFLOW_TEMPLATE_FILE),
      'Commander [COMMANDER_ID] @ [WORKSPACE_CWD]\n',
      'utf8',
    )
    const commanderId = '55555555-5555-4555-8555-555555555555'

    const workflowPath = await scaffoldCommanderWorkflow(
      commanderId,
      {
        cwd: '/workspace/custom',
      },
      dir,
    )

    const written = await readFile(workflowPath, 'utf8')
    expect(written).toBe(`Commander ${commanderId} @ /workspace/custom\n`)
  })
})
