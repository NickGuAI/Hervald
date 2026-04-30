import { useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { useMachines } from '@/hooks/use-agents'
import { ModalFormContainer } from '../../components/ModalFormContainer'
import { CreateTaskForm } from '../../command-room/components/CreateTaskForm'
import { TaskCard } from '../../command-room/components/TaskCard'
import type { CreateCronTaskInput, CronTask } from '../../command-room/hooks/useCommandRoom'
import type {
  CommanderCronCreateInput,
  CommanderCronTask,
  CommanderSession,
} from '../hooks/useCommander'

type CommanderCronScope =
  | {
      kind: 'commander'
      commander: CommanderSession
    }
  | {
      kind: 'global'
    }

function toTaskCardCron(task: CommanderCronTask): CronTask {
  return {
    id: task.id,
    name: task.name || task.schedule,
    description: task.description,
    commanderId: task.commanderId,
    schedule: task.schedule,
    timezone: task.timezone,
    machine: task.machine ?? '',
    workDir: task.workDir ?? '',
    agentType: task.agentType ?? 'claude',
    instruction: task.instruction,
    model: task.model,
    enabled: task.enabled,
    createdAt: task.createdAt ?? '',
    nextRun: task.nextRun,
    lastRunStatus: task.lastRunStatus ?? null,
    lastRunAt: task.lastRun,
    permissionMode: task.permissionMode,
    sessionType: task.sessionType,
  }
}

export function CommanderCronTab({
  scope,
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
}: {
  scope: CommanderCronScope
  crons: CommanderCronTask[]
  cronsLoading: boolean
  cronsError: string | null
  addCron: (input: CommanderCronCreateInput) => Promise<void>
  addCronPending: boolean
  toggleCron: (input: { commanderId?: string; cronId: string; enabled: boolean }) => Promise<void>
  toggleCronPending: boolean
  toggleCronId?: string | null
  updateCron: (input: {
    commanderId?: string
    cronId: string
    name?: string
    description?: string
    schedule?: string
    timezone?: string
    machine?: string
    workDir?: string
    agentType?: 'claude' | 'codex' | 'gemini'
    instruction?: string
    model?: string
    enabled?: boolean
    permissionMode?: string
    sessionType?: 'stream' | 'pty'
  }) => Promise<void>
  updateCronPending: boolean
  updateCronId?: string | null
  triggerCron: (cronId: string) => Promise<void>
  triggerCronPending: boolean
  triggerCronId?: string | null
  deleteCron: (input: { commanderId?: string; cronId: string }) => Promise<void>
  deleteCronPending: boolean
  deleteCronId?: string | null
}) {
  const { data: machines } = useMachines()
  const machineList = machines ?? []
  const [showCreateForm, setShowCreateForm] = useState(false)
  const commanderId = scope.kind === 'commander' ? scope.commander.id : undefined

  async function handleCreateAutomation(input: CreateCronTaskInput): Promise<void> {
    await addCron({
      commanderId,
      name: input.name,
      schedule: input.schedule,
      instruction: input.instruction,
      enabled: input.enabled,
      agentType: input.agentType,
      sessionType: input.sessionType,
      permissionMode: input.permissionMode,
      workDir: input.workDir,
      machine: input.machine,
    })
    setShowCreateForm(false)
  }

  async function handleToggle(cronId: string, enabled: boolean): Promise<void> {
    await toggleCron({ commanderId, cronId, enabled: !enabled })
  }

  async function handleDelete(cronId: string): Promise<void> {
    await deleteCron({ commanderId, cronId })
  }

  async function handleUpdate(input: { taskId: string; patch: Record<string, unknown> }): Promise<void> {
    await updateCron({
      commanderId,
      cronId: input.taskId,
      ...input.patch,
    } as Parameters<typeof updateCron>[0])
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-3 border-b border-ink-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-sumi-diluted">
          {crons.length} automation{crons.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="btn-ghost !px-3 !py-1.5 text-xs inline-flex items-center gap-1.5"
        >
          <Plus size={12} />
          Add Automation
        </button>
      </div>

      <ModalFormContainer
        open={showCreateForm}
        title="New Cron Task"
        onClose={() => setShowCreateForm(false)}
      >
        <CreateTaskForm
          onCreate={handleCreateAutomation}
          onClose={() => setShowCreateForm(false)}
          machines={machineList}
          createPending={addCronPending}
        />
      </ModalFormContainer>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {cronsLoading && crons.length === 0 && (
          <div className="flex items-center justify-center h-20">
            <div className="w-3 h-3 rounded-full bg-sumi-mist animate-breathe" />
          </div>
        )}

        {!cronsLoading && crons.length === 0 && !cronsError && (
          <div className="rounded-lg border border-dashed border-ink-border p-4 text-sm text-sumi-diluted">
            <div className="flex items-center gap-2 text-sumi-gray">
              <CalendarClock size={14} />
              <span>
                {scope.kind === 'global'
                  ? 'No global automations scheduled. Add one to automate unattached workflows.'
                  : 'No automations scheduled. Add one to automate this commander.'}
              </span>
            </div>
          </div>
        )}

        {crons.map((cron) => (
          <TaskCard
            key={cron.id}
            task={toTaskCardCron(cron)}
            onToggle={async (taskId, enabled) => {
              await handleToggle(taskId, enabled)
            }}
            onDelete={async (taskId) => {
              await handleDelete(taskId)
            }}
            onRunNow={triggerCron}
            onUpdate={handleUpdate}
            updatePending={
              (toggleCronPending && toggleCronId === cron.id)
              || (updateCronPending && updateCronId === cron.id)
            }
            deletePending={deleteCronPending && deleteCronId === cron.id}
            triggerPending={triggerCronPending && triggerCronId === cron.id}
          />
        ))}

        {cronsError && (
          <p className="text-sm text-accent-vermillion">{cronsError}</p>
        )}
      </div>
    </div>
  )
}
