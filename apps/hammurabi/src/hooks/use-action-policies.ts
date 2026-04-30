import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'

export type ActionPolicyMode = 'auto' | 'review' | 'block'
export type ActionPolicyKind = 'action' | 'skill'
export type ActionPolicyScope = 'global' | `commander:${string}`

export interface PolicyCommander {
  id: string
  host: string
  displayName?: string
  state?: string
}

export interface ActionPolicyRecord {
  actionId: string
  id: string
  name: string
  kind: ActionPolicyKind
  policy: ActionPolicyMode
  allowlist: string[]
  blocklist: string[]
  standing_approval?: Array<{
    email: string
    added_at: string
    added_by: string
    reason: string
    expires_at?: string
    permanent?: boolean
  }>
  description?: string
  group?: string
  category?: string
  targetLabel?: string
  scope?: string
  sourceScope?: string
}

export interface ActionPolicySettings {
  timeoutMinutes: number
  timeoutAction: 'auto' | 'block'
  standingApprovalExpiryDays: number
}

export interface UpdateActionPolicyInput {
  scope: ActionPolicyScope
  actionId: string
  id: string
  name: string
  kind: ActionPolicyKind
  policy: ActionPolicyMode
  allowlist: string[]
  blocklist: string[]
  description?: string
  group?: string
  category?: string
  targetLabel?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function normalizePolicyMode(value: unknown): ActionPolicyMode {
  if (value === 'auto' || value === 'review' || value === 'block') {
    return value
  }
  return 'review'
}

function normalizePolicyKind(value: unknown, id: string): ActionPolicyKind {
  if (value === 'action' || value === 'skill') {
    return value
  }
  return id.startsWith('skill:') ? 'skill' : 'action'
}

function normalizeActionPolicyRecord(value: unknown): ActionPolicyRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const rawId =
    value.actionId ??
    value.id ??
    value.policyId ??
    value.skillId ??
    value.slug ??
    value.name

  const rawName = value.name ?? value.label ?? value.displayName ?? rawId

  if (typeof rawId !== 'string' || typeof rawName !== 'string') {
    return null
  }

  return {
    actionId: rawId,
    id: rawId,
    name: rawName,
    kind: normalizePolicyKind(value.kind, rawId),
    policy: normalizePolicyMode(value.policy ?? value.mode),
    allowlist: normalizeStringArray(value.allowlist ?? value.allowPatterns),
    blocklist: normalizeStringArray(value.blocklist ?? value.blockPatterns),
    standing_approval: Array.isArray(value.standing_approval)
      ? value.standing_approval
        .filter((item): item is {
          email: string
          added_at: string
          added_by: string
          reason: string
          expires_at?: string
          permanent?: boolean
        } =>
          isRecord(item)
          && typeof item.email === 'string'
          && typeof item.added_at === 'string'
          && typeof item.added_by === 'string'
          && typeof item.reason === 'string')
        .map((item) => ({
          email: item.email,
          added_at: item.added_at,
          added_by: item.added_by,
          reason: item.reason,
          ...(typeof item.expires_at === 'string' ? { expires_at: item.expires_at } : {}),
          ...(typeof item.permanent === 'boolean' ? { permanent: item.permanent } : {}),
        }))
      : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    group:
      typeof value.group === 'string'
        ? value.group
        : typeof value.category === 'string'
          ? value.category
          : undefined,
    category: typeof value.category === 'string' ? value.category : undefined,
    targetLabel: typeof value.targetLabel === 'string' ? value.targetLabel : undefined,
    scope: typeof value.scope === 'string' ? value.scope : undefined,
    sourceScope: typeof value.sourceScope === 'string' ? value.sourceScope : undefined,
  }
}

function normalizeActionPolicyList(payload: unknown): ActionPolicyRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => normalizeActionPolicyRecord(item))
      .filter((item): item is ActionPolicyRecord => item !== null)
  }

  if (!isRecord(payload)) {
    return []
  }

  for (const key of ['policies', 'items', 'actions']) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) => normalizeActionPolicyRecord(item))
        .filter((item): item is ActionPolicyRecord => item !== null)
    }
  }

  const single = normalizeActionPolicyRecord(payload)
  return single ? [single] : []
}

function normalizePolicySettings(payload: unknown): ActionPolicySettings {
  const source = isRecord(payload) && isRecord(payload.settings) ? payload.settings : payload
  return {
    timeoutMinutes:
      isRecord(source) &&
      typeof source.timeoutMinutes === 'number' &&
      Number.isFinite(source.timeoutMinutes) &&
      source.timeoutMinutes > 0
        ? Math.round(source.timeoutMinutes)
        : 15,
    timeoutAction:
      isRecord(source) && (source.timeoutAction === 'auto' || source.timeoutAction === 'block')
        ? source.timeoutAction
        : 'block',
    standingApprovalExpiryDays:
      isRecord(source) &&
      typeof source.standingApprovalExpiryDays === 'number' &&
      Number.isFinite(source.standingApprovalExpiryDays) &&
      source.standingApprovalExpiryDays > 0
        ? Math.round(source.standingApprovalExpiryDays)
        : 30,
  }
}

