import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  AgentSession,
  CreateMachineInput,
  CreateSessionInput,
  MachineAuthSetupInput,
  MachineAuthStatusReport,
  Machine,
  SessionTransportType,
  SessionType,
  WorldAgent,
} from '@/types'

const AGENT_SESSIONS_REFETCH_INTERVAL_MS = 5000

export interface DirectoryListing {
  parent: string
  directories: string[]
}

async function fetchDirectories(dirPath?: string, host?: string): Promise<DirectoryListing> {
  const searchParams = new URLSearchParams()
  if (dirPath) { searchParams.set('path', dirPath) }
  if (host) { searchParams.set('host', host) }
  const qs = searchParams.toString()
  return fetchJson<DirectoryListing>(`/api/agents/directories${qs ? `?${qs}` : ''}`)
}

async function fetchSessions(): Promise<AgentSession[]> {
  return fetchJson<AgentSession[]>('/api/agents/sessions')
}

async function fetchMachines(): Promise<Machine[]> {
  return fetchJson<Machine[]>('/api/agents/machines')
}

export interface VerifyTailscaleHostnameResponse {
  tailscaleHostname: string
  resolvedHost: string
}

export async function createMachine(input: CreateMachineInput): Promise<Machine> {
  return fetchJson<Machine>('/api/agents/machines', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

export async function fetchMachineAuthStatus(machineId: string): Promise<MachineAuthStatusReport> {
  return fetchJson<MachineAuthStatusReport>(
    `/api/agents/machines/${encodeURIComponent(machineId)}/auth-status`,
  )
}

export async function setupMachineAuth(
  machineId: string,
  input: MachineAuthSetupInput,
): Promise<MachineAuthStatusReport> {
  return fetchJson<MachineAuthStatusReport>(
    `/api/agents/machines/${encodeURIComponent(machineId)}/auth-setup`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  )
}

export async function fetchWorldAgents(): Promise<WorldAgent[]> {
  return fetchJson<WorldAgent[]>('/api/agents/world')
}

export function useAgentSessions() {
  return useQuery({
    queryKey: ['agents', 'sessions'],
    queryFn: fetchSessions,
    refetchInterval: AGENT_SESSIONS_REFETCH_INTERVAL_MS,
  })
}

export function useMachines() {
  return useQuery({
    queryKey: ['agents', 'machines'],
    queryFn: fetchMachines,
  })
}

export async function verifyTailscaleHostname(
  hostname: string,
): Promise<VerifyTailscaleHostnameResponse> {
  return fetchJson<VerifyTailscaleHostnameResponse>('/api/agents/machines/verify-tailscale', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hostname }),
  })
}

export function useMachineAuthStatus(machineId?: string, enabled = true) {
  return useQuery({
    queryKey: ['agents', 'machines', machineId ?? '', 'auth-status'],
    queryFn: () => fetchMachineAuthStatus(machineId ?? ''),
    enabled: enabled && typeof machineId === 'string' && machineId.trim().length > 0,
  })
}

export function useWorldAgents() {
  return useQuery({
    queryKey: ['agents', 'world'],
    queryFn: fetchWorldAgents,
    refetchInterval: 5000,
  })
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{
  sessionName: string
  mode: 'default'
  sessionType: SessionType
  transportType: SessionTransportType
  created: boolean
}> {
  return fetchJson('/api/agents/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      transportType: input.transportType ?? 'stream',
    }),
  })
}

export async function killSession(sessionName: string): Promise<{ killed: boolean }> {
  return fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}`, {
    method: 'DELETE',
  })
}

export async function resumeSession(
  sessionName: string,
): Promise<{ name: string; resumedFrom: string }> {
  return fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}/resume`, {
    method: 'POST',
  })
}

export interface SendSessionMessageResponse {
  sent: boolean
  queued: boolean
  id?: string
  position?: number
}

export async function sendSessionMessage(
  sessionName: string,
  text: string,
): Promise<SendSessionMessageResponse> {
  return fetchJson<SendSessionMessageResponse>(
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/message`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
    },
  )
}

export interface PreKillDebriefResponse {
  debriefStarted?: boolean
  timeoutMs?: number
  debriefed?: boolean
  reason?: string
}

export async function triggerPreKillDebrief(
  sessionName: string,
): Promise<PreKillDebriefResponse> {
  return fetchJson<PreKillDebriefResponse>(
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/pre-kill-debrief`,
    { method: 'POST' },
  )
}

export type DebriefStatus = 'pending' | 'completed' | 'timed-out' | 'none'

export async function getDebriefStatus(
  sessionName: string,
): Promise<{ status: DebriefStatus }> {
  return fetchJson<{ status: DebriefStatus }>(
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/debrief-status`,
  )
}

export function useDirectories(dirPath?: string, enabled = true, host?: string) {
  return useQuery({
    queryKey: ['agents', 'directories', dirPath ?? '~', host ?? ''],
    queryFn: () => fetchDirectories(dirPath, host),
    enabled,
  })
}
