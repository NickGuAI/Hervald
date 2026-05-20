import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fetchJson, fetchVoid } from '@/lib/api'
import {
  CLAUDE_EFFORT_LEVELS,
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../claude-effort.js'
import type { CommanderSession } from '../hooks/useCommander'
import {
  createDefaultCommanderRuntimeConfig,
  type CommanderRuntimeConfig,
} from '../runtime-config.shared.js'
import { HeartbeatMonitor } from './HeartbeatMonitor'

interface CommanderDetailPayload {
  contextMode?: 'thin' | 'fat' | null
  workflowMd?: string | null
  cwd?: string | null
  currentTask?: {
    issueNumber: number
    issueUrl: string
    startedAt: string
    title?: string
  } | null
  contextConfig?: {
    fatPinInterval?: number
  } | null
  runtime?: {
    heartbeatCount?: number
    terminalState?: {
      kind: 'max_turns'
      subtype?: string
      terminalReason?: string
      message: string
      errors?: string[]
    } | null
  } | null
  memoryRoot?: string | null
  commanderRoot?: string | null
  runtimeConfig?: CommanderRuntimeConfig | null
}

const FALLBACK_RUNTIME_CONFIG = createDefaultCommanderRuntimeConfig()
const FIELD_CLASS =
  'w-full rounded-lg border border-[color:var(--hv-field-border)] bg-[var(--hv-field-bg)] px-3 py-2 text-[16px] text-[color:var(--hv-fg)] placeholder:text-[color:var(--hv-field-placeholder)] focus:border-[color:var(--hv-field-focus-border)] focus:outline-none md:text-sm'
const NOTE_CLASS = 'text-whisper text-[color:var(--hv-fg-faint)]'
const SUBTLE_NOTE_CLASS = 'text-whisper text-[color:var(--hv-fg-subtle)]'
const SECTION_HEADER_CLASS = 'border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-4 py-3'

async function fetchCommanderDetail(commanderId: string): Promise<CommanderDetailPayload> {
  return fetchJson<CommanderDetailPayload>(`/api/commanders/${encodeURIComponent(commanderId)}`)
}

async function updateCommanderEffort(
  commanderId: string,
  effort: ClaudeEffortLevel,
): Promise<void> {
  await fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}/profile`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ effort }),
  })
}

async function updateCommanderRuntime(
  commanderId: string,
  input: {
    maxTurns: number
    contextMode: 'thin' | 'fat'
    contextConfig: {
      fatPinInterval?: number
    }
  },
): Promise<void> {
  await fetchJson(`/api/commanders/${encodeURIComponent(commanderId)}/runtime`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

function formatHeartbeatInterval(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return '15 minutes'
  }
  const minutes = Math.max(1, Math.round(intervalMs / 60_000))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

function formatTaskState(detail: CommanderDetailPayload, commander: CommanderSession): string {
  const currentTask = detail.currentTask ?? commander.currentTask
  if (!currentTask) {
    return 'No task claimed'
  }

  if (currentTask.title?.trim()) {
    return `#${currentTask.issueNumber} · ${currentTask.title.trim()}`
  }

  return `#${currentTask.issueNumber}`
}

function formatContextMode(detail: CommanderDetailPayload, commander: CommanderSession): string {
  const value = detail.contextConfig?.fatPinInterval
  const contextMode = detail.contextMode ?? commander.contextMode ?? 'fat'
  if (!Number.isFinite(value) || !value || value <= 0) {
    return contextMode === 'thin' ? 'Thin' : 'Fat'
  }
  return contextMode === 'thin'
    ? `Thin (fat pin every ${value} heartbeats)`
    : `Fat (pin every ${value} heartbeats)`
}

function resolveMemoryRoot(detail: CommanderDetailPayload, commanderId: string): string {
  if (detail.memoryRoot?.trim()) {
    return detail.memoryRoot.trim()
  }
  return `<COMMANDER_DATA_DIR>/${commanderId}/.memory`
}

function MetadataField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2.5 text-[color:var(--hv-fg)]">
      <p className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">{label}</p>
      <p className="mt-1 break-words text-sm text-[color:var(--hv-fg)]">{value}</p>
    </div>
  )
}

function IdentitySection({
  title,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string
  defaultOpen?: boolean
  testId: string
  children: ReactNode
}) {
  return (
    <details
      className="card-sumi overflow-hidden"
      open={defaultOpen || undefined}
      data-testid={testId}
    >
      <summary className={`${SECTION_HEADER_CLASS} cursor-pointer list-none`}>
        <h3 className="section-title">{title}</h3>
      </summary>
      {children}
    </details>
  )
}

