import { GitBranch, GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceGitLog, WorkspaceGitStatus } from '../types'

interface WorkspaceGitPanelProps {
  status: WorkspaceGitStatus | null
  log: WorkspaceGitLog | null
  loading?: boolean
  error?: string | null
  readOnly?: boolean
  onInit?: () => void
  initializing?: boolean
  variant?: 'light' | 'dark'
}

export function WorkspaceGitPanel({
  status,
  log,
  loading = false,
  error,
  readOnly = false,
  onInit,
  initializing = false,
}: WorkspaceGitPanelProps) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--hv-fg-subtle)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading Git status…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
        {error}
      </div>
    )
  }

  if (!status || !log) {
    return null
  }

  if (!status.enabled) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center',
          'border-[color:var(--hv-border-hair)] text-[color:var(--hv-fg-subtle)]',
        )}
      >
        <GitBranch size={18} className="mb-3" />
        <p className="text-sm">Git is not initialized for this workspace</p>
        {!readOnly && onInit && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--hv-border-hair)] px-3 py-1.5 text-xs hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
            onClick={onInit}
            disabled={initializing}
          >
            {initializing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Initialize Git
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]">
        <header className="shrink-0 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2">
          <p className="section-title flex items-center gap-2">
            <GitBranch size={13} />
            Pending Changes
          </p>
          <p className="mt-1 font-mono text-xs text-[color:var(--hv-fg-subtle)]">
            {status.branch ?? 'detached'} • +{status.ahead} / -{status.behind}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3 space-y-2">
          {status.entries.length === 0 ? (
            <p className="text-sm text-[color:var(--hv-fg-subtle)]">Working tree is clean.</p>
          ) : (
            status.entries.map((entry) => (
              <div key={`${entry.code}:${entry.path}`} className="rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2">
                <p className="font-mono text-xs text-[color:var(--hv-fg)]">{entry.path}</p>
                <p className="mt-1 text-whisper text-[color:var(--hv-fg-subtle)]">status: {entry.code}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]">
        <header className="shrink-0 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2">
          <p className="section-title flex items-center gap-2">
            <GitCommitHorizontal size={13} />
            Recent Commits
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3 space-y-2">
          {log.commits.length === 0 ? (
            <p className="text-sm text-[color:var(--hv-fg-subtle)]">No commits yet.</p>
          ) : (
            log.commits.map((commit) => (
              <div key={commit.hash} className="rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2">
                <p className="font-mono text-xs text-[color:var(--hv-fg)]">{commit.shortHash}</p>
                <p className="mt-1 text-sm text-[color:var(--hv-fg-muted)]">{commit.subject}</p>
                <p className="mt-1 text-whisper text-[color:var(--hv-fg-subtle)]">
                  {commit.author} • {new Date(commit.authoredAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
