import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CommanderSession } from '@modules/commanders/hooks/useCommander'
import { QuestBoard } from '@modules/commanders/components/QuestBoard'
import { CommanderCronTab } from '@modules/commanders/components/CommanderCronTab'
import { SentinelPanel } from '@modules/sentinels/components/SentinelPanel'

type AutomationSegment = 'cron' | 'sentinels' | 'quests'

function readSegment(value: string | null): AutomationSegment {
  if (value === 'sentinels' || value === 'quests') {
    return value
  }
  return 'cron'
}

interface MobileAutomationsProps {
  commanders: CommanderSession[]
  selectedCommanderId: string | null
  onSelectCommanderId: (id: string) => void
  crons: React.ComponentProps<typeof CommanderCronTab>['crons']
  cronsLoading: React.ComponentProps<typeof CommanderCronTab>['cronsLoading']
  cronsError: React.ComponentProps<typeof CommanderCronTab>['cronsError']
  addCron: React.ComponentProps<typeof CommanderCronTab>['addCron']
  addCronPending: React.ComponentProps<typeof CommanderCronTab>['addCronPending']
  toggleCron: React.ComponentProps<typeof CommanderCronTab>['toggleCron']
  toggleCronPending: React.ComponentProps<typeof CommanderCronTab>['toggleCronPending']
  toggleCronId?: React.ComponentProps<typeof CommanderCronTab>['toggleCronId']
  updateCron: React.ComponentProps<typeof CommanderCronTab>['updateCron']
  updateCronPending: React.ComponentProps<typeof CommanderCronTab>['updateCronPending']
  updateCronId?: React.ComponentProps<typeof CommanderCronTab>['updateCronId']
  triggerCron: React.ComponentProps<typeof CommanderCronTab>['triggerCron']
  triggerCronPending: React.ComponentProps<typeof CommanderCronTab>['triggerCronPending']
  triggerCronId?: React.ComponentProps<typeof CommanderCronTab>['triggerCronId']
  deleteCron: React.ComponentProps<typeof CommanderCronTab>['deleteCron']
  deleteCronPending: React.ComponentProps<typeof CommanderCronTab>['deleteCronPending']
  deleteCronId?: React.ComponentProps<typeof CommanderCronTab>['deleteCronId']
}

export function MobileAutomations({
  commanders,
  selectedCommanderId,
  onSelectCommanderId,
  crons,
  cronsLoading,
  cronsError,
  addCron,
  addCronPending,
  toggleCron,
  toggleCronPending,
  toggleCronId,
  updateCron,
  updateCronPending,
  updateCronId,
  triggerCron,
  triggerCronPending,
  triggerCronId,
  deleteCron,
  deleteCronPending,
  deleteCronId,
}: MobileAutomationsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showCreateSentinelForm, setShowCreateSentinelForm] = useState(false)
  const segment = readSegment(searchParams.get('segment'))
  const commanderFilter = searchParams.get('commander') ?? selectedCommanderId ?? commanders[0]?.id ?? 'all'

  useEffect(() => {
    if (commanderFilter !== 'all' && commanderFilter !== selectedCommanderId) {
      onSelectCommanderId(commanderFilter)
    }
  }, [commanderFilter, onSelectCommanderId, selectedCommanderId])

  const scopeCommander = useMemo(() => {
    if (commanderFilter === 'all') {
      return commanders.find((commander) => commander.id === selectedCommanderId) ?? commanders[0] ?? null
    }
    return commanders.find((commander) => commander.id === commanderFilter) ?? null
  }, [commanders, commanderFilter, selectedCommanderId])

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

      <div className="border-b border-ink-border/70 px-4 pb-3">
        <div className="flex gap-2">
          {([
            ['cron', 'Cron'],
            ['sentinels', 'Sentinels'],
            ['quests', 'Quests'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => updateParams({ segment: value })}
              className="flex-1 rounded-[2px_10px_2px_10px] px-3 py-2 text-[11px] uppercase tracking-[0.08em]"
              style={{
                background: segment === value ? 'var(--hv-fg)' : 'transparent',
                color: segment === value ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
                border: segment === value ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="hv-scroll flex gap-2 overflow-x-auto px-4 py-3">
        <button
          type="button"
          onClick={() => updateParams({ commander: 'all' })}
          className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-mono"
          style={{
            background: commanderFilter === 'all' ? 'var(--hv-fg)' : 'transparent',
            color: commanderFilter === 'all' ? 'var(--hv-bg)' : 'var(--hv-fg-subtle)',
            border: commanderFilter === 'all' ? '1px solid var(--hv-fg)' : '1px solid var(--hv-border-hair)',
          }}
        >
          all
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

      <div className="min-h-0 flex-1 overflow-hidden px-0 pb-0">
        {segment === 'cron' ? (
          <CommanderCronTab
            scope={
              commanderFilter === 'all' || !scopeCommander
                ? { kind: 'global' }
                : { kind: 'commander', commander: scopeCommander }
            }
            crons={crons}
            cronsLoading={cronsLoading}
            cronsError={cronsError}
            addCron={addCron}
            addCronPending={addCronPending}
            toggleCron={toggleCron}
            toggleCronPending={toggleCronPending}
            toggleCronId={toggleCronId}
            updateCron={updateCron}
            updateCronPending={updateCronPending}
            updateCronId={updateCronId}
            triggerCron={triggerCron}
            triggerCronPending={triggerCronPending}
            triggerCronId={triggerCronId}
            deleteCron={deleteCron}
            deleteCronPending={deleteCronPending}
            deleteCronId={deleteCronId}
          />
        ) : null}

        {segment === 'sentinels' ? (
          <div className="h-full px-4 pb-4">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowCreateSentinelForm(true)}
                disabled={!scopeCommander}
                className="btn-ghost !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add Sentinel
              </button>
            </div>
            {commanderFilter === 'all' ? (
              <div className="rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white px-4 py-3 text-xs text-sumi-diluted">
                Select a commander above to view their sentinels. Cross-commander sentinel
                aggregation is tracked in #1095.
              </div>
            ) : (
              <SentinelPanel
                commanderId={scopeCommander?.id}
                showCreateForm={showCreateSentinelForm}
                onCloseCreateForm={() => setShowCreateSentinelForm(false)}
              />
            )}
          </div>
        ) : null}

        {segment === 'quests' ? (
          <div className="h-full overflow-hidden px-4 pb-4">
            {commanderFilter === 'all' ? (
              <div className="px-4">
                <div className="rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white px-4 py-3 text-xs text-sumi-diluted">
                  Select a commander above to view their quest board. Cross-commander quest
                  aggregation is tracked in #1095.
                </div>
              </div>
            ) : (
              <QuestBoard
                commanders={commanders.map((commander) => ({
                  id: commander.id,
                  host: commander.host,
                }))}
                selectedCommanderId={scopeCommander?.id ?? null}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
