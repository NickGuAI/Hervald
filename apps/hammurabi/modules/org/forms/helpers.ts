import { MAX_PERSONA_LENGTH } from '../../commanders/persona.js'
import {
  CADENCE_PRESET_TO_CRON,
  CRON_SEGMENT_PATTERN,
  DEFAULT_HIRE_COMMANDER_AGENT_TYPE,
  DEFAULT_HIRE_COMMANDER_EFFORT,
  DEFAULT_NEW_AUTOMATION_AGENT_TYPE,
  DEFAULT_NEW_AUTOMATION_CADENCE_PRESET,
  DEFAULT_NEW_AUTOMATION_TRIGGER,
  HIRE_COMMANDER_ROLE_OPTIONS,
  HOST_PATTERN,
  listSupportedAutomationProviders,
  listSupportedCommanderConversationProviders,
  NEW_AUTOMATION_CADENCE_PRESET_OPTIONS,
  NEW_AUTOMATION_TRIGGER_OPTIONS,
} from './constants.js'
import type { ProviderRegistryEntry } from '@/types'
import type {
  HireCommanderCreateRequestBody,
  HireCommanderWizardFormErrors,
  HireCommanderWizardFormValues,
  HireCommanderWizardStep,
  NewAutomationCadencePreset,
  NewAutomationCommander,
  NewAutomationCreateRequestBody,
  NewAutomationOwner,
  NewAutomationWizardFormErrors,
  NewAutomationWizardFormValues,
  NewAutomationWizardStep,
  OrgFormOption,
} from './types.js'

function normalizeText(value: string): string {
  return value.trim()
}

function normalizeName(value: string): string {
  return normalizeText(value).toLocaleLowerCase()
}

function toOptionSet(options: ReadonlyArray<OrgFormOption>): Set<string> {
  return new Set(options.map((option) => option.value))
}

function commanderExists(commanders: ReadonlyArray<NewAutomationCommander>, commanderId: string): boolean {
  const trimmedCommanderId = normalizeText(commanderId)
  if (!trimmedCommanderId) {
    return false
  }
  return commanders.some((commander) => commander.id === trimmedCommanderId)
}

export function createEmptyHireCommanderWizardErrors(): HireCommanderWizardFormErrors {
  return {
    global: null,
    displayName: null,
    roleKey: null,
  }
}

export function createEmptyNewAutomationWizardErrors(): NewAutomationWizardFormErrors {
  return {
    global: null,
    trigger: null,
    cron: null,
    name: null,
    instruction: null,
  }
}

export function createDefaultHireCommanderWizardValues(
  defaultAgentType: string = DEFAULT_HIRE_COMMANDER_AGENT_TYPE,
): HireCommanderWizardFormValues {
  return {
    displayName: '',
    roleKey: '',
    persona: '',
    agentType: defaultAgentType,
    effort: DEFAULT_HIRE_COMMANDER_EFFORT,
  }
}

export function createDefaultNewAutomationWizardValues(
  defaultQuestCommanderId = '',
  defaultAgentType: string = DEFAULT_NEW_AUTOMATION_AGENT_TYPE,
): NewAutomationWizardFormValues {
  return {
    trigger: DEFAULT_NEW_AUTOMATION_TRIGGER,
    cadencePreset: DEFAULT_NEW_AUTOMATION_CADENCE_PRESET,
    customCron: '',
    questCommanderId: defaultQuestCommanderId,
    name: '',
    instruction: '',
    agentType: defaultAgentType,
  }
}

export function buildHiddenCommanderHost(displayName: string, uniqueSuffix = Date.now().toString(36)): string {
  const base = normalizeText(displayName)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'commander'
  const suffix = String(uniqueSuffix)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '') || 'new'
  const host = `${base}-${suffix.slice(-6)}`
  return HOST_PATTERN.test(host) ? host : 'commander-new'
}

export function looksLikeCronExpression(expression: string): boolean {
  return CRON_SEGMENT_PATTERN.test(expression)
}

export function buildAutomationScheduleFromPreset(
  cadencePreset: NewAutomationCadencePreset,
  customCron: string,
): string | null {
  if (cadencePreset === 'custom') {
    const trimmedCron = normalizeText(customCron)
    return trimmedCron ? trimmedCron : null
  }

  return CADENCE_PRESET_TO_CRON[cadencePreset] ?? null
}

export function validateHireCommanderWizardStep(
  values: HireCommanderWizardFormValues,
  step: HireCommanderWizardStep,
  options: {
    existingCommanderNames: ReadonlyArray<string>
    providers: readonly ProviderRegistryEntry[]
  },
): HireCommanderWizardFormErrors {
  const errors = createEmptyHireCommanderWizardErrors()
  const trimmedDisplayName = normalizeText(values.displayName)
  const validAgentTypes = toOptionSet(listSupportedCommanderConversationProviders(options.providers))
  const validRoles = toOptionSet(HIRE_COMMANDER_ROLE_OPTIONS)

  if (!validAgentTypes.has(values.agentType)) {
    errors.global = 'Agent type must be a supported provider.'
  } else if (normalizeText(values.persona).length > MAX_PERSONA_LENGTH) {
    errors.global = `Persona must be ${MAX_PERSONA_LENGTH} characters or fewer.`
  }

  if (step === 'details' || step === 'review') {
    if (!trimmedDisplayName) {
      errors.displayName = 'Display name is required.'
    } else if (
      options.existingCommanderNames.some(
        (existingName) => normalizeName(existingName) === normalizeName(trimmedDisplayName),
      )
    ) {
      errors.displayName = 'Display name already exists.'
    }

    if (!validRoles.has(values.roleKey)) {
      errors.roleKey = 'Select a valid role.'
    }
  }

  return errors
}

