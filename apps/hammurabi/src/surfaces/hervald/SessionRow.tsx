/**
 * SessionRow — individual commander session row for the Sessions column.
 *
 * Visual spec:
 *  - 7px status dot (color from STATE_COLOR)
 *  - Commander name in JetBrains Mono 13px
 *  - Italic description (first sentence, truncated)
 *  - Pending count badge when pendingCount > 0
 *  - Selected state: ink-wash-02 bg + 2px solid foreground left border
 *  - When selected: inline New Chat action for the selected commander
 */
import type { SessionCreator } from '@/types'
import { AgentAvatar, Icon, STATE_COLOR } from '@/surfaces/hervald'

const ACTIVE_STATES = new Set(['active', 'connected', 'running'])

export interface Commander {
  id: string
  name: string
  // Used by AgentAvatar for the initial-letter fallback when no avatar image
  // is set. Hosts from `useCommander` supply this as their real host name
  // (e.g. the machine nickname); display pages pass it through so the letter
  // matches what the user sees in the row title.
  displayName?: string
  host?: string
  status: string
  description?: string
  iconName?: string
  isVirtual?: boolean
  // Threaded through from `CommanderSession` so surfaces can render a proper
  // commander avatar via `<AgentAvatar />`. `ui.accentColor` is the operator's
  // chosen theme color from the commander profile route; a deterministic
  // fallback is used when it's absent. `avatarUrl` points at the backend
  // avatar asset route when the operator has uploaded an image.
  avatarUrl?: string | null
  ui?: {
    accentColor?: string | null
    borderColor?: string | null
  } | null
}

export interface Worker {
  id: string
  name: string
  label?: string
  kind?: string
  state?: string
  creator?: SessionCreator
  commanderId?: string
  processAlive?: boolean
  resumeAvailable?: boolean
}

export interface Approval {
  id: string
  commanderId?: string
  workerId?: string
  action?: string
}

interface SessionRowProps {
  commander: Commander
  selected: boolean
  onClick: () => void
  onCreateChat?: () => void
  approvals?: Approval[]
}

export function SessionRow({
  commander,
  selected,
  onClick,
  onCreateChat,
  approvals = [],
}: SessionRowProps) {
  const pendingCount = approvals.length

  return (
    <div data-testid="commander-row" data-commander-id={commander.id}>
      <button
        data-testid="commander-row-button"
        onClick={onClick}
        style={{
          width: '100%',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          background: selected ? 'var(--hv-ink-wash-02)' : 'transparent',
          borderLeft: selected
            ? '2px solid var(--hv-fg)'
            : '2px solid transparent',
          borderTop: 'none',
          borderRight: 'none',
          borderBottom: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: `background 0.15s var(--hv-ease-gentle)`,
        }}
      >
        {commander.iconName ? (
          <Icon
            name={commander.iconName}
            size={14}
            style={{
              color: 'var(--hv-fg-subtle)',
              marginTop: 5,
            }}
          />
        ) : (
          <div style={{ position: 'relative', marginTop: 2, flexShrink: 0 }}>
            <AgentAvatar
              commander={commander}
              size={20}
              active={ACTIVE_STATES.has(commander.status)}
            />
            <span
              aria-hidden
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: STATE_COLOR[commander.status] ?? STATE_COLOR.idle,
                border: '2px solid var(--hv-bg)',
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--hv-font-mono)',
                fontSize: 13,
                color: 'var(--hv-fg)',
                letterSpacing: '-0.01em',
              }}
            >
              {commander.name}
            </span>

            {pendingCount > 0 && (
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  background: 'rgba(194,59,34,0.10)',
                  color: 'var(--vermillion-seal)',
                  borderRadius: '2px 6px 2px 6px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--hv-font-body)',
                  fontWeight: 500,
                  flexShrink: 0,
                  marginLeft: 6,
                }}
              >
                {pendingCount} PEND
              </span>
            )}
          </div>

          {commander.description && (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--hv-fg-subtle)',
                marginTop: 2,
                fontStyle: 'italic',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--hv-font-body)',
              }}
            >
              {commander.description.split('.')[0].toLowerCase()}
            </div>
          )}
        </div>
      </button>

      {selected && onCreateChat && (
        <div style={{ padding: '2px 0 8px' }}>
          <div style={{ padding: '0 20px 6px 36px' }}>
            <button
              type="button"
              data-testid="commander-new-chat-button"
              onClick={onCreateChat}
              aria-label={`New chat for ${commander.name}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: '1px solid var(--hv-border-hair)',
                borderRadius: 999,
                color: 'var(--hv-fg-subtle)',
                cursor: 'pointer',
                padding: '3px 8px',
                fontFamily: 'var(--hv-font-mono)',
                fontSize: 11,
                letterSpacing: '0.04em',
              }}
            >
              <Icon name="plus" size={10} />
              <span>New Chat</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
