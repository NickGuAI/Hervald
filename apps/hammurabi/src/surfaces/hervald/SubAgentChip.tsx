/**
 * Hervald — SubAgentChip
 *
 * Inline worker chip: 5px status dot + name in mono 11.5px
 * Border radius: 2px 8px 2px 8px
 */
import { STATE_COLOR } from '@/surfaces/hervald'

export interface Worker {
  id: string
  name: string
  kind: string
  state: string
  label?: string
}

interface SubAgentChipProps {
  worker: Worker
}

export function SubAgentChip({ worker }: SubAgentChipProps) {
  const dotColor = STATE_COLOR[worker.state] ?? STATE_COLOR.idle

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        border: '1px solid var(--hv-border-soft)',
        borderRadius: '2px 8px 2px 8px',
        fontFamily: 'var(--hv-font-mono)',
        fontSize: 11.5,
        color: 'var(--hv-fg-muted)',
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />
      {worker.name}
    </span>
  )
}
