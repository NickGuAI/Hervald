import { useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, Clock3, Play, Plus, Trash2 } from 'lucide-react'
import { cn, formatCost, timeAgo } from '@/lib/utils'
import { useMachines } from '@/hooks/use-agents'
import { ModalFormContainer } from '../../components/ModalFormContainer'
import {
  useAutomationHistory,
  useAutomations,
  type AutomationListItem,
  type AutomationScope,
  type AutomationTriggerFilter,
} from '../../automations/hooks/useAutomations'
import { SentinelCreateForm } from '../../sentinels/components/SentinelCreateForm'
import type { CommanderSession } from '../hooks/useCommander'
import { CreateAutomationTaskForm } from './CreateAutomationTaskForm'

type CreateMode = null | 'chooser' | 'task' | 'monitor'

export type AutomationPanelScope =
  | {
      kind: 'global'
    }
  | {
      kind: 'commander'
      commander: CommanderSession
    }

interface AutomationPanelProps {
  scope: AutomationPanelScope
  filter?: AutomationTriggerFilter
  onFilterChange?: (filter: AutomationTriggerFilter) => void
}

const FILTER_OPTIONS: Array<{ value: AutomationTriggerFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'quest', label: 'Quest' },
  { value: 'manual', label: 'Manual' },
]

function toAutomationScope(scope: AutomationPanelScope): AutomationScope {
  if (scope.kind === 'global') {
    return { kind: 'global' }
  }

  return {
    kind: 'commander',
    commanderId: scope.commander.id,
  }
}

function statusBadgeClass(status: AutomationListItem['status']): string {
  if (status === 'active') {
    return 'badge-active'
  }
  if (status === 'paused') {
    return 'badge-idle'
  }
  if (status === 'cancelled') {
    return 'badge-error'
  }
  return 'badge-completed'
}

function statusSymbol(status: AutomationListItem['status']): string {
  if (status === 'active') {
    return '●'
  }
  if (status === 'paused') {
    return '◐'
  }
  if (status === 'cancelled') {
    return '✗'
  }
  return '✓'
}

function describeTrigger(automation: AutomationListItem): string {
  if (automation.trigger === 'schedule') {
    return [
      automation.schedule ?? 'No schedule configured',
      automation.timezone ? `(${automation.timezone})` : null,
    ].filter(Boolean).join(' ')
  }

  if (automation.trigger === 'quest') {
    const commanderScope = automation.questTrigger?.commanderId
      ? `commander ${automation.questTrigger.commanderId}`
      : 'any commander'
    return `Quest completed by ${commanderScope}`
  }

  return 'Manual trigger only'
}

function classifyAutomation(automation: AutomationListItem): 'run' | 'monitor' {
  if (automation.trigger !== 'schedule') {
    return 'monitor'
  }
  if ((automation.skills?.length ?? 0) > 0) {
    return 'monitor'
  }
  if ((automation.observations?.length ?? 0) > 0) {
    return 'monitor'
  }
  if ((automation.seedMemory ?? '').trim().length > 0) {
    return 'monitor'
  }
  if (automation.maxRuns) {
    return 'monitor'
  }
  return 'run'
}

function runsLabel(automation: AutomationListItem): string {
  const totalRuns = automation.totalRuns ?? 0
  if (automation.maxRuns) {
    return `${totalRuns}/${automation.maxRuns} runs`
  }
  if (totalRuns === 1) {
    return '1 run'
  }
  return `${totalRuns} runs`
}

function lastRunSummary(automation: AutomationListItem): string {
  const latest = automation.history?.[0]
  if (!latest || !automation.lastRun) {
    return 'Last: no runs yet'
  }

  const action = latest.action.trim().length > 0 ? latest.action.trim() : 'run finished'
  return `Last: "${action}" - ${timeAgo(automation.lastRun)} - ${formatCost(latest.costUsd)}`
}

function filterItems(items: AutomationListItem[], filter: AutomationTriggerFilter): AutomationListItem[] {
  if (filter === 'all') {
    return items
  }

  return items.filter((item) => item.trigger === filter)
}

function emptyMessage(scope: AutomationPanelScope, filter: AutomationTriggerFilter): string {
  if (filter === 'quest') {
    return 'No quest-triggered automations yet.'
  }
  if (filter === 'manual') {
    return 'No manual-trigger automations yet.'
  }
  if (scope.kind === 'global') {
    return 'No global automations yet. Add one to automate unattached workflows.'
  }
  return 'No automations configured for this commander yet.'
}

