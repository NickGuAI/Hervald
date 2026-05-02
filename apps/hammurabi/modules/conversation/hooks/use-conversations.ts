import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { AgentSession, AgentType } from '@/types'
import type { CommanderCurrentTask } from '@modules/commanders/hooks/useCommander'
import type { ClaudeAdaptiveThinkingMode } from '@modules/claude-adaptive-thinking.js'
import type { ClaudeEffortLevel } from '@modules/claude-effort.js'
import type {
  Conversation as ConversationContract,
  ConversationStatus,
  ConversationSurface,
} from '@gehirn/hammurabi-cli/session-contract'

const CONVERSATIONS_POLL_INTERVAL_MS = 1000
const COMMANDER_CONVERSATIONS_QUERY_KEY = ['commanders', 'conversations'] as const
const CONVERSATION_DETAIL_QUERY_KEY = ['conversations', 'detail'] as const

export interface ConversationRecord extends Omit<ConversationContract, 'currentTask' | 'status' | 'surface'> {
  currentTask: CommanderCurrentTask | null
  status: ConversationStatus
  surface: ConversationSurface
  liveSession: AgentSession | null
}

export interface ConversationMessageInput {
  conversationId: string
  message: string
  queue?: boolean
}

export interface CreateConversationInput {
  commanderId: string
  surface?: ConversationSurface
  id?: string
  channelMeta?: Record<string, unknown>
  currentTask?: CommanderCurrentTask | null
}

export interface StartConversationInput {
  conversationId: string
  agentType: AgentType
  effort?: ClaudeEffortLevel
  adaptiveThinking?: ClaudeAdaptiveThinkingMode
  cwd?: string
  host?: string
}

export interface StopConversationInput {
  conversationId: string
}

interface ConversationMessageResponse {
  accepted: boolean
  createdSession: boolean
  conversation: ConversationRecord
}

interface StartConversationResponse {
  conversation: ConversationRecord
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

export function commanderConversationsQueryKey(commanderId: string) {
  return [...COMMANDER_CONVERSATIONS_QUERY_KEY, commanderId] as const
}

export function conversationDetailQueryKey(conversationId: string) {
  return [...CONVERSATION_DETAIL_QUERY_KEY, conversationId] as const
}

async function fetchCommanderConversations(commanderId: string): Promise<ConversationRecord[]> {
  return fetchJson<ConversationRecord[]>(
    `/api/commanders/${encodeURIComponent(commanderId)}/conversations`,
  )
}

async function fetchConversation(conversationId: string): Promise<ConversationRecord> {
  return fetchJson<ConversationRecord>(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
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
        ...(input.queue ? { queue: true } : {}),
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
        agentType: input.agentType,
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.adaptiveThinking !== undefined
          ? { adaptiveThinking: input.adaptiveThinking }
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

export function upsertConversationList(
  current: ConversationRecord[] | undefined,
  nextConversation: ConversationRecord,
): ConversationRecord[] {
  const existing = current ?? []
  const withoutPrevious = existing.filter((conversation) => conversation.id !== nextConversation.id)
  return sortConversations([...withoutPrevious, nextConversation])
}

function updateConversationCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  conversation: ConversationRecord,
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
    select: sortConversations,
  })

  const detailQuery = useQuery({
    queryKey: safeSelectedConversationId
      ? conversationDetailQueryKey(safeSelectedConversationId)
      : [...CONVERSATION_DETAIL_QUERY_KEY, 'none'],
    queryFn: () => fetchConversation(safeSelectedConversationId ?? ''),
    enabled: Boolean(safeSelectedConversationId),
    refetchInterval: safeSelectedConversationId ? CONVERSATIONS_POLL_INTERVAL_MS : false,
    initialData: () => listQuery.data?.find((conversation) => conversation.id === safeSelectedConversationId),
  })

  const conversations = listQuery.data ?? []
  const selectedConversation = detailQuery.data
    ?? conversations.find((conversation) => conversation.id === safeSelectedConversationId)
    ?? null

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

export function useConversationMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: postConversationMessage,
    onSuccess: ({ conversation }) => {
      updateConversationCaches(queryClient, conversation)
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
