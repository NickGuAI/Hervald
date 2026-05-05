import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson, fetchVoid } from '@/lib/api'
import type {
  CommanderChannelBinding,
  CommanderChannelProvider,
} from '../types'

export const CHANNELS_QUERY_KEY = ['commander-channels'] as const

export interface CreateChannelBindingInput {
  commanderId: string
  provider: CommanderChannelProvider
  accountId: string
  displayName: string
  enabled?: boolean
  config?: Record<string, unknown>
}

export interface UpdateChannelBindingInput {
  commanderId: string
  bindingId: string
  displayName?: string
  enabled?: boolean
  config?: Record<string, unknown>
}

function commanderChannelsPath(commanderId: string): string {
  return `/api/commanders/${encodeURIComponent(commanderId)}/channels`
}

export function useChannels(commanderId: string | null) {
  return useQuery({
    queryKey: [...CHANNELS_QUERY_KEY, commanderId],
    enabled: Boolean(commanderId),
    queryFn: () => fetchJson<CommanderChannelBinding[]>(commanderChannelsPath(commanderId ?? '')),
  })
}

export function useCreateChannelBinding() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateChannelBindingInput) => fetchJson<CommanderChannelBinding>(
      commanderChannelsPath(input.commanderId),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),
    onSuccess: async (_binding, input) => {
      await queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] })
    },
  })
}

export function useUpdateChannelBinding() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateChannelBindingInput) => fetchJson<CommanderChannelBinding>(
      `${commanderChannelsPath(input.commanderId)}/${encodeURIComponent(input.bindingId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),
    onSuccess: async (_binding, input) => {
      await queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] })
    },
  })
}

export function useDeleteChannelBinding() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { commanderId: string; bindingId: string }) => {
      await fetchVoid(`${commanderChannelsPath(input.commanderId)}/${encodeURIComponent(input.bindingId)}`, {
        method: 'DELETE',
      })
      return input
    },
    onSuccess: async (input) => {
      await queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] })
    },
  })
}
