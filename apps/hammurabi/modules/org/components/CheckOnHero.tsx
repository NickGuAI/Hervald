import { MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OrgNode } from '../types'

export function CheckOnHero({
  commander,
}: {
  commander: OrgNode
}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="commander-check-on-hero"
      data-commander-id={commander.id}
      onClick={() => navigate(`/command-room?commander=${encodeURIComponent(commander.id)}`)}
      className="card-sumi flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-ink-wash"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
          <MessageSquare size={16} aria-hidden="true" />
        </span>
        <span className="truncate text-lg font-medium text-sumi-black">
          Check On {commander.displayName}
        </span>
      </span>
      <span className="shrink-0 text-lg text-sumi-diluted" aria-hidden="true">→</span>
    </button>
  )
}
