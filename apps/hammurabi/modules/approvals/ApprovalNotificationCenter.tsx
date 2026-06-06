import { Link } from 'react-router-dom'
import { ShieldAlert, WifiOff, X } from 'lucide-react'
import {
  APPROVAL_NOTIFICATION_MAX_VISIBLE,
  useApprovalNotifications,
  useApprovalNotificationsSuppressed,
} from '@/hooks/use-approvals'
import { cn, timeAgo } from '@/lib/utils'
import { MOBILE_SHELL_FLOATING_BOTTOM_OFFSET_CLASS } from '@/styles/mobile-shell'

function approvalActorLabel(approval: {
  commanderName: string | null
  sessionName: string | null
  source: string
}): string {
  return approval.commanderName ?? approval.sessionName ?? approval.source
}

export function ApprovalNotificationCenter() {
  const globallySuppressed = useApprovalNotificationsSuppressed()
  const {
    visibleNotifications,
    hiddenNotificationCount,
    dismissNotification,
    connectionStatus,
  } = useApprovalNotifications({
    maxVisible: APPROVAL_NOTIFICATION_MAX_VISIBLE,
    suppressNotifications: globallySuppressed,
  })
  const showDisconnectedStatus = connectionStatus === 'disconnected'

  if (visibleNotifications.length === 0 && !showDisconnectedStatus) {
    return null
  }

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-3 right-3 z-50 flex flex-col gap-2 md:bottom-auto md:left-auto md:right-4 md:top-16 md:w-96',
        MOBILE_SHELL_FLOATING_BOTTOM_OFFSET_CLASS,
      )}
      aria-live="polite"
      aria-label="Approval notifications"
    >
      {showDisconnectedStatus && (
        <article
          className="pointer-events-auto overflow-hidden rounded-lg border border-ink-border bg-washi-white shadow-ink-md"
          role="status"
        >
          <div className="flex items-start gap-3 px-3 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-wash text-sumi-diluted">
              <WifiOff size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">
                Approval stream disconnected
              </p>
              <p className="mt-1 text-xs leading-relaxed text-sumi-gray">
                New approval prompts may not appear until the connection recovers.
              </p>
            </div>
          </div>
        </article>
      )}

      {visibleNotifications.map((notification) => {
        const { approval } = notification
        return (
          <article
            key={notification.id}
            className="pointer-events-auto overflow-hidden rounded-lg border border-ink-border bg-washi-white shadow-ink-md"
          >
            <div className="flex items-start gap-3 px-3 py-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-vermillion/10 text-accent-vermillion">
                <ShieldAlert size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">
                      Approval requested
                    </p>
                    <h2 className="mt-1 truncate text-sm font-medium text-sumi-black">
                      {approval.actionLabel}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-sumi-diluted transition-colors hover:bg-ink-wash hover:text-sumi-black"
                    onClick={() => dismissNotification(notification.id)}
                    aria-label={`Dismiss ${approval.actionLabel}`}
                  >
                    <X size={14} />
                  </button>
                </div>

                <p className="mt-1 truncate text-xs text-sumi-diluted">
                  {approvalActorLabel(approval)}
                  {' · '}
                  {timeAgo(approval.requestedAt)}
                </p>

                {approval.summary && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-sumi-gray">
                    {approval.summary}
                  </p>
                )}

                <div className="mt-3 flex justify-end">
                  <Link
                    to="/approvals"
                    className="rounded-md bg-sumi-black px-3 py-1.5 text-xs font-medium text-washi-white transition-opacity hover:opacity-90"
                    onClick={() => dismissNotification(notification.id)}
                  >
                    Review
                  </Link>
                </div>
              </div>
            </div>
          </article>
        )
      })}

      {hiddenNotificationCount > 0 && (
        <Link
          to="/approvals"
          className="pointer-events-auto rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-center text-xs font-medium text-sumi-gray shadow-ink-md transition-colors hover:bg-ink-wash hover:text-sumi-black"
        >
          {hiddenNotificationCount} more approval{hiddenNotificationCount === 1 ? '' : 's'} awaiting review
        </Link>
      )}
    </div>
  )
}
