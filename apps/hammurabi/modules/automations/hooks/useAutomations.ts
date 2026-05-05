import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useProviderRegistry } from '@/hooks/use-providers'
import { fetchJson, fetchVoid } from '@/lib/api'
import type { AgentType } from '@/types'
import type {
  CreateSentinelInput,
  UpdateSentinelInput,
} from '../../sentinels/types'
import type {
  Automation,
  AutomationHistoryEntry,
  AutomationQuestTrigger,
  AutomationStatus,
  AutomationTrigger,
} from '../types'

const AUTOMATIONS_QUERY_KEY = (scopeKey: string) => ['automations', 'list', scopeKey] as const
const AUTOMATION_HISTORY_QUERY_KEY = (automationId: string | null) =>
  ['automations', 'history', automationId ?? 'none'] as const
const SKILL_OPTIONS_QUERY_KEY = ['automations', 'skill-options'] as const

export type AutomationTriggerFilter = 'all' | AutomationTrigger

export type AutomationScope =
  | {
      kind: 'global'
    }
  | {
      kind: 'commander'
      commanderId: string
    }

export interface SkillOption {
  value: string
  label: string
  description?: string
}

interface SkillDiscoveryItem {
  name?: string
  dirName?: string
  description?: string
}

export interface AutomationListItem extends Automation {
  nextRun: string | null
}

interface AutomationHistoryResponse {
  entries?: AutomationHistoryEntry[]
}

interface TriggerAutomationResult {
  automation: AutomationListItem
  historyEntry: AutomationHistoryEntry
}

interface AutomationCreatePayload {
  parentCommanderId?: string | null
  name: string
  trigger: AutomationTrigger
  schedule?: string
  questTrigger?: AutomationQuestTrigger
  instruction: string
  agentType: AgentType
  permissionMode?: 'default'
  status?: AutomationStatus
  description?: string
  timezone?: string
  machine?: string
  workDir?: string
  model?: string
  sessionType?: 'stream' | 'pty'
  skills?: string[]
  observations?: string[]
  seedMemory?: string
  maxRuns?: number
}

export interface CreateAutomationTaskInput {
  name: string
  schedule: string
  timezone?: string
  machine: string
  workDir: string
  agentType: AutomationCreatePayload['agentType']
  instruction: string
  model?: string
  enabled: boolean
  permissionMode?: 'default'
  sessionType?: 'stream' | 'pty'
  description?: string
}

interface AutomationUpdatePayload {
  name?: string
  trigger?: AutomationTrigger
  schedule?: string
  questTrigger?: AutomationQuestTrigger | null
  instruction?: string
  agentType?: AgentType
  permissionMode?: 'default'
  status?: AutomationStatus
  description?: string
  timezone?: string
  machine?: string
  workDir?: string
  model?: string | null
  sessionType?: 'stream' | 'pty' | null
  skills?: string[]
  observations?: string[]
  seedMemory?: string
  maxRuns?: number | null
}

function toErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return null
}

function compareAutomationNames(left: AutomationListItem, right: AutomationListItem): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function resolveScopeCommanderId(scope: AutomationScope): string | null {
  return scope.kind === 'commander' ? scope.commanderId : null
}

async function fetchAutomations(scope: AutomationScope): Promise<AutomationListItem[]> {
  const query = new URLSearchParams()
  if (scope.kind === 'global') {
    query.set('parentCommanderId', 'null')
  } else {
    query.set('parentCommanderId', scope.commanderId)
  }

  return fetchJson<AutomationListItem[]>(`/api/automations?${query.toString()}`)
}

async function fetchAutomationHistory(automationId: string): Promise<AutomationHistoryEntry[]> {
  const payload = await fetchJson<AutomationHistoryResponse>(
    `/api/automations/${encodeURIComponent(automationId)}/history?limit=50`,
  )
  return Array.isArray(payload.entries) ? payload.entries : []
}

async function fetchSkillOptions(): Promise<SkillOption[]> {
  const payload = await fetchJson<SkillDiscoveryItem[] | { skills?: SkillDiscoveryItem[] }>('/api/skills')
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.skills)
      ? payload.skills
      : []

  const options: SkillOption[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const value = typeof item.dirName === 'string' && item.dirName.trim().length > 0
      ? item.dirName.trim()
      : null
    const label = typeof item.name === 'string' && item.name.trim().length > 0
      ? item.name.trim()
      : value

    if (!value || !label) {
      continue
    }

    options.push({
      value,
      label,
      description: typeof item.description === 'string' ? item.description.trim() : undefined,
    })
  }

  return options.sort((left, right) => left.label.localeCompare(right.label))
}

