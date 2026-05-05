import type { AuthUser } from '@gehirn/auth-providers'
import type { Operator } from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isSyntheticAuth0LocalEmail(value: string | null): value is string {
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

function resolveBootstrapAvatarUrl(user: AuthUser): string | null {
  return readUserMetadataString(user, 'picture')
    ?? readUserMetadataString(user, 'avatarUrl')
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
    avatarUrl: resolveBootstrapAvatarUrl(user),
    createdAt: new Date().toISOString(),
  }
}
