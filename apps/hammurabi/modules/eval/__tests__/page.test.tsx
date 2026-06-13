// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvalRunsResponse } from '../page'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import EvalPage from '../page'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let container: HTMLDivElement | null = null
let root: Root | null = null
let observedSearch = ''

const response: EvalRunsResponse = {
  runs: [
    {
      runId: 'run-1',
      bench: 'terminal-bench',
      source: 'terminal-bench',
      profile: 'smoke',
      runnerMode: 'api-key',
      authMode: 'api-key',
      status: 'completed',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:05:00.000Z',
      rootPath: '/tmp/run-1',
      configPath: '/tmp/run-1/config.json',
      resultPath: '/tmp/run-1/result.json',
      summaryPath: '/tmp/run-1/summary.md',
      trajectoriesPath: '/tmp/run-1/trajectories.jsonl',
      leaderboardPath: '/tmp/run-1/leaderboard.json',
      passRate: 1,
      costUsd: 0.1,
      failures: [],
      tasks: [],
      telemetryMetadata: {
        source: 'terminal-bench',
        run_id: 'run-1',
        bench: 'terminal-bench',
        runner_mode: 'api-key',
      },
      leaderboard: {
        status: 'not-submitted',
        updatedAt: '2026-06-10T00:05:00.000Z',
      },
    },
  ],
  filters: {
    sources: ['terminal-bench', 'locomo'],
    benches: ['terminal-bench', 'locomo'],
    runnerModes: ['api-key', 'subscription-host-cli'],
  },
}

function LocationProbe() {
  observedSearch = useLocation().search
  return null
}

async function renderEvalPage(initialEntry = '/eval'): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/eval"
            element={(
              <>
                <EvalPage />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

function getSelects(): HTMLSelectElement[] {
  return Array.from(document.body.querySelectorAll<HTMLSelectElement>('select'))
}

beforeEach(() => {
  previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  observedSearch = ''
  mocks.fetchJson.mockResolvedValue(response)
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  }
  container?.remove()
  document.body.innerHTML = ''
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  vi.clearAllMocks()
})

describe('EvalPage filters', () => {
  it('reads filters from URL search params and fetches the filtered runs path', async () => {
    await renderEvalPage('/eval?source=terminal-bench&bench=terminal-bench&runner_mode=api-key')

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        '/api/eval/runs?source=terminal-bench&bench=terminal-bench&runner_mode=api-key',
      )
    })

    const [sourceSelect, benchSelect, runnerSelect] = getSelects()
    expect(sourceSelect.value).toBe('terminal-bench')
    expect(benchSelect.value).toBe('terminal-bench')
    expect(runnerSelect.value).toBe('api-key')
  })

  it('writes filter changes to URL search params while preserving all-filter defaults', async () => {
    await renderEvalPage()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/eval/runs')
    })

    const [, benchSelect] = getSelects()
    await changeSelect(benchSelect, 'locomo')

    await vi.waitFor(() => {
      expect(observedSearch).toBe('?bench=locomo')
    })
    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith('/api/eval/runs?bench=locomo')
    })

    await changeSelect(benchSelect, 'all')

    await vi.waitFor(() => {
      expect(observedSearch).toBe('')
    })
    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/eval/runs')
  })

  it('uses a horizontal scroll wrapper for the runs table', async () => {
    await renderEvalPage()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('run-1')
    })

    const wrapper = document.body.querySelector('[data-testid="eval-runs-table-scroll"]')
    const table = wrapper?.querySelector('table')

    expect(wrapper?.className).toContain('overflow-x-auto')
    expect(wrapper?.className).not.toContain('overflow-hidden')
    expect(table?.className).toContain('min-w-[900px]')
  })
})