function mapCreateTaskInput(
  scope: AutomationScope,
  input: CreateAutomationTaskInput,
): AutomationCreatePayload {
  return {
    name: input.name.trim(),
    parentCommanderId: scope.kind === 'commander' ? scope.commanderId : null,
    trigger: 'schedule',
    schedule: input.schedule.trim(),
    instruction: input.instruction.trim(),
    agentType: input.agentType,
    permissionMode: input.permissionMode ?? 'default',
    status: input.enabled === false ? 'paused' : 'active',
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.timezone?.trim() ? { timezone: input.timezone.trim() } : {}),
    ...(input.machine.trim() ? { machine: input.machine.trim() } : {}),
    ...(input.workDir.trim() ? { workDir: input.workDir.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.sessionType ? { sessionType: input.sessionType } : {}),
  }
}

function mapUpdateTaskPatch(
  patch: Record<string, unknown>,
  validProviderIds: ReadonlySet<AgentType>,
): AutomationUpdatePayload {
  const nextPatch: AutomationUpdatePayload = {}

  if (typeof patch.name === 'string' && patch.name.trim()) {
    nextPatch.name = patch.name.trim()
  }
  if (typeof patch.description === 'string') {
    const description = patch.description.trim()
    nextPatch.description = description || undefined
  }
  if (typeof patch.schedule === 'string' && patch.schedule.trim()) {
    nextPatch.schedule = patch.schedule.trim()
  }
  if (typeof patch.timezone === 'string') {
    const timezone = patch.timezone.trim()
    nextPatch.timezone = timezone || undefined
  }
  if (typeof patch.machine === 'string') {
    nextPatch.machine = patch.machine.trim()
  }
  if (typeof patch.workDir === 'string') {
    const workDir = patch.workDir.trim()
    nextPatch.workDir = workDir || undefined
  }
  if (typeof patch.agentType === 'string' && patch.agentType.trim()) {
    const providerId = patch.agentType.trim() as AgentType
    if (validProviderIds.has(providerId)) {
      nextPatch.agentType = providerId
    }
  }
  if (typeof patch.instruction === 'string' && patch.instruction.trim()) {
    nextPatch.instruction = patch.instruction.trim()
  }
  if (typeof patch.model === 'string') {
    const model = patch.model.trim()
    nextPatch.model = model || null
  }
  if (typeof patch.enabled === 'boolean') {
    nextPatch.status = patch.enabled ? 'active' : 'paused'
  }
  if (patch.permissionMode === 'default') {
    nextPatch.permissionMode = 'default'
  }
  if (patch.sessionType === 'stream' || patch.sessionType === 'pty') {
    nextPatch.sessionType = patch.sessionType
  }

  return nextPatch
}

function mapCreateSentinelInput(
  scope: AutomationScope,
  input: Omit<CreateSentinelInput, 'parentCommanderId'>,
): AutomationCreatePayload {
  return {
    name: input.name.trim(),
    parentCommanderId: scope.kind === 'commander' ? scope.commanderId : null,
    trigger: 'schedule',
    schedule: input.schedule.trim(),
    instruction: input.instruction.trim(),
    agentType: input.agentType ?? 'claude',
    permissionMode: input.permissionMode ?? 'default',
    status: input.status ?? 'active',
    ...(input.timezone?.trim() ? { timezone: input.timezone.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    ...(input.seedMemory?.trim() ? { seedMemory: input.seedMemory } : {}),
    ...(input.workDir?.trim() ? { workDir: input.workDir.trim() } : {}),
    ...(input.maxRuns ? { maxRuns: input.maxRuns } : {}),
    ...(input.observations?.length ? { observations: input.observations } : {}),
  }
}

function mapUpdateSentinelPatch(
  patch: UpdateSentinelInput,
  validProviderIds: ReadonlySet<AgentType>,
): AutomationUpdatePayload {
  return {
    ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.instruction?.trim() ? { instruction: patch.instruction.trim() } : {}),
    ...(patch.schedule?.trim() ? { schedule: patch.schedule.trim() } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone?.trim() || undefined } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.agentType && validProviderIds.has(patch.agentType)
      ? { agentType: patch.agentType }
      : {}),
    ...(patch.permissionMode ? { permissionMode: patch.permissionMode } : {}),
    ...(patch.model !== undefined ? { model: patch.model?.trim() || null } : {}),
    ...(patch.skills ? { skills: patch.skills } : {}),
    ...(patch.seedMemory !== undefined ? { seedMemory: patch.seedMemory } : {}),
    ...(patch.workDir !== undefined ? { workDir: patch.workDir?.trim() || undefined } : {}),
    ...(patch.maxRuns !== undefined ? { maxRuns: patch.maxRuns } : {}),
    ...(patch.observations ? { observations: patch.observations } : {}),
  }
}

