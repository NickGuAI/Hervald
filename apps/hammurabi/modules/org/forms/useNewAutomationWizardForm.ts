import { useEffect, useMemo, useState } from 'react'
import { useProviderRegistry } from '@/hooks/use-providers'
import {
  buildNewAutomationCreateRequestBody,
  createDefaultNewAutomationWizardValues,
  createEmptyNewAutomationWizardErrors,
  validateNewAutomationWizardStep,
} from './helpers.js'
import { listSupportedAutomationProviders } from './constants.js'
import type {
  NewAutomationCommander,
  NewAutomationCreateRequestBody,
  NewAutomationOwner,
  NewAutomationWizardField,
  NewAutomationWizardFormErrors,
  NewAutomationWizardFormValues,
  NewAutomationWizardStep,
} from './types.js'

export function useNewAutomationWizardForm(options: {
  existingAutomationNames: ReadonlyArray<string>
  commanders: ReadonlyArray<NewAutomationCommander>
  defaultQuestCommanderId?: string
}) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = useMemo(
    () => listSupportedAutomationProviders(providers),
    [providers],
  )
  const defaultAgentType = agentTypeOptions[0]?.value
  const defaultValues = useMemo(
    () => createDefaultNewAutomationWizardValues(
      options.defaultQuestCommanderId ?? '',
      defaultAgentType,
    ),
    [defaultAgentType, options.defaultQuestCommanderId],
  )
  const [step, setStep] = useState<NewAutomationWizardStep>('trigger')
  const [values, setValues] = useState<NewAutomationWizardFormValues>(defaultValues)
  const [errors, setErrors] = useState<NewAutomationWizardFormErrors>(createEmptyNewAutomationWizardErrors)

  const dirty = useMemo(() => (
    JSON.stringify(values) !== JSON.stringify(defaultValues) || step !== 'trigger'
  ), [defaultValues, step, values])

  useEffect(() => {
    if (agentTypeOptions.length === 0) {
      return
    }
    if (!agentTypeOptions.some((option) => option.value === values.agentType)) {
      setValues((current) => ({
        ...current,
        agentType: defaultAgentType ?? current.agentType,
      }))
    }
  }, [agentTypeOptions, defaultAgentType, values.agentType])

  function updateField<TField extends NewAutomationWizardField>(
    field: TField,
    value: NewAutomationWizardFormValues[TField],
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }))
    setErrors((current) => ({
      ...current,
      global: null,
      ...(field === 'trigger' ? { trigger: null } : {}),
      ...(field === 'customCron' ? { cron: null } : {}),
      ...(field === 'name' ? { name: null } : {}),
      ...(field === 'instruction' ? { instruction: null } : {}),
    }))
  }

  function reset() {
    setStep('trigger')
    setValues(defaultValues)
    setErrors(createEmptyNewAutomationWizardErrors())
  }

  function goBack() {
    setStep((current) => {
      if (current === 'review') {
        return 'details'
      }
      return 'trigger'
    })
  }

  function goNext(): boolean {
    const nextValidationOptions = {
      ...options,
      providers,
    }
    const nextErrors = validateNewAutomationWizardStep(values, step, nextValidationOptions)
    setErrors(nextErrors)
    if (Object.values(nextErrors).some((error) => error !== null)) {
      return false
    }

    setStep((current) => {
      if (current === 'trigger') {
        return 'details'
      }
      if (current === 'details') {
        return 'review'
      }
      return current
    })

    return true
  }

  function buildCreateRequestBody(owner: NewAutomationOwner): NewAutomationCreateRequestBody | null {
    const nextErrors = validateNewAutomationWizardStep(values, 'review', {
      ...options,
      providers,
    })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some((error) => error !== null)) {
      return null
    }

    return buildNewAutomationCreateRequestBody(values, {
      existingAutomationNames: options.existingAutomationNames,
      commanders: options.commanders,
      owner,
      providers,
    })
  }

  function setGlobalError(message: string | null) {
    setErrors((current) => ({
      ...current,
      global: message,
    }))
  }

  return {
    step,
    values,
    errors,
    dirty,
    updateField,
    goBack,
    goNext,
    reset,
    buildCreateRequestBody,
    setGlobalError,
  }
}
