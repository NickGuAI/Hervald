/**
 * Hervald — TeamMemberRow
 *
 * A single row in the Team column worker list.
 * Selected state gets a carved-radius border + whisper shadow.
 */
import { Chip, StatusDot } from '@/surfaces/hervald'

export interface Worker {
  id: string
  name: string
  label?: string
  kind: string
  state: string
}

interface TeamMemberRowProps {
  worker: Worker
  selected: boolean
  onClick: () => void
  approvalCount: number
}

function stateTone(state: string) {
  if (state === 'running') {
    return 'success' as const
  }
  if (state === 'stale') {
    return 'warning' as const
  }
  if (state === 'exited') {
    return 'neutral' as const
  }
  return 'ink' as const
}

export function TeamMemberRow({ worker, selected, onClick, approvalCount }: TeamMemberRowProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 16px',
        // Inset by 10px each side when selected so border fits inside the column
        margin: selected ? '4px 10px' : '0',
        width: selected ? 'calc(100% - 20px)' : '100%',
        background: 'transparent',
        border: selected ? '1px solid var(--hv-border-firm)' : '1px solid transparent',
        borderRadius: selected ? '2px 10px 2px 10px' : 0,
        boxShadow: selected ? 'var(--hv-shadow-whisper)' : 'none',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--hv-font-body)',
        transition: 'border-color 0.15s var(--hv-ease-gentle), box-shadow 0.15s var(--hv-ease-gentle)',
      }}
    >
      {/* Status dot — 6px as spec'd */}
      <StatusDot state={worker.state} size={6} style={{ marginTop: 7 }} />

      {/* Name + label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontFamily: 'var(--hv-font-mono)',
              fontSize: 12.5,
              color: 'var(--hv-fg)',
            }}
          >
            {worker.name}
          </span>
          <Chip tone={stateTone(worker.state)} style={{ padding: '2px 7px', fontSize: 9.5 }}>
            {worker.state}
          </Chip>
          {worker.kind === 'tool' && (
            <span
              style={{
                fontFamily: 'var(--hv-font-mono)',
                fontSize: 10.5,
                color: 'var(--hv-fg-faint)',
              }}
            >
              &amp; {worker.name === 'researcher' ? 'fetcher' : 'caller'}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--hv-fg-subtle)',
            marginTop: 2,
            fontStyle: 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--hv-font-body)',
          }}
        >
          {worker.label ?? worker.kind}
        </div>
      </div>

      {/* Approval badge — vermillion count */}
      {approvalCount > 0 && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--vermillion-seal)',
            fontFamily: 'var(--hv-font-mono)',
            marginTop: 6,
            flexShrink: 0,
          }}
        >
          {approvalCount}
        </span>
      )}
    </button>
  )
}
