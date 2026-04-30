import ApprovalSheet from '@modules/approvals/ApprovalSheet'
import type { PendingApproval } from '@/hooks/use-approvals'

interface MobileApprovalSheetProps {
  approval: PendingApproval | null
  onClose: () => void
  onApprove?: () => void | Promise<void>
  onDeny?: () => void | Promise<void>
}

export function MobileApprovalSheet(props: MobileApprovalSheetProps) {
  return <ApprovalSheet {...props} />
}
