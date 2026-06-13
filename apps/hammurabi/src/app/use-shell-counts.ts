import { useMemo } from 'react'
import { usePendingApprovalCount } from '@modules/approvals/hooks/use-pending-approval-count'
import { useSessionLifecycleCounts } from '@modules/agents/hooks/use-session-lifecycle-counts'
import type { TopBarCounts } from '@/surfaces/desktop/TopBar'

export function useShellCounts(): TopBarCounts {
  const sessionCounts = useSessionLifecycleCounts()
  const pending = usePendingApprovalCount()

  return useMemo(() => ({
    ...sessionCounts,
    pending,
  }), [pending, sessionCounts])
}
