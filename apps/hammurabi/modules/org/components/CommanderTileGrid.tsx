import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTheme } from '@/lib/theme-context'
import type { OrgNode } from '../types'
import { ROLE_LABELS } from './CommanderRow'

function slugifyDisplayName(displayName: string): string {
  return (
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'commander'
  )
}

function initials(displayName: string): string {
  const [first = 'C', second = 'M'] = displayName.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function roleLabel(roleKey: OrgNode['roleKey']) {
  return ROLE_LABELS[roleKey ?? ''] ?? roleKey ?? 'Commander'
}

function statusDotClass(status: string) {
  return status === 'running' || status === 'active'
    ? 'bg-sumi-black'
    : 'bg-sumi-diluted'
}

function handleSelectKeyDown(event: ReactKeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  event.preventDefault()
  onActivate()
}

function CommanderInitialsAvatar({
  displayName,
  theme,
}: {
  displayName: string
  theme: 'light' | 'dark'
}) {
  const avatarFill = theme === 'dark' ? '#262626' : 'var(--hv-bg-raised)'
  const textFill = theme === 'dark' ? '#f5f1e8' : 'var(--hv-fg)'

  return (
    <svg
      viewBox="0 0 56 56"
      aria-hidden="true"
      className="h-14 w-14 shrink-0"
    >
      <rect
        x="0.5"
        y="0.5"
        width="55"
        height="55"
        rx="18"
        fill={avatarFill}
        stroke="var(--hv-border-hair)"
      />
      <text
        x="50%"
        y="52%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textFill}
        fontFamily="Source Sans 3, -apple-system, sans-serif"
        fontSize="18"
        fontWeight="700"
        letterSpacing="1.25"
      >
        {initials(displayName)}
      </text>
    </svg>
  )
}

export function CommanderTileGrid({
  commanders,
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { theme } = useTheme()

  return (
    <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {commanders.map((commander) => {
        const isSelected = commander.id === expandedId
        const handle = `@${slugifyDisplayName(commander.displayName)}`

        return (
          <article
            key={commander.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            data-testid="commander-tile"
            data-commander-card={commander.id}
            onClick={() => onSelect(isSelected ? null : commander.id)}
            onKeyDown={(event) => handleSelectKeyDown(event, () => onSelect(isSelected ? null : commander.id))}
            className={[
              'card-sumi flex min-h-[176px] cursor-pointer flex-col justify-between gap-5 border border-ink-border bg-washi-white p-5 text-sumi-black outline-none transition-all duration-300 ease-gentle',
              'hover:bg-ink-wash focus-visible:bg-ink-wash',
              'focus-visible:ring-2 focus-visible:ring-sumi-black focus-visible:ring-offset-2 focus-visible:ring-offset-washi-white',
              isSelected
                ? 'ring-2 ring-sumi-black ring-offset-2 ring-offset-washi-white shadow-ink-md'
                : 'shadow-ink-sm',
              commander.archived ? 'opacity-60' : '',
            ].join(' ').trim()}
          >
            <div className="flex items-start gap-4">
              {commander.avatarUrl ? (
                <img
                  src={commander.avatarUrl}
                  alt={commander.displayName}
                  className="h-14 w-14 shrink-0 rounded-[18px] border border-ink-border/70 object-cover"
                />
              ) : (
                <CommanderInitialsAvatar displayName={commander.displayName} theme={theme} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-medium text-sumi-black">{commander.displayName}</h2>
                    <p className="mt-1 truncate font-mono text-sm text-sumi-diluted">{handle}</p>
                  </div>
                  <span className="inline-flex max-w-full items-center rounded-full bg-ink-wash px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-sumi-diluted">
                    {roleLabel(commander.roleKey)}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-sumi-diluted">
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(commander.status)}`} />
                  <span className="capitalize">{commander.status}</span>
                  {commander.archived ? <span className="badge-sumi badge-idle">Archived</span> : null}
                </div>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
