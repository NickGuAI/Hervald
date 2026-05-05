import { ModalFormContainer } from '../../components/ModalFormContainer'
import type { OrgNode } from '../types'
import { CommanderRow } from './CommanderRow'

interface CommanderDetailModalProps {
  open: boolean
  commander: OrgNode | null
  automations: ReadonlyArray<OrgNode>
  highlighted: boolean
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  onClose: () => void
}

export function CommanderDetailModal({
  open,
  commander,
  automations,
  highlighted,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
  onClose,
}: CommanderDetailModalProps) {
  if (!commander) {
    return null
  }

  return (
    <ModalFormContainer
      open={open}
      onClose={onClose}
      title={commander.displayName}
    >
      <CommanderRow
        commander={commander}
        automations={automations}
        highlighted={highlighted}
        onEdit={onEdit}
        onReplicate={onReplicate}
        onDelete={onDelete}
        onRestore={onRestore}
        onSaveTemplate={onSaveTemplate}
      />
    </ModalFormContainer>
  )
}
