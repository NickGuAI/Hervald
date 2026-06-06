import { WorkspaceOverlay } from '@modules/agents/components/WorkspaceOverlay'
import type { WorkspaceSource, WorkspaceSourceRecovery } from '@modules/workspace/use-workspace'
import type { WorkspaceTreeNode } from '@modules/workspace/types'

interface MobileWorkspaceSheetProps {
  open: boolean
  source: WorkspaceSource | null
  onClose: () => void
  onSelectFile: (filePath: string, type: WorkspaceTreeNode['type']) => void
  requestedPath?: string | null
  requestedPathToken?: number
  onRequestedPathConsumed?: (token: number) => void
  onRecoverStaleTarget?: WorkspaceSourceRecovery
}

export function MobileWorkspaceSheet({
  open,
  source,
  onClose,
  onSelectFile,
  requestedPath,
  requestedPathToken = 0,
  onRequestedPathConsumed,
  onRecoverStaleTarget,
}: MobileWorkspaceSheetProps) {
  if (!open || !source) {
    return null
  }

  return (
    <WorkspaceOverlay
      open={open}
      onClose={onClose}
      onSelectFile={(filePath, type) => {
        onSelectFile(filePath, type)
        onClose()
      }}
      source={source}
      requestedPath={requestedPath}
      requestedPathToken={requestedPathToken}
      onRequestedPathConsumed={onRequestedPathConsumed}
      onRecoverStaleTarget={onRecoverStaleTarget}
    />
  )
}
