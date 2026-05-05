import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import { ORG_QUERY_KEY } from '../../org/hooks/useOrgTree'
import type { Operator } from '../types'

export const FOUNDER_PROFILE_QUERY_KEY = ['operators', 'founder'] as const

export interface FounderProfileUpdateInput {
  displayName: string
}

export interface FounderAvatarUploadInput {
  file: File
}

async function fetchFounderProfile(): Promise<Operator> {
  return fetchJson<Operator>('/api/operators/founder')
}

async function updateFounderProfile(input: FounderProfileUpdateInput): Promise<Operator> {
  return fetchJson<Operator>('/api/operators/founder/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: input.displayName,
    }),
  })
}

async function uploadFounderAvatar(
  input: FounderAvatarUploadInput,
): Promise<{ avatarUrl: string }> {
  const formData = new FormData()
  formData.append('avatar', input.file)

  return fetchJson<{ avatarUrl: string }>('/api/operators/founder/avatar', {
    method: 'POST',
    body: formData,
  })
}

export function useFounderProfile() {
  return useQuery({
    queryKey: FOUNDER_PROFILE_QUERY_KEY,
    queryFn: fetchFounderProfile,
    retry: 1,
  })
}

export function useUpdateFounderProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateFounderProfile,
    onSuccess: async (founder) => {
      queryClient.setQueryData(FOUNDER_PROFILE_QUERY_KEY, founder)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FOUNDER_PROFILE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
      ])
    },
  })
}

export function useUploadFounderAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: uploadFounderAvatar,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FOUNDER_PROFILE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
      ])
    },
  })
}
