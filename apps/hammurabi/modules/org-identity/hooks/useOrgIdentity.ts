import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import { ORG_QUERY_KEY } from '../../org/hooks/useOrgTree'
import type { OrgIdentity } from '../types'

export const ORG_IDENTITY_QUERY_KEY = ['org-identity'] as const

export interface OrgIdentityUpdateInput {
  name: string
}

async function fetchOrgIdentity(): Promise<OrgIdentity> {
  return fetchJson<OrgIdentity>('/api/org/identity')
}

async function updateOrgIdentity(input: OrgIdentityUpdateInput): Promise<OrgIdentity> {
  return fetchJson<OrgIdentity>('/api/org/identity', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: input.name }),
  })
}

export function useOrgIdentity() {
  return useQuery({
    queryKey: ORG_IDENTITY_QUERY_KEY,
    queryFn: fetchOrgIdentity,
    retry: 1,
  })
}

export function useUpdateOrgIdentity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateOrgIdentity,
    onSuccess: async (identity) => {
      queryClient.setQueryData(ORG_IDENTITY_QUERY_KEY, identity)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ORG_IDENTITY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }),
      ])
    },
  })
}
