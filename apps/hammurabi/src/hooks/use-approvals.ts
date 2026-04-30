import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson, getAccessToken } from '@/lib/api'
import { getWsBase } from '@/lib/api-base'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../../modules/agents/ws-reconnect'

export const APPROVALS_QUERY_KEY = ['approvals', 'pending'] as const
export const APPROVAL_HISTORY_QUERY_KEY = ['approvals', 'history'] as const

export type ApprovalDecision = 'approve' | 'reject'
export type ApprovalStreamStatus = 'connecting' | 'connected' | 'disconnected'

export interface ApprovalDetailLine {
  label: string
  value: string
}

export interface PendingApproval {
  id: string
  decisionId: string | number
  actionLabel: string
  actionId: string | null
  source: string
  commanderId: string | null
  commanderName: string | null
  sessionName: string | null
  requestedAt: string
  requestId: string | number | null
  reason: string | null
  risk: string | null
  summary: string | null
  previewText: string | null
  details: ApprovalDetailLine[]
  raw: Record<string, unknown>
  context: Record<string, unknown> | null
}

export interface ApprovalStreamEvent {
  type: string
  approval: PendingApproval | null
  approvalId: string | number | null
  raw: unknown
}

export interface ApprovalNotification {
  id: string
  approval: PendingApproval
  createdAt: number
}

export interface ApprovalHistoryEntry {
  id: string
  timestamp: string
  type: 'approval.enqueued' | 'approval.resolved'
  actionId: string | null
  actionLabel: string
  commanderId: string | null
  source: string | null
  summary: string | null
  decision: ApprovalDecision | null
  timedOut: boolean
  delivered: boolean | null
  raw: Record<string, unknown>
}

interface ApprovalListResponse {
  approvals?: unknown[]
  pending?: unknown[]
  items?: unknown[]
  data?: unknown[]
}

interface ApprovalHistoryResponse {
  history?: unknown[]
  items?: unknown[]
  data?: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function pickValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source && source[key] !== undefined && source[key] !== null) {
      return source[key]
    }
  }
  return undefined
}

function readString(source: Record<string, unknown>, keys: string[]): string | null {
  const value = pickValue(source, keys)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function readScalar(source: Record<string, unknown>, keys: string[]): string | number | null {
  const value = pickValue(source, keys)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  return null
}

function truncateText(value: string, limit = 220): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function formatUnknownValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const pieces = value
      .map((entry) => formatUnknownValue(entry))
      .filter((entry): entry is string => Boolean(entry))
    if (pieces.length === 0) {
      return null
    }
    return truncateText(pieces.join(', '), 240)
  }
  if (isRecord(value)) {
    const preferredText = readString(value, [
      'summary',
      'text',
      'body',
      'content',
      'message',
      'subject',
      'title',
      'value',
    ])
    if (preferredText) {
      return truncateText(preferredText, 240)
    }
    try {
      return truncateText(JSON.stringify(value, null, 2), 240)
    } catch {
      return null
    }
  }
  return null
}

