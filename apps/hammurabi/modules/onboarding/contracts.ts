import type { OrgIdentity } from '../org-identity/types.js'
import type { Operator } from '../operators/types.js'

export const FOUNDER_SETUP_PATH = '/welcome'
export const FOUNDER_SETUP_COMPLETED_PATH = '/org'
export const FOUNDER_SETUP_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface FounderOrgSetupFormValues {
  orgDisplayName: string
  founderDisplayName: string
  founderEmail: string
}

export interface FounderOrgSetupValidationErrors {
  orgDisplayName?: string
  founderDisplayName?: string
  founderEmail?: string
}

export const DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES: FounderOrgSetupFormValues = {
  orgDisplayName: '',
  founderDisplayName: '',
  founderEmail: '',
}

export interface FounderOrgSetupRequest {
  displayName: string
  founder: {
    displayName: string
    email: string
  }
}

export interface FounderOrgSetupResponse {
  operator: Operator
  orgIdentity: OrgIdentity
  nextRoute: string
}

export interface FounderSetupStatus {
  setupComplete: boolean
  defaultValues: FounderOrgSetupFormValues
  validationErrors: FounderOrgSetupValidationErrors
  nextRoute: string
}

export type OnboardingStepId =
  | 'instance'
  | 'founder-org'
  | 'gaia'
  | 'starter-workforce'
  | 'providers-machines'
  | 'launch'

export type OnboardingStepState = 'complete' | 'current' | 'pending' | 'warning'

export interface OnboardingStep {
  id: OnboardingStepId
  label: string
  state: OnboardingStepState
  summary: string
}

export type OnboardingReadinessState =
  | 'ready'
  | 'warning'
  | 'missing'
  | 'skipped'

export interface ProviderOnboardingReadiness {
  id: string
  label: string
  cliBinaryName: string | null
  installed: boolean | null
  authConfigured: boolean | null
  authMode: 'env' | 'login' | 'not-required' | 'missing' | 'unknown'
  state: OnboardingReadinessState
  shortAction: string
  verificationCommand: string | null
  envSourceKey: string | null
}

export interface MachineOnboardingReadiness {
  id: string
  label: string
  transport: 'local' | 'ssh' | 'daemon'
  state: OnboardingReadinessState
  envFile: string | null
  cwd: string | null
  summary: string
}

export interface GaiaOnboardingStatus {
  commanderId: string | null
  displayName: string
  exists: boolean
  conversationId: string | null
  defaultProviderId: string | null
}

export interface StarterCommanderPackageStatus {
  packageId: string
  displayName: string
  role: string
  summary: string
  installed: boolean
  commanderId: string | null
}

export interface StarterWorkforceOnboardingStatus {
  packages: StarterCommanderPackageStatus[]
  installedCount: number
  totalCount: number
  complete: boolean
}

export interface OnboardingReceipt {
  url: string
  account: string
  organization: string | null
  founder: string | null
  commander: string | null
  machine: string | null
  providerSummary: string
}

export interface OnboardingStatus {
  currentStepId: OnboardingStepId
  steps: OnboardingStep[]
  founderSetup: FounderSetupStatus
  gaia: GaiaOnboardingStatus
  starterWorkforce: StarterWorkforceOnboardingStatus
  providers: ProviderOnboardingReadiness[]
  machines: MachineOnboardingReadiness[]
  receipt: OnboardingReceipt
  launchTarget: string
}

export interface SeedGaiaOnboardingResponse {
  gaia: GaiaOnboardingStatus
  status: OnboardingStatus
}

export interface SeedStarterWorkforceOnboardingResponse {
  starterWorkforce: StarterWorkforceOnboardingStatus
  status: OnboardingStatus
}

export function validateFounderOrgSetupFormValues(
  state: FounderOrgSetupFormValues,
): FounderOrgSetupValidationErrors {
  const orgDisplayName = state.orgDisplayName.trim()
  const founderDisplayName = state.founderDisplayName.trim()
  const founderEmail = state.founderEmail.trim()
  const errors: FounderOrgSetupValidationErrors = {}

  if (!orgDisplayName) {
    errors.orgDisplayName = 'Org display name is required.'
  }

  if (!founderDisplayName) {
    errors.founderDisplayName = 'Founder display name is required.'
  }

  if (!founderEmail) {
    errors.founderEmail = 'Founder email is required.'
  } else if (!FOUNDER_SETUP_EMAIL_PATTERN.test(founderEmail)) {
    errors.founderEmail = 'Founder email must be a valid email address.'
  }

  return errors
}