export function buildHireCommanderCreateRequestBody(
  values: HireCommanderWizardFormValues,
  options: {
    existingCommanderNames: ReadonlyArray<string>
    host: string
    providers: readonly ProviderRegistryEntry[]
  },
): HireCommanderCreateRequestBody | null {
  const errors = validateHireCommanderWizardStep(values, 'review', {
    existingCommanderNames: options.existingCommanderNames,
    providers: options.providers,
  })
  if (Object.values(errors).some((error) => error !== null)) {
    return null
  }

  const trimmedPersona = normalizeText(values.persona)
  return {
    host: normalizeText(options.host),
    displayName: normalizeText(values.displayName),
    roleKey: values.roleKey as HireCommanderCreateRequestBody['roleKey'],
    ...(trimmedPersona ? { persona: trimmedPersona } : {}),
    agentType: values.agentType,
    effort: values.effort,
  }
}

export function validateNewAutomationWizardStep(
  values: NewAutomationWizardFormValues,
  step: NewAutomationWizardStep,
  options: {
    existingAutomationNames: ReadonlyArray<string>
    commanders: ReadonlyArray<NewAutomationCommander>
    providers: readonly ProviderRegistryEntry[]
  },
): NewAutomationWizardFormErrors {
  const errors = createEmptyNewAutomationWizardErrors()
  const validTriggers = toOptionSet(NEW_AUTOMATION_TRIGGER_OPTIONS)
  const validCadencePresets = toOptionSet(NEW_AUTOMATION_CADENCE_PRESET_OPTIONS)
  const validAgentTypes = toOptionSet(listSupportedAutomationProviders(options.providers))

  if (!validTriggers.has(values.trigger)) {
    errors.trigger = 'Select a valid trigger.'
  }

  if (!validAgentTypes.has(values.agentType)) {
    errors.global = 'Agent type must be a supported provider.'
  }

  if (step === 'details' || step === 'review') {
    if (values.trigger === 'schedule') {
      if (!validCadencePresets.has(values.cadencePreset)) {
        errors.global = 'Cadence preset is invalid.'
      } else if (values.cadencePreset === 'custom') {
        const trimmedCron = normalizeText(values.customCron)
        if (!trimmedCron) {
          errors.cron = 'Cron expression is required.'
        } else if (!looksLikeCronExpression(trimmedCron)) {
          errors.cron = 'Cron expression must contain exactly five fields.'
        }
      }
    }

    if (values.trigger === 'quest' && values.questCommanderId && !commanderExists(options.commanders, values.questCommanderId)) {
      errors.global = 'Selected commander is no longer available.'
    }

    const trimmedName = normalizeText(values.name)
    if (!trimmedName) {
      errors.name = 'Name is required.'
    } else if (
      options.existingAutomationNames.some(
        (existingName) => normalizeName(existingName) === normalizeName(trimmedName),
      )
    ) {
      errors.name = 'Name already exists for this owner.'
    }

    if (!normalizeText(values.instruction)) {
      errors.instruction = 'Instruction is required.'
    }
  }

  return errors
}

export function buildNewAutomationCreateRequestBody(
  values: NewAutomationWizardFormValues,
  options: {
    existingAutomationNames: ReadonlyArray<string>
    commanders: ReadonlyArray<NewAutomationCommander>
    owner: NewAutomationOwner
    providers: readonly ProviderRegistryEntry[]
  },
): NewAutomationCreateRequestBody | null {
  const errors = validateNewAutomationWizardStep(values, 'review', {
    existingAutomationNames: options.existingAutomationNames,
    commanders: options.commanders,
    providers: options.providers,
  })
  if (Object.values(errors).some((error) => error !== null)) {
    return null
  }

  const body: NewAutomationCreateRequestBody = {
    name: normalizeText(values.name),
    parentCommanderId: options.owner.kind === 'commander' ? options.owner.id : null,
    trigger: values.trigger,
    instruction: normalizeText(values.instruction),
    agentType: values.agentType,
    status: 'active',
  }

  if (values.trigger === 'schedule') {
    const schedule = buildAutomationScheduleFromPreset(values.cadencePreset, values.customCron)
    if (!schedule) {
      return null
    }
    body.schedule = schedule
  }

  if (values.trigger === 'quest') {
    body.questTrigger = {
      event: 'completed',
      ...(normalizeText(values.questCommanderId)
        ? { commanderId: normalizeText(values.questCommanderId) }
        : {}),
    }
  }

  return body
}

export function toRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }
  return fallback
}
