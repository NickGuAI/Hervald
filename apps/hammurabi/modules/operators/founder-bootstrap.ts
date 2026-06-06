import type { AuthUser } from '@gehirn/auth-providers'
import type { Operator } from './types.js'
import {
  asNonEmptyFounderAvatarString,
  resolveFounderAvatarSrc,
} from './founder-avatar.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNonEmptyString(value: unknown): string | null {
  return asNonEmptyFounderAvatarString(value)
}

function isSyntheticAuth0LocalEmail(value: string | null): boolean {
  return value !== null && /^.+@auth0\.local$/.test(value)
}

function readUserMetadataString(user: AuthUser, key: string): string | null {
  if (!isObject(user.metadata)) {
    return null
  }

  return asNonEmptyString(user.metadata[key])
}

export function humanizeFounderDisplayName(value: string): string {
  const normalized = value
    .trim()
    .replace(/@.*$/, '')
    .replace(/[|/\\]+/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return 'Founder'
  }

  return normalized
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function resolveFounderBootstrapAvatarUrl(user: AuthUser | undefined): string | null {
  return resolveFounderAvatarSrc(null, user)
}

export function isFounderAuthUser(founder: Operator, user: AuthUser | undefined): boolean {
  if (!user) {
    return false
  }

  const founderId = asNonEmptyString(founder.id)
  const userId = asNonEmptyString(user.id)
  if (founderId && userId && founderId === userId) {
    return true
  }

  const founderEmail = asNonEmptyString(founder.email)?.toLowerCase() ?? null
  const userEmail = asNonEmptyString(user.email)
  if (!founderEmail || !userEmail || isSyntheticAuth0LocalEmail(userEmail)) {
    return false
  }

  return founderEmail === userEmail.toLowerCase()
}

export function resolveFounderAvatarBackfillUrl(
  founder: Operator,
  user: AuthUser | undefined,
): string | null {
  if (resolveFounderAvatarSrc(founder, null) || !isFounderAuthUser(founder, user)) {
    return null
  }

  return resolveFounderAvatarSrc(null, user)
}

export function createFounderBootstrapCandidate(user: AuthUser | undefined): Operator | null {
  if (!user) {
    return null
  }

  const id = asNonEmptyString(user.id)
  const rawEmail = asNonEmptyString(user.email)
  if (!id || rawEmail === 'system' || id === 'api-key' || id === 'internal') {
    return null
  }
  const email = isSyntheticAuth0LocalEmail(rawEmail) ? null : rawEmail

  const displayName = readUserMetadataString(user, 'name')
    ?? readUserMetadataString(user, 'displayName')
    ?? readUserMetadataString(user, 'nickname')
    ?? humanizeFounderDisplayName(email ?? id)

  return {
    id,
    kind: 'founder',
    displayName,
    email,
    avatarUrl: resolveFounderBootstrapAvatarUrl(user),
    createdAt: new Date().toISOString(),
  }
}
