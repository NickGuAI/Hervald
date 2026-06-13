import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { AgentSession, AgentType } from '@/types'
import type { MsgItem } from '@modules/agents/messages/model'
import type { CommanderCurrentTask } from '@modules/commanders/hooks/useCommander'
import type { ClaudeAdaptiveThinkingMode } from '@modules/claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '@modules/claude-effort.js'
import type { ClaudeMaxThinkingTokens } from '@modules/claude-max-thinking-tokens.js'
import type {
  Conversation as ConversationContract,
  ConversationStatus,
  ConversationSurface,
} from '@gehirn/hammurabi-cli/session-contract'
import type { WorkspaceContextPayload } from '@modules/workspace/types'

const CONVERSATIONS_POLL_INTERVAL_MS = 5000
const CONVERSATION_DETAIL_STALE_MS = 30_000
const ACTIVE_CONVERSATION_STALE_MS = 30_000
const COMMANDER_CONVERSATIONS_QUERY_KEY = ['commanders', 'conversations'] as const
const COMMANDER_ACTIVE_CONVERSATION_QUERY_KEY = ['commanders', 'conversations', 'active'] as const
const CONVERSATION_DETAIL_QUERY_KEY = ['conversations', 'detail'] as const
const CONVERSATION_MESSAGES_QUERY_KEY = ['conversations', 'messages'] as const

export interface ConversationRecord extends Omit<ConversationContract, 'currentTask' | 'status' | 'surface'> {
  currentTask: CommanderCurrentTask | null
  status: ConversationStatus
  surface: ConversationSurface
  agentType?: AgentType | null
  model?: string | null
  providerContext?: ConversationContract['providerContext']
  runtimeState?: ConversationRuntimeState
  websocketReady?: boolean
  runtimeError?: string | null
  liveSession: AgentSession | null
  canonicalOrder?: number
  displayState?: ConversationDisplayState
  sendTarget?: ConversationSendTarget | null
  allowedActions?: ConversationAllowedActions
}

export type ConversationRuntimeState = 'idle' | 'starting' | 'active' | 'failed' | 'archived'

export type ConversationAction =
  | 'send'
  | 'queue'
  | 'media'
  | 'start'
  | 'pause'
  | 'resume'
  | 'archive'
  | 'delete'
  | 'updateProvider'

export type ConversationDisabledReasons = Record<ConversationAction, string | null>

export type ConversationAllowedActions = Record<ConversationAction, boolean>

export interface ConversationCapabilityState {
  supported: boolean
  reason: string | null
}

export interface ConversationSendTarget {
  kind: 'conversation'
  conversationId: string
  commanderId: string
  sessionName: string
  transportType: AgentSession['transportType'] | null
  agentType: AgentType | null
  queue: ConversationCapabilityState
  media: ConversationCapabilityState
}

export interface ConversationDisplayState {
  status: ConversationStatus
  runtimeState?: ConversationRuntimeState
  websocketReady?: boolean
  runtimeError?: string | null
  isVisible: boolean
  isDefaultConversation: boolean
  hasLiveSession: boolean
  isSendable: boolean
  isQueueable: boolean
  isMediaSendable: boolean
  label: string
  disabledReasons: ConversationDisabledReasons
}

export interface ConversationMessageInput {
  conversationId: string
  message: string
  images?: Array<{
    mediaType: string
    data: string
  }>
  clientSendId?: string
  queue?: boolean
  workspaceContext?: WorkspaceContextPayload
}

export interface CreateConversationInput {
  commanderId: string
  surface?: ConversationSurface
  id?: string
  channelMeta?: Record<string, unknown>
  currentTask?: CommanderCurrentTask | null
  agentType?: AgentType
  model?: string | null
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
}

export interface StartConversationInput {
  conversationId: string
  agentType?: AgentType
  model?: string | null
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  maxThinkingTokens?: ClaudeMaxThinkingTokens
  cwd?: string
  host?: string
}

export interface StopConversationInput {
  conversationId: string
}

export interface UpdateConversationInput {
  conversationId: string
  name?: string
  agentType?: AgentType
  model?: string | null
  status?: ConversationStatus
}

export interface DeleteConversationInput {
  conversationId: string
  hard?: boolean
}

interface ConversationMessageResponse {
  accepted: boolean
  createdSession: boolean
  conversation: ConversationRecord
  messagePage?: ConversationMessagesPage
}

export interface ConversationMessagesPage {
  conversationId: string
  sessionName: string
  source: 'live' | 'transcript' | 'empty'
  limit: number
  before: string | null
  nextBefore: string | null
  hasMore: boolean
  totalMessages: number
  messages: MsgItem[]
}

