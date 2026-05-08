import type { OrgIdentity } from '../org-identity/types.js'
import type { Operator } from '../operators/types.js'

export const FOUNDER_SETUP_PATH = '/welcome'
export const FOUNDER_SETUP_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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
}
