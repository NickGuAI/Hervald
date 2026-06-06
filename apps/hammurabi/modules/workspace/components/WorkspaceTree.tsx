import { Check, ChevronRight, Download, FileText, Folder, FolderOpen, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceTreeNode } from '../types'

interface WorkspaceTreeProps {
  nodesByParent: Record<string, WorkspaceTreeNode[]>
  expandedPaths: Set<string>
  loadingPaths: Set<string>
  addedPaths?: Set<string>
  selectedPath: string | null
  variant?: 'light' | 'dark'
  onSelectPath: (path: string) => void
  onToggleDirectory: (path: string) => void
  onAddPath?: (path: string, knownType?: WorkspaceTreeNode['type']) => void
  onDownloadPath?: (path: string, knownType?: WorkspaceTreeNode['type']) => void
  downloadingPath?: string | null
  selectDirectoriesOnClick?: boolean
}

function TreeBranch({
  parentPath,
  depth,
  nodesByParent,
  expandedPaths,
  loadingPaths,
  addedPaths,
  selectedPath,
  variant = 'light',
  onSelectPath,
  onToggleDirectory,
  onAddPath,
  onDownloadPath,
  downloadingPath,
  selectDirectoriesOnClick = true,
}: WorkspaceTreeProps & {
  parentPath: string
  depth: number
}) {
  const nodes = nodesByParent[parentPath] ?? []
  const dark = variant === 'dark'

  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.type === 'directory'
        const isExpanded = expandedPaths.has(node.path)
        const isSelected = selectedPath === node.path
        const isLoading = loadingPaths.has(node.path)
        const isAdded = addedPaths?.has(node.path) ?? false
        const isDownloading = downloadingPath === node.path

        return (
          <div key={node.path}>
            <div className="flex w-full items-center gap-1">
              <button
                type="button"
                className={cn(
                  'flex-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                  dark
                    ? 'hover:bg-white/[0.06]'
                    : 'hover:bg-[var(--hv-surface-hover)]',
                  isSelected && (dark ? 'bg-white/[0.08]' : 'bg-[var(--hv-surface-selected)]'),
                  isAdded && 'ring-1 ring-[color:var(--hv-accent-success)]',
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => {
                  if (isDirectory) {
                    if (selectDirectoriesOnClick) {
                      onSelectPath(node.path)
                    }
                    onToggleDirectory(node.path)
                    return
                  }
                  onSelectPath(node.path)
                }}
              >
                {isDirectory ? (
                  <>
                    <ChevronRight
                      size={12}
                      className={cn(
                        'shrink-0 transition-transform',
                        dark ? 'text-[color:var(--hv-fg)]' : 'text-[color:var(--hv-fg-faint)]',
                        isExpanded && 'rotate-90',
                      )}
                    />
                    {isExpanded ? (
                      <FolderOpen size={13} className={dark ? 'text-[color:var(--hv-fg)]' : 'text-[color:var(--hv-fg-subtle)]'} />
                    ) : (
                      <Folder size={13} className={dark ? 'text-[color:var(--hv-fg)]' : 'text-[color:var(--hv-fg-subtle)]'} />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    <FileText size={13} className={dark ? 'text-[color:var(--hv-fg)]' : 'text-[color:var(--hv-fg-subtle)]'} />
                  </>
                )}
                <span className={cn('font-mono truncate', dark ? 'text-[color:var(--hv-fg)]' : 'text-[color:var(--hv-fg-muted)]')}>
                  {node.name}
                </span>
              </button>

              {onAddPath && (
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                    isAdded
                      ? 'text-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] hover:bg-[var(--hv-accent-success-wash)]'
                      : 'text-[color:var(--hv-fg-subtle)] hover:bg-[var(--hv-surface-hover)]',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddPath(node.path, node.type)
                  }}
                  aria-label={isAdded ? `Added ${node.path}` : `Add ${node.path} to context`}
                >
                  {isAdded ? <Check size={11} /> : <Plus size={11} />}
                  {isAdded ? 'Added' : 'Add'}
                </button>
              )}

              {onDownloadPath && (
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--hv-fg-subtle)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40',
                    isDownloading && 'text-[color:var(--hv-fg)]',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!isDirectory) {
                      onDownloadPath(node.path, node.type)
                    }
                  }}
                  disabled={isDirectory || isDownloading}
                  aria-label={`Download ${node.path}`}
                  title={isDirectory ? 'Directories cannot be downloaded as single files' : `Download ${node.path}`}
                >
                  {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                </button>
              )}

              {isLoading && <Loader2 size={12} className="shrink-0 animate-spin text-[color:var(--hv-fg-subtle)]" />}
            </div>

            {isDirectory && isExpanded && (
              <TreeBranch
                parentPath={node.path}
                depth={depth + 1}
                nodesByParent={nodesByParent}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                addedPaths={addedPaths}
                selectedPath={selectedPath}
                variant={variant}
                onSelectPath={onSelectPath}
                onToggleDirectory={onToggleDirectory}
                onAddPath={onAddPath}
                onDownloadPath={onDownloadPath}
                downloadingPath={downloadingPath}
                selectDirectoriesOnClick={selectDirectoriesOnClick}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export function WorkspaceTree(props: WorkspaceTreeProps) {
  const rootNodes = props.nodesByParent[''] ?? []
  const dark = props.variant === 'dark'

  if (rootNodes.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center rounded-lg border border-dashed text-sm',
          dark
            ? 'border-[color:var(--hv-border-soft)] text-[color:var(--hv-fg)]'
            : 'border-[color:var(--hv-border-hair)] text-[color:var(--hv-fg-subtle)]',
        )}
      >
        Workspace is empty
      </div>
    )
  }

  return <TreeBranch {...props} parentPath="" depth={0} />
}
