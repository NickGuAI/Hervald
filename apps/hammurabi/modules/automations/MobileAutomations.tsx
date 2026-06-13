import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AutomationPanel } from '@modules/commanders/components/AutomationPanel'
import type { AutomationTriggerFilter } from '@modules/automations/hooks/useAutomations'

function readTriggerFilter(triggerValue: string | null): AutomationTriggerFilter {
  if (triggerValue === 'schedule' || triggerValue === 'quest' || triggerValue === 'manual') {
    return triggerValue
  }

  return 'all'
}

export interface MobileAutomationCommander {
  id: string
  host?: string
  displayName?: string
}

function readCommanderFilter(value: string | null, commanders: MobileAutomationCommander[]): string {
  if (value && (value === 'global' || commanders.some((commander) => commander.id === value))) {
    return value
  }
  return 'global'
}

interface MobileAutomationsProps {
  commanders: MobileAutomationCommander[]
}

export function MobileAutomations({
  commanders,
}: MobileAutomationsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const triggerFilter = readTriggerFilter(searchParams.get('trigger'))
  const commanderFilter = readCommanderFilter(
    searchParams.get('commander'),
    commanders,
  )

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

      <div className="px-5 pb-3">
        <label className="block">
          <span className="section-title block mb-2">Commander</span>
          <select
            value={commanderFilter}
            onChange={(event) => updateParams({ commander: event.target.value })}
            className="w-full rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-[16px] font-mono text-sumi-black focus:outline-none focus:border-ink-border-hover"
            data-testid="mobile-automation-commander-select"
          >
            <option value="global">global</option>
            {commanders.map((commander) => (
              <option key={commander.id} value={commander.id}>
                {(commander.displayName?.trim() || commander.host?.trim() || commander.id).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
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
