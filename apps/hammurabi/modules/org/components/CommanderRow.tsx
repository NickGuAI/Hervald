import type { OrgNode } from '../types'
import { AutomationsCard } from './AutomationsCard'
import { ChannelsCard } from './ChannelsCard'
import { CheckOnHero } from './CheckOnHero'
import { MoreCard } from './MoreCard'
import { StatusCard } from './StatusCard'

export const ROLE_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  research: 'Research',
  ops: 'Ops',
  content: 'Content',
  validator: 'Validator',
  ea: 'EA',
}

function roleLabel(roleKey: string | undefined) {
  return ROLE_LABELS[roleKey ?? ''] ?? 'Commander'
}

function initials(name: string): string {
  const [first = 'C', second = 'M'] = name.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function statusDotClass(status: string) {
  return status === 'running' || status === 'active'
    ? 'bg-sumi-black'
    : 'bg-sumi-diluted'
}

export function CommanderRow({
  commander,
  automations,
  highlighted,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
}: {
  commander: OrgNode
  automations: ReadonlyArray<OrgNode>
  highlighted: boolean
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
}) {
  return (
    <section
      data-commander-card={commander.id}
      data-testid="commander-row"
      className={[
        'space-y-3 rounded-[8px] transition-all duration-300',
        highlighted ? 'ring-2 ring-sumi-black ring-offset-4 ring-offset-washi-white' : '',
        commander.archived ? 'opacity-60' : '',
      ].join(' ').trim()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {commander.avatarUrl ? (
            <img
              src={commander.avatarUrl}
              alt={commander.displayName}
              className="h-11 w-11 rounded-full border border-ink-border object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-border bg-washi-aged text-sm font-medium text-sumi-black">
              {initials(commander.displayName)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-sumi-diluted">
              Commander · {roleLabel(commander.roleKey)}
            </p>
            <h2 className="truncate text-lg font-medium text-sumi-black">{commander.displayName}</h2>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-sumi-diluted">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(commander.status)}`} />
          <span>{commander.status}</span>
          {commander.archived ? (
            <>
              <span className="badge-sumi badge-idle">Archived</span>
              <button
                type="button"
                data-testid="commander-restore-button"
                data-commander-id={commander.id}
                onClick={() => onRestore(commander)}
                className="rounded-full bg-sumi-black px-3 py-1.5 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
              >
                Restore
              </button>
            </>
          ) : null}
        </div>
      </div>

      <CheckOnHero commander={commander} />

      <div className="grid gap-4 lg:grid-cols-4">
        <StatusCard commander={commander} />
        <AutomationsCard commander={commander} automationCount={automations.length} />
        <ChannelsCard commander={commander} />
        <MoreCard
          commander={commander}
          onEdit={onEdit}
          onReplicate={onReplicate}
          onSaveTemplate={onSaveTemplate}
          onDelete={onDelete}
        />
      </div>
    </section>
  )
}