function humanizeSlug(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function inferActionLabel(source: Record<string, unknown>): string {
  const explicit = readString(source, ['actionLabel', 'actionName', 'action', 'label'])
  if (explicit) {
    return explicit
  }

  const method = readString(source, ['method'])
  if (method === 'item/commandExecution/requestApproval') {
    return 'Command Execution'
  }
  if (method === 'item/fileChange/requestApproval') {
    return 'File Change'
  }

  const actionId = readString(source, ['actionId', 'kind', 'type'])
  if (actionId) {
    return humanizeSlug(actionId)
  }

  return 'Approval Request'
}

function inferSource(source: Record<string, unknown>): string {
  const explicit = readString(source, ['source'])
  if (explicit) {
    return explicit
  }

  const method = readString(source, ['method'])
  if (method?.startsWith('item/')) {
    return 'codex'
  }

  return 'approval'
}

function collectDetailLines(
  raw: Record<string, unknown>,
  context: Record<string, unknown> | null,
): ApprovalDetailLine[] {
  const lines: ApprovalDetailLine[] = []
  const seen = new Set<string>()
  const sources = [raw, context].filter((entry): entry is Record<string, unknown> => Boolean(entry))

  const explicitDetailCandidates = [
    pickValue(raw, ['details', 'detailLines', 'previewFields']),
    pickValue(context ?? {}, ['details', 'detailLines', 'previewFields']),
  ]
  for (const candidate of explicitDetailCandidates) {
    if (!Array.isArray(candidate)) {
      continue
    }
    for (const entry of candidate) {
      const record = asRecord(entry)
      if (!record) {
        continue
      }
      const label = readString(record, ['label', 'name', 'title'])
      const value = formatUnknownValue(pickValue(record, ['value', 'text', 'content', 'summary']))
      if (!label || !value) {
        continue
      }
      const key = `${label}:${value}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      lines.push({ label, value })
    }
  }

  const fieldMap: Array<{ label: string; keys: string[] }> = [
    { label: 'To', keys: ['recipient', 'to', 'target', 'email'] },
    { label: 'Subject', keys: ['subject'] },
    { label: 'Channel', keys: ['channel', 'recipientChannel'] },
    { label: 'Platform', keys: ['platform', 'platforms'] },
    { label: 'Repository', keys: ['repo', 'repository'] },
    { label: 'Branch', keys: ['branch'] },
    { label: 'Environment', keys: ['environment', 'env'] },
    { label: 'Service', keys: ['service', 'deployTarget'] },
    { label: 'Calendar', keys: ['calendar'] },
    { label: 'Event', keys: ['eventTitle', 'title'] },
  ]

  for (const field of fieldMap) {
    let value: string | null = null
    for (const source of sources) {
      value = formatUnknownValue(pickValue(source, field.keys))
      if (value) {
        break
      }
    }
    if (!value) {
      continue
    }
    const key = `${field.label}:${value}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    lines.push({ label: field.label, value })
  }

  return lines.slice(0, 6)
}

function collectPreviewText(
  raw: Record<string, unknown>,
  context: Record<string, unknown> | null,
): string | null {
  const previewRecord = asRecord(pickValue(raw, ['preview', 'proposal', 'payloadPreview']))
  const sources = [previewRecord, context, raw].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry),
  )

  for (const source of sources) {
    const direct = readString(source, ['previewText', 'summary', 'body', 'content', 'text', 'message'])
    if (direct) {
      return truncateText(direct, 320)
    }
  }

  const previewValue = pickValue(raw, ['preview', 'proposal', 'payloadPreview'])
  return previewValue ? formatUnknownValue(previewValue) : null
}

export function normalizeApproval(input: unknown): PendingApproval | null {
  const raw = asRecord(input)
  if (!raw) {
    return null
  }

  const context = asRecord(pickValue(raw, ['context', 'toolInput', 'request', 'payload']))
  const decisionId = readScalar(raw, ['id', 'approvalId', 'requestId']) ?? readString(raw, ['itemId'])
  const requestId = readScalar(raw, ['requestId'])
  const requestedAt = readString(raw, ['requestedAt', 'createdAt', 'timestamp']) ?? new Date().toISOString()
  const summary =
    readString(raw, ['summary']) ??
    readString(context ?? {}, ['summary']) ??
    readString(raw, ['reason']) ??
    readString(context ?? {}, ['reason'])

  const id =
    readString(raw, ['id', 'approvalId']) ??
    (requestId !== null ? String(requestId) : null) ??
    readString(raw, ['itemId']) ??
    `${inferSource(raw)}:${requestedAt}`

  return {
    id,
    decisionId: decisionId ?? id,
    actionLabel: inferActionLabel(raw),
    actionId: readString(raw, ['actionId']),
    source: inferSource(raw),
    commanderId: readString(raw, ['commanderId']),
    commanderName:
      readString(raw, ['commanderName', 'commanderLabel', 'commanderDisplayName']) ??
      readString(context ?? {}, ['commanderName', 'commanderLabel']),
    sessionName:
      readString(raw, ['sessionName', 'agentName']) ??
      readString(context ?? {}, ['sessionName', 'agentName']),
    requestedAt,
    requestId,
    reason: readString(raw, ['reason']),
    risk: readString(raw, ['risk']),
    summary,
    previewText: collectPreviewText(raw, context),
    details: collectDetailLines(raw, context),
    raw,
    context,
  }
}

function normalizeApprovalList(payload: unknown): PendingApproval[] {
  const response = payload as ApprovalListResponse
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(response.pending)
      ? response.pending
      : Array.isArray(response.approvals)
        ? response.approvals
        : Array.isArray(response.items)
          ? response.items
          : Array.isArray(response.data)
            ? response.data
            : []

  return entries
    .map((entry) => normalizeApproval(entry))
    .filter((entry): entry is PendingApproval => Boolean(entry))
}

