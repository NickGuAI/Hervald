import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Download,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RadioTower,
  Trash2,
  Zap,
} from 'lucide-react'
import type { OrgNode, OrgTree } from '@modules/org/types'
import { AgentAvatar } from '@/surfaces/hervald'

const ROLE_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  research: 'Research',
  ops: 'Ops',
  content: 'Content',
  validator: 'Validator',
  ea: 'EA',
}

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm text-sumi-black transition-colors hover:bg-ink-wash'

function roleLabel(roleKey: string | undefined) {
  return ROLE_LABELS[roleKey ?? ''] ?? 'Commander'
}

function statusDotClass(status: string) {
  return status === 'running' || status === 'active'
    ? 'bg-sumi-black'
    : 'bg-sumi-diluted'
}

function commanderPanelPath(commanderId: string, panel: string): string {
  return `/command-room?commander=${encodeURIComponent(commanderId)}&panel=${encodeURIComponent(panel)}`
}

function MiniStatButton({
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
      className="flex items-center justify-between gap-2 rounded-[8px] border border-ink-border/70 px-2.5 py-2 text-xs text-sumi-black"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Circle size={6} className="shrink-0 fill-current" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-medium">{value}</span>
    </button>
  )
}

function MobileMoreCard({
  commander,
  menuOpen,
  onToggleMenu,
  onEdit,
  onReplicate,
  onSaveTemplate,
  onDelete,
}: {
  commander: OrgNode
  menuOpen: boolean
  onToggleMenu: () => void
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
}) {
  function handleAction(action: (commander: OrgNode) => void) {
    onToggleMenu()
    action(commander)
  }

  return (
    <div className="relative rounded-[8px] border border-ink-border bg-washi-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-sumi-diluted">More</p>
          <p className="mt-1 text-sm text-sumi-black">Manage</p>
        </div>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={`More actions for ${commander.displayName}`}
          onClick={onToggleMenu}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-border text-sumi-black"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </div>

      {menuOpen ? (
        <div className="absolute right-2 top-12 z-20 flex min-w-44 flex-col rounded-[8px] border border-ink-border bg-washi-white p-2 shadow-lg">
          <button type="button" onClick={() => handleAction(onEdit)} className={MENU_ITEM_CLASS}>
            <Pencil size={14} aria-hidden="true" />
            Edit
          </button>
          <button type="button" onClick={() => handleAction(onReplicate)} className={MENU_ITEM_CLASS}>
            <Copy size={14} aria-hidden="true" />
            Replicate
          </button>
          <button type="button" onClick={() => handleAction(onSaveTemplate)} className={MENU_ITEM_CLASS}>
            <Download size={14} aria-hidden="true" />
            Save as Template
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className={`${MENU_ITEM_CLASS} text-accent-vermillion`}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

function MobileCommanderTile({
  commander,
  automationCount,
  expanded,
  menuOpen,
  restoring,
  onToggleExpanded,
  onToggleMenu,
  onEdit,
  onReplicate,
  onDelete,
  onRestore,
  onSaveTemplate,
}: {
  commander: OrgNode
  automationCount: number
  expanded: boolean
  menuOpen: boolean
  restoring: boolean
  onToggleExpanded: () => void
  onToggleMenu: () => void
  onEdit: (commander: OrgNode) => void
  onReplicate: (commander: OrgNode) => void
  onDelete: (commander: OrgNode) => void
  onRestore: (commander: OrgNode) => void
  onSaveTemplate: (commander: OrgNode) => void
}) {
  const navigate = useNavigate()
  const counts = commander.counts ?? {
    activeQuests: commander.questsInFlight?.active ?? 0,
    activeWorkers: commander.status === 'running' ? 1 : 0,
    activeChats: commander.activeUiChats ?? 0,
  }
  const channelTotal = Object.values(commander.channels ?? {}).reduce((sum, count) => sum + count, 0)

  return (
    <section
      data-testid="mobile-org-commander-tile"
      data-commander-card={commander.id}
      className={[
        'rounded-[8px] border border-ink-border bg-washi-white transition-opacity',
        commander.archived ? 'opacity-60' : '',
      ].join(' ')}
    >
      <button
        type="button"
        data-testid="mobile-org-commander-toggle"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(commander.status)}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-sumi-black">{commander.displayName}</span>
            <span className="block truncate text-xs text-sumi-diluted">
              {roleLabel(commander.roleKey)} - {commander.status}
            </span>
          </span>
        </span>
        {expanded ? (
          <ChevronDown size={16} className="shrink-0 text-sumi-diluted" aria-hidden="true" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-sumi-diluted" aria-hidden="true" />
        )}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-ink-border px-3 py-3">
          <button
            type="button"
            data-testid="mobile-org-check-on"
            onClick={() => navigate(`/command-room?commander=${encodeURIComponent(commander.id)}`)}
            className="flex w-full items-center justify-between gap-3 rounded-[8px] bg-ink-wash px-3 py-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <MessageSquare size={16} className="shrink-0 text-sumi-black" aria-hidden="true" />
              <span className="truncate text-sm font-medium text-sumi-black">
                Check On {commander.displayName}
              </span>
            </span>
            <span className="text-sumi-diluted" aria-hidden="true">&gt;</span>
          </button>

          {commander.archived ? (
            <button
              type="button"
              disabled={restoring}
              data-testid="mobile-org-restore-button"
              onClick={() => onRestore(commander)}
              className="w-full rounded-[8px] bg-sumi-black px-3 py-2 text-sm text-washi-white disabled:opacity-60"
            >
              Restore
            </button>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-ink-border bg-washi-white p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-sumi-diluted">Status</p>
              <div className="mt-2 grid gap-2">
                <MiniStatButton
                  label="Quests"
                  value={counts.activeQuests}
                  onClick={() => navigate(commanderPanelPath(commander.id, 'quests'))}
                />
                <MiniStatButton
                  label="Workers"
                  value={counts.activeWorkers}
                  onClick={() => navigate(commanderPanelPath(commander.id, 'workers'))}
                />
                <MiniStatButton
                  label="Chats"
                  value={counts.activeChats}
                  onClick={() => navigate(commanderPanelPath(commander.id, 'chat'))}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate(commanderPanelPath(commander.id, 'automation'))}
              className="rounded-[8px] border border-ink-border bg-washi-white p-3 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-sumi-diluted">Automations</span>
                <Zap size={14} className="text-sumi-diluted" aria-hidden="true" />
              </span>
              <span className="mt-4 block text-sm font-medium text-sumi-black">{automationCount}</span>
              <span className="mt-1 block text-xs text-sumi-diluted">Open panel &gt;</span>
            </button>

            <button
              type="button"
              onClick={() => navigate(`/channels?commander=${encodeURIComponent(commander.id)}`)}
              className="rounded-[8px] border border-ink-border bg-washi-white p-3 text-left"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-sumi-diluted">Channels</span>
                <RadioTower size={14} className="text-sumi-diluted" aria-hidden="true" />
              </span>
              <span className="mt-4 block text-sm font-medium text-sumi-black">{channelTotal}</span>
              <span className="mt-1 block text-xs text-sumi-diluted">Configure &gt;</span>
            </button>

            <MobileMoreCard
              commander={commander}
              menuOpen={menuOpen}
              onToggleMenu={onToggleMenu}
              onEdit={onEdit}
              onReplicate={onReplicate}
              onSaveTemplate={onSaveTemplate}
              onDelete={onDelete}
            />
          </div>
        </div>
      ) : null}
    </section>
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
  const [expandedCommanderIds, setExpandedCommanderIds] = useState<Set<string>>(new Set())
  const [menuCommanderId, setMenuCommanderId] = useState<string | null>(null)
  const founder = tree.operator

  function toggleExpanded(commanderId: string) {
    setExpandedCommanderIds((current) => {
      const next = new Set(current)
      if (next.has(commanderId)) {
        next.delete(commanderId)
      } else {
        next.add(commanderId)
      }
      return next
    })
  }

  return (
    <div data-testid="mobile-org-page" className="flex w-full flex-col gap-4 px-4 pb-24 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-medium text-sumi-black">
            {tree.orgIdentity?.name ?? 'Organization'}
          </h1>
          <p className="mt-1 truncate text-sm text-sumi-diluted">Organization - {founder.displayName}</p>
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

      <article className="rounded-[8px] border border-ink-border bg-washi-white p-4">
        <div className="flex items-center gap-3">
          <AgentAvatar
            commander={{
              id: founder.id,
              displayName: founder.displayName,
              avatarUrl: founder.avatarUrl,
            }}
            size={40}
          />
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-sumi-black">{founder.displayName}</p>
            <p className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Founder</p>
          </div>
        </div>
      </article>

      <button
        type="button"
        data-testid="mobile-global-automation-chip"
        onClick={() => navigate('/command-room?commander=global&panel=automation')}
        className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-ink-border bg-washi-white p-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
            <Zap size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-sumi-black">
              Global Automation - {operatorAutomationCount} active
            </span>
            <span className="mt-0.5 block text-xs text-sumi-diluted">Command-room panel</span>
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
        <div className="rounded-[8px] border border-ink-border bg-washi-white px-4 py-8 text-center">
          <p className="text-sm text-sumi-black">Hire your first commander.</p>
          <button
            type="button"
            data-testid="mobile-empty-org-hire-button"
            onClick={onHire}
            className="mt-4 rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white"
          >
            Hire
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {commanders.map((commander) => (
            <MobileCommanderTile
              key={commander.id}
              commander={commander}
              automationCount={getCommanderAutomations(commander.id).length}
              expanded={expandedCommanderIds.has(commander.id) || commander.id === highlightedCommanderId}
              menuOpen={menuCommanderId === commander.id}
              restoring={restoringCommanderId === commander.id}
              onToggleExpanded={() => toggleExpanded(commander.id)}
              onToggleMenu={() => {
                setMenuCommanderId((current) => (current === commander.id ? null : commander.id))
              }}
              onEdit={onEdit}
              onReplicate={onReplicate}
              onDelete={onDelete}
              onRestore={onRestore}
              onSaveTemplate={onSaveTemplate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
