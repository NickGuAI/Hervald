import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { OrgNode, OrgTree } from '@modules/org/types'
import { CommanderDetailModal } from '@modules/org/components/CommanderDetailModal'
import { CommanderTileGrid } from '@modules/org/components/CommanderTileGrid'
import { GlobalAutomationChip } from '@modules/org/components/GlobalAutomationChip'
import { OperatorCard } from '@modules/org/components/OperatorCard'
import { exportOrgCommanderTemplate, restoreOrgCommander } from '@modules/org/hooks/useOrgActions'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { MobileOrgPage } from '@/surfaces/mobile/MobileOrgPage'
import { Toast } from './components'
import { ConfirmDelete } from './dialogs/ConfirmDelete'
import { EditCommander } from './panels/EditCommander'
import { ReplicateCommander } from './panels/ReplicateCommander'
import { HireCommanderWizard } from './wizards/HireCommanderWizard'

interface ToastState {
  message: string
  tone?: 'neutral' | 'error'
}

function CommanderCardSkeleton() {
  return (
    <article className="card-sumi animate-pulse p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-sumi-mist/50" />
          <div className="space-y-2">
            <div className="h-4 w-28 rounded-full bg-sumi-mist/50" />
            <div className="h-3 w-20 rounded-full bg-sumi-mist/40" />
          </div>
        </div>
        <div className="h-3 w-14 rounded-full bg-sumi-mist/40" />
      </div>
      <div className="mt-5 space-y-3">
        <div className="h-3 w-40 rounded-full bg-sumi-mist/40" />
        <div className="h-3 w-24 rounded-full bg-sumi-mist/30" />
        <div className="h-3 w-32 rounded-full bg-sumi-mist/30" />
      </div>
    </article>
  )
}

function findCommanderAutomations(tree: OrgTree, commanderId: string) {
  return tree.automations.filter((automation) => automation.parentId === commanderId)
}

function templateFileName(commander: OrgNode): string {
  const safeName = commander.displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'commander'
  return `commander-${safeName}-${commander.id.slice(0, 8)}.json`
}

function downloadJsonFile(fileName: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.URL.revokeObjectURL(url)
}

