import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import {
  CLAUDE_EFFORT_LEVELS,
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../claude-effort.js'
import type { CommanderCreateInput } from '../hooks/useCommander'
import { COMMANDER_ARCHETYPES, findCommanderArchetype } from '../templates/archetypes'
import {
  createDefaultCommanderRuntimeConfig,
  type CommanderRuntimeConfig,
} from '../runtime-config.shared.js'
import { CommanderMdPreview } from './CommanderMdPreview'
import { CreateCommanderForm } from './CreateCommanderForm'
import { WizardChatPanel } from './WizardChatPanel'

const HOST_PATTERN = /^[a-zA-Z0-9_-]+$/
const MIN_HEARTBEAT_MINUTES = 1
const DEFAULT_HEARTBEAT_MINUTES = 15
const MS_PER_MINUTE = 60_000
const FALLBACK_RUNTIME_CONFIG = createDefaultCommanderRuntimeConfig()

const INPUT_CLASS =
  'w-full rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-white focus:outline-none focus:ring-1 focus:ring-sumi-black/20 placeholder:text-sumi-mist'

const LABEL_CLASS = 'text-whisper uppercase tracking-wide text-sumi-diluted'

type WizardMode = 'choice' | 'quick' | 'chat' | 'advanced'
type WizardStep = 1 | 2 | 3

type CommanderCreateInputWithWizardFields = CommanderCreateInput & {
  displayName?: string
  agentType?: 'claude' | 'codex' | 'gemini'
  effort?: ClaudeEffortLevel
  persona?: string
  heartbeat?: {
    intervalMs: number
    messageTemplate?: string
  }
  contextConfig?: {
    fatPinInterval?: number
  }
  taskSource?: {
    owner: string
    repo: string
    label?: string
    project?: string
  }
}

async function fetchCommanderRuntimeConfig(): Promise<CommanderRuntimeConfig> {
  return fetchJson<CommanderRuntimeConfig>('/api/commanders/runtime-config')
}

function resolvedInitialArchetype() {
  return findCommanderArchetype('engineering') ?? COMMANDER_ARCHETYPES[0]
}

export function CreateCommanderWizard({
  onAdd,
  isPending,
  onClose,
  onWizardCreated,
}: {
  onAdd: (input: CommanderCreateInput) => Promise<void>
  isPending: boolean
  onClose: () => void
  onWizardCreated?: () => Promise<void> | void
}) {
  const initialArchetype = resolvedInitialArchetype()
  const runtimeConfigQuery = useQuery({
    queryKey: ['commanders', 'runtime-config'],
    queryFn: fetchCommanderRuntimeConfig,
    staleTime: 60_000,
  })
  const runtimeConfig = runtimeConfigQuery.data ?? FALLBACK_RUNTIME_CONFIG

  const [mode, setMode] = useState<WizardMode>('choice')
  const [step, setStep] = useState<WizardStep>(1)

  const [host, setHost] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [archetypeId, setArchetypeId] = useState(initialArchetype?.id ?? 'custom')
  const [agentType, setAgentType] = useState<'claude' | 'codex' | 'gemini'>('claude')
  const [effort, setEffort] = useState<ClaudeEffortLevel>(DEFAULT_CLAUDE_EFFORT_LEVEL)
  const [persona, setPersona] = useState(initialArchetype?.defaultPersona ?? '')
  const [cwd, setCwd] = useState('')
  const [heartbeatMinutes, setHeartbeatMinutes] = useState(
    String(initialArchetype?.defaultHeartbeatMinutes ?? DEFAULT_HEARTBEAT_MINUTES),
  )
  const [messageTemplate, setMessageTemplate] = useState('')
  const [maxTurns, setMaxTurns] = useState(String(runtimeConfig.defaults.maxTurns))
  const [maxTurnsDirty, setMaxTurnsDirty] = useState(false)
  const [contextMode, setContextMode] = useState<'thin' | 'fat'>(initialArchetype?.defaultContextMode ?? 'thin')
  const [fatPinInterval, setFatPinInterval] = useState(
    initialArchetype?.defaultContextMode === 'fat' ? '2' : '',
  )
  const [taskOwner, setTaskOwner] = useState(initialArchetype?.suggestedTaskSource?.owner ?? '')
  const [taskRepo, setTaskRepo] = useState(initialArchetype?.suggestedTaskSource?.repo ?? '')
  const [taskLabel, setTaskLabel] = useState(initialArchetype?.suggestedTaskSource?.label ?? '')
  const [taskProject, setTaskProject] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const parsedHeartbeatMinutes = Number.parseInt(heartbeatMinutes.trim(), 10)
  const parsedHeartbeatMs = Number.isFinite(parsedHeartbeatMinutes)
    ? parsedHeartbeatMinutes * MS_PER_MINUTE
    : undefined

  useEffect(() => {
    if (!maxTurnsDirty) {
      setMaxTurns(String(runtimeConfig.defaults.maxTurns))
    }
  }, [maxTurnsDirty, runtimeConfig.defaults.maxTurns])

  const parsedFatPinInterval = fatPinInterval.trim()
    ? Number.parseInt(fatPinInterval.trim(), 10)
    : undefined

  const selectedArchetype = useMemo(
    () => findCommanderArchetype(archetypeId) ?? initialArchetype,
    [archetypeId, initialArchetype],
  )

  const previewTaskSource = taskOwner.trim() && taskRepo.trim()
    ? {
        owner: taskOwner.trim(),
        repo: taskRepo.trim(),
        label: taskLabel.trim() || undefined,
        project: taskProject.trim() || undefined,
      }
    : undefined

  const applyArchetype = (nextArchetypeId: string) => {
    const archetype = findCommanderArchetype(nextArchetypeId)
    if (!archetype) {
      return
    }

    setArchetypeId(archetype.id)
    setPersona(archetype.defaultPersona)
    setHeartbeatMinutes(String(archetype.defaultHeartbeatMinutes))
    setContextMode(archetype.defaultContextMode)
    setFatPinInterval(archetype.defaultContextMode === 'fat' ? '2' : '')
    setTaskOwner(archetype.suggestedTaskSource?.owner ?? '')
    setTaskRepo(archetype.suggestedTaskSource?.repo ?? '')
    setTaskLabel(archetype.suggestedTaskSource?.label ?? '')
    setTaskProject('')
    setActionError(null)
  }

  const validateIdentityStep = (): boolean => {
    const trimmedHost = host.trim()
    if (!trimmedHost) {
      setActionError('Host is required.')
      return false
    }
    if (!HOST_PATTERN.test(trimmedHost)) {
      setActionError('Host must only contain letters, numbers, hyphens, and underscores.')
      return false
    }
    setActionError(null)
    return true
  }

  const validateConfigStep = (): boolean => {
    if (!Number.isFinite(parsedHeartbeatMinutes) || parsedHeartbeatMinutes < MIN_HEARTBEAT_MINUTES) {
      setActionError('Heartbeat interval must be at least 1 minute.')
      return false
    }

    if (contextMode === 'fat') {
      if (!Number.isFinite(parsedFatPinInterval) || (parsedFatPinInterval ?? 0) < 1) {
        setActionError('Fat context interval must be at least 1 heartbeat.')
        return false
      }
    }

    const parsedMaxTurns = Number.parseInt(maxTurns.trim(), 10)
    if (
      !Number.isFinite(parsedMaxTurns)
      || parsedMaxTurns < 1
      || parsedMaxTurns > runtimeConfig.limits.maxTurns
    ) {
      setActionError(
        `Max turns must be an integer between 1 and ${runtimeConfig.limits.maxTurns}.`,
      )
      return false
    }

    setActionError(null)
    return true
  }

  const buildCreateInput = (): CommanderCreateInputWithWizardFields | null => {
    if (!validateIdentityStep()) {
      return null
    }
    if (!validateConfigStep()) {
      return null
    }

    const trimmedHost = host.trim()
    const resolvedFatPinInterval = contextMode === 'fat'
      ? (Number.isFinite(parsedFatPinInterval) ? parsedFatPinInterval : undefined)
      : undefined
    const parsedMaxTurns = Number.parseInt(maxTurns.trim(), 10)

    return {
      host: trimmedHost,
      displayName: displayName.trim() || undefined,
      agentType,
      effort,
      cwd: cwd.trim() || undefined,
      persona: persona.trim() || undefined,
      maxTurns: Number.isFinite(parsedMaxTurns)
        ? parsedMaxTurns
        : runtimeConfig.defaults.maxTurns,
      contextMode,
      heartbeat: {
        intervalMs: (parsedHeartbeatMinutes || DEFAULT_HEARTBEAT_MINUTES) * MS_PER_MINUTE,
        messageTemplate: messageTemplate.trim() || undefined,
      },
      contextConfig: resolvedFatPinInterval ? { fatPinInterval: resolvedFatPinInterval } : undefined,
      taskSource: taskOwner.trim() && taskRepo.trim()
        ? {
            owner: taskOwner.trim(),
            repo: taskRepo.trim(),
            label: taskLabel.trim() || undefined,
            project: taskProject.trim() || undefined,
          }
        : undefined,
    }
  }

  const handleQuickCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (step !== 3) {
      return
    }

    const createInput = buildCreateInput()
    if (!createInput) {
      return
    }

    try {
      setActionError(null)
      await onAdd(createInput)
      onClose()
    } catch (error) {
      if (error instanceof Error && error.message.includes('(409)')) {
        setActionError(`Host "${createInput.host}" already exists.`)
      } else {
        setActionError(error instanceof Error ? error.message : 'Failed to create commander.')
      }
    }
  }

  const handleWizardCreated = () => {
    void Promise.resolve(onWizardCreated?.()).catch(() => {})
    onClose()
  }

  if (mode === 'chat') {
    return (
      <WizardChatPanel
        onCancel={() => setMode('choice')}
        onCreated={handleWizardCreated}
      />
    )
  }

  if (mode === 'advanced') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-sumi-diluted">
            Advanced mode exposes every available field.
          </p>
          <button
            type="button"
            onClick={() => setMode('choice')}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-xs min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Back
          </button>
        </div>
        <CreateCommanderForm
          onAdd={onAdd}
          isPending={isPending}
          onClose={onClose}
          heading="Advanced create"
          runtimeConfig={runtimeConfig}
        />
      </div>
    )
  }

  if (mode === 'choice') {
    return (
      <div className="rounded-lg border border-dashed border-ink-border p-4 space-y-4">
        <p className="text-sm text-sumi-gray">Choose a creation path</p>
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              setStep(1)
              setMode('quick')
            }}
            className="rounded-lg border border-ink-border bg-washi-white p-3 text-left hover:bg-washi-aged/40 transition-colors"
          >
            <p className="text-sm text-sumi-black">Quick Create</p>
            <p className="mt-1 text-whisper text-sumi-diluted">
              Guided 3-step panel with archetypes and preview.
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              setMode('chat')
            }}
            className="rounded-lg border border-ink-border bg-washi-white p-3 text-left hover:bg-washi-aged/40 transition-colors"
          >
            <p className="text-sm text-sumi-black">Talk to Me</p>
            <p className="mt-1 text-whisper text-sumi-diluted">
              Spin up a temporary wizard agent and create by chat.
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              setMode('advanced')
            }}
            className="rounded-lg border border-ink-border bg-washi-white p-3 text-left hover:bg-washi-aged/40 transition-colors"
          >
            <p className="text-sm text-sumi-black">Advanced</p>
            <p className="mt-1 text-whisper text-sumi-diluted">
              Full form with all identity, heartbeat, and task source fields.
            </p>
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => void handleQuickCreate(event)}
      className="rounded-lg border border-dashed border-ink-border p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-sumi-gray">Quick Create</p>
          <p className="text-whisper text-sumi-diluted">Step {step} of 3</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('choice')}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-xs min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setMode('advanced')}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-xs min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Advanced
          </button>
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className={LABEL_CLASS}>Identity</p>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="Host (e.g. infra-lead)"
              className={INPUT_CLASS}
            />
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name (optional)"
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            <p className={LABEL_CLASS}>Role Archetype</p>
            <div className="grid gap-2 md:grid-cols-2">
              {COMMANDER_ARCHETYPES.map((archetype) => {
                const selected = archetype.id === archetypeId
                return (
                  <button
                    key={archetype.id}
                    type="button"
                    onClick={() => applyArchetype(archetype.id)}
                    className={[
                      'rounded-lg border p-3 text-left transition-colors',
                      selected
                        ? 'border-sumi-black bg-washi-aged/60'
                        : 'border-ink-border bg-washi-white hover:bg-washi-aged/40',
                    ].join(' ')}
                  >
                    <p className="text-sm text-sumi-black">{archetype.label}</p>
                    <p className="mt-1 text-whisper text-sumi-diluted">{archetype.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Agent type</span>
              <select
                value={agentType}
                onChange={(event) => setAgentType(event.target.value as 'claude' | 'codex' | 'gemini')}
                className={INPUT_CLASS}
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="gemini">gemini</option>
              </select>
            </label>

            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Claude effort</span>
              <select
                value={effort}
                onChange={(event) => setEffort(event.target.value as ClaudeEffortLevel)}
                className={INPUT_CLASS}
              >
                {CLAUDE_EFFORT_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <label className="block">
            <span className={`${LABEL_CLASS} mb-1 block`}>Persona</span>
            <textarea
              rows={4}
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              placeholder="Describe this commander's operating style and responsibilities."
              className={INPUT_CLASS}
              style={{ resize: 'vertical' }}
            />
            <p className="mt-1 text-xs text-sumi-diluted">
              Added to the commander&apos;s runtime system prompt when the session starts.
            </p>
          </label>

          <label className="block">
            <span className={`${LABEL_CLASS} mb-1 block`}>Working directory</span>
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Optional absolute path"
              className={INPUT_CLASS}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Heartbeat (minutes)</span>
              <input
                type="number"
                min={MIN_HEARTBEAT_MINUTES}
                step={1}
                value={heartbeatMinutes}
                onChange={(event) => setHeartbeatMinutes(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>

            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Max turns</span>
              <input
                type="number"
                min={1}
                max={runtimeConfig.limits.maxTurns}
                step={1}
                value={maxTurns}
                onChange={(event) => {
                  setMaxTurns(event.target.value)
                  setMaxTurnsDirty(true)
                }}
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-sumi-diluted">
                Global default {runtimeConfig.defaults.maxTurns} · limit {runtimeConfig.limits.maxTurns}
              </p>
            </label>

            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Context mode</span>
              <select
                value={contextMode}
                onChange={(event) => setContextMode(event.target.value as 'thin' | 'fat')}
                className={INPUT_CLASS}
              >
                <option value="thin">thin</option>
                <option value="fat">fat</option>
              </select>
            </label>
          </div>

          {contextMode === 'fat' && (
            <label className="block">
              <span className={`${LABEL_CLASS} mb-1 block`}>Fat context every N heartbeats</span>
              <input
                type="number"
                min={1}
                step={1}
                value={fatPinInterval}
                onChange={(event) => setFatPinInterval(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          )}

          <label className="block">
            <span className={`${LABEL_CLASS} mb-1 block`}>Heartbeat message (optional)</span>
            <input
              value={messageTemplate}
              onChange={(event) => setMessageTemplate(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <div className="space-y-2">
            <p className={LABEL_CLASS}>Task Source (optional)</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={taskOwner}
                onChange={(event) => setTaskOwner(event.target.value)}
                placeholder="GitHub owner"
                className={INPUT_CLASS}
              />
              <input
                value={taskRepo}
                onChange={(event) => setTaskRepo(event.target.value)}
                placeholder="GitHub repo"
                className={INPUT_CLASS}
              />
              <input
                value={taskLabel}
                onChange={(event) => setTaskLabel(event.target.value)}
                placeholder="Label filter"
                className={INPUT_CLASS}
              />
              <input
                value={taskProject}
                onChange={(event) => setTaskProject(event.target.value)}
                placeholder="Project filter"
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="text-whisper text-sumi-diluted">
            <p>Archetype: {selectedArchetype?.label ?? 'custom'}</p>
            <p>Agent: {agentType} · Effort: {effort}</p>
            <p>
              Heartbeat: {heartbeatMinutes.trim() || DEFAULT_HEARTBEAT_MINUTES} min
              {' · '}
              Max turns: {maxTurns.trim() || runtimeConfig.defaults.maxTurns}
              {' · '}
              Context: {contextMode}
            </p>
          </div>
          <CommanderMdPreview
            host={host}
            displayName={displayName.trim() || undefined}
            cwd={cwd.trim() || undefined}
            persona={persona.trim() || undefined}
            agentType={agentType}
            effort={effort}
            heartbeatIntervalMs={parsedHeartbeatMs}
            heartbeatMessage={messageTemplate.trim() || undefined}
            fatPinInterval={contextMode === 'fat' ? parsedFatPinInterval : undefined}
            taskSource={previewTaskSource}
          />
        </div>
      )}

      {actionError && <p className="text-sm text-accent-vermillion">{actionError}</p>}

      <div className="flex justify-end gap-2">
        {step > 1 && (
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              setStep((current) => (current === 3 ? 2 : 1))
            }}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-sm min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Back
          </button>
        )}

        {step < 3 ? (
          <button
            type="button"
            onClick={() => {
              const isValid = step === 1 ? validateIdentityStep() : validateConfigStep()
              if (!isValid) {
                return
              }
              setStep((current) => (current === 1 ? 2 : 3))
            }}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-sm min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Next
          </button>
        ) : (
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-sm min-h-[44px] min-w-[44px] hover:bg-ink-wash disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Creating...' : 'Create Commander'}
          </button>
        )}
      </div>
    </form>
  )
}
