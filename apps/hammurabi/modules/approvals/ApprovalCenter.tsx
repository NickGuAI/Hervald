import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  Check,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import {
  type PendingApproval,
  type ApprovalHistoryEntry,
  useApprovalDecision,
  useApprovalHistory,
  useApprovalNotifications,
  usePendingApprovals,
} from '@/hooks/use-approvals'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn, timeAgo } from '@/lib/utils'
import ApprovalCard from './ApprovalCard'
import ApprovalSheet from './ApprovalSheet'

export interface ApprovalCenterProps {
  className?: string
  defaultOpen?: boolean
  panelMode?: 'adaptive' | 'drawer' | 'fixed'
  title?: string
}

function formatSourceLabel(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (normalized === 'codex') {
    return 'Codex'
  }
  if (normalized === 'claude') {
    return 'Claude'
  }
  if (normalized === 'approval') {
    return 'Queue'
  }
  return source.replace(/[-_]+/g, ' ')
}

function EmptyState() {
  return (
    <div className="card-sumi px-5 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-washi-aged/70 text-sumi-diluted">
        <ShieldCheck size={20} />
      </div>
      <h3 className="mt-4 font-display text-heading text-sumi-black">Nothing waiting</h3>
      <p className="mt-2 text-sm leading-relaxed text-sumi-diluted">
        New approval requests will appear here as soon as agents pause for review.
      </p>
    </div>
  )
}

function HistoryDecisionBadge({ entry }: { entry: ApprovalHistoryEntry }) {
  const label = entry.type === 'approval.enqueued'
    ? 'Queued'
    : entry.timedOut
      ? 'Timed Out'
      : entry.decision === 'approve'
        ? 'Approved'
        : 'Rejected'
  const badgeClassName = entry.type === 'approval.enqueued'
    ? 'badge-idle'
    : entry.decision === 'approve'
      ? 'badge-active'
      : 'badge-stale'

  return <span className={cn('badge-sumi', badgeClassName)}>{label}</span>
}

function ApprovalHistoryCard({ entry }: { entry: ApprovalHistoryEntry }) {
  return (
    <article className="rounded-xl border border-ink-border/60 bg-white/70 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-sumi-black">{entry.actionLabel}</h3>
            <HistoryDecisionBadge entry={entry} />
          </div>
          <p className="mt-1 text-xs text-sumi-diluted">
            {(entry.commanderId ?? 'Unknown agent')}
            {entry.source ? ` · ${formatSourceLabel(entry.source)}` : ''}
            {' · '}
            {timeAgo(entry.timestamp)}
          </p>
        </div>
      </div>

      {entry.summary && (
        <p className="mt-3 text-sm leading-relaxed text-sumi-gray">{entry.summary}</p>
      )}
    </article>
  )
}

