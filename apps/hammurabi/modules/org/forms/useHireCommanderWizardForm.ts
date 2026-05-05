import { useEffect, useMemo, useState } from 'react'
import { useProviderRegistry } from '@/hooks/use-providers'
import {
  buildHireCommanderCreateRequestBody,
  createDefaultHireCommanderWizardValues,
  createEmptyHireCommanderWizardErrors,
  validateHireCommanderWizardStep,
} from './helpers.js'
import { listSupportedCommanderConversationProviders } from './constants.js'
import type {
  HireCommanderCreateRequestBody,
  HireCommanderWizardField,
  HireCommanderWizardFormErrors,
  HireCommanderWizardFormValues,
  HireCommanderWizardStep,
} from './types.js'

export function useHireCommanderWizardForm(options: {
  existingCommanderNames: ReadonlyArray<string>
}) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = useMemo(
    () => listSupportedCommanderConversationProviders(providers),
    [providers],
  )
  const defaultAgentType = agentTypeOptions[0]?.value
  const defaultValues = useMemo(() => (
    createDefaultHireCommanderWizardValues(defaultAgentType)
  ), [defaultAgentType])
  const [step, setStep] = useState<HireCommanderWizardStep>('details')
  const [values, setValues] = useState<HireCommanderWizardFormValues>(defaultValues)
  const [errors, setErrors] = useState<HireCommanderWizardFormErrors>(createEmptyHireCommanderWizardErrors)

  const dirty = useMemo(() => (
    JSON.stringify(values) !== JSON.stringify(defaultValues) || step !== 'details'
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

  function updateField<TField extends HireCommanderWizardField>(
    field: TField,
    value: HireCommanderWizardFormValues[TField],
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }))
    setErrors((current) => ({
      ...current,
      global: null,
      ...(field === 'displayName' ? { displayName: null } : {}),
      ...(field === 'roleKey' ? { roleKey: null } : {}),
    }))
  }

  function reset() {
    setStep('details')
    setValues(defaultValues)
    setErrors(createEmptyHireCommanderWizardErrors())
  }

  function goBack() {
    setStep('details')
  }

  function goNext(): boolean {
    const nextErrors = validateHireCommanderWizardStep(values, step, {
      ...options,
      providers,
    })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some((error) => error !== null)) {
      return false
    }

    if (step === 'details') {
      setStep('review')
    }

    return true
  }

  function buildCreateRequestBody(host: string): HireCommanderCreateRequestBody | null {
    const nextErrors = validateHireCommanderWizardStep(values, 'review', {
      ...options,
      providers,
    })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some((error) => error !== null)) {
      return null
    }

    return buildHireCommanderCreateRequestBody(values, {
      existingCommanderNames: options.existingCommanderNames,
      host,
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
