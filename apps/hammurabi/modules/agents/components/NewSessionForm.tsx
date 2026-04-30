import { memo, type FormEvent, type ReactNode } from 'react'
import type {
  AgentSession,
  AgentType,
  Machine,
  SessionTransportType,
} from '@/types'
import type { ClaudeAdaptiveThinkingMode } from '../../claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import { AgentControlsSection } from './new-session-form/AgentControlsSection'
import { MachineSection } from './new-session-form/MachineSection'
import { ResumeSourceSection } from './new-session-form/ResumeSourceSection'
import { SessionFieldsSection } from './new-session-form/SessionFieldsSection'
import {
  CLAUDE_MODE_OPTIONS,
  CODEX_MODE_OPTIONS,
  GEMINI_MODE_OPTIONS,
} from './new-session-form/options'
import { useNewSessionConstraints } from './new-session-form/useNewSessionConstraints'

const DEFAULT_AGENT_OPTIONS: AgentType[] = ['claude', 'codex', 'gemini']
const NOOP_SET_STRING = (_value: string): undefined => undefined

export interface NewSessionFormProps {
  name?: string
  setName?: (value: string) => void
  cwd: string
  setCwd: (value: string) => void
  task: string
  setTask: (value: string) => void
  effort: ClaudeEffortLevel
  setEffort: (value: ClaudeEffortLevel) => void
  adaptiveThinking: ClaudeAdaptiveThinkingMode
  setAdaptiveThinking: (value: ClaudeAdaptiveThinkingMode) => void
  agentType: AgentType
  setAgentType: (value: AgentType) => void
  transportType: Exclude<SessionTransportType, 'external'>
  setTransportType: (value: Exclude<SessionTransportType, 'external'>) => void
  machines: Machine[]
  selectedHost: string
  setSelectedHost: (value: string) => void
  isCreating: boolean
  createError: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  resumeOptions?: AgentSession[]
  resumeSourceName?: string
  setResumeSourceName?: (value: string) => void
  resumeSource?: AgentSession | null
  schedule?: string
  setSchedule?: (value: string) => void
  submitLabel?: string
  nameLabel?: string
  namePlaceholder?: string
  namePattern?: string
  taskLabel?: string
  taskPlaceholder?: string
  taskRequired?: boolean
  beforeTaskField?: ReactNode
  afterScheduleField?: ReactNode
  showNameField?: boolean
  agentOptions?: readonly AgentType[]
}

function NewSessionFormComponent({
  name = '',
  setName = NOOP_SET_STRING,
  cwd,
  setCwd,
  task,
  setTask,
  effort,
  setEffort,
  adaptiveThinking,
  setAdaptiveThinking,
  agentType,
  setAgentType,
  transportType,
  setTransportType,
  machines,
  selectedHost,
  setSelectedHost,
  isCreating,
  createError,
  onSubmit,
  resumeOptions,
  resumeSourceName = '',
  setResumeSourceName,
  resumeSource = null,
  schedule,
  setSchedule,
  submitLabel = 'Start Session',
  nameLabel = 'Session Name',
  namePlaceholder = 'agent-fix-auth',
  namePattern = '[a-zA-Z0-9_\\-]+',
  taskLabel = 'Initial Task (Optional)',
  taskPlaceholder = 'Fix the auth bug in login.ts',
  taskRequired = false,
  beforeTaskField,
  afterScheduleField,
  showNameField = true,
  agentOptions = DEFAULT_AGENT_OPTIONS,
}: NewSessionFormProps) {
  const remoteMachines = machines.filter((machine) => machine.host)
  const showMachineSelector = remoteMachines.length > 0
  const resumeSelectionEnabled = Array.isArray(resumeOptions) && typeof setResumeSourceName === 'function'
  const resumeLocked = resumeSource !== null

  useNewSessionConstraints({
    agentOptions,
    agentType,
    setAgentType,
    transportType,
    setTransportType,
    effort,
    setEffort,
    adaptiveThinking,
    setAdaptiveThinking,
  })

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <AgentControlsSection
        agentOptions={agentOptions}
        agentType={agentType}
        setAgentType={setAgentType}
        transportType={transportType}
        setTransportType={setTransportType}
        resumeLocked={resumeLocked}
        effort={effort}
        setEffort={setEffort}
        adaptiveThinking={adaptiveThinking}
        setAdaptiveThinking={setAdaptiveThinking}
      />

      {resumeSelectionEnabled ? (
        <ResumeSourceSection
          resumeSourceName={resumeSourceName}
          setResumeSourceName={setResumeSourceName}
          resumeOptions={resumeOptions}
          resumeSource={resumeSource}
          machines={machines}
        />
      ) : null}

      {showMachineSelector ? (
        <MachineSection
          selectedHost={selectedHost}
          setSelectedHost={setSelectedHost}
          machines={machines}
          resumeLocked={resumeLocked}
          resumeSource={resumeSource}
        />
      ) : null}

      <SessionFieldsSection
        name={name}
        setName={setName}
        showNameField={showNameField}
        nameLabel={nameLabel}
        namePlaceholder={namePlaceholder}
        namePattern={namePattern}
        schedule={schedule}
        setSchedule={setSchedule}
        afterScheduleField={afterScheduleField}
        cwd={cwd}
        setCwd={setCwd}
        selectedHost={selectedHost}
        resumeLocked={resumeLocked}
        taskLabel={taskLabel}
        task={task}
        setTask={setTask}
        taskPlaceholder={taskPlaceholder}
        taskRequired={taskRequired}
        beforeTaskField={beforeTaskField}
        createError={createError}
        isCreating={isCreating}
        submitLabel={submitLabel}
      />
    </form>
  )
}

export const NewSessionForm = memo(NewSessionFormComponent)
NewSessionForm.displayName = 'NewSessionForm'

export { CLAUDE_MODE_OPTIONS, CODEX_MODE_OPTIONS, GEMINI_MODE_OPTIONS }
