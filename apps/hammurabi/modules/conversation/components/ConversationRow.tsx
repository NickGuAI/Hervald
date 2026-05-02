import { STATE_COLOR } from '@/surfaces/hervald'
import type { ConversationRecord } from '../hooks/use-conversations'

interface ConversationRowProps {
  conversation: ConversationRecord
  selected?: boolean
  onSelect: (conversationId: string) => void
  onAttach?: (conversationId: string) => void
}

const SURFACE_LABEL: Record<ConversationRecord['surface'], string> = {
  api: 'API',
  cli: 'CLI',
  discord: 'Discord',
  telegram: 'Telegram',
  ui: 'UI',
  whatsapp: 'WhatsApp',
}

const STATUS_LABEL: Record<ConversationRecord['status'], string> = {
  active: 'Active',
  idle: 'Idle',
  archived: 'Archived',
}

function formatLastMessageAt(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return 'Unknown'
  }

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) {
    return 'Just now'
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`
  }

  return `${Math.floor(elapsedHours / 24)}d ago`
}

function formatCurrentTask(conversation: ConversationRecord): string | null {
  const task = conversation.currentTask
  if (!task) {
    return null
  }

  return task.title?.trim()
    ? `#${task.issueNumber} ${task.title.trim()}`
    : `#${task.issueNumber}`
}

export function ConversationRow({
  conversation,
  selected = false,
  onSelect,
  onAttach,
}: ConversationRowProps) {
  const currentTaskLabel = formatCurrentTask(conversation)
  const handleAttach = onAttach ?? onSelect

  return (
    <div
      style={{
        padding: '0 16px 8px 20px',
        display: 'flex',
        alignItems: 'stretch',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-pressed={selected}
        style={{
          flex: 1,
          minWidth: 0,
          background: selected ? 'var(--hv-ink-wash-02)' : 'transparent',
          borderLeft: selected ? '2px solid var(--sumi-black)' : '2px solid transparent',
          borderTop: '1px solid var(--hv-border-hair)',
          borderRight: '1px solid var(--hv-border-hair)',
          borderBottom: '1px solid var(--hv-border-hair)',
          borderRadius: '2px 12px 2px 12px',
          cursor: 'pointer',
          padding: '10px 12px',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--hv-font-body)',
              fontSize: 'calc(9.5px * var(--hv-sessions-scale, 1))',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-faint)',
              border: '1px solid var(--hv-border-hair)',
              borderRadius: 999,
              padding: '2px 6px',
            }}
          >
            {SURFACE_LABEL[conversation.surface]}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STATE_COLOR[conversation.status] ?? STATE_COLOR.idle,
              flexShrink: 0,
            }}
            aria-hidden
          />
          <span
            style={{
              fontFamily: 'var(--hv-font-body)',
              fontSize: 'calc(10px * var(--hv-sessions-scale, 1))',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: selected ? 'var(--hv-fg)' : 'var(--hv-fg-subtle)',
            }}
          >
            {STATUS_LABEL[conversation.status]}
          </span>
          <span
            style={{
              fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
              color: 'var(--hv-fg-faint)',
            }}
          >
            {formatLastMessageAt(conversation.lastMessageAt)}
          </span>
        </div>

        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div
            style={{
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {currentTaskLabel ? (
              <span
                style={{
                  fontSize: 'calc(11px * var(--hv-sessions-scale, 1))',
                  color: selected ? 'var(--hv-fg)' : 'var(--hv-fg-subtle)',
                  border: '1px solid var(--hv-border-soft)',
                  borderRadius: 999,
                  padding: '2px 8px',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={currentTaskLabel}
              >
                {currentTaskLabel}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 'calc(11px * var(--hv-sessions-scale, 1))',
                  color: 'var(--hv-fg-faint)',
                }}
              >
                No current task
              </span>
            )}
          </div>
          <span
            style={{
              fontFamily: 'var(--hv-font-mono)',
              fontSize: 'calc(10px * var(--hv-sessions-scale, 1))',
              color: 'var(--hv-fg-faint)',
              flexShrink: 0,
            }}
            title={conversation.id}
          >
            {conversation.id.slice(0, 8)}
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={() => handleAttach(conversation.id)}
        aria-label={`Attach to conversation ${conversation.id}`}
        style={{
          alignSelf: 'stretch',
          padding: '0 10px',
          borderRadius: '2px 10px 2px 10px',
          border: '1px solid var(--hv-border-hair)',
          background: selected ? 'var(--hv-bg-raised)' : 'transparent',
          color: selected ? 'var(--hv-fg)' : 'var(--hv-fg-subtle)',
          fontFamily: 'var(--hv-font-body)',
          fontSize: 'calc(10px * var(--hv-sessions-scale, 1))',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {selected ? 'Attached' : 'Attach'}
      </button>
    </div>
  )
}
