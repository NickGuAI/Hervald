import { createHmac, randomBytes } from 'node:crypto'
import { secureTokenEqual } from '../../server/middleware/secure-compare.js'

export const APPROVAL_BRIDGE_TOKEN_ENV = 'HAMMURABI_APPROVAL_BRIDGE_TOKEN'
export const APPROVAL_BRIDGE_TOKEN_HEADER = 'x-hammurabi-approval-bridge-token'
export const DEFAULT_APPROVAL_BRIDGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const APPROVAL_BRIDGE_TOKEN_PREFIX = 'hmab'
const APPROVAL_BRIDGE_TOKEN_VERSION = 1

interface ApprovalBridgeTokenClaims {
  v: typeof APPROVAL_BRIDGE_TOKEN_VERSION
  sessionName: string
  expiresAtMs: number
  nonce: string
}

export type ApprovalBridgeTokenVerification =
  | { ok: true; sessionName: string; expiresAtMs: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' | 'expired' }

function nowMs(now: Date | number | undefined): number {
  if (typeof now === 'number' && Number.isFinite(now)) {
    return Math.floor(now)
  }
  if (now instanceof Date) {
    return now.getTime()
  }
  return Date.now()
}

function signPayload(payload: string, internalToken: string): string {
  return createHmac('sha256', internalToken.trim())
    .update(payload, 'utf8')
    .digest('base64url')
}

function encodeClaims(claims: ApprovalBridgeTokenClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
}

function decodeClaims(payload: string): ApprovalBridgeTokenClaims | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const record = parsed as Record<string, unknown>
  if (
    record.v !== APPROVAL_BRIDGE_TOKEN_VERSION ||
    typeof record.sessionName !== 'string' ||
    record.sessionName.trim().length === 0 ||
    typeof record.expiresAtMs !== 'number' ||
    !Number.isFinite(record.expiresAtMs) ||
    typeof record.nonce !== 'string' ||
    record.nonce.trim().length === 0
  ) {
    return null
  }

  return {
    v: APPROVAL_BRIDGE_TOKEN_VERSION,
    sessionName: record.sessionName.trim(),
    expiresAtMs: Math.floor(record.expiresAtMs),
    nonce: record.nonce.trim(),
  }
}

export function createApprovalBridgeToken(options: {
  internalToken: string
  sessionName: string
  ttlMs?: number
  now?: Date | number
}): string {
  const internalToken = options.internalToken.trim()
  const sessionName = options.sessionName.trim()
  if (!internalToken) {
    throw new Error('internalToken is required to mint approval bridge tokens')
  }
  if (!sessionName) {
    throw new Error('sessionName is required to mint approval bridge tokens')
  }

  const ttlMs = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? Math.floor(options.ttlMs)
    : DEFAULT_APPROVAL_BRIDGE_TOKEN_TTL_MS
  const payload = encodeClaims({
    v: APPROVAL_BRIDGE_TOKEN_VERSION,
    sessionName,
    expiresAtMs: nowMs(options.now) + ttlMs,
    nonce: randomBytes(16).toString('base64url'),
  })
  return `${APPROVAL_BRIDGE_TOKEN_PREFIX}.${payload}.${signPayload(payload, internalToken)}`
}

export function verifyApprovalBridgeToken(
  token: string | null | undefined,
  options: {
    internalToken?: string
    now?: Date | number
  },
): ApprovalBridgeTokenVerification {
  const normalizedToken = token?.trim()
  const internalToken = options.internalToken?.trim()
  if (!normalizedToken) {
    return { ok: false, reason: 'missing' }
  }
  if (!internalToken) {
    return { ok: false, reason: 'invalid' }
  }

  const parts = normalizedToken.split('.')
  if (parts.length !== 3 || parts[0] !== APPROVAL_BRIDGE_TOKEN_PREFIX) {
    return { ok: false, reason: 'malformed' }
  }

  const [, payload, signature] = parts
  const expectedSignature = signPayload(payload, internalToken)
  if (!secureTokenEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid' }
  }

  const claims = decodeClaims(payload)
  if (!claims) {
    return { ok: false, reason: 'malformed' }
  }

  if (claims.expiresAtMs <= nowMs(options.now)) {
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    sessionName: claims.sessionName,
    expiresAtMs: claims.expiresAtMs,
  }
}
