import { useEffect, useState } from 'react'
import { Check, Loader2, ShieldAlert, X } from 'lucide-react'
import {
  type PendingApproval,
  useApprovalDecision,
  useApprovalNotifications,
  usePendingApprovals,
} from '@/hooks/use-approvals'
import { cn, timeAgo } from '@/lib/utils'

function formatSourceLabel(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (normalized === 'codex') return 'Codex'
  if (normalized === 'claude') return 'Claude'
  if (normalized === 'approval') return 'Queue'
  return source.replace(/[-_]+/g, ' ')
}

interface SessionApprovalsButtonProps {
  approvals?: PendingApproval[]
  onDecision?: (
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ) => void | Promise<void>
}

interface SessionApprovalsButtonViewProps {
  approvals: PendingApproval[]
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onDecision: (
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ) => Promise<void>
  mutationError: string | null
  isPending: boolean
  decisionTargetId: string | null
}

function SessionApprovalsButtonView({
  approvals,
  open,
  onOpenChange,
  onDecision,
  mutationError,
  isPending,
  decisionTargetId,
}: SessionApprovalsButtonViewProps) {
  const pendingCount = approvals.length
  const hasPending = pendingCount > 0

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className={cn('session-approvals-btn', hasPending && 'has-pending')}
        onClick={() => onOpenChange(!open)}
        aria-label={hasPending ? `Approvals (${pendingCount} pending)` : 'Approvals'}
        aria-expanded={open}
        title={hasPending ? `${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}` : 'Approvals'}
      >
        <ShieldAlert size={16} />
        {hasPending && (
          <span className="session-approvals-badge">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => onOpenChange(false)}
          />
          <div
            className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-ink-border bg-washi-white shadow-ink-md"
            role="dialog"
            aria-label="Pending approvals"
          >
            <div className="flex items-start justify-between gap-2 border-b border-ink-border/70 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sumi-mist">
                  Approvals
                </p>
                <p className="mt-0.5 text-xs text-sumi-black">
                  {pendingCount === 0 ? 'Queue clear' : `${pendingCount} awaiting review`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md p-1 text-sumi-diluted transition-colors hover:bg-ink-wash hover:text-sumi-black"
                aria-label="Close approvals"
              >
                <X size={14} />
              </button>
            </div>

            {mutationError && (
              <div className="border-b border-ink-border/50 px-3 py-2 text-[11px] text-accent-vermillion">
                {mutationError}
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto">
              {approvals.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-sumi-diluted">
                  No pending approvals
                </div>
              ) : (
                approvals.map((approval) => {
                  const busy = isPending && decisionTargetId === approval.id
                  return (
                    <div
                      key={approval.id}
                      className="border-b border-ink-border/50 px-3 py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-sumi-black">
                          {approval.actionLabel}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-sumi-diluted">
                          <span className="font-mono uppercase tracking-wide">
                            {formatSourceLabel(approval.source)}
                          </span>
                          {' · '}
                          {approval.commanderName ?? approval.sessionName ?? 'Unknown agent'}
                          {' · '}
                          {timeAgo(approval.requestedAt)}
                        </p>
                        {approval.summary && (
                          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-sumi-gray">
                            {approval.summary}
                          </p>
                        )}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-ink-border px-2 py-1.5 text-[11px] text-accent-vermillion transition-colors hover:bg-accent-vermillion/5 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void onDecision(approval, 'reject')}
                          disabled={busy}
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                          Reject
                        </button>
                        <button
                          type="button"
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-sumi-black px-2 py-1.5 text-[11px] font-medium text-washi-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void onDecision(approval, 'approve')}
                          disabled={busy}
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Approve
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function HookedSessionApprovalsButton() {
  const [open, setOpen] = useState(false)
  const pendingApprovalsQuery = usePendingApprovals()
  const decisionMutation = useApprovalDecision()
  const pending = pendingApprovalsQuery.data ?? []
  useApprovalNotifications({ suppressNotifications: open })

  return (
    <SessionApprovalsButtonView
      approvals={pending}
      open={open}
      onOpenChange={setOpen}
      onDecision={async (approval, decision) => {
        await decisionMutation.mutateAsync({ approval, decision })
      }}
      mutationError={
        decisionMutation.error instanceof Error ? decisionMutation.error.message : null
      }
      isPending={decisionMutation.isPending}
      decisionTargetId={decisionMutation.variables?.approval.id ?? null}
    />
  )
}

function ControlledSessionApprovalsButton({
  approvals,
  onDecision,
}: Required<Pick<SessionApprovalsButtonProps, 'approvals' | 'onDecision'>>) {
  const [open, setOpen] = useState(false)
  const [decisionTargetId, setDecisionTargetId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  return (
    <SessionApprovalsButtonView
      approvals={approvals}
      open={open}
      onOpenChange={setOpen}
      onDecision={async (approval, decision) => {
        setMutationError(null)
        setDecisionTargetId(approval.id)
        try {
          await onDecision(approval, decision)
        } catch (error) {
          setMutationError(error instanceof Error ? error.message : 'Failed to resolve approval')
        } finally {
          setDecisionTargetId((current) => (current === approval.id ? null : current))
        }
      }}
      mutationError={mutationError}
      isPending={decisionTargetId !== null}
      decisionTargetId={decisionTargetId}
    />
  )
}

export function SessionApprovalsButton({
  approvals,
  onDecision,
}: SessionApprovalsButtonProps = {}) {
  if (approvals && onDecision) {
    return (
      <ControlledSessionApprovalsButton
        approvals={approvals}
        onDecision={onDecision}
      />
    )
  }

  return <HookedSessionApprovalsButton />
}
