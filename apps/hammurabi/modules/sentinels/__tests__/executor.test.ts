import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SentinelExecutor } from '../executor.js'
import { SentinelStore } from '../store.js'

describe('SentinelExecutor', () => {
  let tmpDir = ''
  let store: SentinelStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sentinel-executor-'))
    store = new SentinelStore({ filePath: join(tmpDir, 'sentinels.json') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates stream sessions with explicit sentinel category metadata', async () => {
    const sentinel = await store.create({
      parentCommanderId: '11111111-1111-1111-1111-111111111111',
      name: 'email-watch',
      instruction: 'Summarize urgent messages.',
      schedule: '*/15 * * * *',
      workDir: '/tmp/example-repo',
    })

    const createSession = vi.fn(async () => ({ sessionId: 'sentinel-session-1' }))
    const monitorSession = vi.fn(async () => ({
      sessionId: 'sentinel-session-1',
      status: 'SUCCESS' as const,
      finalComment: JSON.stringify({
        action: 'Reviewed inbox',
        result: 'No urgent emails found.',
        memoryUpdated: false,
      }),
      filesChanged: 0,
      durationMin: 1,
      raw: {},
    }))

    const executor = new SentinelExecutor({
      store,
      now: () => new Date('2026-04-14T10:00:00.000Z'),
      agentSessionFactory: () => ({
        createSession,
        monitorSession,
      }),
    })

    const result = await executor.executeSentinel(sentinel.id, 'manual')
    expect(result).not.toBeNull()
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      transportType: 'stream',
      sessionType: 'sentinel',
      agentType: 'claude',
      cwd: '/tmp/example-repo',
    })
  })

  // Issue #1217: when a sentinel session terminates via a Claude `result`
  // event with `is_error: true` (e.g. 429 rate limit), the route layer now
  // surfaces a real BLOCKED completion. The executor must render this as a
  // `'failed'` history entry with the meaningful error string in `result`,
  // NOT the misleading "did not complete after 30 status checks" timeout.
  it('records a BLOCKED completion as failed with the actual error string (issue #1217)', async () => {
    const sentinel = await store.create({
      parentCommanderId: '11111111-1111-1111-1111-111111111111',
      name: 'context-hygiene',
      instruction: 'Sweep stale context.',
      schedule: '0 4 * * *',
      workDir: '/tmp/example-repo',
    })

    const createSession = vi.fn(async () => ({ sessionId: 'sentinel-session-rate-limited' }))
    const monitorSession = vi.fn(async () => ({
      sessionId: 'sentinel-session-rate-limited',
      status: 'BLOCKED' as const,
      finalComment: 'rate_limit (429)',
      filesChanged: 0,
      durationMin: 0,
      raw: {
        is_error: true,
        api_error_status: 429,
      },
    }))

    const executor = new SentinelExecutor({
      store,
      now: () => new Date('2026-04-27T04:00:00.000Z'),
      agentSessionFactory: () => ({
        createSession,
        monitorSession,
      }),
    })

    const result = await executor.executeSentinel(sentinel.id, 'cron')
    expect(result).not.toBeNull()
    expect(monitorSession).toHaveBeenCalledTimes(1)

    const updated = await store.get(sentinel.id)
    expect(updated?.history).toHaveLength(1)
    const historyEntry = updated?.history[0]
    expect(historyEntry?.result).toBe('rate_limit (429)')
    expect(historyEntry?.result).not.toMatch(/did not complete after/)
    expect(historyEntry?.sessionId).toBe('sentinel-session-rate-limited')

    const runJsonPath = store.resolveRunJsonPath(updated!, '2026-04-27T04-00-00-000Z')
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(runJsonPath, 'utf8')
    const metadata = JSON.parse(raw) as { status: string; result: string }
    expect(metadata.status).toBe('failed')
    expect(metadata.result).toBe('rate_limit (429)')
  })

  // Companion to the route-level regression: if the polling client throws
  // the misleading "did not complete after N status checks" error (which is
  // what the bug looked like before fixing the route), the executor must
  // still classify the run as `'timeout'` rather than `'failed'` — preserving
  // the existing operator-visible vocabulary for legitimate hangs.
  it('marks legitimate polling-timeout errors as timeout (no regression)', async () => {
    const sentinel = await store.create({
      parentCommanderId: '11111111-1111-1111-1111-111111111111',
      name: 'context-hygiene-hang',
      instruction: 'Sweep stale context.',
      schedule: '0 4 * * *',
      workDir: '/tmp/example-repo',
    })

    const createSession = vi.fn(async () => ({ sessionId: 'sentinel-session-hang' }))
    const monitorSession = vi.fn(async () => {
      throw new Error('Session "sentinel-session-hang" did not complete after 30 status checks')
    })

    const executor = new SentinelExecutor({
      store,
      now: () => new Date('2026-04-27T04:00:00.000Z'),
      agentSessionFactory: () => ({
        createSession,
        monitorSession,
      }),
    })

    const result = await executor.executeSentinel(sentinel.id, 'cron')
    expect(result).not.toBeNull()

    const runJsonPath = store.resolveRunJsonPath(result!.sentinel, '2026-04-27T04-00-00-000Z')
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(runJsonPath, 'utf8')
    const metadata = JSON.parse(raw) as { status: string; result: string }
    expect(metadata.status).toBe('timeout')
    expect(metadata.result).toMatch(/did not complete after 30 status checks/)
  })
})
