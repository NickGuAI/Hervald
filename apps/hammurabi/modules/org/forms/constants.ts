import {
  CLAUDE_EFFORT_LEVELS,
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '../../claude-effort.js'
import type { ProviderRegistryEntry } from '@/types'
import type { OrgCommanderRoleKey } from '../types.js'
import type {
  NewAutomationCadencePreset,
  NewAutomationTrigger,
  OrgAgentType,
  OrgFormOption,
} from './types.js'

export const DEFAULT_HIRE_COMMANDER_AGENT_TYPE: OrgAgentType = 'claude'
export const DEFAULT_HIRE_COMMANDER_EFFORT: ClaudeEffortLevel = DEFAULT_CLAUDE_EFFORT_LEVEL
export const DEFAULT_NEW_AUTOMATION_AGENT_TYPE: OrgAgentType = 'claude'
export const DEFAULT_NEW_AUTOMATION_TRIGGER: NewAutomationTrigger = 'schedule'
export const DEFAULT_NEW_AUTOMATION_CADENCE_PRESET: NewAutomationCadencePreset = 'every-5-minutes'
export const HOST_PATTERN = /^[a-zA-Z0-9_-]+$/
export const CRON_SEGMENT_PATTERN = /^\s*\S+(?:\s+\S+){4}\s*$/

export const HIRE_COMMANDER_ROLE_OPTIONS: ReadonlyArray<OrgFormOption<OrgCommanderRoleKey>> = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'research', label: 'Research' },
  { value: 'ops', label: 'Ops' },
  { value: 'content', label: 'Content' },
  { value: 'validator', label: 'Validator' },
  { value: 'ea', label: 'EA' },
]

function toAgentOption(provider: Pick<ProviderRegistryEntry, 'id' | 'label'>): OrgFormOption<OrgAgentType> {
  return {
    value: provider.id,
    label: provider.label,
  }
}

export function listSupportedCommanderConversationProviders(
  providers: readonly ProviderRegistryEntry[],
): ReadonlyArray<OrgFormOption<OrgAgentType>> {
  return providers
    .filter((provider) => provider.capabilities.supportsCommanderConversation)
    .map(toAgentOption)
}

export function listSupportedAutomationProviders(
  providers: readonly ProviderRegistryEntry[],
): ReadonlyArray<OrgFormOption<OrgAgentType>> {
  return providers
    .filter((provider) => provider.capabilities.supportsAutomation)
    .map(toAgentOption)
}

export const HIRE_COMMANDER_EFFORT_OPTIONS: ReadonlyArray<OrgFormOption<ClaudeEffortLevel>> =
  CLAUDE_EFFORT_LEVELS.map((value) => ({
    value,
    label: value,
  }))

export const NEW_AUTOMATION_TRIGGER_OPTIONS: ReadonlyArray<OrgFormOption<NewAutomationTrigger>> = [
  { value: 'schedule', label: 'Schedule' },
  { value: 'quest', label: 'Quest' },
  { value: 'manual', label: 'Manual' },
]

export const NEW_AUTOMATION_CADENCE_PRESET_OPTIONS: ReadonlyArray<OrgFormOption<NewAutomationCadencePreset>> = [
  { value: 'every-5-minutes', label: 'Every 5 minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily-0900', label: 'Daily at 09:00' },
  { value: 'custom', label: 'Custom cron' },
]

export const CADENCE_PRESET_TO_CRON: Record<Exclude<NewAutomationCadencePreset, 'custom'>, string> = {
  'every-5-minutes': '*/5 * * * *',
  hourly: '0 * * * *',
  'daily-0900': '0 9 * * *',
}
