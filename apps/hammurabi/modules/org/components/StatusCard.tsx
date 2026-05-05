import { Circle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OrgNode } from '../types'

function statusPath(commanderId: string, panel: string): string {
  return `/command-room?commander=${encodeURIComponent(commanderId)}&panel=${encodeURIComponent(panel)}`
}

function StatusChip({
  label,
  value,
  onClick,
}: {
  label: string
  value: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-ink-border/70 px-3 py-2 text-left text-sm text-sumi-black transition-colors hover:bg-ink-wash"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Circle size={8} className="shrink-0 fill-current" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-medium">{value}</span>
    </button>
  )
}

export function StatusCard({
  commander,
}: {
  commander: OrgNode
}) {
  const navigate = useNavigate()
  const counts = commander.counts ?? {
    activeQuests: commander.questsInFlight?.active ?? 0,
    activeWorkers: commander.status === 'running' ? 1 : 0,
    activeChats: commander.activeUiChats ?? 0,
  }

  return (
    <article data-testid="commander-status-card" className="card-sumi flex h-full min-h-40 flex-col gap-4 p-5">
      <div>
        <p className="section-title">Status</p>
        <p className="mt-1 text-sm text-sumi-diluted">Live work surfaces</p>
      </div>
      <div className="mt-auto space-y-2">
        <StatusChip
          label="quests active"
          value={counts.activeQuests}
          onClick={() => navigate(statusPath(commander.id, 'quests'))}
        />
        <StatusChip
          label="workers"
          value={counts.activeWorkers}
          onClick={() => navigate(statusPath(commander.id, 'workers'))}
        />
        <StatusChip
          label="chats"
          value={counts.activeChats}
          onClick={() => navigate(statusPath(commander.id, 'chat'))}
        />
      </div>
    </article>
  )
}
