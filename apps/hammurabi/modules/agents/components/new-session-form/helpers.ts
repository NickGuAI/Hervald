import type { AgentSession, Machine } from '@/types'

export function getResumeSourceStateLabel(session: AgentSession | null): string {
  if (!session?.status) {
    return session?.processAlive === false ? 'exited' : 'active'
  }
  return session.status
}

export function getMachineConnectionHost(machine: Machine): string {
  return machine.tailscaleHostname ?? machine.host ?? 'local'
}

export function getMachineDisplayValue(session: AgentSession | null, machines: Machine[]): string {
  if (!session?.host) {
    return 'Local (this server)'
  }

  const machine = machines.find((entry) => entry.id === session.host)
  if (!machine) {
    return session.host
  }

  return `${machine.label} (${machine.user ? `${machine.user}@` : ''}${getMachineConnectionHost(machine)})`
}
