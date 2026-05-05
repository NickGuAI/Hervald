import type { ClaudeEffortLevel } from '@modules/claude-effort.js'
import type {
  HireCommanderCreateRequestBody,
  NewAutomationCreateRequestBody,
  OrgAgentType,
} from '@modules/org/forms'
import type { OrgCommanderRoleKey } from '@modules/org/types'
import { fetchJson, fetchVoid } from '@/lib/api'

export type CommanderContextMode = 'thin' | 'fat'

export interface OrgCommanderDetail {
  id: string
  displayName?: string | null
  operatorId?: string | null
  createdAt?: string | null
  created?: string | null
  roleKey?: OrgCommanderRoleKey | null
  persona?: string | null
  agentType?: OrgAgentType | null
  effort?: ClaudeEffortLevel | null
  cwd?: string | null
  maxTurns?: number | null
  contextMode?: CommanderContextMode | null
  templateId?: string | null
  replicatedFromCommanderId?: string | null
  runtimeConfig?: {
    defaults?: {
      maxTurns?: number
    }
    limits?: {
      maxTurns?: number
    }
  }
}

export interface OrgMutationResult {
  id: string
}

export interface CommanderTemplatePackage {
  schemaVersion: 1
  exportedAt: string
  sourceCommanderId?: string
  commander: {
    id?: string
    displayName: string
  }
  commanderMd: string | null
  memorySnapshot: {
    memoryMd: string
    syncRevision: number
  }
  skillBindings: Array<{
    skillId: string
    version?: string
  }>
}

export async function fetchOrgCommanderDetail(commanderId: string): Promise<OrgCommanderDetail> {
  return fetchJson<OrgCommanderDetail>(`/api/commanders/${encodeURIComponent(commanderId)}`)
}

export async function updateOrgCommander(
  commanderId: string,
  payload: Record<string, string | number>,
): Promise<void> {
  return fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteOrgCommander(commanderId: string): Promise<void> {
  return fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}`, {
    method: 'DELETE',
  })
}

export async function archiveOrgCommander(commanderId: string): Promise<void> {
  return fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}/archive`, {
    method: 'POST',
  })
}

export async function restoreOrgCommander(commanderId: string): Promise<void> {
  return fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}/restore`, {
    method: 'POST',
  })
}

export async function exportOrgCommanderTemplate(
  commanderId: string,
): Promise<CommanderTemplatePackage> {
  return fetchJson<CommanderTemplatePackage>(`/api/commanders/${encodeURIComponent(commanderId)}/export`)
}

export async function replicateOrgCommander(
  commanderId: string,
  displayName: string,
): Promise<OrgMutationResult> {
  return fetchJson<OrgMutationResult>(`/api/commanders/${encodeURIComponent(commanderId)}/replicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
}

export async function runOrgCommanderNow(
  commanderId: string,
  message: string,
): Promise<void> {
  return fetchVoid(`/api/commanders/${encodeURIComponent(commanderId)}/run-now`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

export async function createOrgCommander(
  payload: HireCommanderCreateRequestBody,
): Promise<OrgMutationResult> {
  return fetchJson<OrgMutationResult>('/api/commanders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function createOrgAutomation(
  payload: NewAutomationCreateRequestBody,
): Promise<OrgMutationResult> {
  return fetchJson<OrgMutationResult>('/api/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
