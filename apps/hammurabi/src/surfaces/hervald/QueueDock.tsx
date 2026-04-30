import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import type { SessionQueueSnapshot } from '@/types'
import {
  formatQueuePreview,
  getQueuePendingCount,
  getQueuedMessageLabel,
} from '@modules/agents/queue-state'

interface QueueDockProps {
  conversationName: string
  hasConversation: boolean
  canQueue: boolean
  queueSnapshot: SessionQueueSnapshot
  queueError: string | null
  isQueueMutating: boolean
  onClearQueue: () => void
  onMoveQueuedMessage: (messageId: string, offset: number) => void
  onRemoveQueuedMessage: (messageId: string) => void
}

export function QueueDock({
  conversationName,
  hasConversation,
  canQueue,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
}: QueueDockProps) {
  const queueItems = queueSnapshot.items
  const currentQueuedMessage = queueSnapshot.currentMessage ?? null
  const totalQueuedCount = getQueuePendingCount(queueSnapshot)
  const canClearQueue = canQueue && !isQueueMutating && (queueItems.length > 0 || currentQueuedMessage !== null)

  let helperText = 'Select a conversation to stack follow-ups.'
  if (hasConversation && !canQueue) {
    helperText = 'Queue is unavailable for this session type.'
  } else if (hasConversation) {
    helperText = currentQueuedMessage
      ? `${conversationName} is working through queued follow-ups.`
      : 'Press Tab to queue a follow-up without interrupting the current turn.'
  }

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--hv-border-hair)',
        background: 'var(--hv-bg-raised)',
        padding: '12px 22px 10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--hv-font-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-faint)',
            }}
          >
            Queue
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: 'var(--hv-fg-subtle)',
            }}
          >
            {canQueue
              ? `${totalQueuedCount} queued${queueSnapshot.maxSize ? ` · ${totalQueuedCount}/${queueSnapshot.maxSize}` : ''}`
              : helperText}
          </div>
        </div>

        <button
          type="button"
          onClick={onClearQueue}
          disabled={!canClearQueue}
          style={{
            padding: '6px 12px',
            borderRadius: '2px 8px 2px 8px',
            border: '1px solid var(--hv-border-firm)',
            background: 'transparent',
            color: canClearQueue ? 'var(--hv-fg-muted)' : 'var(--hv-fg-faint)',
            fontFamily: 'var(--hv-font-body)',
            fontSize: 11,
            letterSpacing: '0.04em',
            cursor: canClearQueue ? 'pointer' : 'not-allowed',
            opacity: canClearQueue ? 1 : 0.55,
          }}
        >
          Clear
        </button>
      </div>

      {currentQueuedMessage && (
        <div
          style={{
            marginTop: 12,
            borderRadius: '2px 12px 2px 12px',
            border: '1px solid rgba(107,123,94,0.28)',
            background: 'rgba(107,123,94,0.08)',
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--moss-stone)',
                fontFamily: 'var(--hv-font-body)',
              }}
            >
              Working On
            </span>
            <span
              style={{
                fontFamily: 'var(--hv-font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--moss-stone)',
              }}
            >
              {getQueuedMessageLabel(currentQueuedMessage)}
            </span>
          </div>
          <p
            style={{
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--hv-fg)',
            }}
          >
            {formatQueuePreview(currentQueuedMessage, 160)}
          </p>
        </div>
      )}

      {canQueue && queueItems.length > 0 && (
        <div
          className="hv-scroll"
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 180,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {queueItems.map((message, index) => (
            <div
              key={message.id}
              style={{
                borderRadius: '2px 10px 2px 10px',
                border: '1px solid var(--hv-border-soft)',
                background: 'var(--hv-bg)',
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--hv-font-mono)',
                        fontSize: 10.5,
                        color: 'var(--hv-fg-faint)',
                      }}
                    >
                      #{index + 1}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--hv-fg-subtle)',
                        fontFamily: 'var(--hv-font-body)',
                      }}
                    >
                      {getQueuedMessageLabel(message)}
                    </span>
                  </div>
                  <p
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: 'var(--hv-fg)',
                    }}
                  >
                    {formatQueuePreview(message, 140)}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onMoveQueuedMessage(message.id, -1)}
                    disabled={index === 0 || isQueueMutating}
                    aria-label={`Move queued message ${index + 1} up`}
                    style={queueActionButtonStyle(index === 0 || isQueueMutating)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveQueuedMessage(message.id, 1)}
                    disabled={index === queueItems.length - 1 || isQueueMutating}
                    aria-label={`Move queued message ${index + 1} down`}
                    style={queueActionButtonStyle(index === queueItems.length - 1 || isQueueMutating)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveQueuedMessage(message.id)}
                    disabled={isQueueMutating}
                    aria-label={`Remove queued message ${index + 1}`}
                    style={queueDangerButtonStyle(isQueueMutating)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!currentQueuedMessage && (!canQueue || queueItems.length === 0) && (
        <p
          style={{
            marginTop: 10,
            fontSize: 11.5,
            color: 'var(--hv-fg-faint)',
          }}
        >
          {helperText}
        </p>
      )}

      {queueError && (
        <div
          style={{
            marginTop: 10,
            borderRadius: '2px 8px 2px 8px',
            background: 'rgba(194,59,34,0.10)',
            color: 'var(--vermillion-seal)',
            padding: '8px 10px',
            fontSize: 11.5,
          }}
        >
          {queueError}
        </div>
      )}
    </div>
  )
}

function queueActionButtonStyle(disabled: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: '2px 8px 2px 8px',
    border: '1px solid var(--hv-border-soft)',
    background: 'transparent',
    color: disabled ? 'var(--hv-fg-faint)' : 'var(--hv-fg-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  } satisfies CSSProperties
}

function queueDangerButtonStyle(disabled: boolean) {
  return {
    ...queueActionButtonStyle(disabled),
    color: disabled ? 'var(--hv-fg-faint)' : 'var(--vermillion-seal)',
    border: '1px solid rgba(194,59,34,0.22)',
  } satisfies CSSProperties
}
