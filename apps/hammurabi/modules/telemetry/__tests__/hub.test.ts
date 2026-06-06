import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TelemetryHub } from '../hub'
import { TelemetryJsonlStore } from '../store'

const tempDirectories: string[] = []

async function createHub(now: () => Date): Promise<TelemetryHub> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-telemetry-hub-'))
  tempDirectories.push(directory)
  const storeFilePath = path.join(directory, 'events.jsonl')
  const store = new TelemetryJsonlStore(storeFilePath)
  return new TelemetryHub({ store, now })
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  )
})

describe('TelemetryHub summary token aggregates', () => {
  it('computes today/week/month token aggregates using UTC windows', async () => {
    const now = new Date('2026-02-10T10:00:00.000Z')
    const hub = await createHub(() => now)

    await hub.ingest({
      sessionId: 's-old',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
      cost: 1,
      durationMs: 1000,
      currentTask: 'prior day',
      timestamp: new Date('2026-02-08T23:30:00.000Z'),
    })

    await hub.ingest({
      sessionId: 's-new',
      agentName: 'codex',
      model: 'o3',
      provider: 'openai',
      inputTokens: 200,
      outputTokens: 100,
      cost: 2,
      durationMs: 1000,
      currentTask: 'current week',
      timestamp: new Date('2026-02-10T09:00:00.000Z'),
    })

    const summary = await hub.getSummary(now)

    expect(summary.costToday).toBe(2)
    expect(summary.costWeek).toBe(2)
    expect(summary.costMonth).toBe(3)
    expect(summary.inputTokensToday).toBe(200)
    expect(summary.inputTokensWeek).toBe(200)
    expect(summary.inputTokensMonth).toBe(300)
    expect(summary.outputTokensToday).toBe(100)
    expect(summary.outputTokensWeek).toBe(100)
    expect(summary.outputTokensMonth).toBe(150)
    expect(summary.totalTokensToday).toBe(300)
    expect(summary.totalTokensWeek).toBe(300)
    expect(summary.totalTokensMonth).toBe(450)
  })

  it('restores local telemetry as bounded daily rollups instead of per-event calls', async () => {
    const now = new Date('2026-05-29T12:00:00.000Z')
    const directory = await mkdtemp(path.join(tmpdir(), 'hammurabi-telemetry-hub-'))
    tempDirectories.push(directory)
    const store = new TelemetryJsonlStore(path.join(directory, 'events.jsonl'))

    await store.append({
      type: 'ingest',
      recordedAt: '2026-05-29T10:00:00.000Z',
      payload: {
        id: 'call-1',
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
        id: 'call-2',
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
      type: 'otel_log',
      recordedAt: '2026-05-29T10:02:00.000Z',
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
          timestamp: '2026-05-29T10:02:00.000Z',
          eventName: 'codex.user_prompt',
        },
      },
    })

    const hub = new TelemetryHub({ store, now: () => now })
    await hub.ensureReady()

    const detail = hub.getSessionDetail('local-session')
    expect(detail?.session.callCount).toBe(2)
    expect(detail?.session.inputTokens).toBe(400)
    expect(detail?.session.outputTokens).toBe(100)
    expect(detail?.session.totalCost).toBe(0.04)
    expect(detail?.calls).toHaveLength(1)
    expect(detail?.calls[0]).toMatchObject({
      id: 'local-rollup:2026-05-29:local-session:codex-local:gpt-5.5:codex-local',
      inputTokens: 400,
      outputTokens: 100,
      cost: 0.04,
      callCount: 2,
    })

    const summary = await hub.getSummary(now)
    expect(summary.costToday).toBe(0.04)
    expect(summary.inputTokensToday).toBe(400)
    expect(summary.outputTokensToday).toBe(100)
    expect(summary.topModels).toEqual([
      {
        model: 'gpt-5.5',
        cost: 0.04,
        calls: 2,
      },
    ])
    expect(hub.getSessionDetail('prompt-only')).toBeNull()
  })
})

describe('TelemetryHub topModels and topAgents period filtering', () => {
  it('filters topModels by period range', async () => {
    const now = new Date('2026-03-15T12:00:00.000Z')
    const hub = await createHub(() => now)

    // January call — outside March period
    await hub.ingest({
      sessionId: 's-jan',
      agentName: 'claude',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
      cost: 5,
      durationMs: 1000,
      currentTask: 'january work',
      timestamp: new Date('2026-01-15T10:00:00.000Z'),
    })

    // March call — inside March period
    await hub.ingest({
      sessionId: 's-mar',
      agentName: 'codex',
      model: 'gpt-5.turbo',
      provider: 'openai',
      inputTokens: 200,
      outputTokens: 100,
      cost: 2,
      durationMs: 1000,
      currentTask: 'march work',
      timestamp: new Date('2026-03-10T10:00:00.000Z'),
    })

    // Default period is current month (March 2026)
    const summary = await hub.getSummary(now)

    // topModels should only include March calls
    expect(summary.topModels).toHaveLength(1)
    expect(summary.topModels[0].model).toBe('gpt-5.turbo')
    expect(summary.topModels[0].cost).toBe(2)

    // topAgents should only include the March agent
    expect(summary.topAgents).toHaveLength(1)
    expect(summary.topAgents[0].agent).toBe('codex')
    expect(summary.topAgents[0].cost).toBe(2)
    expect(summary.topAgents[0].sessions).toBe(1)
  })

  it('includes all data when period spans entire range', async () => {
    const now = new Date('2026-03-15T12:00:00.000Z')
    const hub = await createHub(() => now)

    await hub.ingest({
      sessionId: 's-jan',
      agentName: 'claude',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
      cost: 5,
      durationMs: 1000,
      currentTask: 'january work',
      timestamp: new Date('2026-01-15T10:00:00.000Z'),
    })

    await hub.ingest({
      sessionId: 's-mar',
      agentName: 'codex',
      model: 'gpt-5.turbo',
      provider: 'openai',
      inputTokens: 200,
      outputTokens: 100,
      cost: 2,
      durationMs: 1000,
      currentTask: 'march work',
      timestamp: new Date('2026-03-10T10:00:00.000Z'),
    })

    // 90-day period should include both
    const summary = await hub.getSummary(
      { period: '90d', startKey: '2025-12-16', endKey: '2026-03-15' },
      now,
    )

    expect(summary.topModels).toHaveLength(2)
    expect(summary.topAgents).toHaveLength(2)
    const totalModelCost = summary.topModels.reduce((sum, m) => sum + m.cost, 0)
    expect(totalModelCost).toBe(7)
  })

  it('counts sessions per agent correctly in period', async () => {
    const now = new Date('2026-03-15T12:00:00.000Z')
    const hub = await createHub(() => now)

    // Two sessions for same agent in March
    await hub.ingest({
      sessionId: 's-mar-1',
      agentName: 'claude',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      inputTokens: 100,
      outputTokens: 50,
      cost: 1,
      durationMs: 500,
      currentTask: 'task 1',
      timestamp: new Date('2026-03-05T10:00:00.000Z'),
    })

    await hub.ingest({
      sessionId: 's-mar-2',
      agentName: 'claude',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      inputTokens: 100,
      outputTokens: 50,
      cost: 1,
      durationMs: 500,
      currentTask: 'task 2',
      timestamp: new Date('2026-03-06T10:00:00.000Z'),
    })

    const summary = await hub.getSummary(now)
    expect(summary.topAgents).toHaveLength(1)
    expect(summary.topAgents[0].agent).toBe('claude')
    expect(summary.topAgents[0].cost).toBe(2)
    expect(summary.topAgents[0].sessions).toBe(2)
  })
})
