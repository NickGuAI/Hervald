/**
 * Hervald — SelectedDetailCard
 *
 * Bottom-pinned detail card for the selected worker in the Team column.
 * Shows worker name, label, pending action, and primary action buttons.
 */
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { Chip } from '@modules/components/hervald'

export interface Worker {
  id: string
  name: string
  label?: string
  kind: string
  state: string
  processAlive?: boolean
  resumeAvailable?: boolean
}

export interface Approval {
  id: string
  workerId: string
  action: string
}

interface SelectedDetailCardProps {
  worker: Worker
  approval?: Approval
  onOpen?: () => void
  onApprove?: () => void
  onOpenWorkspace: () => void
  onDismiss?: () => void
}

const truncateTextStyle: CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function SelectedDetailCard({
  worker,
  approval,
  onOpen,
  onApprove,
  onOpenWorkspace,
  onDismiss,
}: SelectedDetailCardProps) {
  const isBlocked = worker.state === 'blocked'
  const isExited = worker.state === 'exited' || worker.processAlive === false

  return (
    <div
      style={{
        margin: '4px 12px 14px',
        padding: '14px 14px 12px',
        border: '1px solid var(--hv-border-soft)',
        borderRadius: '2px 12px 2px 12px',
        background: 'var(--hv-bg)',
        boxShadow: 'var(--hv-shadow-whisper)',
      }}
    >
      {/* Header row: "Selected" label + blocking status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          className="font-body"
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--hv-fg-subtle)',
            fontWeight: 500,
          }}
        >
          Selected
        </span>
        <span style={{ flex: 1 }} />
        {isExited && (
          <Chip tone="neutral" style={{ border: '1px solid var(--hv-border-soft)' }}>
            Exited
          </Chip>
        )}
        {isBlocked && (
          <Chip
            tone="warning"
            style={{ border: '1px solid var(--hv-accent-warning)', fontSize: 10, letterSpacing: '0.14em' }}
          >
            WAITING
          </Chip>
        )}
      </div>

      {/* Worker name */}
      <div
        className={cn('truncate font-mono text-sm')}
        data-testid="selected-worker-name"
        title={worker.name}
        style={{
          ...truncateTextStyle,
          color: 'var(--hv-fg)',
          marginBottom: 4,
        }}
      >
        {worker.name}
      </div>

      {/* Worker label */}
      <div
        className={cn('truncate font-body text-xs')}
        data-testid="selected-worker-label"
        title={worker.label ?? worker.kind}
        style={{
          ...truncateTextStyle,
          color: 'var(--hv-fg-subtle)',
          fontStyle: 'italic',
          marginBottom: approval ? 10 : 14,
        }}
      >
        {worker.label ?? worker.kind}
      </div>

      {/* Action label — only shown when a pending approval exists */}
      {approval && (
        <div
          className="font-body"
          style={{
            fontSize: 10.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--hv-accent-danger)',
            marginBottom: 12,
          }}
        >
          action{' · '}
          <span
            className="font-mono"
            style={{
              letterSpacing: 0,
              textTransform: 'none',
            }}
          >
            {approval.action}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onOpen && (
          <button onClick={onOpen} style={btnStyle('primary')}>
            Open
          </button>
        )}
        {approval && onApprove && (
          <button onClick={onApprove} style={btnStyle('ghost-vermillion')}>
            Approve action
          </button>
        )}
        <button onClick={onOpenWorkspace} style={btnStyle('ghost')}>
          Workspace
        </button>
        {isExited && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            style={btnStyle('ghost-critical')}
            data-testid="dismiss-worker-button"
          >
            Dismiss
          </button>
        )}
      </div>
      {isExited && onDismiss && (
        <div
          className="font-body"
          style={{
            marginTop: 10,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--hv-fg-subtle)',
          }}
        >
          Dismiss removes this exited worker from the team list
          {worker.resumeAvailable ? ' and clears its resume handle.' : '.'}
        </div>
      )}
    </div>
  )
}

function btnStyle(kind: 'primary' | 'ghost-vermillion' | 'ghost' | 'ghost-critical'): CSSProperties {
  const base: CSSProperties = {
    flex: 1,
    padding: '6px 10px',
    borderRadius: '2px 6px 2px 6px',
    fontSize: 11,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    border: '1px solid transparent',
  }
  if (kind === 'primary') {
    return { ...base, background: 'var(--hv-fg)', color: 'var(--hv-fg-inverse)', borderColor: 'var(--hv-fg)' }
  }
  if (kind === 'ghost-vermillion') {
    return { ...base, background: 'transparent', color: 'var(--hv-accent-danger)', borderColor: 'var(--hv-accent-danger)' }
  }
  if (kind === 'ghost-critical') {
    return { ...base, background: 'transparent', color: 'var(--hv-accent-danger)', borderColor: 'var(--hv-accent-danger)' }
  }
  return { ...base, background: 'transparent', color: 'var(--hv-fg-muted)', borderColor: 'var(--hv-border-firm)' }
}
