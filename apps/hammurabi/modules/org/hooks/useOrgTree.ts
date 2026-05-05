import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type { OrgTree } from '../types'

export const ORG_QUERY_KEY = ['org'] as const

export interface UseOrgTreeOptions {
  includeArchived?: boolean
}

function buildOrgTreeUrl(options: UseOrgTreeOptions): string {
  return options.includeArchived ? '/api/org?includeArchived=true' : '/api/org'
}

export function useOrgTree(options: UseOrgTreeOptions = {}) {
  return useQuery({
    queryKey: [...ORG_QUERY_KEY, { includeArchived: options.includeArchived === true }],
    queryFn: () => fetchJson<OrgTree>(buildOrgTreeUrl(options)),
  })
}
