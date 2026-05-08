import { useEffect } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { SessionQueueSnapshot } from '@/types'
import { cn } from '@/lib/utils'
import {
  formatQueuePreview,
  getQueuePendingCount,
  getQueuedMessageLabel,
} from '../queue-state'

interface MobileQueuePanelProps {
  open: boolean
  theme: 'light' | 'dark'
  queueSnapshot?: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  onClearQueue?: () => void
  onMoveQueuedMessage?: (id: string, offset: number) => void
  onRemoveQueuedMessage?: (id: string) => void
  onClose: () => void
}

export function MobileQueuePanel({
  open,
  theme,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  onClose,
}: MobileQueuePanelProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open || typeof document === 'undefined') {
    return null
  }

  const currentQueuedMessage = queueSnapshot?.currentMessage ?? null
  const queueItems = queueSnapshot?.items ?? []
  const totalQueuedCount = getQueuePendingCount(queueSnapshot)
  const maxSize = typeof queueSnapshot?.maxSize === 'number' ? queueSnapshot.maxSize : 0
  const canClearQueue = (totalQueuedCount > 0 || currentQueuedMessage !== null) && !isQueueMutating && Boolean(onClearQueue)
  const themeRootClassName = theme === 'dark' ? 'hv-dark' : 'hv-light'

  return createPortal(
    <>
      <div
        className={cn(
          'sheet-backdrop visible sheet-backdrop--hervald',
          theme === 'dark' && 'sheet-backdrop--hervald-dark',
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          'sheet visible sheet--hervald',
          theme === 'dark' && 'sheet--hervald-dark',
          themeRootClassName,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-queue-panel-title"
        data-testid="mobile-queue-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle">
          <div className="sheet-handle-bar" />
        </div>

        <div className="px-5 pb-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="mobile-queue-panel-title"
                className="font-display text-heading text-sumi-black"
              >
                Queue
              </h2>
              <p className="mt-1 text-xs text-sumi-diluted">
                {`Pending ${totalQueuedCount}${maxSize > 0 ? `/${maxSize}` : ''}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-ink-border px-2.5 py-1.5 text-[11px] font-mono text-sumi-diluted transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onClearQueue}
                disabled={!canClearQueue}
              >
                Clear
              </button>
              <button
                type="button"
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-ink-border text-sumi-diluted transition-colors hover:bg-ink-wash hover:text-sumi-black"
                onClick={onClose}
                aria-label="Close queue"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {currentQueuedMessage ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="badge-sumi bg-emerald-500/10 text-[10px] text-emerald-500">
                  Working on
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-500">
                  {getQueuedMessageLabel(currentQueuedMessage)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-sumi-black">
                {formatQueuePreview(currentQueuedMessage, 160)}
              </p>
            </div>
          ) : null}

          {queueItems.length > 0 ? (
            <div className={cn('space-y-2', currentQueuedMessage ? 'mt-3' : '')}>
              {queueItems.map((message, index) => (
                <div
                  key={message.id}
                  className="rounded-lg border border-ink-border bg-washi-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-sumi-mist">
                          #{index + 1}
                        </span>
                        <span className="badge-sumi bg-black/5 text-[10px] text-sumi-diluted">
                          {getQueuedMessageLabel(message)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-sumi-black">
                        {formatQueuePreview(message, 140)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-ink-border px-2 py-1 text-[11px] text-sumi-diluted transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onMoveQueuedMessage?.(message.id, -1)}
                        disabled={index === 0 || isQueueMutating || !onMoveQueuedMessage}
                        aria-label={`Move queued message ${index + 1} up`}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-ink-border px-2 py-1 text-[11px] text-sumi-diluted transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onMoveQueuedMessage?.(message.id, 1)}
                        disabled={index === queueItems.length - 1 || isQueueMutating || !onMoveQueuedMessage}
                        aria-label={`Move queued message ${index + 1} down`}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-accent-vermillion/30 px-2 py-1 text-[11px] text-accent-vermillion transition-colors hover:bg-accent-vermillion/10 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onRemoveQueuedMessage?.(message.id)}
                        disabled={isQueueMutating || !onRemoveQueuedMessage}
                        aria-label={`Remove queued message ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !currentQueuedMessage ? (
            <p className="text-[11px] text-sumi-mist">
              Press Tab or use the send button while streaming to stack a follow-up without interrupting the current turn.
            </p>
          ) : null}

          {queueError ? (
            <div className="mt-3 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-[11px] text-accent-vermillion">
              {queueError}
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  )
}
