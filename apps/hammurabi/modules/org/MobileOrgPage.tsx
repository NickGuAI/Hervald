import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Zap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { CommanderRow } from '@modules/org/components/CommanderRow'
import type { OrgNode, OrgTree } from '@modules/org/types'
import BottomSheet from '@/components/BottomSheet'
import { AgentAvatar } from '@modules/components/hervald'
import { resolveFounderAvatarSrc } from '@modules/operators/founder-avatar'

function statusDotClass(status: string) {
  return status === 'running' || status === 'active'
    ? 'bg-[var(--hv-button-primary-bg)]'
    : 'bg-[var(--hv-fg-subtle)]'
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

function initials(name?: string | null): string {
  const source = name?.trim() || 'Founder'
  const [first = 'F', second = 'O'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function MobileCommanderTile({
  commander,
  automationCount,
  selected,
  onSelect,
}: {
  commander: OrgNode
  automationCount: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <article
      data-testid="mobile-org-commander-tile"
      data-commander-card={commander.id}
      className={[
        'rounded-[12px] border border-[color:var(--hv-border-soft)] bg-[var(--hv-surface-card)] transition-colors',
        selected ? 'bg-[var(--hv-surface-selected)] ring-1 ring-[color:var(--hv-border-firm)]' : '',
        commander.archived ? 'opacity-60' : '',
      ].join(' ').trim()}
    >
      <button
        type="button"
        data-testid="mobile-org-commander-toggle"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <AgentAvatar
            commander={{
              id: commander.id,
              displayName: commander.displayName,
              avatarUrl: commander.avatarUrl,
              ui: commander.profile,
            }}
            size={40}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[color:var(--hv-fg)]">{commander.displayName}</span>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-[color:var(--hv-fg-subtle)]">
              <span className={`h-2 w-2 rounded-full ${statusDotClass(commander.status)}`} />
              <span>
                Commander · {statusLabel(commander.status, commander.archived)} · {automationCount} automation
                {automationCount === 1 ? '' : 's'}
              </span>
            </span>
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-[color:var(--hv-fg-subtle)]" aria-hidden="true" />
      </button>
    </article>
  )
}

function MobileCommanderDetailSheet({
  commander,
  automations,
  highlighted,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
  onClose,
}: {
  commander: OrgNode | null
  automations: ReadonlyArray<OrgNode>
  highlighted: boolean
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  onClose: () => void
}) {
  if (!commander) {
    return null
  }

  return (
    <BottomSheet open={Boolean(commander)} onClose={onClose} maxHeight="85dvh">
      <div className="overflow-y-auto px-4 pb-5 pt-2" data-testid="mobile-org-commander-sheet">
        <CommanderRow
          commander={commander}
          automations={automations}
          highlighted={highlighted}
          onEdit={(selectedCommander) => {
            onClose()
            onEdit(selectedCommander)
          }}
          onReplicate={(selectedCommander) => {
            onClose()
            onReplicate(selectedCommander)
          }}
          onDelete={(selectedCommander) => {
            onClose()
            onDelete(selectedCommander)
          }}
          onRestore={(selectedCommander) => {
            onClose()
            onRestore(selectedCommander)
          }}
          onSaveTemplate={onSaveTemplate}
        />
      </div>
    </BottomSheet>
  )
}

export function MobileOrgPage({
  tree,
  commanders,
  operatorAutomationCount,
  showArchived,
  highlightedCommanderId,
  restoringCommanderId,
  onToggleArchived,
  onHire,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
  getCommanderAutomations,
}: {
  tree: OrgTree
  commanders: OrgNode[]
  operatorAutomationCount: number
  showArchived: boolean
  highlightedCommanderId: string | null
  restoringCommanderId: string | null
  onToggleArchived: () => void
  onHire: () => void
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  getCommanderAutomations: (commanderId: string) => ReadonlyArray<OrgNode>
}) {
  const navigate = useNavigate()
  const auth = useAuth()
  const [selectedCommanderId, setSelectedCommanderId] = useState<string | null>(highlightedCommanderId)
  const founder = tree.operator
  const founderAvatarSrc = resolveFounderAvatarSrc(founder, auth)
  const selectedCommander = commanders.find((commander) => commander.id === selectedCommanderId) ?? null

  useEffect(() => {
    if (!highlightedCommanderId) {
      return
    }
    if (!commanders.some((commander) => commander.id === highlightedCommanderId)) {
      return
    }
    setSelectedCommanderId(highlightedCommanderId)
  }, [commanders, highlightedCommanderId])

  useEffect(() => {
    if (!selectedCommanderId) {
      return
    }
    if (commanders.some((commander) => commander.id === selectedCommanderId)) {
      return
    }
    setSelectedCommanderId(null)
  }, [commanders, selectedCommanderId])

  return (
    <>
      <div
        data-testid="mobile-org-page"
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-medium text-[color:var(--hv-fg)]">{tree.orgIdentity?.name || 'Organization'}</h1>
            <p className="mt-1 truncate text-sm text-[color:var(--hv-fg-subtle)]">Organization · {founder.displayName}</p>
          </div>
          <button
            type="button"
            data-testid="mobile-commander-hire-button"
            onClick={onHire}
            className="shrink-0 rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)]"
          >
            Hire
          </button>
        </header>

        <article className="rounded-[12px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {founderAvatarSrc ? (
                <AgentAvatar
                  commander={{
                    id: founder.id,
                    displayName: founder.displayName,
                    avatarUrl: founderAvatarSrc,
                  }}
                  size={40}
                />
              ) : (
                <div
                  data-testid="mobile-founder-avatar-initials"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-raised)] font-display text-base italic text-[color:var(--hv-fg-muted)]"
                  aria-label={`${founder.displayName} avatar`}
                >
                  {initials(founder.displayName)}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-medium text-[color:var(--hv-fg)]">{founder.displayName}</p>
                  <span className="rounded-full bg-[var(--hv-surface-selected)] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--hv-fg-subtle)]">
                    Founder
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Multi-operator coming soon"
              className="rounded-full border border-[color:var(--hv-border-hair)] px-3 py-1.5 text-sm text-[color:var(--hv-fg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Invite
            </button>
          </div>
        </article>

        <button
          type="button"
          data-testid="mobile-global-automation-chip"
          onClick={() => navigate('/automations?commander=global')}
          className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-4 text-left"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hv-surface-selected)] text-[color:var(--hv-fg)]">
              <Zap size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[color:var(--hv-fg)]">
                Global Automation · {operatorAutomationCount} active
              </span>
              <span className="mt-0.5 block text-xs text-[color:var(--hv-fg-subtle)]">Automation page</span>
            </span>
          </span>
          <span className="text-[color:var(--hv-fg-subtle)]" aria-hidden="true">&gt;</span>
        </button>

        {tree.archivedCommandersCount > 0 ? (
          <button
            type="button"
            data-testid="mobile-archived-commanders-toggle"
            onClick={onToggleArchived}
            className="self-start rounded-full border border-[color:var(--hv-border-hair)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)]"
          >
            {showArchived ? 'Hide archived' : `View archived (${tree.archivedCommandersCount})`}
          </button>
        ) : null}

        {commanders.length === 0 ? (
          <div className="rounded-[12px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-8 text-center">
            <div className="space-y-2">
              <p className="text-sm text-[color:var(--hv-fg)]">Hire your first commander.</p>
              <p className="text-xs leading-5 text-[color:var(--hv-fg-subtle)]">
                Pick Quick Create for a guided template, Talk to Me to spin up a wizard agent, or Advanced for the full form.
              </p>
            </div>
            <button
              type="button"
              data-testid="mobile-empty-org-hire-button"
              onClick={onHire}
              className="mt-4 rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)]"
            >
              Open wizard
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {commanders.map((commander) => (
              <MobileCommanderTile
                key={commander.id}
                commander={commander}
                automationCount={getCommanderAutomations(commander.id).length}
                selected={commander.id === selectedCommanderId}
                onSelect={() => setSelectedCommanderId(commander.id)}
              />
            ))}
          </div>
        )}
      </div>

      <MobileCommanderDetailSheet
        commander={selectedCommander}
        automations={selectedCommander ? getCommanderAutomations(selectedCommander.id) : []}
        highlighted={selectedCommander?.id === highlightedCommanderId}
        onEdit={onEdit}
        onReplicate={onReplicate}
        onDelete={onDelete}
        onRestore={(commander) => {
          if (restoringCommanderId === null) {
            onRestore(commander)
          }
        }}
        onSaveTemplate={onSaveTemplate}
        onClose={() => setSelectedCommanderId(null)}
      />
    </>
  )
}
