import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))

describe('agents route decomposition', () => {
  it('keeps the real agents router orchestrator under the decomposition target', async () => {
    const source = await readFile(join(currentDir, '..', 'routes-core.ts'), 'utf8')
    const lineCount = source.split('\n').length

    expect(lineCount).toBeLessThanOrEqual(800)
  })
})
