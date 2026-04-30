import { useMemo, useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { useMachines } from '@/hooks/use-agents'
import { ModalFormContainer } from '../components/ModalFormContainer'
import { CreateTaskForm } from './components/CreateTaskForm'
import { TaskCard } from './components/TaskCard'
import { type CronTask, useCommandRoom } from './hooks/useCommandRoom'

export default function CommandRoomPage() {
  const commandRoom = useCommandRoom()
  const { data: machines } = useMachines()
  const machineList = machines ?? []
  const [showCreateForm, setShowCreateForm] = useState(false)

  const groupedTasks = useMemo(() => {
    const commanderInstructionTasks: CronTask[] = []
    const regularTasks: CronTask[] = []

    for (const task of commandRoom.tasks) {
      if (task.commanderId) {
        commanderInstructionTasks.push(task)
        continue
      }
      regularTasks.push(task)
    }

    return {
      commanderInstructionTasks,
      regularTasks,
    }
  }, [commandRoom.tasks])

  const commanderTaskCount = groupedTasks.commanderInstructionTasks.length

  function renderTaskCards(tasks: CronTask[]) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onToggle={async (taskId, enabled) => {
              await commandRoom.updateTask({ taskId, patch: { enabled: !enabled } })
            }}
            onDelete={commandRoom.deleteTask}
            onRunNow={commandRoom.triggerTask}
            onUpdate={commandRoom.updateTask}
            updatePending={commandRoom.updateTaskPending && commandRoom.updateTaskId === task.id}
            deletePending={commandRoom.deleteTaskPending && commandRoom.deleteTaskId === task.id}
            triggerPending={commandRoom.triggerTaskPending && commandRoom.triggerTaskId === task.id}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-5 md:px-7 py-5 border-b border-ink-border bg-washi-aged/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock size={20} className="text-sumi-diluted" />
            <div>
              <h2 className="font-display text-display text-sumi-black">Command Room</h2>
              <p className="text-whisper text-sumi-mist mt-1 uppercase tracking-wider">
                Scheduled agent workflows
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="btn-ghost min-h-[44px] inline-flex items-center gap-1.5 text-sm"
          >
            <Plus size={14} />
            New Task
          </button>
        </div>
      </header>

      <ModalFormContainer
        open={showCreateForm}
        title="New Cron Task"
        onClose={() => setShowCreateForm(false)}
      >
        <CreateTaskForm
          onCreate={commandRoom.createTask}
          onClose={() => setShowCreateForm(false)}
          machines={machineList}
          createPending={commandRoom.createTaskPending}
        />
      </ModalFormContainer>

      <div className="flex-1 min-h-0 p-4 md:p-6 overflow-y-auto">
        {(commandRoom.tasksError || commandRoom.actionError) && (
          <p className="text-sm text-accent-vermillion mb-4">
            {commandRoom.actionError ?? commandRoom.tasksError}
          </p>
        )}

        {commandRoom.tasksLoading && commandRoom.tasks.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="w-4 h-4 rounded-full bg-sumi-mist animate-breathe" />
          </div>
        )}

        {!commandRoom.tasksLoading && commandRoom.tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-sumi-diluted">
            <p className="text-sm">No scheduled tasks.</p>
            <p className="text-xs mt-1">Create one to get started.</p>
          </div>
        )}

        {commandRoom.tasks.length > 0 && (
          <div className="space-y-5">
            <section className="rounded-xl border border-ink-border bg-washi-aged/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-whisper uppercase tracking-wider text-sumi-diluted">Commander Crons</h3>
                <span className="font-mono text-whisper text-sumi-mist">{commanderTaskCount}</span>
              </div>

              {commanderTaskCount === 0 && (
                <p className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-whisper text-sumi-diluted">
                  No commander cron tasks.
                </p>
              )}

              {groupedTasks.commanderInstructionTasks.length > 0 && (
                renderTaskCards(groupedTasks.commanderInstructionTasks)
              )}

            </section>

            <section className="rounded-xl border border-ink-border bg-washi-aged/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-whisper uppercase tracking-wider text-sumi-diluted">Regular Crons</h3>
                <span className="font-mono text-whisper text-sumi-mist">
                  {groupedTasks.regularTasks.length}
                </span>
              </div>

              {groupedTasks.regularTasks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-border px-3 py-2 text-whisper text-sumi-diluted">
                  No worker cron tasks.
                </p>
              ) : (
                renderTaskCards(groupedTasks.regularTasks)
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