function AutomationCard({
  automation,
  automationState,
}: {
  automation: AutomationListItem
  automationState: ReturnType<typeof useAutomations>
}) {
  const [expanded, setExpanded] = useState(false)
  const [newObservation, setNewObservation] = useState('')
  const historyState = useAutomationHistory(expanded ? automation.id : null)
  const observations = automation.observations ?? []
  const category = classifyAutomation(automation)
  const actionsDisabled =
    (automationState.updateAutomationPending && automationState.updateAutomationId === automation.id)
    || (automationState.deleteAutomationPending && automationState.deleteAutomationId === automation.id)
    || (automationState.triggerAutomationPending && automationState.triggerAutomationId === automation.id)

  async function handleAddObservation(): Promise<void> {
    const trimmed = newObservation.trim()
    if (!trimmed) {
      return
    }

    await automationState.updateAutomation(automation.id, {
      observations: [...observations, trimmed],
    })
    setNewObservation('')
  }

  async function handleRemoveObservation(index: number): Promise<void> {
    const next = observations.filter((_, observationIndex) => observationIndex !== index)
    await automationState.updateAutomation(automation.id, {
      observations: next,
    })
  }

  return (
    <div className="card-sumi p-4">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-sumi-black truncate">{automation.name}</p>
              <span className={cn('badge-sumi shrink-0', statusBadgeClass(automation.status))}>
                {statusSymbol(automation.status)} {automation.status}
              </span>
              <span className="badge-sumi badge-completed shrink-0">{automation.trigger}</span>
              <span className="badge-sumi badge-idle shrink-0">{category}</span>
            </div>
            <p className="mt-2 text-xs text-sumi-diluted">{describeTrigger(automation)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sumi-diluted">
              <span>{runsLabel(automation)}</span>
              {(automation.totalCostUsd ?? 0) > 0 && (
                <span>{formatCost(automation.totalCostUsd ?? 0)} total</span>
              )}
              {automation.nextRun ? <span>Next: {timeAgo(automation.nextRun)}</span> : null}
            </div>
            <p className="mt-1.5 text-xs text-sumi-gray truncate">{lastRunSummary(automation)}</p>
          </div>

          <ChevronDown
            size={14}
            className={cn('mt-1 shrink-0 text-sumi-diluted transition-transform', expanded && 'rotate-180')}
          />
        </div>
      </button>

      {expanded ? (
        <div className="mt-2 rounded-lg border border-ink-border bg-washi-aged/30 p-3 space-y-3">
          {automation.description ? (
            <div>
              <p className="section-title">Description</p>
              <p className="mt-1 text-sm text-sumi-gray whitespace-pre-wrap">{automation.description}</p>
            </div>
          ) : null}

          <div>
            <p className="section-title">Instruction</p>
            <p className="mt-1 text-sm text-sumi-gray whitespace-pre-wrap">{automation.instruction}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-sumi-diluted">
            <span>{automation.agentType}</span>
            <span>{automation.permissionMode}</span>
            {automation.model ? <span>{automation.model}</span> : null}
            {automation.workDir ? <span>{automation.workDir}</span> : null}
            {automation.machine ? <span>{automation.machine}</span> : null}
          </div>

          <div>
            <p className="section-title">Skills</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(automation.skills ?? []).length === 0 ? (
                <span className="text-whisper text-sumi-diluted">No skills configured.</span>
              ) : (
                (automation.skills ?? []).map((skill) => (
                  <span key={skill} className="badge-sumi badge-completed font-mono normal-case">
                    {skill}
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="section-title">Observations</p>
            <div className="mt-2 space-y-2">
              {observations.length === 0 ? (
                <p className="text-whisper text-sumi-diluted">No observations yet.</p>
              ) : (
                observations.map((observation, index) => (
                  <div
                    key={`${observation}-${index}`}
                    className="flex items-start justify-between gap-2 rounded border border-ink-border bg-washi-white px-2 py-1.5"
                  >
                    <p className="text-sm text-sumi-gray">{observation}</p>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => void handleRemoveObservation(index)}
                      className="text-whisper text-accent-vermillion disabled:opacity-60"
                    >
                      remove
                    </button>
                  </div>
                ))
              )}

              <div className="flex items-center gap-2">
                <input
                  value={newObservation}
                  onChange={(event) => setNewObservation(event.target.value)}
                  className="flex-1 px-2.5 py-2 rounded border border-ink-border bg-washi-white text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
                  placeholder="Add observation"
                />
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => void handleAddObservation()}
                  className="btn-ghost !px-3 !py-2 text-xs disabled:opacity-60"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="section-title">Run History</p>
            <div className="mt-2 max-h-48 overflow-y-auto space-y-2 pr-1">
              {historyState.historyLoading ? (
                <p className="text-whisper text-sumi-mist">Loading run history...</p>
              ) : null}
              {!historyState.historyLoading && historyState.history.length === 0 ? (
                <p className="text-whisper text-sumi-diluted">No runs yet.</p>
              ) : null}
              {historyState.history.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="rounded border border-ink-border bg-washi-white px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-sumi-diluted">{timeAgo(entry.timestamp)}</p>
                    <span className="text-xs text-sumi-diluted">{formatCost(entry.costUsd)}</span>
                  </div>
                  <p className="mt-1 text-sm text-sumi-black">{entry.action}</p>
                  <p className="text-xs text-sumi-gray mt-0.5">{entry.result}</p>
                  <p className="mt-1 text-whisper text-sumi-mist">
                    duration {entry.durationSec}s
                    {entry.source ? ` • ${entry.source}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {automation.status === 'active' ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => void automationState.pauseAutomation(automation.id)}
                className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-60"
              >
                <Clock3 size={12} />
                Pause
              </button>
            ) : automation.status === 'paused' ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => void automationState.resumeAutomation(automation.id)}
                className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-60"
              >
                <Clock3 size={12} />
                Resume
              </button>
            ) : null}

            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => void automationState.triggerAutomation(automation.id)}
              className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1 disabled:opacity-60"
            >
              <Play size={12} />
              Trigger
            </button>

            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => void automationState.deleteAutomation(automation.id)}
              className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1 text-accent-vermillion disabled:opacity-60"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AutomationPanel({
  scope,
  filter,
  onFilterChange,
}: AutomationPanelProps) {
  const [internalFilter, setInternalFilter] = useState<AutomationTriggerFilter>('all')
  const [createMode, setCreateMode] = useState<CreateMode>(null)
  const automationState = useAutomations(toAutomationScope(scope))
  const { data: machines } = useMachines()

  const machineList = machines ?? []
  const currentFilter = filter ?? internalFilter
  const visibleItems = useMemo(
    () => filterItems(automationState.items, currentFilter),
    [automationState.items, currentFilter],
  )

  function handleFilterChange(nextFilter: AutomationTriggerFilter) {
    if (onFilterChange) {
      onFilterChange(nextFilter)
      return
    }

    setInternalFilter(nextFilter)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-3 border-b border-ink-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs uppercase tracking-wide text-sumi-diluted">Automations</span>
          <p className="text-sm text-sumi-gray mt-1">
            {automationState.counts.active} active
            {' · '}
            {automationState.counts.paused} paused
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateMode('chooser')}
          className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1.5 shrink-0"
        >
          <Plus size={12} />
          New Automation
        </button>
      </div>

      <div className="border-b border-ink-border px-4 md:px-6 py-3 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {FILTER_OPTIONS.map((option) => {
            const isActive = currentFilter === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleFilterChange(option.value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'border-sumi-black bg-sumi-black text-washi-aged'
                    : 'border-ink-border text-sumi-gray hover:border-ink-border-hover hover:text-sumi-black',
                )}
              >
                {option.label}
                <span className="ml-1.5 text-[10px] opacity-80">
                  {automationState.counts.triggerCounts[option.value]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <ModalFormContainer
        open={createMode !== null}
        title={createMode === 'chooser' ? 'New Automation' : 'Create Automation'}
        onClose={() => setCreateMode(null)}
      >
        {createMode === 'chooser' ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setCreateMode('task')}
              className="w-full rounded-lg border border-ink-border bg-washi-aged/50 px-4 py-3 text-left hover:border-ink-border-hover transition-colors"
            >
              <p className="font-mono text-sm text-sumi-black">Instruction Run</p>
              <p className="mt-1 text-sm text-sumi-gray">
                Runs a scheduled instruction in a workspace on a machine you choose.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setCreateMode('monitor')}
              className="w-full rounded-lg border border-ink-border bg-washi-aged/50 px-4 py-3 text-left hover:border-ink-border-hover transition-colors"
            >
              <p className="font-mono text-sm text-sumi-black">Persistent Automation</p>
              <p className="mt-1 text-sm text-sumi-gray">
                Keeps memory, skills, and observations across repeated or event-based runs.
              </p>
            </button>
          </div>
        ) : null}

        {createMode === 'task' ? (
          <CreateAutomationTaskForm
            onCreate={async (input) => {
              await automationState.createTask(input)
              setCreateMode(null)
            }}
            onClose={() => setCreateMode(null)}
            machines={machineList}
            createPending={automationState.createTaskPending}
          />
        ) : null}

        {createMode === 'monitor' ? (
          <SentinelCreateForm
            skillOptions={automationState.skillOptions}
            isSubmitting={automationState.createSentinelPending}
            error={automationState.actionError}
            onSubmit={automationState.createSentinel}
            onCancel={() => setCreateMode(null)}
            submitLabel="Create Automation"
            seedMemoryPlaceholder="Context this automation should remember across runs."
          />
        ) : null}
      </ModalFormContainer>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {automationState.loading && automationState.items.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-3 h-3 rounded-full bg-sumi-mist animate-breathe" />
          </div>
        ) : null}

        {!automationState.loading && visibleItems.length === 0 && !automationState.dataError ? (
          <div className="rounded-lg border border-dashed border-ink-border p-4 text-sm text-sumi-diluted">
            <div className="flex items-center gap-2 text-sumi-gray">
              <CalendarClock size={14} />
              <span>{emptyMessage(scope, currentFilter)}</span>
            </div>
          </div>
        ) : null}

        {visibleItems.map((automation) => (
          <AutomationCard
            key={automation.id}
            automation={automation}
            automationState={automationState}
          />
        ))}

        {automationState.dataError ? (
          <p className="text-sm text-accent-vermillion">{automationState.dataError}</p>
        ) : null}

        {!automationState.dataError && automationState.actionError ? (
          <p className="text-sm text-accent-vermillion">{automationState.actionError}</p>
        ) : null}
      </div>
    </div>
  )
}