async function fetchPolicyCommanders(): Promise<PolicyCommander[]> {
  const payload = await fetchJson<unknown>('/api/commanders')
  if (!Array.isArray(payload)) {
    return []
  }

  const commanders: PolicyCommander[] = []

  for (const item of payload) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.host !== 'string') {
      continue
    }

    commanders.push({
      id: item.id,
      host: item.host,
      displayName: typeof item.displayName === 'string' ? item.displayName : undefined,
      state: typeof item.state === 'string' ? item.state : undefined,
    })
  }

  return commanders
}

async function fetchActionPolicies(scope: ActionPolicyScope): Promise<ActionPolicyRecord[]> {
  const encodedScope = encodeURIComponent(scope)
  const payload = await fetchJson<unknown>(`/api/action-policies?scope=${encodedScope}`)
  return normalizeActionPolicyList(payload)
}

async function fetchPolicySettings(): Promise<ActionPolicySettings> {
  const payload = await fetchJson<unknown>('/api/action-policies/settings')
  return normalizePolicySettings(payload)
}

async function updateActionPolicy(input: UpdateActionPolicyInput): Promise<ActionPolicyRecord | null> {
  const payload = await fetchJson<unknown>('/api/action-policies', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      scope: input.scope,
      id: input.actionId,
      actionId: input.actionId,
      name: input.name,
      kind: input.kind,
      policy: input.policy,
      allowlist: input.allowlist,
      blocklist: input.blocklist,
      description: input.description,
      group: input.group,
      category: input.category,
      targetLabel: input.targetLabel,
    }),
  })

  const [record] = normalizeActionPolicyList(payload)
  return record ?? null
}

async function updatePolicySettings(
  input: ActionPolicySettings,
): Promise<ActionPolicySettings> {
  const payload = await fetchJson<unknown>('/api/action-policies/settings', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return normalizePolicySettings(payload)
}

function policiesQueryKey(scope: ActionPolicyScope) {
  return ['action-policies', scope] as const
}

function policySettingsQueryKey() {
  return ['action-policies', 'settings'] as const
}

export function usePolicyCommanders() {
  return useQuery({
    queryKey: ['action-policies', 'commanders'],
    queryFn: fetchPolicyCommanders,
    refetchInterval: 15_000,
  })
}

export function useActionPolicies(scope: ActionPolicyScope) {
  return useQuery({
    queryKey: policiesQueryKey(scope),
    queryFn: () => fetchActionPolicies(scope),
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
}

export function usePolicySettings() {
  return useQuery({
    queryKey: policySettingsQueryKey(),
    queryFn: fetchPolicySettings,
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
}

export function useUpdateActionPolicy(scope: ActionPolicyScope) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateActionPolicy,
    onMutate: async (nextRecord) => {
      const queryKey = policiesQueryKey(scope)
      await queryClient.cancelQueries({ queryKey })

      const previous =
        queryClient.getQueryData<ActionPolicyRecord[]>(queryKey) ?? []

      const optimisticRecord: ActionPolicyRecord = {
        actionId: nextRecord.actionId,
        id: nextRecord.id,
        name: nextRecord.name,
        kind: nextRecord.kind,
        policy: nextRecord.policy,
        allowlist: nextRecord.allowlist,
        blocklist: nextRecord.blocklist,
        description: nextRecord.description,
        group: nextRecord.group,
        category: nextRecord.category,
        targetLabel: nextRecord.targetLabel,
        scope: nextRecord.scope,
        sourceScope: nextRecord.scope,
      }

      queryClient.setQueryData<ActionPolicyRecord[]>(queryKey, (current = []) => {
        const next = [...current]
        const index = next.findIndex((item) => item.actionId === optimisticRecord.actionId)
        if (index >= 0) {
          next[index] = { ...next[index], ...optimisticRecord }
          return next
        }
        return [...next, optimisticRecord]
      })

      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (!context) {
        return
      }
      queryClient.setQueryData(context.queryKey, context.previous)
    },
    onSuccess: (record, variables) => {
      if (!record) {
        return
      }

      queryClient.setQueryData<ActionPolicyRecord[]>(policiesQueryKey(variables.scope), (current = []) => {
        const next = [...current]
        const index = next.findIndex((item) => item.actionId === record.actionId)
        if (index >= 0) {
          next[index] = { ...next[index], ...record }
          return next
        }
        return [...next, record]
      })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: policiesQueryKey(scope) })
    },
  })
}

export function useUpdatePolicySettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updatePolicySettings,
    onMutate: async (nextSettings) => {
      const queryKey = policySettingsQueryKey()
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ActionPolicySettings>(queryKey)
      queryClient.setQueryData<ActionPolicySettings>(queryKey, nextSettings)
      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (!context) {
        return
      }
      queryClient.setQueryData(context.queryKey, context.previous)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData<ActionPolicySettings>(policySettingsQueryKey(), settings)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: policySettingsQueryKey() })
    },
  })
}