interface ConversationMessagesInfiniteData {
  pages: ConversationMessagesPage[]
  pageParams: unknown[]
}

interface StartConversationResponse {
  conversation: ConversationRecord
}

interface DeleteConversationResponse {
  deleted: boolean
  hard: boolean
  id: string
  commanderId: string
}

function conversationStatusPriority(status: ConversationStatus): number {
  switch (status) {
    case 'active':
      return 0
    case 'idle':
      return 1
    case 'paused':
      return 2
    case 'archived':
      return 3
    default:
      return 4
  }
}

export function sortConversations(conversations: readonly ConversationRecord[]): ConversationRecord[] {
  return [...conversations].sort((left, right) => {
    if (
      typeof left.canonicalOrder === 'number'
      && typeof right.canonicalOrder === 'number'
      && Number.isFinite(left.canonicalOrder)
      && Number.isFinite(right.canonicalOrder)
    ) {
      const canonicalDelta = left.canonicalOrder - right.canonicalOrder
      if (canonicalDelta !== 0) {
        return canonicalDelta
      }
    }

    const statusDelta = conversationStatusPriority(left.status) - conversationStatusPriority(right.status)
    if (statusDelta !== 0) {
      return statusDelta
    }

    const lastMessageDelta = Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt)
    if (Number.isFinite(lastMessageDelta) && lastMessageDelta !== 0) {
      return lastMessageDelta
    }

    const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (Number.isFinite(createdDelta) && createdDelta !== 0) {
      return createdDelta
    }

    return left.id.localeCompare(right.id)
  })
}

function conversationReadinessRank(conversation: ConversationRecord | null | undefined): number {
  if (!conversation) {
    return -1
  }
  if (
    conversation.websocketReady === true ||
    conversation.displayState?.websocketReady === true ||
    conversation.allowedActions?.send === true
  ) {
    return 4
  }
  if (conversation.runtimeState === 'active' || conversation.status === 'active') {
    return 3
  }
  if (conversation.runtimeState === 'starting') {
    return 2
  }
  if (conversation.runtimeState === 'failed') {
    return 1
  }
  return 0
}

function timestampMs(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function conversationFreshnessMs(conversation: ConversationRecord): number {
  return Math.max(
    timestampMs(conversation.lastMessageAt),
    timestampMs(conversation.createdAt),
  )
}

function selectConversationCandidate(
  detail: ConversationRecord | null | undefined,
  list: ConversationRecord | null | undefined,
): ConversationRecord | null {
  if (!detail) {
    return list ?? null
  }
  if (!list) {
    return detail
  }

  const detailRank = conversationReadinessRank(detail)
  const listRank = conversationReadinessRank(list)
  if (listRank > detailRank) {
    return list
  }
  if (detailRank > listRank) {
    return detail
  }
  return conversationFreshnessMs(list) > conversationFreshnessMs(detail) ? list : detail
}

export function commanderConversationsQueryKey(commanderId: string) {
  return [...COMMANDER_CONVERSATIONS_QUERY_KEY, commanderId] as const
}

export function commanderActiveConversationQueryKey(commanderId: string) {
  return [...COMMANDER_ACTIVE_CONVERSATION_QUERY_KEY, commanderId] as const
}

export function conversationDetailQueryKey(conversationId: string) {
  return [...CONVERSATION_DETAIL_QUERY_KEY, conversationId] as const
}

export function conversationMessagesQueryKey(conversationId: string) {
  return [...CONVERSATION_MESSAGES_QUERY_KEY, conversationId] as const
}

async function fetchCommanderConversations(commanderId: string): Promise<ConversationRecord[]> {
  return fetchJson<ConversationRecord[]>(
    `/api/commanders/${encodeURIComponent(commanderId)}/conversations`,
  )
}

export async function fetchCommanderActiveConversation(
  commanderId: string,
): Promise<ConversationRecord | null> {
  return fetchJson<ConversationRecord | null>(
    `/api/commanders/${encodeURIComponent(commanderId)}/conversations/active`,
  )
}

export const ACTIVE_CONVERSATION_FETCH_STALE_MS = ACTIVE_CONVERSATION_STALE_MS

async function fetchConversation(conversationId: string): Promise<ConversationRecord> {
  return fetchJson<ConversationRecord>(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  )
}

async function fetchConversationMessagesPage(input: {
  conversationId: string
  before?: string | null
  limit?: number
}): Promise<ConversationMessagesPage> {
  const params = new URLSearchParams()
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit))
  }
  if (input.before) {
    params.set('before', input.before)
  }

  const query = params.toString()
  return fetchJson<ConversationMessagesPage>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/messages${query ? `?${query}` : ''}`,
  )
}

async function postConversationMessage(
  input: ConversationMessageInput,
): Promise<ConversationMessageResponse> {
  return fetchJson<ConversationMessageResponse>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/message`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: input.message,
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
        ...(input.clientSendId ? { clientSendId: input.clientSendId } : {}),
        ...(input.queue ? { queue: true } : {}),
        ...(input.workspaceContext ? { workspaceContext: input.workspaceContext } : {}),
      }),
    },
  )
}

