import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommanderTranscriptAppender } from '../transcripts'

let tmpDir = ''

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
})

describe('commander transcript appender', () => {
  it('appends commander transcript events under the commander-owned data root', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-transcripts-'))
    const appender = createCommanderTranscriptAppender(tmpDir)

    appender.appendEvent({
      commanderId: 'atlas',
      transcriptId: 'claude-session-1',
      event: { type: 'system', marker: 1 },
    })
    appender.appendEvent({
      commanderId: 'atlas',
      transcriptId: 'claude-session-1',
      event: { type: 'result', marker: 2 },
    })

    const transcriptPath = join(tmpDir, 'atlas', 'sessions', 'claude-session-1.jsonl')
    await vi.waitFor(async () => {
      const raw = await readFile(transcriptPath, 'utf8')
      expect(raw.trim().split('\n').map((line) => JSON.parse(line) as { marker: number })).toEqual([
        { type: 'system', marker: 1 },
        { type: 'result', marker: 2 },
      ])
    })
  })

  it('ignores invalid commander and transcript path segments', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-transcripts-invalid-'))
    const appender = createCommanderTranscriptAppender(tmpDir)

    appender.appendEvent({
      commanderId: '../atlas',
      transcriptId: 'session',
      event: { type: 'system' },
    })
    appender.appendEvent({
      commanderId: 'atlas',
      transcriptId: '../session',
      event: { type: 'system' },
    })

    await expect(readFile(join(tmpDir, 'atlas', 'sessions', 'session.jsonl'), 'utf8'))
      .rejects
      .toMatchObject({ code: 'ENOENT' })
  })
})
