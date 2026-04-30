/**
 * Hervald — StatusPill
 *
 * Compact status badge for commander state.
 * tone variants: waiting (orange), running (green), pending (red)
 * Border radius: 2px 6px 2px 6px
 */
import type { ReactNode } from 'react'

type StatusTone = 'waiting' | 'running' | 'pending'

interface StatusPillProps {
  tone: StatusTone
  children: ReactNode
}

const TONE_STYLES: Record<StatusTone, React.CSSProperties> = {
  waiting: {
    background: 'rgba(212,118,58,0.12)',
    color: 'var(--persimmon)',
    border: '1px solid rgba(212,118,58,0.35)',
  },
  running: {
    background: 'rgba(107,123,94,0.12)',
    color: 'var(--moss-stone)',
    border: '1px solid rgba(107,123,94,0.35)',
  },
  pending: {
    background: 'rgba(194,59,34,0.10)',
    color: 'var(--vermillion-seal)',
    border: '1px solid rgba(194,59,34,0.30)',
  },
}

export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: '2px 6px 2px 6px',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontFamily: 'var(--hv-font-body)',
        fontWeight: 500,
        ...TONE_STYLES[tone],
      }}
    >
      {children}
    </span>
  )
}
