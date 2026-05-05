import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AutomationPanel } from '@modules/commanders/components/AutomationPanel'
import type { CommanderSession } from '@modules/commanders/hooks/useCommander'
import type { AutomationTriggerFilter } from '@modules/automations/hooks/useAutomations'

function readTriggerFilter(triggerValue: string | null): AutomationTriggerFilter {
  if (triggerValue === 'schedule' || triggerValue === 'quest' || triggerValue === 'manual') {
    return triggerValue
  }

  return 'all'
}

function readCommanderFilter(value: string | null, fallbackCommanderId: string | null, commanders: CommanderSession[]): string {
  if (value && (value === 'global' || commanders.some((commander) => commander.id === value))) {
    return value
  }
  if (fallbackCommanderId) {
    return fallbackCommanderId
  }
  return commanders[0]?.id ?? 'global'
}

interface MobileAutomationsProps {
  commanders: CommanderSession[]
  selectedCommanderId: string | null
  onSelectCommanderId: (id: string) => void
  crons?: unknown
  cronsLoading?: unknown
  cronsError?: unknown
  addCron?: unknown
  addCronPending?: unknown
  toggleCron?: unknown
  toggleCronPending?: unknown
  toggleCronId?: unknown
  updateCron?: unknown
  updateCronPending?: unknown
  updateCronId?: unknown
  triggerCron?: unknown
  triggerCronPending?: unknown
  triggerCronId?: unknown
  deleteCron?: unknown
  deleteCronPending?: unknown
  deleteCronId?: unknown
}

export function MobileAutomations({
  commanders,
  selectedCommanderId,
  onSelectCommanderId,
}: MobileAutomationsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const triggerFilter = readTriggerFilter(searchParams.get('trigger'))
  const commanderFilter = readCommanderFilter(
    searchParams.get('commander'),
    selectedCommanderId,
    commanders,
  )

  useEffect(() => {
    if (commanderFilter === 'global' || commanderFilter === selectedCommanderId) {
      return
    }
    onSelectCommanderId(commanderFilter)
  }, [commanderFilter, onSelectCommanderId, selectedCommanderId])

  const scopeCommander = useMemo(
    () => commanders.find((commander) => commander.id === commanderFilter) ?? null,
    [commanders, commanderFilter],
  )

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

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-automations">
      <div className="px-5 pb-3 pt-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">hervald</p>
        <h1 className="mt-1 font-display text-4xl text-sumi-black">Automations</h1>
        <p className="mt-2 text-sm italic text-sumi-diluted">how commanders wake up on their own</p>
      </div>

      <div className="hv-scroll flex gap-2 overflow-x-auto px-4 pb-3">
        <button
          type="button"
          onClick={() => updateParams({ commander: 'global' })}
          className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-mono"
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
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-mono"
            style={{
              background: commanderFilter === commander.id ? 'var(--hv-fg)' : 'transparent',
              color: commanderFilter === commander.id ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
              border: commanderFilter === commander.id ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
            }}
          >
            {(commander.displayName?.trim() || commander.host).toLowerCase()}
          </button>
        ))}
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
