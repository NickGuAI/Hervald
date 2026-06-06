import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TelemetryJsonlStore, type TelemetryStoreEntry } from '../store'

const testDirectories: string[] = []

async function createTempStoreFilePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-telemetry-store-'))
  testDirectories.push(directory)
  return path.join(directory, 'events.jsonl')
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('TelemetryJsonlStore', () => {
  it('returns an empty list when the JSONL file is missing', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    const entries = await store.load()

    expect(entries).toEqual([])
  })

  it('appends and reloads telemetry entries', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    await store.append({
      type: 'ingest',
      recordedAt: '2026-02-10T10:00:00.000Z',
      payload: {
        id: 'call-1',
        sessionId: 'session-1',
        agentName: 'codex',
        model: 'o3',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0123,
        durationMs: 1200,
        currentTask: 'Testing',
        timestamp: '2026-02-10T10:00:00.000Z',
      },
    })

    await store.append({
      type: 'heartbeat',
      recordedAt: '2026-02-10T10:00:05.000Z',
      payload: {
        sessionId: 'session-1',
        currentTask: 'Still testing',
        completed: false,
        timestamp: '2026-02-10T10:00:05.000Z',
      },
    })

    const entries = await store.load()

    expect(entries).toHaveLength(2)
    expect(entries[0]?.type).toBe('ingest')
    expect(entries[1]?.type).toBe('heartbeat')
  })

  it('ignores malformed JSONL rows and keeps valid entries', async () => {
    const filePath = await createTempStoreFilePath()
    await writeFile(
      filePath,
      [
        '{"type":"ingest","recordedAt":"2026-02-10T10:00:00.000Z","payload":{"id":"call-1","sessionId":"s1","agentName":"codex","model":"o3","provider":"openai","inputTokens":1,"outputTokens":2,"cost":0.1,"durationMs":1000,"currentTask":"run","timestamp":"2026-02-10T10:00:00.000Z"}}',
        'this-is-not-json',
        '{"type":"heartbeat","recordedAt":"2026-02-10T10:01:00.000Z","payload":{"sessionId":"s1","completed":true,"timestamp":"2026-02-10T10:01:00.000Z"}}',
      ].join('\n'),
      'utf8',
    )

    const store = new TelemetryJsonlStore(filePath)
    const entries = await store.load()

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.type)).toEqual(['ingest', 'heartbeat'])
  })
})

