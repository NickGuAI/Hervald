import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acquireFileLock } from '../durable-file'
import { writeJsonFileAtomically } from '../json-file'

const tempDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'hammurabi-json-file-'))
  tempDirectories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('writeJsonFileAtomically', () => {
  it('keeps only the configured number of backup siblings', async () => {
    const dir = await createTempDir()
    const filePath = path.join(dir, 'state.json')
    await writeFile(filePath, '{"version":"old"}\n', 'utf8')

    for (let index = 0; index < 7; index += 1) {
      await writeFile(
        `${filePath}.bak.20260101T00000${index}Z`,
        `{"backup":${index}}\n`,
        'utf8',
      )
    }

    await writeJsonFileAtomically(
      filePath,
      { version: 'new' },
      { backup: true, backupRetention: 3, trailingNewline: true },
    )

    const entries = await readdir(dir)
    const backups = entries.filter((entry) => entry.startsWith('state.json.bak.'))
    expect(backups).toHaveLength(3)
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{\n  "version": "new"\n}\n')
  })

  it('refuses a write while another holder owns the file lock', async () => {
    const dir = await createTempDir()
    const filePath = path.join(dir, 'locked.json')
    await writeFile(filePath, '{"version":"old"}\n', 'utf8')
    const lock = await acquireFileLock(`${filePath}.lock`)

    try {
      await expect(writeJsonFileAtomically(filePath, { version: 'new' }))
        .rejects.toMatchObject({ code: 'ELOCKED' })
      await expect(readFile(filePath, 'utf8')).resolves.toBe('{"version":"old"}\n')
    } finally {
      await lock.release()
    }
  })
})
