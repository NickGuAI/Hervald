import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { type HammurabiConfig, normalizeEndpoint } from './config.js'

export type ProviderId = string
export type MachineAuthMode = 'setup-token' | 'api-key' | 'device-auth'

export interface ProviderCapabilities {
  supportsAutomation: boolean
  supportsCommanderConversation: boolean
  supportsWorkerDispatch: boolean
}

export interface ProviderMachineAuthDescriptor {
  cliBinaryName: string
  installPackageName?: string
  authEnvKeys: string[]
  supportedAuthModes: MachineAuthMode[]
  requiresSecretModes: MachineAuthMode[]
  loginStatusCommand: string | null
}

export interface ProviderRegistryEntry {
  id: ProviderId
  label: string
  eventProvider: string
  capabilities: ProviderCapabilities
  machineAuth?: ProviderMachineAuthDescriptor
}

type ProviderCachePayload = {
  cachedAt: string
  providers: ProviderRegistryEntry[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asString(entry))
        .filter((entry): entry is string => entry !== null)
    : []
}

function parseMachineAuth(value: unknown): ProviderMachineAuthDescriptor | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const cliBinaryName = asString(value.cliBinaryName)
  if (!cliBinaryName) {
    return undefined
  }

  return {
    cliBinaryName,
    ...(asString(value.installPackageName)
      ? { installPackageName: asString(value.installPackageName) ?? undefined }
      : {}),
    authEnvKeys: asStringArray(value.authEnvKeys),
    supportedAuthModes: asStringArray(value.supportedAuthModes) as MachineAuthMode[],
    requiresSecretModes: asStringArray(value.requiresSecretModes) as MachineAuthMode[],
    loginStatusCommand: asString(value.loginStatusCommand),
  }
}

function parseProviderEntry(value: unknown): ProviderRegistryEntry | null {
  if (!isObject(value)) {
    return null
  }

  const id = asString(value.id)
  const label = asString(value.label)
  const eventProvider = asString(value.eventProvider)
  const capabilities = isObject(value.capabilities) ? value.capabilities : null
  if (!id || !label || !eventProvider || !capabilities) {
    return null
  }

  return {
    id,
    label,
    eventProvider,
    capabilities: {
      supportsAutomation: asBoolean(capabilities.supportsAutomation),
      supportsCommanderConversation: asBoolean(capabilities.supportsCommanderConversation),
      supportsWorkerDispatch: asBoolean(capabilities.supportsWorkerDispatch),
    },
    ...(parseMachineAuth(value.machineAuth)
      ? { machineAuth: parseMachineAuth(value.machineAuth) }
      : {}),
  }
}

function parseProviderRegistryPayload(payload: unknown): ProviderRegistryEntry[] {
  const rawProviders = Array.isArray(payload)
    ? payload
    : (isObject(payload) && Array.isArray(payload.providers) ? payload.providers : [])

  return rawProviders
    .map((entry) => parseProviderEntry(entry))
    .filter((entry): entry is ProviderRegistryEntry => entry !== null)
}

function buildProviderApiUrl(endpoint: string): string {
  return new URL('/api/providers', `${normalizeEndpoint(endpoint)}/`).toString()
}

function buildAuthHeaders(config: HammurabiConfig): HeadersInit {
  return {
    authorization: `Bearer ${config.apiKey}`,
  }
}

export function defaultProviderCachePath(): string {
  return path.join(homedir(), '.hammurabi', '.cache', 'providers.json')
}

export async function readCachedProviderRegistry(
  cachePath: string = defaultProviderCachePath(),
): Promise<ProviderRegistryEntry[] | null> {
  let raw: string

  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }

  const payload = isObject(parsed) ? parsed as Partial<ProviderCachePayload> : null
  if (!payload) {
    return null
  }

  const providers = parseProviderRegistryPayload(payload.providers)
  return providers.length > 0 ? providers : null
}

export async function writeCachedProviderRegistry(
  providers: readonly ProviderRegistryEntry[],
  cachePath: string = defaultProviderCachePath(),
): Promise<void> {
  const payload: ProviderCachePayload = {
    cachedAt: new Date().toISOString(),
    providers: [...providers],
  }

  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function fetchLiveProviderRegistry(
  config: HammurabiConfig,
  fetchImpl: typeof fetch,
): Promise<ProviderRegistryEntry[]> {
  const response = await fetchImpl(buildProviderApiUrl(config.endpoint), {
    method: 'GET',
    headers: buildAuthHeaders(config),
  })

  if (!response.ok) {
    throw new Error(`Provider registry request failed (${response.status})`)
  }

  const payload = (await response.json()) as unknown
  const providers = parseProviderRegistryPayload(payload)
  if (providers.length === 0) {
    throw new Error('Provider registry response was empty')
  }

  return providers
}

export async function loadProviderRegistry(
  config: HammurabiConfig,
  options: {
    fetchImpl?: typeof fetch
    cachePath?: string
  } = {},
): Promise<{ providers: ProviderRegistryEntry[]; source: 'live' | 'cache' }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const cachePath = options.cachePath ?? defaultProviderCachePath()

  try {
    const providers = await fetchLiveProviderRegistry(config, fetchImpl)
    await writeCachedProviderRegistry(providers, cachePath)
    return { providers, source: 'live' }
  } catch (liveError) {
    const cached = await readCachedProviderRegistry(cachePath)
    if (cached) {
      return { providers: cached, source: 'cache' }
    }
    throw liveError
  }
}

export function listCommanderConversationProviderIds(
  providers: readonly ProviderRegistryEntry[],
): ProviderId[] {
  return providers
    .filter((provider) => provider.capabilities.supportsCommanderConversation)
    .map((provider) => provider.id)
}

export function listAutomationProviderIds(
  providers: readonly ProviderRegistryEntry[],
): ProviderId[] {
  return providers
    .filter((provider) => provider.capabilities.supportsAutomation)
    .map((provider) => provider.id)
}

export function listWorkerDispatchProviderIds(
  providers: readonly ProviderRegistryEntry[],
): ProviderId[] {
  return providers
    .filter((provider) => provider.capabilities.supportsWorkerDispatch)
    .map((provider) => provider.id)
}

export function listMachineAuthProviders(
  providers: readonly ProviderRegistryEntry[],
): ProviderRegistryEntry[] {
  return providers.filter((provider) => provider.machineAuth)
}

export function findProvider(
  providers: readonly ProviderRegistryEntry[],
  providerId: string,
): ProviderRegistryEntry | null {
  return providers.find((provider) => provider.id === providerId.trim()) ?? null
}