async function postCreateConversation(
  input: CreateConversationInput,
): Promise<ConversationRecord> {
  return fetchJson<ConversationRecord>(
    `/api/commanders/${encodeURIComponent(input.commanderId)}/conversations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        surface: input.surface ?? 'ui',
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.channelMeta !== undefined ? { channelMeta: input.channelMeta } : {}),
        ...(input.currentTask !== undefined ? { currentTask: input.currentTask } : {}),
        ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.adaptiveThinking !== undefined
          ? { adaptiveThinking: input.adaptiveThinking }
          : {}),
        ...(input.maxThinkingTokens !== undefined
          ? { maxThinkingTokens: input.maxThinkingTokens }
          : {}),
      }),
    },
  )
}

async function postStartConversation(
  input: StartConversationInput,
): Promise<ConversationRecord> {
  const response = await fetchJson<StartConversationResponse>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/start`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.adaptiveThinking !== undefined
          ? { adaptiveThinking: input.adaptiveThinking }
          : {}),
        ...(input.maxThinkingTokens !== undefined
          ? { maxThinkingTokens: input.maxThinkingTokens }
          : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
      }),
    },
  )

  return response.conversation
}

async function postStopConversation(
  input: StopConversationInput,
): Promise<ConversationRecord> {
  return fetchJson<ConversationRecord>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/pause`,
    {
      method: 'POST',
    },
  )
}

async function patchConversation(
  input: UpdateConversationInput,
): Promise<ConversationRecord> {
  return fetchJson<ConversationRecord>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    },
  )
}

async function deleteConversation(
  input: DeleteConversationInput,
): Promise<DeleteConversationResponse> {
  const querySuffix = input.hard ? '?hard=true' : ''
  return fetchJson<DeleteConversationResponse>(
    `/api/conversations/${encodeURIComponent(input.conversationId)}${querySuffix}`,
    {
      method: 'DELETE',
    },
  )
}

export function upsertConversationList(
  current: ConversationRecord[] | undefined,
  nextConversation: ConversationRecord,
): ConversationRecord[] {
  const existing = current ?? []
  const withoutPrevious = existing.filter((conversation) => conversation.id !== nextConversation.id)
  return sortConversations([...withoutPrevious, nextConversation])
}

function updateConversationMessagePageCache(
  queryClient: ReturnType<typeof useQueryClient>,
  messagePage: ConversationMessagesPage,
) {
  queryClient.setQueryData(
    conversationMessagesQueryKey(messagePage.conversationId),
    (current: ConversationMessagesInfiniteData | undefined) => ({
      pages: [
        messagePage,
        ...(current?.pages.slice(1) ?? []),
      ],
      pageParams: [
        null,
        ...(current?.pageParams.slice(1) ?? []),
      ],
    }),
  )
}

function updateConversationCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  conversation: ConversationRecord,
  options: {
    messagePage?: ConversationMessagesPage
  } = {},
) {
  queryClient.setQueryData(
    conversationDetailQueryKey(conversation.id),
    conversation,
  )
  queryClient.setQueryData(
    commanderConversationsQueryKey(conversation.commanderId),
    (current: ConversationRecord[] | undefined) =>
      upsertConversationList(current, conversation),
  )
  void queryClient.invalidateQueries({
    queryKey: commanderActiveConversationQueryKey(conversation.commanderId),
  })
  if (options.messagePage) {
    updateConversationMessagePageCache(queryClient, options.messagePage)
  } else {
    void queryClient.invalidateQueries({
      queryKey: conversationMessagesQueryKey(conversation.id),
    })
  }
}

function removeConversationCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  payload: DeleteConversationResponse,
) {
  queryClient.removeQueries({
    queryKey: conversationDetailQueryKey(payload.id),
    exact: true,
  })
  queryClient.removeQueries({
    queryKey: conversationMessagesQueryKey(payload.id),
    exact: true,
  })
  queryClient.setQueryData(
    commanderConversationsQueryKey(payload.commanderId),
    (current: ConversationRecord[] | undefined) =>
      (current ?? []).filter((conversation) => conversation.id !== payload.id),
  )
  void queryClient.invalidateQueries({
    queryKey: commanderActiveConversationQueryKey(payload.commanderId),
  })
}

export function useConversations(
  commanderId?: string | null,
  selectedConversationId?: string | null,
) {
  const safeCommanderId = typeof commanderId === 'string' && commanderId.trim().length > 0
    ? commanderId.trim()
    : null
  const safeSelectedConversationId =
    typeof selectedConversationId === 'string' && selectedConversationId.trim().length > 0
      ? selectedConversationId.trim()
      : null

  const listQuery = useQuery({
    queryKey: safeCommanderId ? commanderConversationsQueryKey(safeCommanderId) : [...COMMANDER_CONVERSATIONS_QUERY_KEY, 'none'],
    queryFn: () => fetchCommanderConversations(safeCommanderId ?? ''),
    enabled: Boolean(safeCommanderId),
    refetchInterval: safeCommanderId ? CONVERSATIONS_POLL_INTERVAL_MS : false,
  })

  const detailQuery = useQuery({
    queryKey: safeSelectedConversationId
      ? conversationDetailQueryKey(safeSelectedConversationId)
      : [...CONVERSATION_DETAIL_QUERY_KEY, 'none'],
    queryFn: () => fetchConversation(safeSelectedConversationId ?? ''),
    enabled: Boolean(safeSelectedConversationId),
    staleTime: CONVERSATION_DETAIL_STALE_MS,
    initialData: () => listQuery.data?.find((conversation) => conversation.id === safeSelectedConversationId),
  })

  const conversations = useMemo(
    () => listQuery.data ? sortConversations(listQuery.data) : [],
    [listQuery.data],
  )
  const selectedConversationFromList =
    conversations.find((conversation) => conversation.id === safeSelectedConversationId) ?? null
  const selectedConversation = selectConversationCandidate(detailQuery.data, selectedConversationFromList)

  return {
    conversations,
    selectedConversation,
    isLoading: listQuery.isLoading || detailQuery.isLoading,
    isFetching: listQuery.isFetching || detailQuery.isFetching,
    error: listQuery.error ?? detailQuery.error ?? null,
    refetch: async () => {
      await Promise.all([
        listQuery.refetch(),
        safeSelectedConversationId ? detailQuery.refetch() : Promise.resolve(),
      ])
    },
  }
}

export function useActiveConversation(
  commanderId?: string | null,
  enabled = true,
) {
  const safeCommanderId = typeof commanderId === 'string' && commanderId.trim().length > 0
    ? commanderId.trim()
    : null

  return useQuery({
    queryKey: safeCommanderId
      ? commanderActiveConversationQueryKey(safeCommanderId)
      : [...COMMANDER_ACTIVE_CONVERSATION_QUERY_KEY, 'none'],
    queryFn: () => fetchCommanderActiveConversation(safeCommanderId ?? ''),
    enabled: Boolean(safeCommanderId) && enabled,
    staleTime: ACTIVE_CONVERSATION_STALE_MS,
  })
}

export function useConversationMessages(
  conversationId?: string | null,
  enabled = true,
) {
  const safeConversationId = typeof conversationId === 'string' && conversationId.trim().length > 0
    ? conversationId.trim()
    : null

  return useInfiniteQuery({
    queryKey: safeConversationId
      ? conversationMessagesQueryKey(safeConversationId)
      : [...CONVERSATION_MESSAGES_QUERY_KEY, 'none'],
    queryFn: ({ pageParam }) => fetchConversationMessagesPage({
      conversationId: safeConversationId ?? '',
      before: pageParam,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    enabled: Boolean(safeConversationId) && enabled,
    staleTime: 5_000,
  })
}

export function useConversationMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: postConversationMessage,
    onSuccess: ({ conversation, messagePage }) => {
      updateConversationCaches(queryClient, conversation, { messagePage })
    },
  })
}

export function useCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: postCreateConversation,
    onSuccess: (conversation) => {
      updateConversationCaches(queryClient, conversation)
    },
  })
}

export function useStartConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: postStartConversation,
    onSuccess: (conversation) => {
      updateConversationCaches(queryClient, conversation)
    },
  })
}

export function useStopConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: postStopConversation,
    onSuccess: (conversation) => {
      updateConversationCaches(queryClient, conversation)
    },
  })
}

export function useUpdateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: patchConversation,
    onSuccess: (conversation) => {
      updateConversationCaches(queryClient, conversation)
    },
  })
}

export function useDeleteConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: (payload) => {
      removeConversationCaches(queryClient, payload)
    },
  })
}
