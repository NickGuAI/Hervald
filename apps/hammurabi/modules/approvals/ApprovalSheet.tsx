import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, Loader2 } from 'lucide-react'
import BottomSheet from '@/components/BottomSheet'
import type { PendingApproval } from '@/hooks/use-approvals'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { timeAgo } from '@/lib/utils'

export interface ApprovalSheetProps {
  approval: PendingApproval | null
  onClose: () => void
  onApprove?: () => void | Promise<void>
  onDeny?: () => void | Promise<void>
}

function PreviewBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="section-title">{label}</p>
      {children}
    </div>
  )
}

export default function ApprovalSheet({
  approval,
  onClose,
  onApprove,
  onDeny,
}: ApprovalSheetProps) {
  const isMobile = useIsMobile()
  const [busyDecision, setBusyDecision] = useState<'approve' | 'reject' | null>(null)

  useEffect(() => {
    if (!approval) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [approval, onClose])

  if (!approval) {
    return null
  }

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

  const actionFooter = onApprove || onDeny ? (
    <div className="border-t border-ink-border/70 px-5 py-4">
      <div className="flex flex-wrap justify-end gap-2">
        {onDeny ? (
          <button
            type="button"
            onClick={() => void handleDecision('reject', onDeny)}
            disabled={busyDecision !== null}
            className="btn-ghost inline-flex items-center gap-2 px-4 py-2.5 text-sm text-accent-vermillion disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyDecision ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            Reject
          </button>
        ) : null}
        {onApprove ? (
          <button
            type="button"
            onClick={() => void handleDecision('approve', onApprove)}
            disabled={busyDecision !== null}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyDecision ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve
          </button>
        ) : null}
      </div>
    </div>
  ) : null

  const content = (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-ink-border/70 px-5 py-4">
        <div className="min-w-0">
          <p className="section-title">Approval Preview</p>
          <h3 className="mt-2 font-display text-heading text-sumi-black">
            {approval.actionLabel}
          </h3>
          <p className="mt-1 text-sm text-sumi-diluted">
            {(approval.commanderName ?? approval.sessionName ?? 'Unknown agent')}
            {' · '}
            {timeAgo(approval.requestedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-ink-border p-1 text-sumi-diluted transition-colors hover:border-ink-border-hover hover:text-sumi-black"
          aria-label="Close preview"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {approval.summary && (
          <PreviewBlock label="Summary">
            <p className="rounded-xl border border-ink-border/70 bg-washi-aged/60 px-4 py-3 text-sm leading-relaxed text-sumi-gray">
              {approval.summary}
            </p>
          </PreviewBlock>
        )}

        {approval.details.length > 0 && (
          <PreviewBlock label="Highlights">
            <div className="grid gap-3 md:grid-cols-2">
              {approval.details.map((detail) => (
                <div
                  key={`${detail.label}:${detail.value}`}
                  className="rounded-xl border border-ink-border/70 bg-white/60 px-4 py-3"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-sumi-mist">
                    {detail.label}
                  </p>
                  <p className="mt-2 break-words text-sm text-sumi-black">{detail.value}</p>
                </div>
              ))}
            </div>
          </PreviewBlock>
        )}

        {approval.previewText && (
          <PreviewBlock label="Preview">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink-border/70 bg-sumi-black px-4 py-3 text-xs leading-relaxed text-washi-white">
              {approval.previewText}
            </pre>
          </PreviewBlock>
        )}

        <PreviewBlock label="Raw Payload">
          <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-ink-border/70 bg-washi-aged/60 px-4 py-3 text-xs leading-relaxed text-sumi-gray">
            {JSON.stringify(approval.raw, null, 2)}
          </pre>
        </PreviewBlock>
      </div>

      {actionFooter}
    </>
  )

  if (isMobile) {
    return (
      <BottomSheet
        open={Boolean(approval)}
        onClose={onClose}
        maxHeight="88dvh"
      >
        <div className="min-h-0 flex flex-col">{content}</div>
      </BottomSheet>
    )
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        className="absolute inset-0 bg-sumi-black/40"
        aria-label="Close approval preview"
        onClick={onClose}
      />

      <div className="absolute inset-0 flex items-end justify-center p-3 md:items-center md:p-5">
        <div className="card-sumi relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden bg-washi-white">
          {content}
        </div>
      </div>
    </div>,
    document.body,
  )
}
