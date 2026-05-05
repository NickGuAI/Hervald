import { AgentAvatar } from '@/surfaces/hervald'
import type { Operator } from '../../operators/types'

export function OperatorCard({
  operator,
}: {
  operator: Operator
}) {
  return (
    <article className="card-sumi p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar
            commander={{
              id: operator.id,
              displayName: operator.displayName,
              avatarUrl: operator.avatarUrl,
            }}
            size={48}
          />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-medium text-sumi-black">{operator.displayName}</h2>
              <span className="rounded-full bg-ink-wash px-2.5 py-1 text-xs uppercase tracking-[0.16em] text-sumi-diluted">
                Founder
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Multi-operator coming soon"
          data-testid="operator-invite-button"
          className="rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-diluted disabled:cursor-not-allowed disabled:opacity-60"
        >
          Invite
        </button>
      </div>
    </article>
  )
}
