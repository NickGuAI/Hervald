import { getApiBase } from './api-base'

type AccessTokenResolver = () => Promise<string | null>
type UnauthorizedHandler = () => void

let accessTokenResolver: AccessTokenResolver | null = null
let unauthorizedHandler: UnauthorizedHandler | null = null
const API_KEY_STORAGE = 'hammurabi_api_key'

export function setAccessTokenResolver(resolver: AccessTokenResolver | null): void {
  accessTokenResolver = resolver
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

function handleUnauthorized(): void {
  if (unauthorizedHandler) {
    unauthorizedHandler()
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

  try {
    const token = accessTokenResolver
      ? await accessTokenResolver()
      : getStoredApiKey()
    if (token) {
      headers.set('authorization', `Bearer ${token}`)
    }
  } catch {
    // If token retrieval fails we still allow explicit API key requests.
  }

  return headers
}

export async function getAccessToken(): Promise<string | null> {
  try {
    if (accessTokenResolver) {
      return await accessTokenResolver()
    }
    return getStoredApiKey()
  } catch {
    return null
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await buildRequestHeaders(init?.headers)
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`
  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized()
    }
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }
  return (await response.json()) as T
}

export async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
  const headers = await buildRequestHeaders(init?.headers)
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`
  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized()
    }
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }
}
