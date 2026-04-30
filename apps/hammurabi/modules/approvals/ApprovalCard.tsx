import { useState } from 'react'
import { Check, Eye, Loader2, X } from 'lucide-react'
import type { PendingApproval } from '@/hooks/use-approvals'
import { cn, timeAgo } from '@/lib/utils'

export interface ApprovalCardProps {
  approval: PendingApproval
  onApprove: () => void | Promise<void>
  onDeny: () => void | Promise<void>
  onPreview?: () => void
  compact?: boolean
  className?: string
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

export default function ApprovalCard({
  approval,
  onApprove,
  onDeny,
  onPreview,
  compact = false,
  className,
}: ApprovalCardProps) {
  const [busyDecision, setBusyDecision] = useState<'approve' | 'reject' | null>(null)
  const busy = busyDecision !== null

  async function handleDecision(
    decision: 'approve' | 'reject',
    action: () => void | Promise<void>,
  ) {
    if (busyDecision) {
      return
    }

    setBusyDecision(decision)
    try {
      await Promise.resolve(action())
    } finally {
      setBusyDecision(null)
    }
  }

  return (
    <article
      className={cn(
        'card-sumi bg-white/90',
        compact ? 'px-3 py-3' : 'px-4 py-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-heading text-sumi-black">{approval.actionLabel}</h3>
            <span className="badge-sumi">{formatSourceLabel(approval.source)}</span>
            {approval.sessionName && (
              <span className="badge-sumi bg-washi-aged/80 text-sumi-diluted">
                {approval.sessionName}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-sumi-diluted">
            {approval.commanderName ?? approval.sessionName ?? 'Unknown agent'}
            {' · '}
            {timeAgo(approval.requestedAt)}
          </p>
        </div>
        {(approval.reason || approval.risk) && (
          <div className="rounded-xl border border-accent-vermillion/20 bg-accent-vermillion/5 px-3 py-2 text-xs text-accent-vermillion">
            {approval.reason && <p>Reason: {approval.reason}</p>}
            {approval.risk && <p className={approval.reason ? 'mt-1' : ''}>Risk: {approval.risk}</p>}
          </div>
        )}
      </div>

      {approval.details.length > 0 && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {approval.details.slice(0, compact ? 2 : 4).map((detail) => (
            <div
              key={`${detail.label}:${detail.value}`}
              className="rounded-xl border border-ink-border/60 bg-washi-aged/45 px-3 py-3"
            >
              <dt className="text-[11px] uppercase tracking-[0.18em] text-sumi-mist">
                {detail.label}
              </dt>
              <dd className="mt-2 break-words text-sm text-sumi-black">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(approval.summary || approval.previewText) && (
        <div className="mt-4 rounded-xl border border-ink-border/60 bg-white/60 px-4 py-3">
          {approval.summary && (
            <p className="text-sm leading-relaxed text-sumi-gray">{approval.summary}</p>
          )}
          {approval.previewText && (
            <p className={cn('text-sm leading-relaxed text-sumi-gray', approval.summary && 'mt-2')}>
              {approval.previewText}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <Eye size={14} />
            Preview
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleDecision('reject', onDeny)}
          disabled={busy}
          className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5 text-sm text-accent-vermillion disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          Reject
        </button>
        <button
          type="button"
          onClick={() => void handleDecision('approve', onApprove)}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
      </div>
    </article>
  )
}