export function OrgPage() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading, error, refetch } = useOrgTree({ includeArchived: showArchived })
  const highlightSearchParam = searchParams.get('highlight')
  const [hireWizardOpen, setHireWizardOpen] = useState(false)
  const [editingCommander, setEditingCommander] = useState<OrgNode | null>(null)
  const [replicatingCommander, setReplicatingCommander] = useState<OrgNode | null>(null)
  const [deletingCommander, setDeletingCommander] = useState<OrgNode | null>(null)
  const [restoringCommanderId, setRestoringCommanderId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [highlightedCommanderId, setHighlightedCommanderId] = useState<string | null>(null)
  const [expandedCommanderId, setExpandedCommanderId] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) {
      return
    }

    const toastTimer = window.setTimeout(() => {
      setToast(null)
    }, 2500)

    return () => {
      window.clearTimeout(toastTimer)
    }
  }, [toast])

  useEffect(() => {
    setHighlightedCommanderId(highlightSearchParam)

    if (!highlightSearchParam) {
      return
    }

    const clearTimer = window.setTimeout(() => {
      setHighlightedCommanderId((current) => (current === highlightSearchParam ? null : current))
    }, 2000)

    return () => {
      window.clearTimeout(clearTimer)
    }
  }, [highlightSearchParam])

  useEffect(() => {
    if (!highlightedCommanderId || !data?.commanders.some((commander) => commander.id === highlightedCommanderId)) {
      return
    }

    const highlightedCard = document.querySelector<HTMLElement>(`[data-commander-card="${highlightedCommanderId}"]`)
    highlightedCard?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [data, highlightedCommanderId])

  useEffect(() => {
    if (!expandedCommanderId || !data || data.commanders.some((commander) => commander.id === expandedCommanderId)) {
      return
    }

    setExpandedCommanderId(null)
  }, [data, expandedCommanderId])

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-medium text-sumi-black">Org</h1>
          <button
            type="button"
            data-testid="commander-hire-button"
            className="rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black"
          >
            Hire
          </button>
        </div>
        <CommanderCardSkeleton />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CommanderCardSkeleton />
          <CommanderCardSkeleton />
          <CommanderCardSkeleton />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 py-8">
        <div
          data-testid="org-page-error"
          className="card-sumi flex max-w-md flex-col items-center gap-4 p-8 text-center"
        >
          <h1 className="text-xl font-medium text-sumi-black">Org</h1>
          <p className="text-sm text-sumi-diluted">
            {error instanceof Error ? error.message : 'Unable to load the org chart.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void refetch()
            }}
            className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const operatorAutomations = data.automations.filter((automation) => automation.parentId === data.operator.id)
  const commanderCards = data.commanders
  const commanderSummaries = commanderCards.map((commander) => ({
    id: commander.id,
    displayName: commander.displayName,
  }))
  const expandedCommander = commanderCards.find((commander) => commander.id === expandedCommanderId) ?? null

  function openCommandRoom(commanderId: string) {
    navigate(`/command-room?commander=${encodeURIComponent(commanderId)}`)
  }

  function highlightCommander(commanderId: string) {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('highlight', commanderId)
    setSearchParams(nextSearchParams)
  }

  async function restoreCommander(commander: OrgNode) {
    setRestoringCommanderId(commander.id)
    try {
      await restoreOrgCommander(commander.id)
      setToast({ message: `Restored ${commander.displayName}.` })
      void refetch()
    } catch (restoreError) {
      setToast({
        message: restoreError instanceof Error ? restoreError.message : 'Failed to restore commander.',
        tone: 'error',
      })
    } finally {
      setRestoringCommanderId(null)
    }
  }

  async function saveCommanderTemplate(commander: OrgNode) {
    try {
      const templatePackage = await exportOrgCommanderTemplate(commander.id)
      downloadJsonFile(templateFileName(commander), templatePackage)
      setToast({ message: `Saved template for ${commander.displayName}.` })
    } catch (exportError) {
      setToast({
        message: exportError instanceof Error ? exportError.message : 'Failed to save template.',
        tone: 'error',
      })
    }
  }

  const handleRestoreRequest = (commander: OrgNode) => {
    if (restoringCommanderId === null) {
      void restoreCommander(commander)
    }
  }

  const orgContent = isMobile ? (
    <MobileOrgPage
      tree={data}
      commanders={commanderCards}
      operatorAutomationCount={operatorAutomations.length}
      showArchived={showArchived}
      highlightedCommanderId={highlightedCommanderId}
      restoringCommanderId={restoringCommanderId}
      onToggleArchived={() => setShowArchived((current) => !current)}
      onHire={() => setHireWizardOpen(true)}
      onEdit={setEditingCommander}
      onReplicate={setReplicatingCommander}
      onDelete={setDeletingCommander}
      onRestore={handleRestoreRequest}
      onSaveTemplate={(commander) => {
        void saveCommanderTemplate(commander)
      }}
      getCommanderAutomations={(commanderId) => findCommanderAutomations(data, commanderId)}
    />
  ) : (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-medium text-sumi-black">
            {data.orgIdentity?.name ?? 'Organization'}
          </h1>
          <p className="mt-1 text-sm text-sumi-diluted">
            Organization · {data.operator.displayName}
          </p>
        </div>
        <button
          type="button"
          data-testid="commander-hire-button"
          onClick={() => setHireWizardOpen(true)}
          className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
        >
          Hire
        </button>
      </div>

      {data.archivedCommandersCount > 0 ? (
        <button
          type="button"
          data-testid="archived-commanders-toggle"
          onClick={() => setShowArchived((current) => !current)}
          className="self-start rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash"
        >
          {showArchived ? 'Hide archived' : `View archived (${data.archivedCommandersCount})`}
        </button>
      ) : null}

      <OperatorCard operator={data.operator} />

      <GlobalAutomationChip activeCount={operatorAutomations.length} />

      {commanderCards.length === 0 ? (
        <div className="card-sumi flex flex-col items-center gap-4 px-6 py-12 text-center">
          <p className="text-lg text-sumi-black">Hire your first commander.</p>
          <button
            type="button"
            data-testid="empty-org-hire-button"
            onClick={() => setHireWizardOpen(true)}
            className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
          >
            Hire
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <CommanderTileGrid
            commanders={commanderCards}
            expandedId={expandedCommanderId}
            onSelect={setExpandedCommanderId}
          />
        </div>
      )}
    </div>
  )

  return (
    <>
      {orgContent}

      <CommanderDetailModal
        open={Boolean(expandedCommander)}
        commander={expandedCommander}
        automations={expandedCommander ? findCommanderAutomations(data, expandedCommander.id) : []}
        highlighted={expandedCommander?.id === highlightedCommanderId}
        onEdit={setEditingCommander}
        onReplicate={setReplicatingCommander}
        onDelete={setDeletingCommander}
        onRestore={handleRestoreRequest}
        onSaveTemplate={(commander) => {
          void saveCommanderTemplate(commander)
        }}
        onClose={() => setExpandedCommanderId(null)}
      />

      <HireCommanderWizard
        open={hireWizardOpen}
        commanders={data.commanders}
        onClose={() => setHireWizardOpen(false)}
      />

      {editingCommander ? (
        <EditCommander
          open
          commanderId={editingCommander.id}
          commanderDisplayName={editingCommander.displayName}
          commanders={commanderSummaries}
          fallbackOperatorId={data.operator.id}
          onClose={() => setEditingCommander(null)}
          onUpdated={(displayName) => {
            setToast({ message: `Updated ${displayName}.` })
          }}
        />
      ) : null}

      {replicatingCommander ? (
        <ReplicateCommander
          open
          commanderId={replicatingCommander.id}
          commanderDisplayName={replicatingCommander.displayName}
          commanders={commanderSummaries}
          onClose={() => setReplicatingCommander(null)}
          onReplicated={(commanderId, displayName) => {
            highlightCommander(commanderId)
            setToast({ message: `Replicated ${displayName}.` })
          }}
        />
      ) : null}

      {deletingCommander ? (
        <ConfirmDelete
          open
          commanderId={deletingCommander.id}
          commanderDisplayName={deletingCommander.displayName}
          onClose={() => setDeletingCommander(null)}
          onDeleted={() => {
            setToast({ message: `Deleted ${deletingCommander.displayName}.` })
            void refetch()
          }}
          onArchived={() => {
            setToast({ message: `Archived ${deletingCommander.displayName}.` })
            void refetch()
          }}
          onOpenCommandRoom={() => openCommandRoom(deletingCommander.id)}
        />
      ) : null}

      <Toast open={Boolean(toast)} message={toast?.message ?? ''} tone={toast?.tone} />
    </>
  )
}
