import type { ReactNode } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { DirectoryPicker } from '../DirectoryPicker'
import { ScheduleExpressionField } from '../../../components/ScheduleExpressionField'

interface SessionFieldsSectionProps {
  name: string
  setName: (value: string) => void
  showNameField: boolean
  nameLabel: string
  namePlaceholder: string
  namePattern: string
  schedule?: string
  setSchedule?: (value: string) => void
  afterScheduleField?: ReactNode
  cwd: string
  setCwd: (value: string) => void
  selectedHost: string
  resumeLocked: boolean
  taskLabel: string
  task: string
  setTask: (value: string) => void
  taskPlaceholder: string
  taskRequired: boolean
  beforeTaskField?: ReactNode
  createError: string | null
  isCreating: boolean
  submitLabel: string
}

export function SessionFieldsSection({
  name,
  setName,
  showNameField,
  nameLabel,
  namePlaceholder,
  namePattern,
  schedule,
  setSchedule,
  afterScheduleField,
  cwd,
  setCwd,
  selectedHost,
  resumeLocked,
  taskLabel,
  task,
  setTask,
  taskPlaceholder,
  taskRequired,
  beforeTaskField,
  createError,
  isCreating,
  submitLabel,
}: SessionFieldsSectionProps) {
  return (
    <>
      {showNameField ? (
        <div>
          <label className="section-title block mb-2">{nameLabel}</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
            placeholder={namePlaceholder}
            required
            pattern={namePattern || undefined}
            title={namePattern ? 'Alphanumeric, underscore, and hyphen only' : undefined}
          />
        </div>
      ) : null}

      {schedule !== undefined && setSchedule ? (
        <ScheduleExpressionField schedule={schedule} onScheduleChange={setSchedule} />
      ) : null}

      {afterScheduleField}

      <div>
        <label className="section-title block mb-2">Working Directory</label>
        {resumeLocked ? (
          <div className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 font-mono text-[16px] text-sumi-black md:text-sm">
            {cwd || '~'}
          </div>
        ) : (
          <DirectoryPicker value={cwd} onChange={setCwd} host={selectedHost || undefined} />
        )}
      </div>

      {beforeTaskField}

      <div>
        <label className="section-title block mb-2">{taskLabel}</label>
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          className="w-full min-h-24 px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
          placeholder={taskPlaceholder}
          required={taskRequired}
        />
      </div>

      {createError ? (
        <div className="flex items-start gap-2 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
          <AlertTriangle size={15} className="mt-0.5" />
          <span>{createError}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isCreating}
        className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        <Plus size={14} />
        {isCreating ? 'Working...' : submitLabel}
      </button>
    </>
  )
}
