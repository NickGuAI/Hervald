import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryMdWriter } from '../memory-md-writer.js'

describe('MemoryMdWriter.updateFacts()', () => {
  let tmpDir: string
  let memoryRoot: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memory-writer-test-'))
    memoryRoot = join(tmpDir, '.memory')
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(tmpDir, '.memory', 'MEMORY.md'), '# Commander Memory\n\n', 'utf-8')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('appends only new facts and preserves existing entries', async () => {
    await writeFile(
      join(memoryRoot, 'MEMORY.md'),
      `# Commander Memory

- Doctrine: Validate audience
`,
      'utf-8',
    )
    const writer = new MemoryMdWriter(memoryRoot)
    const result = await writer.updateFacts([
      'Doctrine: Validate audience',
      'Avoid: skip startup env validation',
    ])
    expect(result).toMatchObject({ factsAdded: 1 })

    const memory = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf-8')
    expect(memory).toContain('- Doctrine: Validate audience')
    expect(memory).toContain('Avoid: skip startup env validation')
  })

  it('does not evict or archive existing facts', async () => {
    await writeFile(
      join(memoryRoot, 'MEMORY.md'),
      `# Commander Memory

- old fact
- fresh fact
`,
      'utf-8',
    )

    const writer = new MemoryMdWriter(memoryRoot)
    const result = await writer.updateFacts([])
    expect(result).toMatchObject({ factsAdded: 0 })

    const memory = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf-8')
    expect(memory).toContain('old fact')
    expect(memory).toContain('fresh fact')
    await expect(access(join(memoryRoot, 'archive', 'MEMORY-archive-2026-03-01.md'))).rejects.toThrow()
  })

  it('deduplicates repeated facts in the same save call', async () => {
    const writer = new MemoryMdWriter(memoryRoot)
    const result = await writer.updateFacts(['fact-1', 'fact-1', 'fact-2'])

    expect(result).toMatchObject({ factsAdded: 2 })

    const memory = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf-8')
    expect(memory.match(/- fact-1/g)).toHaveLength(1)
    expect(memory.match(/- fact-2/g)).toHaveLength(1)
  })
})
