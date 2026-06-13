import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  useTelemetrySessions: vi.fn(),
  useTelemetrySessionDetail: vi.fn(),
  useTelemetrySummary: vi.fn(),
}))

const summaryData = {
  costToday: 0.5,
  costWeek: 2,
  costMonth: 4,
  inputTokensToday: 200,
  inputTokensWeek: 500,
  inputTokensMonth: 1000,
  outputTokensToday: 100,
  outputTokensWeek: 300,
  outputTokensMonth: 600,
  totalTokensToday: 300,
  totalTokensWeek: 800,
  totalTokensMonth: 1600,
  activeSessions: 1,
  totalSessions: 1,
  topModels: [{ model: 'o3', cost: 4, calls: 2 }],
  topAgents: [{ agent: 'codex', cost: 4, sessions: 1 }],
  dailyCosts: [{ date: '2026-02-10', costUsd: 2 }],
}

const sessionsData = [
  {
    id: 'session-1',
    agentName: 'codex',
    model: 'o3',
    currentTask: 'Token split rendering',
    status: 'active' as const,
    startedAt: '2026-02-10T09:00:00.000Z',
    lastHeartbeat: '2026-02-10T10:00:00.000Z',
    totalCost: 2,
    totalTokens: 12,
    inputTokens: 5,
    outputTokens: 7,
    callCount: 1,
  },
]

vi.mock('@/hooks/use-telemetry', () => ({
  useTelemetrySessions: mocks.useTelemetrySessions,
  useTelemetrySessionDetail: mocks.useTelemetrySessionDetail,
  useTelemetrySummary: mocks.useTelemetrySummary,
}))

vi.mock('recharts', () => {
  const Mock = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)

  return {
    ComposedChart: Mock,
    Area: Mock,
    AreaChart: Mock,
    Line: Mock,
    PieChart: Mock,
    Pie: Mock,
    Cell: Mock,
    XAxis: Mock,
    YAxis: Mock,
    Tooltip: Mock,
    ResponsiveContainer: Mock,
  }
})

import TelemetryPage from '../page'

describe('TelemetryPage token usage rendering', () => {
  beforeEach(() => {
    mocks.useTelemetrySessions.mockReturnValue({
      data: sessionsData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.useTelemetrySessionDetail.mockReturnValue({ data: null, isLoading: false, error: null })
    mocks.useTelemetrySummary.mockReturnValue({
      data: summaryData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it('shows token summary cards and session input/output split', () => {
    const html = renderToStaticMarkup(React.createElement(TelemetryPage))

    expect(html).toContain('Tokens today')
    expect(html).toContain('Tokens this week')
    expect(html).toContain('Tokens this month')
    expect(html).toContain('In 200 / Out 100')
    expect(html).toContain('In 5 / Out 7')
  })

  it('shows telemetry summary fetch errors instead of a loading or empty state', () => {
    mocks.useTelemetrySummary.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('summary endpoint unavailable'),
      refetch: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(TelemetryPage))

    expect(html).toContain('Failed to load telemetry summary')
    expect(html).toContain('summary endpoint unavailable')
    expect(html).toContain('Retry')
    expect(html).not.toContain('No telemetry summary yet')
  })

  it('shows telemetry sessions fetch errors instead of an empty sessions list', () => {
    mocks.useTelemetrySessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('sessions endpoint unavailable'),
      refetch: vi.fn(),
    })

    const html = renderToStaticMarkup(React.createElement(TelemetryPage))

    expect(html).toContain('Failed to load telemetry sessions')
    expect(html).toContain('sessions endpoint unavailable')
    expect(html).toContain('Retry')
    expect(html).not.toContain('No telemetry sessions yet')
  })
})
