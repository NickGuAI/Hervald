import type { ProviderAdapter } from './provider-adapter.js'

const providerRegistry = new Map<string, ProviderAdapter>()
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/

export function registerProvider<T extends ProviderAdapter>(adapter: T): T {
  const id = adapter.id.trim()
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(`Invalid provider id "${adapter.id}"`)
  }

  const existing = providerRegistry.get(id)
  if (existing && existing !== adapter) {
    throw new Error(`Provider "${id}" is already registered`)
  }

  providerRegistry.set(id, adapter)
  return adapter
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return providerRegistry.get(id.trim())
}

export function unregisterProvider(id: string): void {
  providerRegistry.delete(id.trim())
}

export function listProviders(): ProviderAdapter[] {
  return [...providerRegistry.values()]
}

export function listProviderIds(): string[] {
  return [...providerRegistry.keys()]
}

export function parseProviderId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const id = raw.trim()
  return providerRegistry.has(id) ? id : null
}
