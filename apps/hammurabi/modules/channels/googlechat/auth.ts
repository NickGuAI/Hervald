import { createHash } from 'node:crypto'
import {
  SignJWT,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importPKCS8,
  importX509,
  jwtVerify,
  type JWTPayload,
} from 'jose'
import type { GoogleChatChannelConfig } from './config.js'

export const GOOGLE_CHAT_BOT_SCOPE = 'https://www.googleapis.com/auth/chat.bot'
export const GOOGLE_CHAT_ISSUER = 'chat@system.gserviceaccount.com'

export interface GoogleChatVerifiedBearer {
  audience: string | string[]
  issuer?: string
  email?: string
  payload: JWTPayload
}

export interface GoogleChatBearerVerifier {
  verifyBearerToken(
    bearerToken: string,
    config: GoogleChatChannelConfig,
  ): Promise<GoogleChatVerifiedBearer>
}

export interface GoogleChatServiceAccountCredential {
  client_email: string
  private_key: string
  private_key_id?: string
  token_uri?: string
}

export interface GoogleChatAccessTokenProvider {
  getAccessToken(credential: GoogleChatServiceAccountCredential): Promise<string>
}

const GOOGLE_OIDC_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const SERVICE_ACCOUNT_CERTS_URL = `https://www.googleapis.com/service_accounts/v1/metadata/x509/${GOOGLE_CHAT_ISSUER}`
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimString(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function payloadAudience(payload: JWTPayload): string | string[] {
  return payload.aud ?? ''
}

function payloadEmail(payload: JWTPayload): string | undefined {
  return typeof payload.email === 'string' ? payload.email : undefined
}

function payloadEmailVerified(payload: JWTPayload): boolean {
  return payload.email_verified === true || payload.email_verified === 'true'
}

function cacheKeyForCredential(credential: GoogleChatServiceAccountCredential): string {
  return createHash('sha256')
    .update(credential.client_email)
    .update('\0')
    .update(credential.private_key)
    .update('\0')
    .update(credential.token_uri ?? DEFAULT_TOKEN_URI)
    .digest('hex')
}

export function parseGoogleChatServiceAccountCredential(raw: string): GoogleChatServiceAccountCredential {
  const parsed = JSON.parse(raw) as unknown
  if (!isObject(parsed)) {
    throw new Error('Google Chat service account credential must be a JSON object')
  }
  const clientEmail = trimString(parsed.client_email)
  const privateKey = trimString(parsed.private_key)
  if (!clientEmail || !privateKey) {
    throw new Error('Google Chat service account credential must include client_email and private_key')
  }
  return {
    client_email: clientEmail,
    private_key: privateKey,
    ...(trimString(parsed.private_key_id) ? { private_key_id: trimString(parsed.private_key_id) } : {}),
    ...(trimString(parsed.token_uri) ? { token_uri: trimString(parsed.token_uri) } : {}),
  }
}

export class JoseGoogleChatBearerVerifier implements GoogleChatBearerVerifier {
  private readonly fetchImpl: typeof fetch
  private certsCache: { certs: Record<string, string>; expiresAt: number } | null = null

  constructor(options: {
    fetchImpl?: typeof fetch
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async verifyBearerToken(
    bearerToken: string,
    config: GoogleChatChannelConfig,
  ): Promise<GoogleChatVerifiedBearer> {
    if (config.webhookAudienceType === 'project-number') {
      return this.verifyProjectNumberJwt(bearerToken, config.webhookAudience)
    }
    return this.verifyEndpointIdToken(bearerToken, config.webhookAudience)
  }

  private async verifyEndpointIdToken(
    bearerToken: string,
    audience: string,
  ): Promise<GoogleChatVerifiedBearer> {
    const { payload } = await jwtVerify(bearerToken, GOOGLE_OIDC_JWKS, {
      audience,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    })
    if (payloadEmail(payload) !== GOOGLE_CHAT_ISSUER || !payloadEmailVerified(payload)) {
      throw new Error('Google Chat bearer token was not issued for the Chat service account')
    }
    return {
      audience: payloadAudience(payload),
      issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
      email: payloadEmail(payload),
      payload,
    }
  }

  private async verifyProjectNumberJwt(
    bearerToken: string,
    audience: string,
  ): Promise<GoogleChatVerifiedBearer> {
    const header = decodeProtectedHeader(bearerToken)
    const certs = await this.getChatServiceAccountCerts()
    const candidateCerts = header.kid && certs[header.kid]
      ? [certs[header.kid]]
      : Object.values(certs)
    let lastError: unknown
    for (const cert of candidateCerts) {
      try {
        const key = await importX509(cert, header.alg ?? 'RS256')
        const { payload } = await jwtVerify(bearerToken, key, {
          audience,
          issuer: GOOGLE_CHAT_ISSUER,
        })
        return {
          audience: payloadAudience(payload),
          issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
          email: payloadEmail(payload),
          payload,
        }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Google Chat project-number JWT verification failed')
  }

  private async getChatServiceAccountCerts(): Promise<Record<string, string>> {
    const now = Date.now()
    if (this.certsCache && this.certsCache.expiresAt > now) {
      return this.certsCache.certs
    }
    const response = await this.fetchImpl(SERVICE_ACCOUNT_CERTS_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch Google Chat service account certs: ${response.status}`)
    }
    const parsed = await response.json() as unknown
    if (!isObject(parsed)) {
      throw new Error('Google Chat service account certs response was not an object')
    }
    const certs: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.includes('BEGIN CERTIFICATE')) {
        certs[key] = value
      }
    }
    if (Object.keys(certs).length === 0) {
      throw new Error('Google Chat service account certs response did not include any certificates')
    }
    this.certsCache = { certs, expiresAt: now + 60 * 60 * 1000 }
    return certs
  }
}

export class GoogleChatServiceAccountTokenProvider implements GoogleChatAccessTokenProvider {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly tokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>()

  constructor(options: {
    fetchImpl?: typeof fetch
    now?: () => number
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => Date.now())
  }

  async getAccessToken(credential: GoogleChatServiceAccountCredential): Promise<string> {
    const cacheKey = cacheKeyForCredential(credential)
    const cached = this.tokenCache.get(cacheKey)
    const nowMs = this.now()
    if (cached && cached.expiresAtMs - 60_000 > nowMs) {
      return cached.accessToken
    }

    const tokenUri = credential.token_uri ?? DEFAULT_TOKEN_URI
    const privateKey = await importPKCS8(credential.private_key, 'RS256')
    const nowSeconds = Math.floor(nowMs / 1000)
    const assertion = await new SignJWT({ scope: GOOGLE_CHAT_BOT_SCOPE })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(credential.private_key_id ? { kid: credential.private_key_id } : {}),
      })
      .setIssuer(credential.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .sign(privateKey)

    const response = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Failed to mint Google Chat access token: ${response.status} ${text}`.trim())
    }
    const body = await response.json() as unknown
    if (!isObject(body) || typeof body.access_token !== 'string') {
      throw new Error('Google Chat access token response did not include access_token')
    }
    const expiresInSeconds = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? Math.max(60, Math.trunc(body.expires_in))
      : 3600
    this.tokenCache.set(cacheKey, {
      accessToken: body.access_token,
      expiresAtMs: nowMs + expiresInSeconds * 1000,
    })
    return body.access_token
  }
}