export function useAutomationHistory(automationId: string | null) {
  const historyQuery = useQuery({
    queryKey: AUTOMATION_HISTORY_QUERY_KEY(automationId),
    queryFn: () => fetchAutomationHistory(automationId!),
    enabled: Boolean(automationId),
    refetchInterval: 10_000,
  })

  return {
    history: historyQuery.data ?? [],
    historyLoading: historyQuery.isLoading,
    historyError: toErrorMessage(historyQuery.error),
  }
}

export function useAutomations(scope: AutomationScope) {
  const queryClient = useQueryClient()
  const scopeKey = scope.kind === 'global' ? 'global' : scope.commanderId
  const commanderId = resolveScopeCommanderId(scope)
  const { data: providers = [] } = useProviderRegistry()
  const supportedAutomationProviderIds = useMemo(
    () => new Set(
      providers
        .filter((provider) => provider.capabilities.supportsAutomation)
        .map((provider) => provider.id as AgentType),
    ),
    [providers],
  )

  const automationsQuery = useQuery({
    queryKey: AUTOMATIONS_QUERY_KEY(scopeKey),
    queryFn: () => fetchAutomations(scope),
    refetchInterval: 10_000,
  })

  const skillOptionsQuery = useQuery({
    queryKey: SKILL_OPTIONS_QUERY_KEY,
    queryFn: fetchSkillOptions,
    refetchInterval: 60_000,
  })

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateAutomationTaskInput) =>
      fetchJson<AutomationListItem>('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mapCreateTaskInput(scope, input)),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })

  const createSentinelMutation = useMutation({
    mutationFn: (input: Omit<CreateSentinelInput, 'parentCommanderId'>) =>
      fetchJson<AutomationListItem>('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mapCreateSentinelInput(scope, input)),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })

  const updateAutomationMutation = useMutation({
    mutationFn: ({ automationId, patch }: { automationId: string; patch: AutomationUpdatePayload }) =>
      fetchJson<AutomationListItem>(`/api/automations/${encodeURIComponent(automationId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automations'] }),
        queryClient.invalidateQueries({
          queryKey: AUTOMATION_HISTORY_QUERY_KEY(updated.id),
        }),
      ])
    },
  })

  const deleteAutomationMutation = useMutation({
    mutationFn: (automationId: string) =>
      fetchVoid(`/api/automations/${encodeURIComponent(automationId)}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automations'] }),
        queryClient.invalidateQueries({ queryKey: ['automations', 'history'] }),
      ])
    },
  })

  const triggerAutomationMutation = useMutation({
    mutationFn: (automationId: string) =>
      fetchJson<TriggerAutomationResult>(`/api/automations/${encodeURIComponent(automationId)}/run`, {
        method: 'POST',
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automations'] }),
        queryClient.invalidateQueries({
          queryKey: AUTOMATION_HISTORY_QUERY_KEY(result.automation.id),
        }),
      ])
    },
  })

  const items = useMemo(
    () => [...(automationsQuery.data ?? [])].sort(compareAutomationNames),
    [automationsQuery.data],
  )

  const counts = useMemo(() => {
    const triggerCounts: Record<AutomationTriggerFilter, number> = {
      all: items.length,
      schedule: 0,
      quest: 0,
      manual: 0,
    }

    let active = 0
    let paused = 0
    let failed = 0

    for (const item of items) {
      triggerCounts[item.trigger] += 1
      if (item.status === 'active') {
        active += 1
      } else if (item.status === 'paused') {
        paused += 1
      } else if (item.status === 'cancelled') {
        failed += 1
      }
    }

    return { triggerCounts, active, paused, failed }
  }, [items])

  const createTask = useCallback(
    async (input: CreateAutomationTaskInput) => {
      await createTaskMutation.mutateAsync(input)
    },
    [createTaskMutation],
  )

  const updateTask = useCallback(
    async (automationId: string, patch: Record<string, unknown>) => {
      await updateAutomationMutation.mutateAsync({
        automationId,
        patch: mapUpdateTaskPatch(patch, supportedAutomationProviderIds),
      })
    },
    [supportedAutomationProviderIds, updateAutomationMutation],
  )

  const deleteTask = useCallback(
    async (automationId: string) => {
      await deleteAutomationMutation.mutateAsync(automationId)
    },
    [deleteAutomationMutation],
  )

  const triggerTask = useCallback(
    async (automationId: string) => {
      await triggerAutomationMutation.mutateAsync(automationId)
    },
    [triggerAutomationMutation],
  )

  const createSentinel = useCallback(
    async (input: Omit<CreateSentinelInput, 'parentCommanderId'>) => {
      await createSentinelMutation.mutateAsync(input)
    },
    [createSentinelMutation],
  )

  const updateSentinel = useCallback(
    async (automationId: string, patch: UpdateSentinelInput) => {
      await updateAutomationMutation.mutateAsync({
        automationId,
        patch: mapUpdateSentinelPatch(patch, supportedAutomationProviderIds),
      })
    },
    [supportedAutomationProviderIds, updateAutomationMutation],
  )

  const deleteSentinel = useCallback(
    async (automationId: string) => {
      await deleteAutomationMutation.mutateAsync(automationId)
    },
    [deleteAutomationMutation],
  )

  const triggerSentinel = useCallback(
    async (automationId: string) => {
      await triggerAutomationMutation.mutateAsync(automationId)
    },
    [triggerAutomationMutation],
  )

  const updateAutomation = useCallback(
    async (automationId: string, patch: AutomationUpdatePayload) => {
      await updateAutomationMutation.mutateAsync({ automationId, patch })
    },
    [updateAutomationMutation],
  )

  const deleteAutomation = useCallback(
    async (automationId: string) => {
      await deleteAutomationMutation.mutateAsync(automationId)
    },
    [deleteAutomationMutation],
  )

  const triggerAutomation = useCallback(
    async (automationId: string) => {
      await triggerAutomationMutation.mutateAsync(automationId)
    },
    [triggerAutomationMutation],
  )

  const pauseAutomation = useCallback(
    async (automationId: string) => {
      await updateAutomationMutation.mutateAsync({
        automationId,
        patch: { status: 'paused' },
      })
    },
    [updateAutomationMutation],
  )

  const resumeAutomation = useCallback(
    async (automationId: string) => {
      await updateAutomationMutation.mutateAsync({
        automationId,
        patch: { status: 'active' },
      })
    },
    [updateAutomationMutation],
  )

  const loading = automationsQuery.isLoading
  const dataError = toErrorMessage(automationsQuery.error)
  const actionError =
    toErrorMessage(createTaskMutation.error)
    ?? toErrorMessage(createSentinelMutation.error)
    ?? toErrorMessage(updateAutomationMutation.error)
    ?? toErrorMessage(deleteAutomationMutation.error)
    ?? toErrorMessage(triggerAutomationMutation.error)

  return {
    commanderId,
    items,
    counts,
    loading,
    dataError,
    actionError,
    skillOptions: skillOptionsQuery.data ?? [],
    skillOptionsLoading: skillOptionsQuery.isLoading,
    createTask,
    updateTask,
    deleteTask,
    triggerTask,
    createTaskPending: createTaskMutation.isPending,
    updateTaskPending: updateAutomationMutation.isPending,
    updateTaskId: updateAutomationMutation.variables?.automationId ?? null,
    deleteTaskPending: deleteAutomationMutation.isPending,
    deleteTaskId: deleteAutomationMutation.variables ?? null,
    triggerTaskPending: triggerAutomationMutation.isPending,
    triggerTaskId: triggerAutomationMutation.variables ?? null,
    createSentinel,
    updateSentinel,
    deleteSentinel,
    triggerSentinel,
    createSentinelPending: createSentinelMutation.isPending,
    updateSentinelPending: updateAutomationMutation.isPending,
    deleteSentinelPending: deleteAutomationMutation.isPending,
    triggerSentinelPending: triggerAutomationMutation.isPending,
    updateAutomation,
    updateAutomationPending: updateAutomationMutation.isPending,
    updateAutomationId: updateAutomationMutation.variables?.automationId ?? null,
    deleteAutomation,
    deleteAutomationPending: deleteAutomationMutation.isPending,
    deleteAutomationId: deleteAutomationMutation.variables ?? null,
    triggerAutomation,
    triggerAutomationPending: triggerAutomationMutation.isPending,
    triggerAutomationId: triggerAutomationMutation.variables ?? null,
    pauseAutomation,
    resumeAutomation,
  }
}
