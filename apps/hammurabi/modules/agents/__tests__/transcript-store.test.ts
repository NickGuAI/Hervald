import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  }
})

import * as fsPromises from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendTranscriptEvent,
  readSessionMeta,
  readTranscriptTail,
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
  writeSessionMeta,
} from '../transcript-store'

let transcriptRoot = ''
const readFileMock = vi.mocked(fsPromises.readFile)

beforeEach(async () => {
  vi.clearAllMocks()
  transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-transcript-store-'))
  setTranscriptStoreRoot(transcriptRoot)
})

afterEach(async () => {
  resetTranscriptStoreRoot()
  if (transcriptRoot) {
    await rm(transcriptRoot, { recursive: true, force: true })
  }
})

describe('transcript-store', () => {
  it('serializes append writes in call order', async () => {
    const sessionName = 'ordered-session'
    const events = [
      { type: 'message', marker: 1 },
      { type: 'message', marker: 2 },
      { type: 'result', marker: 3 },
    ]

    await Promise.all(events.map((event) => appendTranscriptEvent(sessionName, event)))

    const transcriptPath = join(transcriptRoot, sessionName, 'transcript.v1.jsonl')
    const raw = await readFile(transcriptPath, 'utf8')
    expect(raw.trim().split('\n').map((line) => JSON.parse(line) as { marker: number })).toEqual(events)
  })

  it('returns the last N completed turns plus trailing partial events', async () => {
    const sessionName = 'tail-session'
    const events = [
      { type: 'message', marker: 't1-user' },
      { type: 'message', marker: 't1-assistant' },
      { type: 'result', marker: 't1-result' },
      { type: 'message', marker: 't2-user' },
      { type: 'result', marker: 't2-result' },
      { type: 'message', marker: 't3-user' },
      { type: 'message', marker: 't3-assistant' },
      { type: 'result', marker: 't3-result' },
      { type: 'message', marker: 'partial-user' },
      { type: 'message', marker: 'partial-assistant' },
    ]

    for (const event of events) {
      await appendTranscriptEvent(sessionName, event)
    }

    await expect(readTranscriptTail(sessionName, 2)).resolves.toEqual([
      events[3],
      events[4],
      events[5],
      events[6],
      events[7],
      events[8],
      events[9],
    ])
  })

  it('reads and writes session meta', async () => {
    const sessionName = 'meta-session'
    const meta = {
      agentType: 'codex',
      cwd: '/home/builder/projects/demo',
      createdAt: '2026-04-08T00:00:00.000Z',
      providerContext: {
        providerId: 'codex',
        threadId: 'thread-123',
      },
      host: 'local',
    }

    await expect(readSessionMeta(sessionName)).resolves.toBeNull()
    await writeSessionMeta(sessionName, meta)
    await expect(readSessionMeta(sessionName)).resolves.toEqual(meta)

    const metaPath = join(transcriptRoot, sessionName, 'meta.json')
    const raw = await readFile(metaPath, 'utf8')
    expect(JSON.parse(raw)).toEqual(meta)
  })

  it('reads transcript tails without loading the full JSONL via readFile', async () => {
    const sessionName = 'streaming-tail-session'
    const events = [
      { type: 'message', marker: 't1-user' },
      { type: 'result', marker: 't1-result' },
      { type: 'message', marker: 't2-user' },
      { type: 'message', marker: 't2-assistant' },
      { type: 'result', marker: 't2-result' },
      { type: 'message', marker: 'partial-user' },
    ]

    for (const event of events) {
      await appendTranscriptEvent(sessionName, event)
    }

    readFileMock.mockClear()
    const tail = await readTranscriptTail(sessionName, 1)

    expect(tail).toEqual([
      events[2],
      events[3],
      events[4],
      events[5],
    ])
    expect(readFileMock).not.toHaveBeenCalled()
  })
})
