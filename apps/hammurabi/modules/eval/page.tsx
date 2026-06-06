import { useEffect, useMemo, useState } from 'react'
import { Activity, FileText, RefreshCw } from 'lucide-react'
import { fetchJson } from '@/lib/api'
import {
  EVAL_BENCHES,
  EVAL_RUNNER_MODES,
  type EvalBench,
  type EvalRunManifest,
  type EvalRunnerMode,
} from './types'

interface EvalRunsResponse {
  runs: EvalRunManifest[]
  filters?: {
    sources?: string[]
    benches?: EvalBench[]
    runnerModes?: EvalRunnerMode[]
  }
}

type FilterValue = 'all' | string

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

function formatCost(value: number | undefined): string {
  return typeof value === 'number' ? `$${value.toFixed(4)}` : '-'
}

function buildRunsPath(filters: {
  source: FilterValue
  bench: FilterValue
  runnerMode: FilterValue
}): string {
  const params = new URLSearchParams()
  if (filters.source !== 'all') params.set('source', filters.source)
  if (filters.bench !== 'all') params.set('bench', filters.bench)
  if (filters.runnerMode !== 'all') params.set('runner_mode', filters.runnerMode)
  const query = params.toString()
  return `/api/eval/runs${query ? `?${query}` : ''}`
}

export default function EvalPage() {
  const [source, setSource] = useState<FilterValue>('all')
  const [bench, setBench] = useState<FilterValue>('all')
  const [runnerMode, setRunnerMode] = useState<FilterValue>('all')
  const [data, setData] = useState<EvalRunsResponse>({ runs: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const path = useMemo(
    () => buildRunsPath({ source, bench, runnerMode }),
    [source, bench, runnerMode],
  )

  const loadRuns = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchJson<EvalRunsResponse>(path))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load eval runs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRuns()
  }, [path])

  const sourceOptions = useMemo(
    () => [...new Set(data.filters?.sources ?? data.runs.map((run) => run.source))].sort(),
    [data],
  )

  return (
    <main className="flex h-full min-h-0 flex-col gap-4 overflow-auto px-5 py-5">
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-sumi-ink/10 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-sumi-black">Eval Runs</h1>
          <p className="text-sm text-sumi-diluted">
            Benchmark Commander manifests and runner-safe result artifacts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRuns()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-sumi-ink/15 bg-washi-white px-3 text-sm text-sumi-black transition-colors hover:bg-sumi-mist/30"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </section>

      <section className="grid gap-3 border-b border-sumi-ink/10 pb-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-sumi-diluted">
          Source
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="h-10 rounded-md border border-sumi-ink/15 bg-washi-white px-3 text-sm text-sumi-black"
          >
            <option value="all">All sources</option>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-sumi-diluted">
          Benchmark
          <select
            value={bench}
            onChange={(event) => setBench(event.target.value)}
            className="h-10 rounded-md border border-sumi-ink/15 bg-washi-white px-3 text-sm text-sumi-black"
          >
            <option value="all">All benchmarks</option>
            {EVAL_BENCHES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-sumi-diluted">
          Runner
          <select
            value={runnerMode}
            onChange={(event) => setRunnerMode(event.target.value)}
            className="h-10 rounded-md border border-sumi-ink/15 bg-washi-white px-3 text-sm text-sumi-black"
          >
            <option value="all">All runners</option>
            {EVAL_RUNNER_MODES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </section>

      {error ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </section>
      ) : null}

      <section className="min-h-0 overflow-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-sumi-diluted">
            Loading eval runs
          </div>
        ) : data.runs.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-sumi-diluted">
            No eval runs match the selected filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-sumi-ink/10 bg-washi-white">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead className="bg-sumi-mist/25 text-xs uppercase tracking-normal text-sumi-diluted">
                <tr>
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Benchmark</th>
                  <th className="px-4 py-3 font-medium">Runner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Pass</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Artifacts</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.runId} className="border-t border-sumi-ink/10">
                    <td className="px-4 py-3">
                      <div className="font-medium text-sumi-black">{run.runId}</div>
                      <div className="text-xs text-sumi-diluted">{run.createdAt}</div>
                    </td>
                    <td className="px-4 py-3 text-sumi-black">{run.bench}</td>
                    <td className="px-4 py-3 text-sumi-black">{run.runnerMode}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-md border border-sumi-ink/10 px-2 py-1 text-xs text-sumi-black">
                        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sumi-black">{formatPercent(run.passRate)}</td>
                    <td className="px-4 py-3 text-sumi-black">{formatCost(run.costUsd)}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`/api/eval/report/${encodeURIComponent(run.runId)}?format=markdown`}
                        className="inline-flex items-center gap-1 text-sumi-black underline decoration-sumi-ink/30 underline-offset-4 hover:decoration-sumi-ink"
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        summary
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
