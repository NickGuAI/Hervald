import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '@modules/components/ConfirmModal'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
import { Toast } from '@modules/components/Toast'
import { CreateCommanderWizard } from '@modules/commanders/components/CreateCommanderWizard'
import { useCommander } from '@modules/commanders/hooks/useCommander'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import type { OrgNode, OrgTree } from '@modules/org/types'
import { CommanderDetailModal } from '@modules/org/components/CommanderDetailModal'
import { CommanderProfileCardGrid } from '@modules/org/components/CommanderProfileCardGrid'
import { GlobalAutomationChip } from '@modules/org/components/GlobalAutomationChip'
import { OrgTopRow } from '@modules/org/components/OrgTopRow'
import { exportOrgCommanderTemplate, restoreOrgCommander } from '@modules/org/hooks/useOrgActions'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { MobileOrgPage } from './MobileOrgPage'
import { ConfirmDelete } from './dialogs/ConfirmDelete'
import { EditCommander } from './panels/EditCommander'
import { ReplicateCommander } from './panels/ReplicateCommander'

interface ToastState {
  message: string
  tone?: 'neutral' | 'error'
}

function CommanderCardSkeleton() {
  return (
    <article className="card-sumi animate-pulse p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-[var(--hv-fg-faint)]" />
          <div className="space-y-2">
            <div className="h-4 w-28 rounded-full bg-[var(--hv-fg-faint)]" />
            <div className="h-3 w-20 rounded-full bg-[var(--hv-fg-faint)]" />
          </div>
        </div>
        <div className="h-3 w-14 rounded-full bg-[var(--hv-fg-faint)]" />
      </div>
      <div className="mt-5 space-y-3">
        <div className="h-3 w-40 rounded-full bg-[var(--hv-fg-faint)]" />
        <div className="h-3 w-24 rounded-full bg-[var(--hv-fg-faint)]" />
        <div className="h-3 w-32 rounded-full bg-[var(--hv-fg-faint)]" />
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
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const commanderState = useCommander()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showArchived, setShowArchived] = useState(false)
  const { data, isLoading, error, refetch } = useOrgTree({ includeArchived: showArchived })
  const highlightSearchParam = searchParams.get('highlight')
  const [hireWizardOpen, setHireWizardOpen] = useState(false)
  const [hireWizardBusy, setHireWizardBusy] = useState(false)
  const [editingCommander, setEditingCommander] = useState<OrgNode | null>(null)
  const [replicatingCommander, setReplicatingCommander] = useState<OrgNode | null>(null)
  const [deletingCommander, setDeletingCommander] = useState<OrgNode | null>(null)
  const [restoringCommanderId, setRestoringCommanderId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [highlightedCommanderId, setHighlightedCommanderId] = useState<string | null>(null)
  const [expandedCommanderId, setExpandedCommanderId] = useState<string | null>(null)
  const [confirmHireWizardCloseOpen, setConfirmHireWizardCloseOpen] = useState(false)

  const handleCloseCreateCommander = useCallback(() => {
    if (hireWizardBusy) {
      setConfirmHireWizardCloseOpen(true)
      return
    }
    setHireWizardOpen(false)
    setHireWizardBusy(false)
  }, [hireWizardBusy])

  const handleConfirmCloseCreateCommander = useCallback(() => {
    setConfirmHireWizardCloseOpen(false)
    setHireWizardOpen(false)
    setHireWizardBusy(false)
  }, [])

  const handleCreateCommander = useCallback(async (
    input: Parameters<typeof commanderState.createCommander>[0],
  ) => {
    await commanderState.createCommander(input)
    await queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY })
  }, [commanderState, queryClient])

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

  useEffect(() => {
    if (!data || searchParams.get('firstRun') !== 'true') {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('firstRun')
    setSearchParams(nextSearchParams, { replace: true })
  }, [data, searchParams, setSearchParams])

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-medium text-[color:var(--hv-fg)]">Org</h1>
          <button
            type="button"
            data-testid="commander-hire-button"
            className="rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)]"
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
          <h1 className="text-xl font-medium text-[color:var(--hv-fg)]">Org</h1>
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">
            {error instanceof Error ? error.message : 'Unable to load the org chart.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void refetch()
            }}
            className="rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)]"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const operatorAutomations = data.automations.filter((automation) => automation.parentId === data.operator.id)
  const commanderCards = data.commanders
  const commanderAutomationCountsById = Object.fromEntries(
    commanderCards.map((commander) => [commander.id, findCommanderAutomations(data, commander.id).length]),
  )
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
      <OrgTopRow
        orgIdentity={data.orgIdentity}
        operator={data.operator}
        onHire={() => setHireWizardOpen(true)}
      />

      <section data-testid="org-global-automation-section">
        <GlobalAutomationChip activeCount={operatorAutomations.length} />
      </section>

      {data.archivedCommandersCount > 0 ? (
        <button
          type="button"
          data-testid="archived-commanders-toggle"
          onClick={() => setShowArchived((current) => !current)}
          className="self-start rounded-full border border-[color:var(--hv-border-hair)] px-4 py-2 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
        >
          {showArchived ? 'Hide archived' : `View archived (${data.archivedCommandersCount})`}
        </button>
      ) : null}

      {commanderCards.length === 0 ? (
        <div className="card-sumi flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="space-y-2">
            <p className="text-lg text-[color:var(--hv-fg)]">Hire your first commander.</p>
            <p className="max-w-xl text-sm text-[color:var(--hv-fg-subtle)]">
              Pick Quick Create for a guided template, Talk to Me to spin up a wizard agent, or Advanced for the full form.
            </p>
          </div>
          <button
            type="button"
            data-testid="empty-org-hire-button"
            onClick={() => setHireWizardOpen(true)}
            className="rounded-full bg-[var(--hv-button-primary-bg)] px-4 py-2 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)]"
          >
            Open wizard
          </button>
        </div>
      ) : (
        <section data-testid="org-commander-grid-section" className="space-y-8">
          <CommanderProfileCardGrid
            commanders={commanderCards}
            automationCountsByCommanderId={commanderAutomationCountsById}
            expandedId={expandedCommanderId}
            onSelect={setExpandedCommanderId}
          />
        </section>
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

      <ModalFormContainer
        open={hireWizardOpen}
        title="New Commander"
        onClose={handleCloseCreateCommander}
        desktopClassName="max-w-[96rem] max-h-[92dvh]"
        mobileClassName="max-h-[96dvh]"
      >
        <CreateCommanderWizard
          onAdd={handleCreateCommander}
          isPending={commanderState.createCommanderPending}
          onClose={handleCloseCreateCommander}
          onBusyChange={setHireWizardBusy}
          onWizardCreated={async () => {
            await queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY })
          }}
        />
      </ModalFormContainer>

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

      <ConfirmModal
        open={confirmHireWizardCloseOpen}
        title="Close setup chat?"
        message="A commander setup chat is still active. Close and cancel it?"
        confirmLabel="Close setup"
        confirmTone="danger"
        onClose={() => setConfirmHireWizardCloseOpen(false)}
        onConfirm={handleConfirmCloseCreateCommander}
      />
      <Toast open={Boolean(toast)} message={toast?.message ?? ''} tone={toast?.tone} />
    </>
  )
}
