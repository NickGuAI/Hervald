import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { AgentType } from '@/types'
import type { OrgCommanderRoleKey } from '../types.js'

export type OrgAgentType = AgentType

export interface OrgFormOption<TValue extends string = string> {
  value: TValue
  label: string
}

export type HireCommanderWizardStep = 'details' | 'review'
export type HireCommanderWizardField =
  | 'displayName'
  | 'roleKey'
  | 'persona'
  | 'agentType'
  | 'effort'

export interface HireCommanderWizardFormValues {
  displayName: string
  roleKey: OrgCommanderRoleKey | ''
  persona: string
  agentType: OrgAgentType
  effort: ClaudeEffortLevel
}

export interface HireCommanderWizardFormErrors {
  global: string | null
  displayName: string | null
  roleKey: string | null
}

export interface HireCommanderCreateRequestBody {
  host: string
  displayName: string
  roleKey: OrgCommanderRoleKey
  persona?: string
  agentType: OrgAgentType
  effort: ClaudeEffortLevel
}

export type NewAutomationTrigger = 'schedule' | 'quest' | 'manual'
export type NewAutomationCadencePreset = 'every-5-minutes' | 'hourly' | 'daily-0900' | 'custom'
export type NewAutomationWizardStep = 'trigger' | 'details' | 'review'
export type NewAutomationWizardField =
  | 'trigger'
  | 'cadencePreset'
  | 'customCron'
  | 'questCommanderId'
  | 'name'
  | 'instruction'
  | 'agentType'

export interface NewAutomationCommander {
  id: string
  displayName: string
}

export interface NewAutomationOwner {
  kind: 'operator' | 'commander'
  id: string
  displayName: string
  roleLabel?: string
}

export interface NewAutomationWizardFormValues {
  trigger: NewAutomationTrigger
  cadencePreset: NewAutomationCadencePreset
  customCron: string
  questCommanderId: string
  name: string
  instruction: string
  agentType: OrgAgentType
}

export interface NewAutomationWizardFormErrors {
  global: string | null
  trigger: string | null
  cron: string | null
  name: string | null
  instruction: string | null
}

export interface NewAutomationCreateRequestBody {
  name: string
  parentCommanderId: string | null
  trigger: NewAutomationTrigger
  instruction: string
  agentType: OrgAgentType
  status: 'active'
  schedule?: string
  questTrigger?: {
    event: 'completed'
    commanderId?: string
  }
}
