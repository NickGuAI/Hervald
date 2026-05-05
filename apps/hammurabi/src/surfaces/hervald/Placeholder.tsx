/**
 * Hervald — Shared placeholder wrapper.
 *
 * Used by surface pages that are not yet fully implemented.
 * Provides consistent token-driven card styling with carved-xl radius.
 */
import type { CSSProperties, ReactNode } from 'react'

interface PlaceholderProps {
  title: string
  note: string
  children?: ReactNode
}

const outerStyle: CSSProperties = {
  flex: 1,
  padding: '40px 48px',
  overflow: 'auto',
  background: 'var(--hv-bg)',
}

const cardStyle: CSSProperties = {
  maxWidth: 880,
  padding: '40px 48px',
  background: 'var(--hv-bg-raised)',
  border: '1px solid var(--hv-border-hair)',
  borderRadius: 'var(--hv-radius-carved-xl)',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--hv-font-primary)',
  fontSize: 'var(--hv-text-display)',
  fontWeight: 300,
  fontStyle: 'italic',
  lineHeight: 'var(--hv-leading-tight)',
  color: 'var(--hv-fg)',
}

const noteStyle: CSSProperties = {
  margin: '14px 0 0',
  color: 'var(--hv-fg-muted)',
  maxWidth: 560,
  fontFamily: 'var(--hv-font-body)',
  fontSize: 'var(--hv-text-body)',
  lineHeight: 'var(--hv-leading-normal)',
}

export function Placeholder({ title, note, children }: PlaceholderProps) {
  return (
    <div style={outerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={noteStyle}>{note}</p>
        {children && <div style={{ marginTop: 32 }}>{children}</div>}
      </div>
    </div>
  )
}
