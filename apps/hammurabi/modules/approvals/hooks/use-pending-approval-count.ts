import { usePendingApprovals } from '@/hooks/use-approvals'

export function usePendingApprovalCount(): number {
  const { data: approvals = [] } = usePendingApprovals()
  return approvals.length
}