export function ApprovalCenter({
  className,
  defaultOpen = false,
  panelMode = 'adaptive',
  title = 'Pending Approvals',
}: ApprovalCenterProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(defaultOpen)
  const [previewApproval, setPreviewApproval] = useState<PendingApproval | null>(null)
  const [panelMessage, setPanelMessage] = useState<string | null>(null)

  const pendingApprovalsQuery = usePendingApprovals()
  const approvalHistoryQuery = useApprovalHistory()
  const decisionMutation = useApprovalDecision()
  const { notifications, dismissNotification, connectionStatus } = useApprovalNotifications({
    suppressNotifications: open,
  })

  const pendingApprovals = pendingApprovalsQuery.data ?? []
  const approvalHistory = approvalHistoryQuery.data ?? []
  const pendingCount = pendingApprovals.length
  const effectiveMode = panelMode === 'adaptive'
    ? (isMobile ? 'drawer' : 'fixed')
    : panelMode

  useEffect(() => {
    if (!open || pendingCount > 0) {
      return
    }
    setPreviewApproval(null)
  }, [open, pendingCount])

  useEffect(() => {
    if (!panelMessage) {
      return
    }
    const timer = window.setTimeout(() => {
      setPanelMessage(null)
    }, 4000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [panelMessage])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const listError = pendingApprovalsQuery.error instanceof Error
    ? pendingApprovalsQuery.error.message
    : null
  const historyError = approvalHistoryQuery.error instanceof Error
    ? approvalHistoryQuery.error.message
    : null
  const mutationError = decisionMutation.error instanceof Error
    ? decisionMutation.error.message
    : null
  const errorMessage = mutationError ?? listError ?? historyError

  async function handleDecision(
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    try {
      await decisionMutation.mutateAsync({ approval, decision })
      setPanelMessage(decision === 'approve' ? 'Approval granted.' : 'Approval rejected.')
      if (previewApproval?.id === approval.id) {
        setPreviewApproval(null)
      }
    } catch {
      // Hook state renders the error banner.
    }
  }

  const panelShellClasses = effectiveMode === 'drawer'
    ? cn(
      'fixed inset-x-0 bottom-0 z-[80] max-h-[88dvh] overflow-hidden rounded-t-[28px] border border-ink-border bg-washi-white shadow-2xl transition-transform duration-500 ease-out md:inset-y-4 md:right-4 md:left-auto md:w-[26rem] md:rounded-[24px]',
      open ? 'translate-y-0 md:translate-x-0' : 'translate-y-[110%] md:translate-x-[115%]',
    )
    : cn(
      'fixed right-4 top-4 z-[80] h-[calc(100dvh-2rem)] w-[26rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[24px] border border-ink-border bg-washi-white shadow-2xl transition-all duration-500 ease-out',
      open ? 'translate-x-0 opacity-100' : 'translate-x-[115%] opacity-0 pointer-events-none',
    )

  return (
    <>
      <div className={cn('approval-fab fixed bottom-4 right-4 z-[78]', className)}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="card-sumi group inline-flex items-center gap-3 bg-washi-white px-4 py-3 text-left transition-all hover:-translate-y-0.5"
          aria-expanded={open}
          aria-controls="approval-center-panel"
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-washi-aged/80 text-sumi-black">
            <ShieldAlert size={18} />
            {pendingCount > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent-vermillion px-1.5 text-[11px] font-medium text-white">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="section-title">Approvals</p>
            <p className="mt-1 text-sm text-sumi-black">
              {pendingCount === 0 ? 'Queue clear' : `${pendingCount} awaiting review`}
            </p>
            <p className="text-xs text-sumi-diluted">
              {connectionStatus === 'connected' ? 'Live updates on' : 'Reconnecting stream'}
            </p>
          </div>
        </button>
      </div>

      {!open && notifications.length > 0 && (
        <div className="approval-fab fixed bottom-24 right-4 z-[79] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
          {notifications.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => {
                dismissNotification(notification.id)
                setOpen(true)
                setPreviewApproval(notification.approval)
              }}
              className="card-sumi bg-washi-white/95 px-4 py-3 text-left backdrop-blur"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-ink/10 text-accent-ink">
                  <BellRing size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-sumi-mist">New approval</p>
                  <p className="mt-1 text-sm text-sumi-black">
                    {notification.approval.commanderName ?? notification.approval.sessionName ?? 'Unknown agent'}
                    {' · '}
                    {notification.approval.actionLabel}
                  </p>
                  {(notification.approval.summary ?? notification.approval.previewText) && (
                    <p className="mt-1 text-xs leading-relaxed text-sumi-diluted">
                      {notification.approval.summary ?? notification.approval.previewText}
                    </p>
                  )}
                </div>
                <span className="text-xs text-sumi-mist">{timeAgo(notification.approval.requestedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {effectiveMode === 'drawer' && (
        <button
          type="button"
          aria-label="Close approvals panel"
          className={cn(
            'approval-fab fixed inset-0 z-[79] bg-sumi-black/35 transition-opacity md:bg-sumi-black/20',
            open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        id="approval-center-panel"
        className={cn('approval-fab', panelShellClasses)}
        aria-hidden={!open}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-ink-border/70 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="section-title">Action Queue</p>
                <h2 className="mt-2 font-display text-display text-sumi-black">{title}</h2>
                <p className="mt-1 text-sm text-sumi-diluted">
                  Review external actions before they leave the workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-ink-border p-1 text-sumi-diluted transition-colors hover:border-ink-border-hover hover:text-sumi-black"
                aria-label="Close approvals panel"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className={cn('badge-sumi', pendingCount > 0 && 'badge-idle')}>
                {pendingCount} pending
              </span>
              <span
                className={cn(
                  'badge-sumi',
                  connectionStatus === 'connected' ? 'badge-active' : 'badge-stale',
                )}
              >
                {connectionStatus === 'connected' ? (
                  <>
                    <Wifi size={12} className="mr-1" />
                    Live
                  </>
                ) : (
                  <>
                    <WifiOff size={12} className="mr-1" />
                    Reconnecting
                  </>
                )}
              </span>
            </div>

            {connectionStatus !== 'connected' && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-ink-border/70 bg-washi-aged/60 px-3 py-2 text-sm text-sumi-diluted">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>Live approval updates are reconnecting. The list still refreshes in the background.</span>
              </div>
            )}

            {panelMessage && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-moss/20 bg-accent-moss/10 px-3 py-2 text-sm text-accent-moss">
                <Check size={14} className="mt-0.5 shrink-0" />
                <span>{panelMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-vermillion/20 bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {pendingApprovalsQuery.isLoading && pendingApprovals.length === 0 ? (
              <div className="flex justify-center py-16">
                <Loader2 size={20} className="animate-spin text-sumi-diluted" />
              </div>
            ) : pendingApprovals.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-4">
                {pendingApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onPreview={() => setPreviewApproval(approval)}
                    onApprove={() => handleDecision(approval, 'approve')}
                    onDeny={() => handleDecision(approval, 'reject')}
                  />
                ))}
              </div>
            )}

            <section className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="section-title">Recent Decisions</p>
                  <p className="mt-1 text-xs text-sumi-diluted">
                    Latest queue activity from the audit log.
                  </p>
                </div>
                {approvalHistoryQuery.isFetching && (
                  <Loader2 size={14} className="animate-spin text-sumi-diluted" />
                )}
              </div>

              {approvalHistory.length === 0 ? (
                <div className="rounded-xl border border-ink-border/60 bg-washi-aged/40 px-4 py-4 text-sm text-sumi-diluted">
                  No recent approval activity yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {approvalHistory.map((entry) => (
                    <ApprovalHistoryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </aside>

      <ApprovalSheet
        approval={previewApproval}
        onClose={() => setPreviewApproval(null)}
      />
    </>
  )
}
