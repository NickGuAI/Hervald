import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentType,
  ProviderRegistryEntry,
  ProviderRegistryResponse,
} from '@/types'

const fallbackQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const fallbackProviders: ProviderRegistryEntry[] = [
  {
    id: 'claude',
    label: 'Claude',
    eventProvider: 'claude',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    uiCapabilities: {
      supportsEffort: true,
      supportsAdaptiveThinking: true,
      supportsSkills: true,
      supportsLoginMode: true,
      permissionModes: [{ value: 'default', label: 'default', description: 'Default approval policy' }],
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    eventProvider: 'codex',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    uiCapabilities: {
      supportsEffort: false,
      supportsAdaptiveThinking: false,
      supportsSkills: false,
      supportsLoginMode: true,
      permissionModes: [{ value: 'default', label: 'default', description: 'Default approval policy' }],
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    eventProvider: 'gemini',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    uiCapabilities: {
      supportsEffort: false,
      supportsAdaptiveThinking: false,
      supportsSkills: false,
      supportsLoginMode: false,
      forcedTransport: 'stream',
      permissionModes: [{ value: 'default', label: 'default', description: 'Default approval policy' }],
    },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    eventProvider: 'opencode',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
    uiCapabilities: {
      supportsEffort: false,
      supportsAdaptiveThinking: false,
      supportsSkills: false,
      supportsLoginMode: false,
      permissionModes: [{ value: 'default', label: 'default', description: 'Default approval policy' }],
    },
  },
]

async function fetchProviderRegistry(): Promise<ProviderRegistryEntry[]> {
  const response = await fetchJson<ProviderRegistryResponse | ProviderRegistryEntry[]>('/api/providers')
  if (Array.isArray(response)) {
    return response
  }
  return Array.isArray(response?.providers) ? response.providers : []
}

export function useProviderRegistry() {
  const queryClient = useContext(QueryClientContext)
  const hasQueryClient = queryClient !== undefined

  return useQuery({
    queryKey: ['providers'],
    queryFn: fetchProviderRegistry,
    staleTime: hasQueryClient ? 60_000 : Infinity,
    enabled: hasQueryClient,
    initialData: hasQueryClient ? undefined : fallbackProviders,
  }, queryClient ?? fallbackQueryClient)
}

export function findProviderEntry(
  providers: readonly ProviderRegistryEntry[],
  providerId: AgentType | null | undefined,
): ProviderRegistryEntry | null {
  if (!providerId) {
    return null
  }
  return providers.find((provider) => provider.id === providerId) ?? null
}

export function getProviderLabel(
  providers: readonly ProviderRegistryEntry[],
  providerId: AgentType | null | undefined,
): string {
  return findProviderEntry(providers, providerId)?.label ?? (providerId ?? 'claude')
}
