/**
 * Hervald — Shared UI primitives.
 *
 * Icon · StatusDot · AgentAvatar · Chip · MetaRow · Sparkline
 *
 * All components use Hervald CSS custom properties (--hv-*) from tokens.css.
 * Import them as named exports wherever needed.
 */
import type { CSSProperties, ReactNode } from 'react'
import { ICONS } from './icons'

/* ============================================================
   STATE_COLOR — maps agent/worker states to CSS color vars
   ============================================================ */
export const STATE_COLOR: Record<string, string> = {
  connected: 'var(--moss-stone)',
  idle: 'var(--stone-gray)',
  offline: 'var(--ink-mist)',
  paused: 'var(--persimmon)',
  active: 'var(--moss-stone)',
  done: 'var(--diluted-ink)',
  queued: 'var(--stone-gray)',
  blocked: 'var(--vermillion-seal)',
  exited: 'var(--diluted-ink)',
  completed: 'var(--diluted-ink)',
  stale: 'var(--ink-mist)',
  failed: 'var(--vermillion-seal)',
}

/* ============================================================
   Icon
   ============================================================ */
interface IconProps {
  name: string
  size?: number
  stroke?: number
  style?: CSSProperties
  className?: string
}

export function Icon({
  name,
  size = 18,
  stroke = 1.5,
  style = {},
  className,
  ...rest
}: IconProps) {
  const path = ICONS[name] || ICONS.dot
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      {path}
    </svg>
  )
}

/* ============================================================
   StatusDot
   ============================================================ */
interface StatusDotProps {
  state: string
  size?: number
  pulse?: boolean
  style?: CSSProperties
}

export function StatusDot({
  state,
  size = 8,
  pulse = false,
  style = {},
}: StatusDotProps) {
  const color = STATE_COLOR[state] || STATE_COLOR.idle
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: pulse ? `0 0 0 0 ${color}` : 'none',
        animation: pulse
          ? 'hvPulse 2.4s var(--hv-ease-gentle) infinite'
          : 'none',
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

/* ============================================================
   AgentAvatar
   ============================================================
   Canonical Hervald commander avatar. Accepts the live
   `CommanderSession` shape (`ui.accentColor`, `avatarUrl`,
   `displayName`/`name`/`host`) and renders either an `<img>` when
   `avatarUrl` is present OR a round tile with the commander's
   initial letter colored by the accent. Used on every surface that
   shows a commander (desktop + mobile) so the visual identity is
   consistent.
   ============================================================ */

/**
 * Deterministic fallback palette — used when a commander has no
 * explicit `ui.accentColor`. Hashes the commander id so the same
 * commander always gets the same color.
 */
const AVATAR_PALETTE = [
  '#C23B22', // vermillion-seal
  '#D4763A', // persimmon
  '#6B7B5E', // moss-stone
  '#4A6FA5', // washi-blue
  '#7D5A8B', // muted-plum
  '#8A6B3C', // aged-bronze
  '#5E7B6B', // pine-stone
  '#A85A5A', // sumi-red
] as const

function deterministicAccent(seed: string | undefined): string {
  if (!seed) {
    return AVATAR_PALETTE[0]
  }
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  const bucket = Math.abs(hash) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[bucket]
}

function initialFromCommander(commander: AgentAvatarCommander): string {
  const source =
    commander.displayName?.trim() ||
    commander.name?.trim() ||
    commander.host?.trim() ||
    'H'
  return source.charAt(0).toUpperCase()
}

export interface AgentAvatarCommander {
  id?: string
  name?: string
  displayName?: string
  host?: string
  avatarUrl?: string | null
  ui?: {
    accentColor?: string | null
    borderColor?: string | null
  } | null
}

interface AgentAvatarProps {
  commander: AgentAvatarCommander
  size?: number
  active?: boolean
  style?: CSSProperties
}

export function AgentAvatar({
  commander,
  size = 32,
  active = false,
  style = {},
}: AgentAvatarProps) {
  const accent =
    commander.ui?.accentColor?.trim() ||
    commander.ui?.borderColor?.trim() ||
    deterministicAccent(commander.id)
  const initial = initialFromCommander(commander)

  const wrapperStyle: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: '50%',
    overflow: 'hidden',
    background: 'var(--aged-paper)',
    border: active ? `1.5px solid ${accent}` : `1px solid ${accent}33`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...style,
  }

  if (commander.avatarUrl) {
    return (
      <div style={wrapperStyle} data-testid="agent-avatar">
        <img
          src={commander.avatarUrl}
          alt={commander.displayName || commander.name || 'Commander avatar'}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        ...wrapperStyle,
        fontFamily: 'var(--hv-font-primary)',
        fontSize: size * 0.44,
        fontStyle: 'italic',
        color: accent,
        fontWeight: 400,
        letterSpacing: 0,
      }}
      data-testid="agent-avatar"
    >
      {initial}
    </div>
  )
}

/* ============================================================
   Chip
   ============================================================ */
type ChipTone = 'neutral' | 'critical' | 'success' | 'warning' | 'ink'

interface ChipProps {
  children: ReactNode
  tone?: ChipTone
  style?: CSSProperties
}

const CHIP_TONES: Record<ChipTone, CSSProperties> = {
  neutral: {
    background: 'var(--hv-ink-wash-02)',
    color: 'var(--hv-fg-muted)',
  },
  critical: {
    background: 'rgba(194,59,34,0.08)',
    color: 'var(--vermillion-seal)',
  },
  success: {
    background: 'rgba(107,123,94,0.10)',
    color: 'var(--moss-stone)',
  },
  warning: {
    background: 'rgba(212,118,58,0.10)',
    color: 'var(--persimmon)',
  },
  ink: {
    background: 'var(--sumi-black)',
    color: 'var(--washi-white)',
  },
}

export function Chip({ children, tone = 'neutral', style = {} }: ChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: '2px 8px 2px 8px',
        fontFamily: 'var(--hv-font-body)',
        fontWeight: 500,
        ...CHIP_TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/* ============================================================
   MetaRow
   ============================================================ */
interface MetaRowProps {
  label: string
  value: ReactNode
  mono?: boolean
  style?: CSSProperties
}

export function MetaRow({
  label,
  value,
  mono = false,
  style = {},
}: MetaRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '8px 0',
        borderBottom: '1px solid var(--hv-border-hair)',
        fontSize: 12,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--hv-font-body)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--hv-fg-subtle)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? 'var(--hv-font-mono)' : 'var(--hv-font-body)',
          fontSize: mono ? 12 : 13,
          color: 'var(--hv-fg)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/* ============================================================
   Sparkline
   ============================================================ */
interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  color?: string
}

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = 'var(--sumi-black)',
}: SparklineProps) {
  const max = Math.max(1, ...values)
  const step = width / Math.max(1, values.length - 1)
  const pts = values
    .map((v, i) => `${i * step},${height - (v / max) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
