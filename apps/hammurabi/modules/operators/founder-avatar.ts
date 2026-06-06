import type { Operator } from './types.js'

type AuthPictureUser = {
  picture?: unknown
  metadata?: unknown
}

type AuthPictureContext = {
  user?: AuthPictureUser | null
}

export type FounderAvatarAuthSource = AuthPictureUser | AuthPictureContext | null | undefined

export interface ResolveFounderAvatarOptions {
  avatarPreview?: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asNonEmptyFounderAvatarString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readMetadataString(source: unknown, key: string): string | null {
  if (!isObject(source)) {
    return null
  }

  return asNonEmptyFounderAvatarString(source[key])
}

function readAuthPicture(auth: FounderAvatarAuthSource): string | null {
  if (!isObject(auth)) {
    return null
  }

  const authRecord: Record<string, unknown> = auth
  const user = isObject(authRecord.user) ? authRecord.user : authRecord
  return asNonEmptyFounderAvatarString(user.picture)
    ?? readMetadataString(user.metadata, 'picture')
    ?? readMetadataString(user.metadata, 'avatarUrl')
}

export function resolveFounderAvatarSrc(
  founder: Pick<Operator, 'avatarUrl'> | null | undefined,
  auth: FounderAvatarAuthSource,
  options: ResolveFounderAvatarOptions = {},
): string | null {
  return asNonEmptyFounderAvatarString(options.avatarPreview)
    ?? asNonEmptyFounderAvatarString(founder?.avatarUrl)
    ?? readAuthPicture(auth)
}
