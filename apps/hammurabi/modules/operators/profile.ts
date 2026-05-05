import { Buffer } from 'node:buffer'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const OPERATOR_PROFILE_FILE = 'profile.json'

export interface OperatorUiProfile {
  avatar?: string
}

const MAX_AVATAR_PATH = 256

function trimAvatarPath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized || normalized.length > MAX_AVATAR_PATH) {
    return undefined
  }

  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    return undefined
  }

  return normalized
}

function operatorStorageKey(operatorId: string): string {
  return Buffer.from(operatorId, 'utf8').toString('base64url')
}

function sanitizeOperatorUiProfile(raw: unknown): OperatorUiProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const avatar = trimAvatarPath((raw as Record<string, unknown>).avatar)
  if (!avatar) {
    return null
  }

  return { avatar }
}

export function resolveOperatorUiRoot(operatorId: string, baseDataDir: string): string {
  return path.join(baseDataDir, 'operators', operatorStorageKey(operatorId))
}

export async function readOperatorUiProfile(
  operatorId: string,
  baseDataDir: string,
): Promise<OperatorUiProfile | null> {
  const filePath = path.join(resolveOperatorUiRoot(operatorId, baseDataDir), OPERATOR_PROFILE_FILE)
  try {
    const raw = await readFile(filePath, 'utf8')
    return sanitizeOperatorUiProfile(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export async function resolveOperatorAvatarPath(
  operatorId: string,
  baseDataDir: string,
  profile: OperatorUiProfile | null,
): Promise<string | null> {
  const relativeAvatarPath = profile?.avatar
  if (!relativeAvatarPath) {
    return null
  }

  const operatorRoot = resolveOperatorUiRoot(operatorId, baseDataDir)
  const resolved = path.resolve(operatorRoot, relativeAvatarPath)
  const rootWithSeparator = operatorRoot.endsWith(path.sep) ? operatorRoot : `${operatorRoot}${path.sep}`
  if (!resolved.startsWith(rootWithSeparator) && resolved !== operatorRoot) {
    return null
  }

  try {
    await access(resolved)
    return resolved
  } catch {
    return null
  }
}

export async function writeOperatorUiProfile(
  operatorId: string,
  baseDataDir: string,
  profile: OperatorUiProfile,
): Promise<void> {
  const operatorRoot = resolveOperatorUiRoot(operatorId, baseDataDir)
  await mkdir(operatorRoot, { recursive: true })
  await writeFile(
    path.join(operatorRoot, OPERATOR_PROFILE_FILE),
    JSON.stringify(profile, null, 2),
    'utf8',
  )
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

export function mimeTypeForAvatarFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