describe('TelemetryJsonlStore.compact()', () => {
  it('removes entries older than retentionDays', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T00:00:00.000Z'))

    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)
    const now = Date.now()
    const oldRecordedAt = new Date(now - (30 * 24 * 60 * 60 * 1000)).toISOString()
    const recentRecordedAt = new Date(now - (24 * 60 * 60 * 1000)).toISOString()

    const old: TelemetryStoreEntry = {
      type: 'ingest',
      recordedAt: oldRecordedAt,
      payload: {
        id: 'old-1',
        sessionId: 's1',
        agentName: 'codex',
        model: 'o3',
        provider: 'openai',
        inputTokens: 1,
        outputTokens: 1,
        cost: 0.01,
        durationMs: 100,
        currentTask: 'old task',
        timestamp: oldRecordedAt,
      },
    }
    const recent: TelemetryStoreEntry = {
      type: 'ingest',
      recordedAt: recentRecordedAt,
      payload: {
        id: 'new-1',
        sessionId: 's2',
        agentName: 'claude',
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.05,
        durationMs: 200,
        currentTask: 'new task',
        timestamp: recentRecordedAt,
      },
    }

    await store.append(old)
    await store.append(recent)

    await store.compact(14)

    const kept = await store.load()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.payload).toMatchObject({ id: 'new-1' })
  })

  it('no-ops gracefully when the file does not exist', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)
    await expect(store.compact(14)).resolves.toBeUndefined()
  })

  it('keeps all entries when all are within retention window', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    // Use today's date minus 1 day so everything is within 14-day window
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const recentISO = yesterday.toISOString()

    await store.append({
      type: 'heartbeat',
      recordedAt: recentISO,
      payload: { sessionId: 'x', completed: false, timestamp: recentISO },
    })

    await store.compact(14)

    const kept = await store.load()
    expect(kept).toHaveLength(1)
  })

  it('rolls up retained local ingest entries during compaction', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'))

    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    await store.append({
      type: 'ingest',
      recordedAt: '2026-05-29T10:00:00.000Z',
      payload: {
        id: 'local-1',
        sessionId: 'local-session',
        agentName: 'codex-local',
        model: 'gpt-5.5',
        provider: 'codex-local',
        inputTokens: 100,
        outputTokens: 25,
        cost: 0.01,
        durationMs: 100,
        currentTask: 'Local scan',
        timestamp: '2026-05-29T10:00:00.000Z',
      },
    })
    await store.append({
      type: 'ingest',
      recordedAt: '2026-05-29T10:01:00.000Z',
      payload: {
        id: 'local-2',
        sessionId: 'local-session',
        agentName: 'codex-local',
        model: 'gpt-5.5',
        provider: 'codex-local',
        inputTokens: 300,
        outputTokens: 75,
        cost: 0.03,
        durationMs: 300,
        currentTask: 'Local scan',
        timestamp: '2026-05-29T10:01:00.000Z',
      },
    })
    await store.append({
      type: 'ingest',
      recordedAt: '2026-05-29T10:02:00.000Z',
      payload: {
        id: 'remote-1',
        sessionId: 'remote-session',
        agentName: 'codex',
        model: 'o3',
        provider: 'openai',
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.001,
        durationMs: 10,
        currentTask: 'Remote call',
        timestamp: '2026-05-29T10:02:00.000Z',
      },
    })
    await store.append({
      type: 'otel_log',
      recordedAt: '2026-05-29T10:03:00.000Z',
      payload: {
        signal: 'logs',
        resource: {},
        eventName: 'codex.user_prompt',
        attributes: {},
        normalized: {
          id: 'zero-otel',
          sessionId: 'prompt-only',
          agentName: 'codex',
          model: 'gpt-5.5',
          provider: 'openai',
          signal: 'logs',
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          durationMs: 0,
          currentTask: 'Working',
          timestamp: '2026-05-29T10:03:00.000Z',
          eventName: 'codex.user_prompt',
        },
      },
    })

    await store.compact(90)

    const kept = await store.load()
    expect(kept).toHaveLength(2)
    const local = kept.find((entry) =>
      entry.type === 'ingest' && entry.payload.agentName === 'codex-local',
    )
    const remote = kept.find((entry) =>
      entry.type === 'ingest' && entry.payload.agentName === 'codex',
    )
    expect(local).toMatchObject({
      type: 'ingest',
      payload: {
        id: 'local-rollup:2026-05-29:local-session:codex-local:gpt-5.5:codex-local',
        sessionId: 'local-session',
        inputTokens: 400,
        outputTokens: 100,
        cost: 0.04,
        durationMs: 400,
        timestamp: '2026-05-29T10:01:00.000Z',
      },
    })
    expect(remote).toMatchObject({
      type: 'ingest',
      payload: {
        id: 'remote-1',
      },
    })
  })

  it('skips compaction when the file exceeds maxBytes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T00:00:00.000Z'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)
    const oldRecordedAt = '2026-01-01T00:00:00.000Z'

    await store.append({
      type: 'heartbeat',
      recordedAt: oldRecordedAt,
      payload: { sessionId: 'oversized', completed: false, timestamp: oldRecordedAt },
    })

    await store.compact(14, { maxBytes: 1 })

    const kept = await store.load()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.payload).toMatchObject({ sessionId: 'oversized' })
    await expect(stat(`${filePath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping compact'))
  })
})

describe('TelemetryJsonlStore.stream()', () => {
  it('yields no entries when the JSONL file is missing', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    const entries: TelemetryStoreEntry[] = []
    for await (const entry of store.stream()) {
      entries.push(entry)
    }

    expect(entries).toEqual([])
  })

  it('streams entries matching load() output', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    await store.append({
      type: 'ingest',
      recordedAt: '2026-02-10T10:00:00.000Z',
      payload: {
        id: 'call-1',
        sessionId: 'session-1',
        agentName: 'codex',
        model: 'o3',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0123,
        durationMs: 1200,
        currentTask: 'Testing',
        timestamp: '2026-02-10T10:00:00.000Z',
      },
    })

    await store.append({
      type: 'heartbeat',
      recordedAt: '2026-02-10T10:00:05.000Z',
      payload: {
        sessionId: 'session-1',
        currentTask: 'Still testing',
        completed: false,
        timestamp: '2026-02-10T10:00:05.000Z',
      },
    })

    const streamed: TelemetryStoreEntry[] = []
    for await (const entry of store.stream()) {
      streamed.push(entry)
    }

    const loaded = await store.load()

    expect(streamed).toEqual(loaded)
  })

  it('skips malformed lines when streaming', async () => {
    const filePath = await createTempStoreFilePath()
    await writeFile(
      filePath,
      [
        '{"type":"ingest","recordedAt":"2026-02-10T10:00:00.000Z","payload":{"id":"call-1","sessionId":"s1","agentName":"codex","model":"o3","provider":"openai","inputTokens":1,"outputTokens":2,"cost":0.1,"durationMs":1000,"currentTask":"run","timestamp":"2026-02-10T10:00:00.000Z"}}',
        'this-is-not-json',
        '{"type":"heartbeat","recordedAt":"2026-02-10T10:01:00.000Z","payload":{"sessionId":"s1","completed":true,"timestamp":"2026-02-10T10:01:00.000Z"}}',
      ].join('\n'),
      'utf8',
    )

    const store = new TelemetryJsonlStore(filePath)
    const entries: TelemetryStoreEntry[] = []
    for await (const entry of store.stream()) {
      entries.push(entry)
    }

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.type)).toEqual(['ingest', 'heartbeat'])
  })

  it('skips streaming when the file exceeds maxBytes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    await store.append({
      type: 'heartbeat',
      recordedAt: '2026-02-10T10:00:05.000Z',
      payload: {
        sessionId: 'session-1',
        completed: false,
        timestamp: '2026-02-10T10:00:05.000Z',
      },
    })

    const entries: TelemetryStoreEntry[] = []
    for await (const entry of store.stream({ maxBytes: 1 })) {
      entries.push(entry)
    }

    expect(entries).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping stream'))
  })

  it('allows callers to disable the stream size guard', async () => {
    const filePath = await createTempStoreFilePath()
    const store = new TelemetryJsonlStore(filePath)

    await store.append({
      type: 'heartbeat',
      recordedAt: '2026-02-10T10:00:05.000Z',
      payload: {
        sessionId: 'session-1',
        completed: false,
        timestamp: '2026-02-10T10:00:05.000Z',
      },
    })

    const entries: TelemetryStoreEntry[] = []
    for await (const entry of store.stream({ maxBytes: 0 })) {
      entries.push(entry)
    }

    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe('heartbeat')
  })
})
