/**
 * ColumnHeader — Hervald design system panel header.
 *
 * Renders a flex row with an uppercase 10.5px label on the left
 * and an optional action slot on the right.  Used in SessionsColumn
 * and any other Hervald panel that needs a consistent header.
 */
import type { ReactNode, CSSProperties } from 'react'

interface ColumnHeaderProps {
  /** Left-side label — supports inline JSX for styled count spans. */
  label: ReactNode
  /** Optional right slot — icon buttons, badge counts, etc. */
  right?: ReactNode
  style?: CSSProperties
}

export function ColumnHeader({ label, right, style }: ColumnHeaderProps) {
  return (
    <div
      style={{
        padding: '16px 20px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--hv-border-hair)',
        fontSize: 10.5,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--hv-fg-subtle)',
        fontFamily: 'var(--hv-font-body)',
        fontWeight: 500,
        flexShrink: 0,
        ...style,
      }}
    >
      <span>{label}</span>
      {right}
    </div>
  )
}
