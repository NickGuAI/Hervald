import { WorkspaceOverlay } from '@modules/agents/components/WorkspaceOverlay'
import type { WorkspaceSource } from '@modules/workspace/use-workspace'

interface MobileWorkspaceSheetProps {
  open: boolean
  source: WorkspaceSource | null
  onClose: () => void
  onSelectFile: (filePath: string) => void
}

export function MobileWorkspaceSheet({
  open,
  source,
  onClose,
  onSelectFile,
}: MobileWorkspaceSheetProps) {
  if (!open || !source) {
    return null
  }

  return (
    <WorkspaceOverlay
      open={open}
      onClose={onClose}
      onSelectFile={(filePath) => {
        onSelectFile(filePath)
        onClose()
      }}
      source={source}
    />
  )
}
