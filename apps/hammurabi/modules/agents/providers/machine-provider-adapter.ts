import './.generated/registered.js'

const generatedMachineRegistryUrl = new URL('./.generated/registered-loaders.js', import.meta.url)

export async function loadRegisteredMachineProviders(): Promise<void> {
  const { machineAdapterImports } = await import(`${generatedMachineRegistryUrl.href}?t=${Date.now()}`) as {
    machineAdapterImports: Record<string, () => Promise<unknown>>
  }
  await Promise.all(Object.values(machineAdapterImports).map(async (load) => load()))
}

export type {
  MachineAuthMethod,
  MachineAuthMode,
  MachineProviderAdapter,
} from './machine-provider-adapter-core.js'
export {
  getMachineProvider,
  listMachineProviderIds,
  listMachineProviders,
  registerMachineProvider,
  unregisterMachineProvider,
} from './machine-provider-adapter-core.js'