function normalizeApprovalHistoryEntry(input: unknown): ApprovalHistoryEntry | null {
  const raw = asRecord(input)
  if (!raw) {
    return null
  }

  const timestamp = readString(raw, ['timestamp', 'requestedAt', 'createdAt'])
  const type = readString(raw, ['type'])
  const approvalId = readString(raw, ['approvalId', 'id'])
  if (!timestamp || (type !== 'approval.enqueued' && type !== 'approval.resolved') || !approvalId) {
    return null
  }

  const outcome = asRecord(raw.outcome)
  const timedOut = outcome?.timedOut === true
  const decision = raw.decision === 'approve' || raw.decision === 'reject'
    ? raw.decision
    : null

  return {
    id: `${approvalId}:${timestamp}:${type}`,
    timestamp,
    type,
    actionId: readString(raw, ['actionId']),
    actionLabel:
      readString(raw, ['actionLabel']) ??
      readString(raw, ['summary']) ??
      'Approval Request',
    commanderId: readString(raw, ['commanderId']),
    source: readString(raw, ['source']),
    summary: readString(raw, ['summary']) ?? readString(outcome ?? {}, ['reason']),
    decision,
    timedOut,
    delivered: typeof raw.delivered === 'boolean' ? raw.delivered : null,
    raw,
  }
}

function normalizeApprovalHistory(payload: unknown): ApprovalHistoryEntry[] {
  const response = payload as ApprovalHistoryResponse
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(response.history)
      ? response.history
      : Array.isArray(response.items)
        ? response.items
        : Array.isArray(response.data)
          ? response.data
          : []

  return entries
    .map((entry) => normalizeApprovalHistoryEntry(entry))
    .filter((entry): entry is ApprovalHistoryEntry => entry !== null)
}

