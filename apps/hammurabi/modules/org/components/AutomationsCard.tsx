import { Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OrgNode } from '../types'

export function AutomationsCard({
  commander,
  automationCount,
}: {
  commander: OrgNode
  automationCount: number
}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="commander-automations-card"
      data-commander-id={commander.id}
      onClick={() => navigate(`/command-room?commander=${encodeURIComponent(commander.id)}&panel=automation`)}
      className="card-sumi flex h-full min-h-40 flex-col justify-between gap-4 p-5 text-left transition-colors hover:bg-ink-wash"
    >
      <span>
        <span className="section-title block">Automations</span>
        <span className="mt-1 block text-sm text-sumi-diluted">Commander-scoped runs</span>
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink-border px-3 py-1.5 text-sm text-sumi-black">
          <Zap size={14} aria-hidden="true" />
          {automationCount} automations
        </span>
        <span className="text-lg text-sumi-diluted" aria-hidden="true">→</span>
      </span>
    </button>
  )
}
