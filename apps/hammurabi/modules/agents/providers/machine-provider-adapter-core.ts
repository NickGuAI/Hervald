import type { MachineConfig } from '../types.js'

export type MachineAuthMode = 'setup-token' | 'api-key' | 'device-auth'
export type MachineAuthMethod = MachineAuthMode | 'login' | 'missing'

export interface MachineProviderAdapter {
  readonly id: string
  readonly label: string
  readonly cliBinaryName: string
  readonly installPackageName?: string
  readonly authEnvKeys: readonly string[]
  readonly loginStatusCommand: string | null
  readonly supportedAuthModes: readonly MachineAuthMode[]
  readonly modeRequiresSecret: (mode: MachineAuthMode) => boolean
  classifyAuthMethod(args: {
    envSourceKey: string | null
    loginConfigured: boolean
  }): MachineAuthMethod
  computeAuthSetupUpdates(args: {
    mode: MachineAuthMode
    secret?: string
  }): Record<string, string | null>
  ensureCredentialStore?(
    machine: MachineConfig,
    homeDir: string,
    args: { mode: MachineAuthMode; secret?: string },
  ): Promise<void>
}

const machineProviderRegistry = new Map<string, MachineProviderAdapter>()

export function registerMachineProvider<T extends MachineProviderAdapter>(adapter: T): T {
  const id = adapter.id.trim()
  if (!id) {
    throw new Error('Machine providers must declare a non-empty id')
  }

  const existing = machineProviderRegistry.get(id)
  if (existing && existing !== adapter) {
    throw new Error(`Machine provider "${id}" is already registered`)
  }

  machineProviderRegistry.set(id, adapter)
  return adapter
}

export function getMachineProvider(id: string): MachineProviderAdapter | undefined {
  return machineProviderRegistry.get(id.trim())
}

export function unregisterMachineProvider(id: string): void {
  machineProviderRegistry.delete(id.trim())
}

export function listMachineProviders(): MachineProviderAdapter[] {
  return [...machineProviderRegistry.values()]
}

export function listMachineProviderIds(): string[] {
  return [...machineProviderRegistry.keys()]
}
