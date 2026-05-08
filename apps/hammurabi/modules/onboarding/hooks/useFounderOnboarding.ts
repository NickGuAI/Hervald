import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import { FOUNDER_PROFILE_QUERY_KEY } from '@modules/operators/hooks/useFounderProfile'
import { FOUNDER_OPERATOR_NOT_FOUND_ERROR } from '@modules/operators/constants'
import type { FounderOrgSetupRequest, FounderOrgSetupResponse } from '../contracts'

export const FOUNDER_SETUP_STATUS_QUERY_KEY = ['onboarding', 'founder-setup-status'] as const

export interface FounderSetupStatus {
  needsSetup: boolean
}

function isFounderMissingError(error: unknown): boolean {
  return (
    error instanceof Error
    && error.message.includes('Request failed (404)')
    && error.message.includes(FOUNDER_OPERATOR_NOT_FOUND_ERROR)
  )
}

async function fetchFounderSetupStatus(): Promise<FounderSetupStatus> {
  try {
    await fetchJson('/api/operators/founder')
    return { needsSetup: false }
  } catch (error) {
    if (isFounderMissingError(error)) {
      return { needsSetup: true }
    }

    throw error
  }
}

async function createFounderOrgSetup(
  payload: FounderOrgSetupRequest,
): Promise<FounderOrgSetupResponse> {
  return fetchJson<FounderOrgSetupResponse>('/api/org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function useFounderSetupStatus() {
  return useQuery({
    queryKey: FOUNDER_SETUP_STATUS_QUERY_KEY,
    queryFn: fetchFounderSetupStatus,
  })
}

export function useCreateFounderOrgSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createFounderOrgSetup,
    onSuccess: async (result) => {
      queryClient.setQueryData(FOUNDER_SETUP_STATUS_QUERY_KEY, { needsSetup: false })
      queryClient.setQueryData(FOUNDER_PROFILE_QUERY_KEY, result.operator)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FOUNDER_PROFILE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
      ])
    },
  })
}
