import { RadioTower } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { OrgNode } from '../types'

const PROVIDER_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  discord: 'Discord',
}

export function ChannelsCard({
  commander,
}: {
  commander: OrgNode
}) {
  const navigate = useNavigate()
  const entries = Object.entries(commander.channels ?? {})
  // Org channels are conversation-derived surface counts, not channel-binding store rows.
  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  return (
    <button
      type="button"
      data-testid="commander-channels-card"
      data-commander-id={commander.id}
      onClick={() => navigate(`/channels?commander=${encodeURIComponent(commander.id)}`)}
      className="card-sumi flex h-full min-h-40 flex-col gap-4 p-5 text-left transition-colors hover:bg-ink-wash"
    >
      <span className="flex items-start justify-between gap-3">
        <span>
          <span className="section-title block">Channels</span>
          <span className="mt-1 block text-sm text-sumi-diluted">{total} channels</span>
        </span>
        <RadioTower size={16} className="text-sumi-diluted" aria-hidden="true" />
      </span>
      <span className="mt-auto space-y-1">
        {entries.map(([provider, count]) => (
          <span key={provider} className="flex items-center justify-between gap-3 text-sm text-sumi-black">
            <span>{PROVIDER_LABELS[provider] ?? provider}</span>
            <span>{count}</span>
          </span>
        ))}
      </span>
      <span className="self-end text-lg text-sumi-diluted" aria-hidden="true">→</span>
    </button>
  )
}
