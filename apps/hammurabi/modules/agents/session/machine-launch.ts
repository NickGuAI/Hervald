import { getProvider } from '../providers/registry.js'
import {
  isDaemonMachine,
  LOCAL_MACHINE_ID,
} from '../machines.js'
import type { MachineDaemonRegistry } from '../daemon/registry.js'
import type { AgentType, MachineConfig } from '../types.js'

interface MachineLaunchRuntimeDeps {
  daemonRegistry: MachineDaemonRegistry
  readMachineRegistry(): Promise<MachineConfig[]>
}

export interface MachineLaunchRuntime {
  resolveLaunchMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  >
  resolveDaemonLaunchReadiness(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): { ok: true } | { ok: false; status: number; error: string }
}

export function createMachineLaunchRuntime(
  deps: MachineLaunchRuntimeDeps,
): MachineLaunchRuntime {
  async function resolveLaunchMachine(
    requestedHost: string | undefined,
  ): Promise<
    | { ok: true; machine: MachineConfig | undefined }
    | { ok: false; status: number; error: string }
  > {
    const machineId = requestedHost ?? LOCAL_MACHINE_ID
    let machines: MachineConfig[]
    try {
      machines = await deps.readMachineRegistry()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read machines registry'
      return { ok: false, status: 500, error: message }
    }

    const machine = machines.find((entry) => entry.id === machineId)
    if (!machine && requestedHost !== undefined) {
      return { ok: false, status: 400, error: `Unknown host machine "${requestedHost}"` }
    }
    return { ok: true, machine }
  }

  function resolveDaemonLaunchReadiness(
    machine: MachineConfig | undefined,
    agentType: AgentType,
  ): { ok: true } | { ok: false; status: number; error: string } {
    if (!isDaemonMachine(machine)) {
      return { ok: true }
    }
    const connection = deps.daemonRegistry.getConnection(machine.id)
    if (!connection) {
      return {
        ok: false,
        status: 409,
        error: `Daemon machine "${machine.id}" is not connected`,
      }
    }
    const provider = getProvider(agentType)
    const providerKeys = [
      agentType,
      provider?.machineAuth?.cliBinaryName,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    const ready = providerKeys.some((key) => {
      const status = connection.providerHealth[key]
      return status?.installed === true && status.authenticated === true
    })
    if (!ready) {
      return {
        ok: false,
        status: 409,
        error: `Daemon machine "${machine.id}" is not ready for ${agentType}: provider auth is missing`,
      }
    }
    return { ok: true }
  }

  return {
    resolveLaunchMachine,
    resolveDaemonLaunchReadiness,
  }
}
