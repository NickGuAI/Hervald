import './.generated/registered.js'

const generatedRegistryUrl = new URL('./.generated/registered-loaders.js', import.meta.url)

export async function loadRegisteredProviders(): Promise<void> {
  const { adapterImports } = await import(`${generatedRegistryUrl.href}?t=${Date.now()}`) as {
    adapterImports: Record<string, () => Promise<unknown>>
  }
  await Promise.all(Object.values(adapterImports).map(async (load) => load()))
}

export {
  getProvider,
  listProviderIds,
  listProviders,
  parseProviderId,
  registerProvider,
  unregisterProvider,
} from './registry-core.js'