function approvalStreamUrl(path: string, token: string | null): string {
  const query = new URLSearchParams()
  if (token) {
    query.set('access_token', token)
  }

  const wsBase = getWsBase()
  const qs = query.toString()
  if (wsBase) {
    return `${wsBase}${path}${qs ? `?${qs}` : ''}`
  }

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${path}${qs ? `?${qs}` : ''}`
}

function normalizeApprovalStreamEvent(payload: unknown): ApprovalStreamEvent | null {
  const raw = asRecord(payload)
  if (!raw) {
    return null
  }

  const type = readString(raw, ['type', 'event']) ?? 'unknown'
  const approval = normalizeApproval(pickValue(raw, ['approval', 'item', 'data']))
  const approvalId =
    readScalar(raw, ['approvalId', 'id', 'requestId']) ??
    readScalar(approval?.raw ?? {}, ['requestId']) ??
    approval?.decisionId ??
    null

  return {
    type,
    approval,
    approvalId,
    raw: payload,
  }
}

async function fetchPendingApprovals(path: string): Promise<PendingApproval[]> {
  const payload = await fetchJson<ApprovalListResponse | unknown[]>(path)
  return normalizeApprovalList(payload)
}

async function fetchApprovalHistory(path: string): Promise<ApprovalHistoryEntry[]> {
  const payload = await fetchJson<ApprovalHistoryResponse | unknown[]>(path)
  return normalizeApprovalHistory(payload)
}

interface ApprovalDecisionInput {
  approval: PendingApproval
  decision: ApprovalDecision
}

async function postApprovalDecision(
  path: string,
  input: ApprovalDecisionInput,
): Promise<{ ok?: boolean }> {
  return fetchJson<{ ok?: boolean }>(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: input.approval.decisionId,
      decision: input.decision,
    }),
  })
}

export function usePendingApprovals(options?: {
  enabled?: boolean
  path?: string
  refetchIntervalMs?: number
}) {
  const enabled = options?.enabled ?? true
  const path = options?.path ?? '/api/approvals/pending'
  const refetchIntervalMs = options?.refetchIntervalMs ?? 30_000

  return useQuery({
    queryKey: [...APPROVALS_QUERY_KEY, path],
    queryFn: () => fetchPendingApprovals(path),
    enabled,
    refetchInterval: enabled ? refetchIntervalMs : false,
  })
}

export function useApprovalHistory(options?: {
  enabled?: boolean
  path?: string
  refetchIntervalMs?: number
}) {
  const enabled = options?.enabled ?? true
  const path = options?.path ?? '/api/approvals/history?limit=20'
  const refetchIntervalMs = options?.refetchIntervalMs ?? 30_000

  return useQuery({
    queryKey: [...APPROVAL_HISTORY_QUERY_KEY, path],
    queryFn: () => fetchApprovalHistory(path),
    enabled,
    refetchInterval: enabled ? refetchIntervalMs : false,
  })
}

export function useApprovalDecision(options?: { path?: string }) {
  const queryClient = useQueryClient()
  const path = options?.path ?? '/api/approval/decide'

  return useMutation({
    mutationFn: (input: ApprovalDecisionInput) => postApprovalDecision(path, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: APPROVAL_HISTORY_QUERY_KEY })
    },
  })
}

export function useApprovalStream(options?: {
  enabled?: boolean
  path?: string
  onEvent?: (event: ApprovalStreamEvent) => void
  onEnqueued?: (approval: PendingApproval, event: ApprovalStreamEvent) => void
  onResolved?: (approvalId: string | number | null, event: ApprovalStreamEvent) => void
}) {
  const enabled = options?.enabled ?? true
  const path = options?.path ?? '/api/approvals/stream'
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ApprovalStreamStatus>(enabled ? 'connecting' : 'disconnected')

  const callbacksRef = useRef({
    onEvent: options?.onEvent,
    onEnqueued: options?.onEnqueued,
    onResolved: options?.onResolved,
  })

  useEffect(() => {
    callbacksRef.current = {
      onEvent: options?.onEvent,
      onEnqueued: options?.onEnqueued,
      onResolved: options?.onResolved,
    }
  }, [options?.onEnqueued, options?.onEvent, options?.onResolved])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setStatus('disconnected')
      return
    }

    const backoff = createReconnectBackoff()
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let cancelled = false

    async function connect(): Promise<void> {
      setStatus('connecting')
      const token = await getAccessToken()
      if (cancelled) {
        return
      }

      socket = new WebSocket(approvalStreamUrl(path, token))

      socket.addEventListener('open', () => {
        backoff.reset()
        setStatus('connected')
      })

      socket.addEventListener('message', (message) => {
        let payload: unknown
        try {
          payload = JSON.parse(message.data as string)
        } catch {
          return
        }

        const event = normalizeApprovalStreamEvent(payload)
        if (!event) {
          return
        }

        callbacksRef.current.onEvent?.(event)

        if (event.type === 'approval.enqueued' && event.approval) {
          callbacksRef.current.onEnqueued?.(event.approval, event)
          void queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY })
          void queryClient.invalidateQueries({ queryKey: APPROVAL_HISTORY_QUERY_KEY })
          return
        }

        if (event.type === 'approval.resolved') {
          callbacksRef.current.onResolved?.(event.approvalId, event)
          void queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY })
          void queryClient.invalidateQueries({ queryKey: APPROVAL_HISTORY_QUERY_KEY })
          return
        }

        if (event.type.includes('approval')) {
          void queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_KEY })
          void queryClient.invalidateQueries({ queryKey: APPROVAL_HISTORY_QUERY_KEY })
        }
      })

      socket.addEventListener('error', () => {
        setStatus('disconnected')
      })

      socket.addEventListener('close', (event) => {
        setStatus('disconnected')
        if (cancelled || !shouldReconnectWebSocketClose(event)) {
          return
        }

        const delay = backoff.nextDelayMs()
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null
          void connect()
        }, delay)
      })
    }

    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [enabled, path, queryClient])

  return status
}

export function useApprovalNotifications(options?: {
  enabled?: boolean
  suppressNotifications?: boolean
  streamPath?: string
  ttlMs?: number
  maxVisible?: number
}) {
  const enabled = options?.enabled ?? true
  const suppressNotifications = options?.suppressNotifications ?? false
  const ttlMs = options?.ttlMs ?? 10_000
  const maxVisible = options?.maxVisible ?? 3
  const [notifications, setNotifications] = useState<ApprovalNotification[]>([])
  const seenApprovalIdsRef = useRef(new Set<string>())
  const timeoutIdsRef = useRef(new Map<string, number>())

  function dismissNotification(notificationId: string): void {
    const timerId = timeoutIdsRef.current.get(notificationId)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      timeoutIdsRef.current.delete(notificationId)
    }
    setNotifications((current) => current.filter((entry) => entry.id !== notificationId))
  }

  const connectionStatus = useApprovalStream({
    enabled,
    path: options?.streamPath,
    onEnqueued: (approval) => {
      if (suppressNotifications) {
        return
      }
      if (seenApprovalIdsRef.current.has(approval.id)) {
        return
      }
      seenApprovalIdsRef.current.add(approval.id)
      setNotifications((current) => [
        {
          id: `${approval.id}:${Date.now()}`,
          approval,
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, maxVisible))
    },
    onResolved: (approvalId) => {
      if (approvalId === null || approvalId === undefined) {
        return
      }
      const normalized = String(approvalId)
      setNotifications((current) =>
        current.filter((entry) => String(entry.approval.decisionId) !== normalized),
      )
    },
  })

  useEffect(() => {
    for (const entry of notifications) {
      if (timeoutIdsRef.current.has(entry.id)) {
        continue
      }
      const timeoutId = window.setTimeout(() => {
        dismissNotification(entry.id)
      }, ttlMs)
      timeoutIdsRef.current.set(entry.id, timeoutId)
    }
  }, [notifications, ttlMs])

  useEffect(() => {
    return () => {
      for (const timeoutId of timeoutIdsRef.current.values()) {
        window.clearTimeout(timeoutId)
      }
      timeoutIdsRef.current.clear()
    }
  }, [])

  return {
    notifications,
    dismissNotification,
    connectionStatus,
  }
}
