import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import { FOUNDER_PROFILE_QUERY_KEY } from '@modules/operators/hooks/useFounderProfile'
import type {
  FounderOrgSetupRequest,
  FounderOrgSetupResponse,
  FounderSetupStatus,
  OnboardingStatus,
  SeedGaiaOnboardingResponse,
} from '../contracts'

export const FOUNDER_SETUP_STATUS_QUERY_KEY = ['onboarding', 'founder-setup-status'] as const
export const ONBOARDING_STATUS_QUERY_KEY = ['onboarding', 'status'] as const

async function fetchFounderSetupStatus(): Promise<FounderSetupStatus> {
  return fetchJson<FounderSetupStatus>('/api/org/setup-status')
}

async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return fetchJson<OnboardingStatus>('/api/onboarding/status')
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

async function seedGaiaCommander(): Promise<SeedGaiaOnboardingResponse> {
  return fetchJson<SeedGaiaOnboardingResponse>('/api/onboarding/actions/seed-gaia', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export function useFounderSetupStatus() {
  return useQuery({
    queryKey: FOUNDER_SETUP_STATUS_QUERY_KEY,
    queryFn: fetchFounderSetupStatus,
  })
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: fetchOnboardingStatus,
  })
}

export function useCreateFounderOrgSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createFounderOrgSetup,
    onSuccess: async (result) => {
      queryClient.setQueryData(FOUNDER_SETUP_STATUS_QUERY_KEY, {
        setupComplete: true,
        defaultValues: {
          orgDisplayName: result.orgIdentity.name,
          founderDisplayName: result.operator.displayName,
          founderEmail: result.operator.email ?? '',
        },
        validationErrors: {},
        nextRoute: result.nextRoute,
      } satisfies FounderSetupStatus)
      queryClient.setQueryData(FOUNDER_PROFILE_QUERY_KEY, result.operator)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FOUNDER_PROFILE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY }),
      ])
    },
  })
}

export function useSeedGaiaCommander() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: seedGaiaCommander,
    onSuccess: async (result) => {
      queryClient.setQueryData(ONBOARDING_STATUS_QUERY_KEY, result.status)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
      ])
    },
  })
}
