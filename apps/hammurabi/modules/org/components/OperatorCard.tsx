import { AgentAvatar } from '@modules/components/hervald'
import { cn } from '@/lib/utils'
import { resolveFounderAvatarSrc } from '@modules/operators/founder-avatar'
import type { Operator } from '../../operators/types'

export function OperatorCard({
  operator,
  className,
}: {
  operator: Operator
  className?: string
}) {
  const avatarSrc = resolveFounderAvatarSrc(operator, null)

  return (
    <article className={cn(
      'rounded-[16px] border-2 border-[color:var(--hv-border-firm)] bg-[var(--hv-surface-card)] px-5 py-4',
      className,
    )}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar
            commander={{
              id: operator.id,
              displayName: operator.displayName,
              avatarUrl: avatarSrc,
            }}
            size={48}
          />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium text-[color:var(--hv-fg)]">{operator.displayName}</h2>
              <span className="rounded-full bg-[var(--hv-surface-selected)] px-2.5 py-1 text-xs uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">
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
          className="rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Invite
        </button>
      </div>
    </article>
  )
}
