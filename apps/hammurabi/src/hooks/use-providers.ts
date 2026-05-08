import { useContext } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentType,
  ProviderRegistryEntry,
  ProviderRegistryResponse,
} from '@/types'
import { availableModels as claudeModels } from '../../modules/agents/adapters/claude/models.js'
import { availableModels as codexModels } from '../../modules/agents/adapters/codex/models.js'
import { availableModels as geminiModels } from '../../modules/agents/adapters/gemini/models.js'
import { availableModels as opencodeModels } from '../../modules/agents/adapters/opencode/models.js'

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
    availableModels: claudeModels,
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
    availableModels: codexModels,
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
    availableModels: geminiModels,
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
    availableModels: opencodeModels,
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
