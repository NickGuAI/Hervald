import { ChromaGrid, type ChromaItem } from '@/components/ChromaGrid'
import { useTheme } from '@/lib/theme-context'
import type { OrgNode } from '../types'

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

function statusLabel(status: string) {
  if (status === 'active' || status === 'running') {
    return 'Running'
  }

  if (!status || status === 'idle' || status === 'paused' || status === 'stopped') {
    return 'Idle'
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildCommanderInitialsAvatarDataUrl({
  displayName,
  theme,
  borderColor,
}: {
  displayName: string
  theme: 'light' | 'dark'
  borderColor?: string | null
}) {
  const avatarFill = theme === 'dark' ? '#262626' : '#f5f1e8'
  const textFill = theme === 'dark' ? '#f5f1e8' : '#1c1c1c'
  const stroke = borderColor?.trim() || (theme === 'dark' ? 'rgba(245,241,232,0.18)' : 'rgba(28,28,28,0.16)')
  const safeInitials = escapeSvgText(initials(displayName))
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" aria-hidden="true">',
    `<rect x="0.5" y="0.5" width="55" height="55" rx="18" fill="${avatarFill}" stroke="${stroke}" />`,
    '<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"',
    ` fill="${textFill}" font-family="Source Sans 3, -apple-system, sans-serif"`,
    ' font-size="18" font-weight="700" letter-spacing="1.25">',
    safeInitials,
    '</text>',
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export function buildCommanderChromaItems({
  commanders,
  expandedId,
  onSelect,
  theme,
}: {
  commanders: OrgNode[]
  expandedId: string | null
  onSelect: (id: string | null) => void
  theme: 'light' | 'dark'
}): ChromaItem[] {
  return commanders.map((commander) => {
    const isSelected = commander.id === expandedId
    const handle = `@${slugifyDisplayName(commander.displayName)}`
    const borderColor = commander.profile?.borderColor ?? undefined
    const accentColor = commander.profile?.accentColor ?? undefined

    return {
      id: commander.id,
      image: commander.avatarUrl ?? buildCommanderInitialsAvatarDataUrl({
        displayName: commander.displayName,
        theme,
        borderColor,
      }),
      title: commander.displayName,
      subtitle: 'Commander',
      handle,
      location: commander.archived ? 'Archived' : statusLabel(commander.status),
      borderColor,
      gradient: accentColor ? `linear-gradient(165deg,${accentColor},#000)` : undefined,
      cardClassName: [
        isSelected ? 'ring-2 ring-white/80' : '',
        commander.archived ? 'opacity-60' : '',
      ].join(' ').trim(),
      cardProps: {
        'aria-pressed': isSelected,
        'data-testid': 'commander-tile',
        'data-commander-card': commander.id,
      },
      onClick: () => onSelect(isSelected ? null : commander.id),
    }
  })
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
  const items = buildCommanderChromaItems({
    commanders,
    expandedId,
    onSelect,
    theme,
  })

  return (
    <ChromaGrid
      items={items}
      className="justify-start"
    />
  )
}
