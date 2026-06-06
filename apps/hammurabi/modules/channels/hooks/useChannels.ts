import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson, fetchVoid } from '@/lib/api'
import type {
  ChannelAdapterStatus,
  ChannelPairingChallenge,
  ChannelPairingStatus,
  ChannelProviderDescriptor,
  CommanderChannelBinding,
  CommanderChannelProvider,
} from '../types'

export const CHANNELS_QUERY_KEY = ['commander-channels'] as const
export const CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY = ['channel-provider-descriptors'] as const

export interface CreateChannelBindingInput {
  commanderId: string
  provider: CommanderChannelProvider
  accountId: string
  displayName: string
  enabled?: boolean
  config?: Record<string, unknown>
}

export interface BeginChannelPairingInput {
  commanderId: string
  provider: CommanderChannelProvider
  accountId?: string
  displayName?: string
  config?: Record<string, unknown>
}

export interface CompleteChannelPairingInput {
  commanderId: string
  provider: CommanderChannelProvider
  challengeId: string
  accountId?: string
  displayName?: string
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

function channelProviderDescriptorsPath(commanderId: string | null): string {
  return commanderId
    ? `${commanderChannelsPath(commanderId)}/providers`
    : '/api/commanders/channels/providers'
}

export interface ChannelProviderDescriptorResponse {
  providers: ChannelProviderDescriptor[]
}

export function useChannels(commanderId: string | null) {
  return useQuery({
    queryKey: [...CHANNELS_QUERY_KEY, commanderId],
    enabled: Boolean(commanderId),
    queryFn: () => fetchJson<CommanderChannelBinding[]>(commanderChannelsPath(commanderId ?? '')),
  })
}

export function useChannelProviderDescriptors(commanderId: string | null = null) {
  return useQuery({
    queryKey: [...CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY, commanderId],
    queryFn: () => fetchJson<ChannelProviderDescriptorResponse>(channelProviderDescriptorsPath(commanderId)),
    staleTime: 60_000,
  })
}

export function useCreateChannelBinding() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ commanderId, ...body }: CreateChannelBindingInput) => (
      fetchJson<CommanderChannelBinding>(
        commanderChannelsPath(commanderId),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
    ),
    onSuccess: async (_binding, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] }),
        queryClient.invalidateQueries({ queryKey: [...CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY, input.commanderId] }),
      ])
    },
  })
}

export function useBeginChannelPairing() {
  return useMutation({
    mutationFn: ({ commanderId, ...body }: BeginChannelPairingInput) => fetchJson<ChannelPairingChallenge>(
      `${commanderChannelsPath(commanderId)}/pairing`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  })
}

export function useChannelPairingStatus(
  commanderId: string | null,
  challengeId: string | null,
  provider: CommanderChannelProvider,
  accountId?: string | null,
  enabled = true,
) {
  const query = new URLSearchParams({ provider })
  if (accountId) {
    query.set('accountId', accountId)
  }
  return useQuery({
    queryKey: [...CHANNELS_QUERY_KEY, commanderId, 'pairing', challengeId, 'status', provider, accountId ?? null],
    enabled: Boolean(commanderId && challengeId && enabled),
    queryFn: () => fetchJson<ChannelPairingStatus>(
      `${commanderChannelsPath(commanderId ?? '')}/pairing/${encodeURIComponent(challengeId ?? '')}/status?${query.toString()}`,
    ),
    refetchInterval: (queryState) => {
      const data = queryState.state.data
      return data?.connected ? false : 2_000
    },
  })
}

export function useCompleteChannelPairing() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ commanderId, challengeId, ...body }: CompleteChannelPairingInput) => fetchJson<CommanderChannelBinding>(
      `${commanderChannelsPath(commanderId)}/pairing/${encodeURIComponent(challengeId)}/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    onSuccess: async (_binding, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] }),
        queryClient.invalidateQueries({ queryKey: [...CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY, input.commanderId] }),
      ])
    },
  })
}

export function useChannelStatus(commanderId: string, bindingId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...CHANNELS_QUERY_KEY, commanderId, bindingId, 'status'],
    enabled: Boolean(commanderId && bindingId && enabled),
    queryFn: () => fetchJson<ChannelAdapterStatus>(
      `${commanderChannelsPath(commanderId)}/${encodeURIComponent(bindingId)}/status`,
    ),
    refetchInterval: 10_000,
  })
}

export function useUpdateChannelBinding() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ commanderId, bindingId, ...body }: UpdateChannelBindingInput) => fetchJson<CommanderChannelBinding>(
      `${commanderChannelsPath(commanderId)}/${encodeURIComponent(bindingId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    onSuccess: async (_binding, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] }),
        queryClient.invalidateQueries({ queryKey: [...CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY, input.commanderId] }),
      ])
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...CHANNELS_QUERY_KEY, input.commanderId] }),
        queryClient.invalidateQueries({ queryKey: [...CHANNEL_PROVIDER_DESCRIPTORS_QUERY_KEY, input.commanderId] }),
      ])
    },
  })
}
