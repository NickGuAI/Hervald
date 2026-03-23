import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractCommanderIdentityBody,
  renderCommanderIdentity,
  scaffoldCommanderIdentity,
} from '../render.js'

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

describe('commander identity template rendering', () => {
  it('renders all fields when persona and cwd are provided', async () => {
    const rendered = await renderCommanderIdentity({
      id: 'cmdr-identity-1',
      host: 'athena',
      persona: 'Athena, goddess of wisdom and engineering commander',
      created: '2026-03-18T10:00:00.000Z',
      cwd: '/workspace/example-repo',
    })

    expect(rendered).toContain('id: "cmdr-identity-1"')
    expect(rendered).toContain('host: "athena"')
    expect(rendered).toContain('persona: "Athena, goddess of wisdom and engineering commander"')
    expect(rendered).toContain('created: "2026-03-18T10:00:00.000Z"')
    expect(rendered).toContain('cwd: "/workspace/example-repo"')
    expect(rendered).toContain('- Workspace CWD: `/workspace/example-repo`')
  })

  it('falls back to default persona and optional cwd markers', async () => {
    const rendered = await renderCommanderIdentity({
      id: 'cmdr-identity-2',
      host: 'apollo',
      created: '2026-03-18T10:00:00.000Z',
    })

    expect(rendered).toContain(
      'You are Commander apollo, an autonomous orchestration agent for GitHub task execution.',
    )
    expect(rendered).toContain('cwd: null')
    expect(rendered).toContain('- Workspace CWD: _not provided_')
  })

  it('scaffolds identity.md inside .memory/ directory', async () => {
    const dir = await createTempDir('hammurabi-identity-template-')
    const filePath = await scaffoldCommanderIdentity(
      'cmdr-identity-3',
      {
        id: 'cmdr-identity-3',
        host: 'hephaestus',
        persona: 'Hephaestus, forge commander',
        created: '2026-03-18T10:00:00.000Z',
        cwd: '/workspace/forge',
      },
      dir,
    )

    expect(filePath).toContain('.memory')
    expect(filePath).toContain('identity.md')
    const written = await readFile(filePath, 'utf8')
    expect(written).toContain('host: "hephaestus"')
    expect(written).toContain('Hephaestus, forge commander')
    expect(written).toContain('cwd: "/workspace/forge"')
  })

  it('extracts markdown body without yaml front matter', () => {
    const body = extractCommanderIdentityBody([
      '---',
      'id: "cmdr-identity-4"',
      '---',
      '',
      '# Identity',
      '',
      'Commander body text',
    ].join('\n'))

    expect(body).toBe('# Identity\n\nCommander body text')
  })
})
