import { getApiBase } from './api-base'

type AccessTokenResolver = () => Promise<string | null>
export type AuthMode = 'anonymous' | 'api-key' | 'auth0'

export interface UnauthorizedEvent {
  authMode: AuthMode
  phase: 'token' | 'response'
  path?: string
  status?: number
  error?: unknown
}

type UnauthorizedHandler = (event: UnauthorizedEvent) => void

let accessTokenResolver: AccessTokenResolver | null = null
let unauthorizedHandler: UnauthorizedHandler | null = null
let authMode: AuthMode = 'anonymous'
const API_KEY_STORAGE = 'hammurabi_api_key'

export class AuthRecoveryRequiredError extends Error {
  readonly authMode: AuthMode
  readonly cause?: unknown

  constructor(message: string, options: { authMode?: AuthMode; cause?: unknown } = {}) {
    super(message)
    this.name = 'AuthRecoveryRequiredError'
    this.authMode = options.authMode ?? authMode
    this.cause = options.cause
  }
}

export function isAuthRecoveryRequiredError(error: unknown): error is AuthRecoveryRequiredError {
  return error instanceof AuthRecoveryRequiredError
}

export function setAccessTokenResolver(resolver: AccessTokenResolver | null): void {
  accessTokenResolver = resolver
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

export function setAuthMode(mode: AuthMode): void {
  authMode = mode
}

function currentAuthMode(): AuthMode {
  if (authMode !== 'anonymous') {
    return authMode
  }

  return getStoredApiKey() ? 'api-key' : 'anonymous'
}

export function handleUnauthorized(event: Omit<UnauthorizedEvent, 'authMode'> & { authMode?: AuthMode }): void {
  if (unauthorizedHandler) {
    unauthorizedHandler({
      ...event,
      authMode: event.authMode ?? currentAuthMode(),
    })
  }
}

function getStoredApiKey(): string | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null
  }

  const key = window.localStorage.getItem(API_KEY_STORAGE)?.trim()
  return key && key.length > 0 ? key : null
}

function shouldInjectBearerToken(headers: Headers): boolean {
  return (
    !headers.has('authorization') &&
    !headers.has('x-hammurabi-api-key') &&
    !headers.has('x-api-key')
  )
}

export async function buildRequestHeaders(headersInit?: HeadersInit): Promise<Headers> {
  const headers = new Headers(headersInit)
  if (!shouldInjectBearerToken(headers)) {
    return headers
  }

  const token = accessTokenResolver
    ? await accessTokenResolver()
    : getStoredApiKey()
  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }

  return headers
}

export async function getAccessToken(): Promise<string | null> {
  try {
    if (accessTokenResolver) {
      return await accessTokenResolver()
    }
    return getStoredApiKey()
  } catch (error) {
    if (isAuthRecoveryRequiredError(error)) {
      handleUnauthorized({
        authMode: error.authMode,
        phase: 'token',
        error,
      })
    }
    throw error
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let headers: Headers
  try {
    headers = await buildRequestHeaders(init?.headers)
  } catch (error) {
    if (isAuthRecoveryRequiredError(error)) {
      handleUnauthorized({
        authMode: error.authMode,
        phase: 'token',
        path,
        error,
      })
    }
    throw error
  }
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`
  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized({
        phase: 'response',
        path,
        status: response.status,
      })
    }
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }
  return (await response.json()) as T
}

export async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
  let headers: Headers
  try {
    headers = await buildRequestHeaders(init?.headers)
  } catch (error) {
    if (isAuthRecoveryRequiredError(error)) {
      handleUnauthorized({
        authMode: error.authMode,
        phase: 'token',
        path,
        error,
      })
    }
    throw error
  }
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`
  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized({
        phase: 'response',
        path,
        status: response.status,
      })
    }
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }
}
