import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultCommanderRuntimeConfig,
  renderCommanderRuntimeConfig,
} from '../commander-runtime-config.js'
import {
  ensureCommanderRuntimeConfig,
} from '../commander-runtime-config-node.js'

const createdDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('ensureCommanderRuntimeConfig', () => {
  it('creates the canonical runtime config file with default values when missing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-runtime-config-'))
    createdDirectories.push(directory)
    const filePath = path.join(directory, '.hammurabi', 'config.yaml')

    const result = await ensureCommanderRuntimeConfig({ filePath })

    expect(result).toEqual({
      filePath,
      created: true,
    })
    await expect(readFile(filePath, 'utf8')).resolves.toBe(
      renderCommanderRuntimeConfig(createDefaultCommanderRuntimeConfig()),
    )
  })

  it('does not overwrite an existing runtime config file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-runtime-config-'))
    createdDirectories.push(directory)
    const filePath = path.join(directory, '.hammurabi', 'config.yaml')
    const existing = [
      'commanders:',
      '  runtime:',
      '    defaults:',
      '      maxTurns: 42',
      '    limits:',
      '      maxTurns: 84',
      '',
    ].join('\n')

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, existing, 'utf8')

    const result = await ensureCommanderRuntimeConfig({ filePath })

    expect(result).toEqual({
      filePath,
      created: false,
    })
    await expect(readFile(filePath, 'utf8')).resolves.toBe(existing)
  })
})
