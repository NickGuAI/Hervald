import type { AgentType } from '../../agents/types.js'
import type { ClaudeEffortLevel } from '../../claude-effort.js'
import type { CommanderUiProfile } from '../commander-profile.js'
import type { CommanderContextMode } from '../store.js'

export interface CommanderPackageSkill {
  id: string
  label: string
  required: boolean
  purpose: string
}

export interface CommanderPackageExample {
  id: string
  title: string
  body: string
}

export interface CommanderPackageDefinition {
  schemaVersion: 1
  id: string
  version: string
  displayName: string
  host: string
  role: string
  summary: string
  description: string
  agentType: AgentType
  effort: ClaudeEffortLevel
  contextMode: CommanderContextMode
  skills: CommanderPackageSkill[]
  examples: CommanderPackageExample[]
  commanderMd: string
  onboarding: string
  memorySeed: string
  uiProfile: CommanderUiProfile
}

export interface CommanderPackageInstallState {
  installed: boolean
  commanderId: string | null
  displayName: string | null
}

export interface CommanderPackageResponse
  extends Omit<CommanderPackageDefinition, 'commanderMd' | 'memorySeed'> {
  installState: CommanderPackageInstallState
}

export interface CommanderPackageInstallReceipt {
  package: CommanderPackageResponse
  commander: unknown
  created: boolean
}
