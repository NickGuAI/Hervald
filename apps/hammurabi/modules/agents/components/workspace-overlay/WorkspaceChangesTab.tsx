import { Check, GitBranch, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceGitStatus, WorkspaceTreeNode } from '../../../workspace/types'

interface WorkspaceChangesTabProps {
  gitStatus: WorkspaceGitStatus | undefined
  error: unknown
  isLoading: boolean
  addedPaths: Set<string>
  onAddPath: (path: string, knownType?: WorkspaceTreeNode['type']) => void
}

export function WorkspaceChangesTab({
  gitStatus,
  error,
  isLoading,
  addedPaths,
  onAddPath,
}: WorkspaceChangesTabProps) {
  return (
    <div className="h-full min-h-[200px] overflow-y-auto">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-sm text-sumi-diluted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading git status...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-accent-vermillion/30 bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
          {error instanceof Error ? error.message : 'Failed to load git status'}
        </div>
      ) : gitStatus && !gitStatus.enabled ? (
        <div className="flex flex-col items-center justify-center py-8 text-sm text-sumi-diluted">
          <GitBranch size={18} className="mb-2" />
          Git is not initialized
        </div>
      ) : gitStatus ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-sumi-diluted">
            <GitBranch size={12} />
            <span className="font-mono">{gitStatus.branch ?? 'detached'}</span>
            {gitStatus.ahead > 0 && (
              <span className="text-emerald-600">+{gitStatus.ahead}</span>
            )}
            {gitStatus.behind > 0 && (
              <span className="text-accent-vermillion">-{gitStatus.behind}</span>
            )}
          </div>
          {gitStatus.entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-sumi-diluted">
              Working tree clean
            </p>
          ) : (
            <div className="space-y-1">
              {gitStatus.entries.map((entry) => {
                const isAdded = addedPaths.has(entry.path)

                return (
                  <div
                    key={entry.path}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                      isAdded ? 'bg-emerald-50' : 'hover:bg-ink-wash',
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 shrink-0 text-center font-mono text-[10px]',
                        entry.code.includes('M') && 'text-amber-500',
                        entry.code.includes('A') && 'text-emerald-500',
                        entry.code.includes('D') && 'text-accent-vermillion',
                        entry.code.includes('?') && 'text-sumi-mist',
                      )}
                    >
                      {entry.code.trim()}
                    </span>
                    <span className="truncate font-mono text-sumi-gray">
                      {entry.path}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                        isAdded
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'text-sumi-diluted hover:bg-ink-wash',
                      )}
                      onClick={() => onAddPath(entry.path, 'file')}
                      aria-label={isAdded ? `Added ${entry.path}` : `Add ${entry.path} to context`}
                    >
                      {isAdded ? <Check size={11} /> : <Plus size={11} />}
                      {isAdded ? 'Added' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
