import { ProfileCard } from '@/components/ProfileCard'
import { cn } from '@/lib/utils'
import { StatusDot } from '@modules/components/hervald'
import type { OrgNode } from '../types'

export interface CommanderProfileCardItem {
  id: string
  avatarUrl?: string | null
  name: string
  title: string
  handle: string
  status: string
  statusState: string
  automationCount: number
  selected: boolean
  archived: boolean
  onClick: () => void
}

function slugifyDisplayName(displayName: string): string {
  return (
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'commander'
  )
}

function statusLabel(status: string, archived: boolean | undefined) {
  if (archived) {
    return 'Archived'
  }

  if (status === 'active' || status === 'running') {
    return 'Running'
  }

  if (!status || status === 'idle' || status === 'paused' || status === 'stopped') {
    return 'Idle'
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusDotState(status: string, archived: boolean | undefined) {
  if (archived) {
    return 'idle'
  }
  if (status === 'active' || status === 'running') {
    return 'active'
  }
  return status || 'idle'
}

export function buildCommanderProfileCardItems({
  commanders,
  automationCountsByCommanderId = {},
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  automationCountsByCommanderId?: Record<string, number>
  expandedId: string | null
  onSelect: (id: string | null) => void
}): CommanderProfileCardItem[] {
  return commanders.map((commander) => {
    const selected = commander.id === expandedId

    return {
      id: commander.id,
      avatarUrl: commander.avatarUrl,
      name: commander.displayName,
      title: 'Commander',
      handle: `@${slugifyDisplayName(commander.displayName)}`,
      status: statusLabel(commander.status, commander.archived),
      statusState: statusDotState(commander.status, commander.archived),
      automationCount: automationCountsByCommanderId[commander.id] ?? 0,
      selected,
      archived: commander.archived === true,
      onClick: () => onSelect(selected ? null : commander.id),
    }
  })
}

export function CommanderProfileCardGrid({
  commanders,
  automationCountsByCommanderId = {},
  expandedId,
  onSelect,
}: {
  commanders: OrgNode[]
  automationCountsByCommanderId?: Record<string, number>
  expandedId: string | null
  onSelect: (id: string | null) => void
}) {
  const items = buildCommanderProfileCardItems({
    commanders,
    automationCountsByCommanderId,
    expandedId,
    onSelect,
  })

  return (
    <div
      data-testid="commander-profile-card-grid"
      className="grid gap-4"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
      }}
    >
      {items.map((item) => (
        <div key={item.id} className="space-y-2">
          <ProfileCard
            avatarUrl={item.avatarUrl}
            miniAvatarUrl={item.avatarUrl}
            name={item.name}
            title={item.title}
            handle={item.handle}
            status={item.status}
            statusAdornment={<StatusDot state={item.statusState} pulse={item.statusState === 'active'} />}
            aria-pressed={item.selected}
            aria-label={`Open ${item.name}`}
            data-testid="commander-tile"
            data-commander-card={item.id}
            className={cn(
              item.selected ? 'is-selected' : '',
              item.archived ? 'is-archived' : '',
            )}
            onClick={item.onClick}
          />
          <p
            data-testid="commander-profile-card-automation-signal"
            data-commander-id={item.id}
            className="px-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--hv-fg-subtle)]"
          >
            {item.automationCount} automation{item.automationCount === 1 ? '' : 's'}
          </p>
        </div>
      ))}
    </div>
  )
}
