import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  useTelemetrySessions: vi.fn(),
  useTelemetrySessionDetail: vi.fn(),
  useTelemetrySummary: vi.fn(),
}))

const reactStateMock = vi.hoisted(() => ({
  selectedId: 'session-1' as string | null,
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

const detailData = {
  session: {
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
  calls: [
    {
      id: 'call-1',
      sessionId: 'session-1',
      timestamp: '2026-02-10T10:00:00.000Z',
      model: 'o3',
      inputTokens: 5,
      outputTokens: 7,
      cost: 0.42,
      durationMs: 1200,
    },
  ],
}

vi.mock('@/hooks/use-telemetry', () => ({
  useTelemetrySessions: mocks.useTelemetrySessions,
  useTelemetrySessionDetail: mocks.useTelemetrySessionDetail,
  useTelemetrySummary: mocks.useTelemetrySummary,
}))

vi.mock('recharts', async () => {
  const React = await import('react')
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

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')

  const mockedUseState = ((initialState: unknown) => {
    if (initialState === null && reactStateMock.selectedId) {
      return [reactStateMock.selectedId, vi.fn()] as unknown as ReturnType<typeof actual.useState>
    }
    return actual.useState(initialState as never)
  }) as typeof actual.useState

  return {
    ...actual,
    useState: mockedUseState,
  }
})

describe('TelemetryPage session detail token rendering', () => {
  beforeEach(() => {
    reactStateMock.selectedId = 'session-1'
    mocks.useTelemetrySessions.mockReturnValue({ data: [detailData.session], isLoading: false, error: null })
    mocks.useTelemetrySessionDetail.mockImplementation((sessionId: string | null) => ({
      data: sessionId ? detailData : null,
      isLoading: false,
      error: null,
    }))
    mocks.useTelemetrySummary.mockReturnValue({ data: summaryData, isLoading: false, error: null })
  })

  it('renders session-detail and call-level input/output token split', async () => {
    const React = await import('react')
    const { default: TelemetryPage } = await import('../page')
    const html = renderToStaticMarkup(React.createElement(TelemetryPage))

    expect(html).toContain('Cost and input/output tokens per call')
    expect(html).toContain('5 in / 7 out')
    expect(html).toContain('12 total')
  })

  it('shows telemetry detail fetch errors instead of the detail loading state', async () => {
    mocks.useTelemetrySessionDetail.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('detail endpoint unavailable'),
    })

    const React = await import('react')
    const { default: TelemetryPage } = await import('../page')
    const html = renderToStaticMarkup(React.createElement(TelemetryPage))

    expect(html).toContain('Failed to load telemetry session detail')
    expect(html).toContain('detail endpoint unavailable')
    expect(html).not.toContain('No telemetry detail found')
  })
})