export function CommanderIdentityTab({
  commander,
}: {
  commander: CommanderSession
}) {
  const queryClient = useQueryClient()
  const [effort, setEffort] = useState<ClaudeEffortLevel>(
    commander.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
  )
  const [maxTurns, setMaxTurns] = useState(String(commander.maxTurns ?? FALLBACK_RUNTIME_CONFIG.defaults.maxTurns))
  const [runtimeContextMode, setRuntimeContextMode] = useState<'thin' | 'fat'>(commander.contextMode ?? 'fat')
  const [fatPinInterval, setFatPinInterval] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['commanders', 'detail', commander.id],
    queryFn: () => fetchCommanderDetail(commander.id),
    staleTime: 30_000,
  })

  const updateEffortMutation = useMutation({
    mutationFn: async (nextEffort: ClaudeEffortLevel) => updateCommanderEffort(commander.id, nextEffort),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commanders', 'sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['commanders', 'detail', commander.id] }),
      ])
    },
  })

  const updateRuntimeMutation = useMutation({
    mutationFn: async (input: {
      maxTurns: number
      contextMode: 'thin' | 'fat'
      contextConfig: {
        fatPinInterval?: number
      }
    }) => updateCommanderRuntime(commander.id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commanders', 'sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['commanders', 'detail', commander.id] }),
      ])
    },
  })

  useEffect(() => {
    setEffort(commander.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL)
    setMaxTurns(String(
      commander.maxTurns
      ?? detailQuery.data?.runtimeConfig?.defaults.maxTurns
      ?? FALLBACK_RUNTIME_CONFIG.defaults.maxTurns,
    ))
    setRuntimeContextMode(detailQuery.data?.contextMode ?? commander.contextMode ?? 'fat')
    setFatPinInterval(
      detailQuery.data?.contextConfig?.fatPinInterval
        ? String(detailQuery.data.contextConfig.fatPinInterval)
        : '',
    )
    setActionError(null)
  }, [
    commander.contextMode,
    commander.effort,
    commander.id,
    commander.maxTurns,
    detailQuery.data?.contextConfig?.fatPinInterval,
    detailQuery.data?.contextMode,
    detailQuery.data?.runtimeConfig?.defaults.maxTurns,
  ])

  async function handleSaveEffort(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setActionError(null)
    try {
      await updateEffortMutation.mutateAsync(effort)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update commander effort.')
    }
  }

  async function handleSaveRuntime(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const runtimeConfig = detailQuery.data?.runtimeConfig ?? FALLBACK_RUNTIME_CONFIG
    const parsedMaxTurns = Number.parseInt(maxTurns.trim(), 10)
    if (
      !Number.isFinite(parsedMaxTurns)
      || parsedMaxTurns < 1
      || parsedMaxTurns > runtimeConfig.limits.maxTurns
    ) {
      setActionError(`Max turns must be an integer between 1 and ${runtimeConfig.limits.maxTurns}.`)
      return
    }

    const parsedFatPinInterval = fatPinInterval.trim()
      ? Number.parseInt(fatPinInterval.trim(), 10)
      : undefined
    if (
      runtimeContextMode === 'fat'
      && parsedFatPinInterval !== undefined
      && (!Number.isFinite(parsedFatPinInterval) || parsedFatPinInterval < 1)
    ) {
      setActionError('Fat context interval must be at least 1 heartbeat when provided.')
      return
    }

    setActionError(null)
    try {
      await updateRuntimeMutation.mutateAsync({
        maxTurns: parsedMaxTurns,
        contextMode: runtimeContextMode,
        contextConfig: runtimeContextMode === 'fat' && parsedFatPinInterval !== undefined
          ? { fatPinInterval: parsedFatPinInterval }
          : {},
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update commander runtime.')
    }
  }

  const workflowMd = detailQuery.data?.workflowMd ?? null
  const detail = detailQuery.data ?? {}
  const runtimeConfig = detail.runtimeConfig ?? FALLBACK_RUNTIME_CONFIG
  const heartbeatInterval = formatHeartbeatInterval(commander.heartbeat.intervalMs)
  const contextModeLabel = formatContextMode(detail, commander)
  const taskState = formatTaskState(detail, commander)
  const memoryRoot = resolveMemoryRoot(detail, commander.id)
  const workspaceRoot = detail.cwd?.trim() || commander.cwd?.trim() || 'Not configured'
  const heartbeatCount = detail.runtime?.heartbeatCount
  const terminalState = detail.runtime?.terminalState ?? null
  const configuredMaxTurns = commander.maxTurns ?? runtimeConfig.defaults.maxTurns

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-4">
      <IdentitySection title="Runtime Config" testId="identity-section-runtime">
        <div className="p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <MetadataField
              label="Agent"
              value={commander.agentType ?? 'claude'}
            />
            <MetadataField
              label="Heartbeat Interval"
              value={heartbeatInterval}
            />
            <MetadataField
              label="Context Mode"
              value={contextModeLabel}
            />
            <MetadataField
              label="Max Turns"
              value={String(configuredMaxTurns)}
            />
            <MetadataField
              label="Task State"
              value={taskState}
            />
            <MetadataField
              label="Memory Directory"
              value={memoryRoot}
            />
            <MetadataField
              label="Workspace"
              value={workspaceRoot}
            />
          </div>
          {heartbeatCount != null && (
            <p className={SUBTLE_NOTE_CLASS}>
              Heartbeats observed in this runtime: {heartbeatCount}
            </p>
          )}
          {terminalState?.kind === 'max_turns' && (
            <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2.5">
              <p className="text-sm text-[color:var(--hv-accent-danger)]">
                Claude hit the max-turn cap at {configuredMaxTurns} turns.
              </p>
              <p className="mt-1 text-xs text-[color:var(--hv-fg-subtle)]">
                {terminalState.message}
              </p>
              {terminalState.errors?.length ? (
                <p className="mt-1 text-xs text-[color:var(--hv-fg-subtle)]">
                  {terminalState.errors.join(' · ')}
                </p>
              ) : null}
            </div>
          )}
          <form className="space-y-3" onSubmit={(event) => void handleSaveRuntime(event)}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="section-title block mb-2">Max turns</span>
                <input
                  type="number"
                  min={1}
                  max={runtimeConfig.limits.maxTurns}
                  step={1}
                  value={maxTurns}
                  onChange={(event) => setMaxTurns(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block">
                <span className="section-title block mb-2">Context mode</span>
                <select
                  value={runtimeContextMode}
                  onChange={(event) => setRuntimeContextMode(event.target.value as 'thin' | 'fat')}
                  className={FIELD_CLASS}
                >
                  <option value="thin">thin</option>
                  <option value="fat">fat</option>
                </select>
              </label>
            </div>
            {runtimeContextMode === 'fat' && (
              <label className="block">
                <span className="section-title block mb-2">Fat context every N heartbeats</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={fatPinInterval}
                  onChange={(event) => setFatPinInterval(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
            )}
            <p className={NOTE_CLASS}>
              Global default {runtimeConfig.defaults.maxTurns} · limit {runtimeConfig.limits.maxTurns}. Changes apply to the next Claude launch.
            </p>
            <button
              type="submit"
              disabled={updateRuntimeMutation.isPending}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {updateRuntimeMutation.isPending ? 'Saving...' : 'Save runtime'}
            </button>
          </form>
          <form className="space-y-3" onSubmit={(event) => void handleSaveEffort(event)}>
            <label className="block">
              <span className="section-title block mb-2">Claude effort</span>
              <select
                value={effort}
                onChange={(event) => setEffort(event.target.value as ClaudeEffortLevel)}
                className={FIELD_CLASS}
              >
                {CLAUDE_EFFORT_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
            <p className={NOTE_CLASS}>
              Used whenever this commander launches a Claude session. Default is `{DEFAULT_CLAUDE_EFFORT_LEVEL}`.
            </p>
            {commander.agentType !== 'claude' && (
              <p className={SUBTLE_NOTE_CLASS}>
                Current agent type is `{commander.agentType ?? 'claude'}`. This setting applies the next time the commander runs with Claude.
              </p>
            )}
            <button
              type="submit"
              disabled={updateEffortMutation.isPending}
              className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {updateEffortMutation.isPending ? 'Saving...' : 'Save effort'}
            </button>
          </form>
          {actionError && (
            <p className="text-sm text-[color:var(--hv-accent-danger)]">{actionError}</p>
          )}
        </div>
      </IdentitySection>

      <IdentitySection title="COMMANDER.md" testId="identity-section-commander-md" defaultOpen>
        <div className="p-4">
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-3 w-3 animate-breathe rounded-full bg-[var(--hv-fg-faint)]" />
            </div>
          ) : workflowMd ? (
            <div className="hervald-prose max-w-none break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{workflowMd}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-[color:var(--hv-fg-subtle)]">
              No per-commander `COMMANDER.md` has been scaffolded yet.
            </p>
          )}
        </div>
      </IdentitySection>

      <HeartbeatMonitor commander={commander} />
    </div>
  )
}
