import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AutomationPanel } from '@modules/commanders/components/AutomationPanel'
import type { AutomationTriggerFilter } from '@modules/automations/hooks/useAutomations'
import { useOrgTree } from '@modules/org/hooks/useOrgTree'
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  MobileAutomations,
  type MobileAutomationCommander,
} from './MobileAutomations'

function readTriggerFilter(triggerValue: string | null): AutomationTriggerFilter {
  if (triggerValue === 'schedule' || triggerValue === 'quest' || triggerValue === 'manual') {
    return triggerValue
  }

  return 'all'
}

function readCommanderFilter(value: string | null, commanders: MobileAutomationCommander[]): string {
  if (value && (value === 'global' || commanders.some((commander) => commander.id === value))) {
    return value
  }

  return 'global'
}

export function AutomationsPage() {
  const isMobile = useIsMobile()
  const orgTree = useOrgTree({ includeArchived: false })
  const [searchParams, setSearchParams] = useSearchParams()
  const orgCommanders = orgTree.data?.commanders ?? []
  const commanders = useMemo<MobileAutomationCommander[]>(
    () => orgCommanders.map((commander) => ({
      id: commander.id,
      displayName: commander.displayName,
    })),
    [orgCommanders],
  )
  const triggerFilter = readTriggerFilter(searchParams.get('trigger'))
  const commanderFilter = readCommanderFilter(searchParams.get('commander'), commanders)
  const scopeCommander = commanders.find((commander) => commander.id === commanderFilter) ?? null

  function updateParams(patch: Record<string, string | null>) {
    const nextParams = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) {
        nextParams.set(key, value)
      } else {
        nextParams.delete(key)
      }
    }
    setSearchParams(nextParams, { replace: true })
  }

  if (orgTree.isLoading) {
    return (
      <section
        className="flex min-h-0 flex-1 items-center justify-center"
        data-testid="automations-page-loading"
      >
        <div className="h-3 w-3 animate-breathe rounded-full bg-sumi-mist" />
      </section>
    )
  }

  if (orgTree.error || !orgTree.data) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
        <div
          data-testid="automations-page-error"
          className="card-sumi flex max-w-md flex-col items-center gap-4 p-8 text-center"
        >
          <h1 className="text-xl font-medium text-sumi-black">Automations</h1>
          <p className="text-sm text-sumi-diluted">
            {orgTree.error instanceof Error ? orgTree.error.message : 'Unable to load automation scope.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void orgTree.refetch()
            }}
            className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
          >
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (isMobile) {
    return <MobileAutomations commanders={commanders} />
  }

  return (
    <section
      className="flex min-h-0 flex-1 w-full flex-col bg-washi-aged/35"
      data-testid="automations-page"
    >
      <div className="border-b border-ink-border px-6 py-5">
        <p className="text-xs uppercase tracking-wide text-sumi-diluted">Hervald</p>
        <h1 className="mt-1 text-3xl font-medium text-sumi-black">Automations</h1>

        <div className="mt-4 flex gap-2 overflow-x-auto" data-testid="automations-commander-filter">
          <button
            type="button"
            onClick={() => updateParams({ commander: 'global' })}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-mono"
            style={{
              background: commanderFilter === 'global' ? 'var(--hv-fg)' : 'transparent',
              color: commanderFilter === 'global' ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
              border: commanderFilter === 'global' ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
            }}
          >
            global
          </button>
          {commanders.map((commander) => (
            <button
              key={commander.id}
              type="button"
              onClick={() => updateParams({ commander: commander.id })}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-mono"
              style={{
                background: commanderFilter === commander.id ? 'var(--hv-fg)' : 'transparent',
                color: commanderFilter === commander.id ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
                border: commanderFilter === commander.id ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
              }}
            >
              {commander.displayName?.trim().toLowerCase() || commander.id}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <AutomationPanel
          scope={
            commanderFilter === 'global' || !scopeCommander
              ? { kind: 'global' }
              : { kind: 'commander', commander: scopeCommander }
          }
          filter={triggerFilter}
          onFilterChange={(nextFilter) => {
            updateParams({
              trigger: nextFilter === 'all' ? null : nextFilter,
            })
          }}
        />
      </div>
    </section>
  )
}

export default AutomationsPage
