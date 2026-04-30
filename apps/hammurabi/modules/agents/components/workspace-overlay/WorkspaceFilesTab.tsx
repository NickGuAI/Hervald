import { Loader2 } from 'lucide-react'
import type { WorkspaceTreeNode } from '../../../workspace/types'
import { WorkspaceTree } from '../../../workspace/components/WorkspaceTree'

interface WorkspaceFilesTabProps {
  filteredNodesByParent: Record<string, WorkspaceTreeNode[]>
  expandedPaths: Set<string>
  loadingPaths: Set<string>
  addedPaths: Set<string>
  selectedPath: string | null
  onSelectPath: (path: string) => void
  onToggleDirectory: (path: string) => void
  onAddPath: (path: string, knownType?: WorkspaceTreeNode['type']) => void
}

export function WorkspaceFilesTab({
  filteredNodesByParent,
  expandedPaths,
  loadingPaths,
  addedPaths,
  selectedPath,
  onSelectPath,
  onToggleDirectory,
  onAddPath,
}: WorkspaceFilesTabProps) {
  return (
    <div className="flex h-full min-h-[200px] flex-col gap-3 overflow-y-auto">
      {filteredNodesByParent[''] ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-ink-border bg-washi-white p-2">
          <WorkspaceTree
            nodesByParent={filteredNodesByParent}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
            addedPaths={addedPaths}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onToggleDirectory={onToggleDirectory}
            onAddPath={onAddPath}
            selectDirectoriesOnClick={false}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center py-8 text-sm text-sumi-diluted">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading workspace...
        </div>
      )}
    </div>
  )
}
