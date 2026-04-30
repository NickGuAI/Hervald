import { useMemo, useState } from 'react'
import { useApprovalDecision, usePendingApprovals, type PendingApproval } from '@/hooks/use-approvals'
import ApprovalCard from '@modules/approvals/ApprovalCard'

type InboxFilter = 'all' | 'high'

function riskClassName(approval: PendingApproval): string {
  if (approval.risk === 'high') {
    return 'border-accent-vermillion/40 bg-accent-vermillion/5'
  }
  if (approval.risk === 'medium') {
    return 'border-persimmon/40 bg-persimmon/5'
  }
  return 'border-ink-border/70 bg-washi-white'
}

interface MobileInboxProps {
  onOpenApproval: (approvalId: string) => void
}

export function MobileInbox({ onOpenApproval }: MobileInboxProps) {
  const [filter, setFilter] = useState<InboxFilter>('all')
  const pendingApprovals = usePendingApprovals()
  const decisionMutation = useApprovalDecision()
  const approvals = pendingApprovals.data ?? []

  const visibleApprovals = useMemo(
    () => approvals.filter((approval) => filter === 'all' || approval.risk === 'high'),
    [approvals, filter],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-inbox">
      <div className="flex items-end justify-between gap-4 px-5 pb-3 pt-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">hervald</p>
          <h1 className="mt-1 font-display text-4xl text-sumi-black">Inbox</h1>
        </div>
        <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-accent-vermillion">
          {approvals.length} pend
        </span>
      </div>

      <div className="px-5 pb-3">
        <div className="flex gap-2">
          {([
            ['all', 'All'],
            ['high', 'High Risk'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className="rounded-[2px_10px_2px_10px] px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
              style={{
                background: filter === value ? 'var(--hv-fg)' : 'transparent',
                color: filter === value ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
                border: filter === value ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="hv-scroll flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-3">
          {visibleApprovals.map((approval) => (
            <div
              key={approval.id}
              className="rounded-[2px_14px_2px_14px] border-l-[3px] border-l-current"
              style={{
                color: approval.risk === 'high'
                  ? 'var(--vermillion-seal)'
                  : approval.risk === 'medium'
                    ? 'var(--persimmon)'
                    : 'var(--sumi-black)',
              }}
            >
              <ApprovalCard
                approval={approval}
                compact
                className={riskClassName(approval)}
                onPreview={() => onOpenApproval(approval.id)}
                onApprove={() => decisionMutation.mutateAsync({ approval, decision: 'approve' })}
                onDeny={() => decisionMutation.mutateAsync({ approval, decision: 'reject' })}
              />
            </div>
          ))}

          {visibleApprovals.length === 0 ? (
            <div className="rounded-[2px_14px_2px_14px] border border-dashed border-ink-border/70 bg-washi-white px-4 py-6 text-center text-sm italic text-sumi-diluted">
              No approvals in this filter.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
