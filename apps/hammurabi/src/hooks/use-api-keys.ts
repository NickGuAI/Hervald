import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buildRequestHeaders, fetchJson } from '@/lib/api'
import { getFullUrl } from '@/lib/api-base'

export interface ApiKeyView {
  id: string
  name: string
  prefix: string
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
  scopes: string[]
}

export interface CreateApiKeyInput {
  name: string
  scopes: string[]
}

export interface CreatedApiKey extends ApiKeyView {
  key: string
}

export interface OpenAITranscriptionSettings {
  configured: boolean
  updatedAt: string | null
}

export interface GeminiImageGenerationSettings {
  configured: boolean
  updatedAt: string | null
}

async function fetchApiKeys(): Promise<ApiKeyView[]> {
  return fetchJson<ApiKeyView[]>('/api/auth/keys')
}

async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  return fetchJson<CreatedApiKey>('/api/auth/keys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

async function revokeApiKey(id: string): Promise<void> {
  const headers = await buildRequestHeaders()
  const response = await fetch(getFullUrl(`/api/auth/keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to revoke API key (${response.status}): ${body}`)
  }
}

async function fetchOpenAITranscriptionSettings(): Promise<OpenAITranscriptionSettings> {
  return fetchJson<OpenAITranscriptionSettings>('/api/auth/transcription/openai')
}

async function setOpenAITranscriptionKey(apiKey: string): Promise<void> {
  const headers = await buildRequestHeaders({
    'content-type': 'application/json',
  })
  const response = await fetch(getFullUrl('/api/auth/transcription/openai'), {
    method: 'PUT',
    headers,
    body: JSON.stringify({ apiKey }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to save OpenAI key (${response.status}): ${body}`)
  }
}

async function clearOpenAITranscriptionKey(): Promise<void> {
  const headers = await buildRequestHeaders()
  const response = await fetch(getFullUrl('/api/auth/transcription/openai'), {
    method: 'DELETE',
    headers,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to clear OpenAI key (${response.status}): ${body}`)
  }
}

async function fetchGeminiImageGenerationSettings(): Promise<GeminiImageGenerationSettings> {
  return fetchJson<GeminiImageGenerationSettings>('/api/auth/image-generation/gemini')
}

async function setGeminiImageGenerationKey(apiKey: string): Promise<void> {
  const headers = await buildRequestHeaders({
    'content-type': 'application/json',
  })
  const response = await fetch(getFullUrl('/api/auth/image-generation/gemini'), {
    method: 'PUT',
    headers,
    body: JSON.stringify({ apiKey }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to save Gemini key (${response.status}): ${body}`)
  }
}

async function clearGeminiImageGenerationKey(): Promise<void> {
  const headers = await buildRequestHeaders()
  const response = await fetch(getFullUrl('/api/auth/image-generation/gemini'), {
    method: 'DELETE',
    headers,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to clear Gemini key (${response.status}): ${body}`)
  }
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['auth', 'api-keys'],
    queryFn: fetchApiKeys,
    refetchInterval: 15_000,
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'api-keys'] })
    },
  })
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: revokeApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'api-keys'] })
    },
  })
}

export function useOpenAITranscriptionSettings() {
  return useQuery({
    queryKey: ['auth', 'openai-transcription-settings'],
    queryFn: fetchOpenAITranscriptionSettings,
    refetchInterval: 15_000,
  })
}

export function useSetOpenAITranscriptionKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setOpenAITranscriptionKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['auth', 'openai-transcription-settings'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['realtime', 'transcription', 'config'],
      })
    },
  })
}

export function useClearOpenAITranscriptionKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearOpenAITranscriptionKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['auth', 'openai-transcription-settings'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['realtime', 'transcription', 'config'],
      })
    },
  })
}

export function useGeminiImageGenerationSettings() {
  return useQuery({
    queryKey: ['auth', 'gemini-image-generation-settings'],
    queryFn: fetchGeminiImageGenerationSettings,
    refetchInterval: 15_000,
  })
}

export function useSetGeminiImageGenerationKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setGeminiImageGenerationKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['auth', 'gemini-image-generation-settings'],
      })
    },
  })
}

export function useClearGeminiImageGenerationKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: clearGeminiImageGenerationKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['auth', 'gemini-image-generation-settings'],
      })
    },
  })
}
