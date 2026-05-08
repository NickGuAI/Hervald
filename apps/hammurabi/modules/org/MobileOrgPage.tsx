import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Zap } from 'lucide-react'
import { CommanderRow } from '@modules/org/components/CommanderRow'
import type { OrgNode, OrgTree } from '@modules/org/types'
import BottomSheet from '@/components/BottomSheet'
import { AgentAvatar } from '@modules/components/hervald'

function statusDotClass(status: string) {
  return status === 'running' || status === 'active'
    ? 'bg-sumi-black'
    : 'bg-sumi-diluted'
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

function MobileCommanderTile({
  commander,
  selected,
  onSelect,
}: {
  commander: OrgNode
  selected: boolean
  onSelect: () => void
}) {
  return (
    <article
      data-testid="mobile-org-commander-tile"
      data-commander-card={commander.id}
      className={[
        'rounded-[12px] border border-ink-border bg-washi-white transition-colors',
        selected ? 'border-sumi-black bg-ink-wash/40' : '',
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
            }}
            size={40}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-sumi-black">{commander.displayName}</span>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-sumi-diluted">
              <span className={`h-2 w-2 rounded-full ${statusDotClass(commander.status)}`} />
              <span>Commander · {statusLabel(commander.status, commander.archived)}</span>
            </span>
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-sumi-diluted" aria-hidden="true" />
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
  const [selectedCommanderId, setSelectedCommanderId] = useState<string | null>(highlightedCommanderId)
  const founder = tree.operator
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
            <h1 className="truncate text-2xl font-medium text-sumi-black">{tree.orgIdentity?.name || 'Organization'}</h1>
            <p className="mt-1 truncate text-sm text-sumi-diluted">Organization · {founder.displayName}</p>
          </div>
          <button
            type="button"
            data-testid="mobile-commander-hire-button"
            onClick={onHire}
            className="shrink-0 rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white"
          >
            Hire
          </button>
        </header>

        <article className="rounded-[12px] border border-ink-border/70 bg-washi-white/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AgentAvatar
                commander={{
                  id: founder.id,
                  displayName: founder.displayName,
                  avatarUrl: founder.avatarUrl,
                }}
                size={40}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-medium text-sumi-black">{founder.displayName}</p>
                  <span className="rounded-full bg-ink-wash px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-sumi-diluted">
                    Founder
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled
              title="Multi-operator coming soon"
              className="rounded-full border border-ink-border px-3 py-1.5 text-sm text-sumi-diluted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Invite
            </button>
          </div>
        </article>

        <button
          type="button"
          data-testid="mobile-global-automation-chip"
          onClick={() => navigate('/automations?commander=global')}
          className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-ink-border/70 bg-washi-white/70 px-4 py-4 text-left"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
              <Zap size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-sumi-black">
                Global Automation · {operatorAutomationCount} active
              </span>
              <span className="mt-0.5 block text-xs text-sumi-diluted">Automation page</span>
            </span>
          </span>
          <span className="text-sumi-diluted" aria-hidden="true">&gt;</span>
        </button>

        {tree.archivedCommandersCount > 0 ? (
          <button
            type="button"
            data-testid="mobile-archived-commanders-toggle"
            onClick={onToggleArchived}
            className="self-start rounded-full border border-ink-border px-3 py-1.5 text-sm text-sumi-black"
          >
            {showArchived ? 'Hide archived' : `View archived (${tree.archivedCommandersCount})`}
          </button>
        ) : null}

        {commanders.length === 0 ? (
          <div className="rounded-[12px] border border-ink-border bg-washi-white px-4 py-8 text-center">
            <div className="space-y-2">
              <p className="text-sm text-sumi-black">Hire your first commander.</p>
              <p className="text-xs leading-5 text-sumi-diluted">
                Pick Quick Create for a guided template, Talk to Me to spin up a wizard agent, or Advanced for the full form.
              </p>
            </div>
            <button
              type="button"
              data-testid="mobile-empty-org-hire-button"
              onClick={onHire}
              className="mt-4 rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white"
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
