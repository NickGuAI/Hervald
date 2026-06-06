/**
 * API base URL for fetch and WebSocket. When running in Capacitor (bundled),
 * the app loads from capacitor://localhost so relative URLs fail. The native
 * app instead targets a user-selected Hervald/Hammurabi instance URL stored
 * in localStorage, falling back to the default hosted instance only as a
 * suggestion in the connection screen — never as a hard-coded backend.
 */
const DEFAULT_INSTANCE_URL = 'https://hervald.gehirn.ai'
const INSTANCE_URL_STORAGE = 'hammurabi_instance_url'
const INSTANCE_URL_INVITE_KEYS = [
  'instanceUrl',
  'instance_url',
  'url',
  'baseUrl',
  'base_url',
  'apiBaseUrl',
  'api_base_url',
  'endpoint',
  'host',
]
const API_KEY_INVITE_KEYS = [
  'apiKey',
  'api_key',
  'invite',
  'key',
  'token',
  'pairingToken',
  'pairing_token',
  'oneTimeToken',
  'one_time_token',
  'credential',
  'secret',
]
const INVITE_CONTAINER_KEYS = ['invite', 'pairing', 'payload', 'credentials', 'credential']

export interface PairingInvitePayload {
  instanceUrl: string
  apiKey: string
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
}

export function normalizeInstanceUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

export function isValidInstanceUrl(input: string): boolean {
  const normalized = normalizeInstanceUrl(input)
  if (normalized.length === 0) return false
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function cleanInviteValue(value: string): string {
  return value.trim().replace(/^["'`]+|["'`,;]+$/g, '')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      const cleaned = cleanInviteValue(value)
      if (cleaned.length > 0) {
        return cleaned
      }
    }
  }
  return null
}

function buildPairingInvitePayload(
  instanceUrl: string | null | undefined,
  apiKey: string | null | undefined,
): PairingInvitePayload | null {
  const normalizedUrl = instanceUrl ? normalizeInstanceUrl(cleanInviteValue(instanceUrl)) : ''
  const cleanedKey = apiKey ? cleanInviteValue(apiKey) : ''
  if (!normalizedUrl || !cleanedKey) {
    return null
  }
  return { instanceUrl: normalizedUrl, apiKey: cleanedKey }
}

function parsePairingInviteRecord(record: Record<string, unknown>): PairingInvitePayload | null {
  let instanceUrl = firstStringValue(record, INSTANCE_URL_INVITE_KEYS)
  let apiKey = firstStringValue(record, API_KEY_INVITE_KEYS)

  for (const key of INVITE_CONTAINER_KEYS) {
    const nested = asRecord(record[key])
    if (!nested) continue

    instanceUrl = instanceUrl ?? firstStringValue(nested, INSTANCE_URL_INVITE_KEYS)
    apiKey = apiKey ?? firstStringValue(nested, API_KEY_INVITE_KEYS)

    if (!instanceUrl || !apiKey) {
      const nestedPayload = parsePairingInviteRecord(nested)
      instanceUrl = instanceUrl ?? nestedPayload?.instanceUrl ?? null
      apiKey = apiKey ?? nestedPayload?.apiKey ?? null
    }
  }

  return buildPairingInvitePayload(instanceUrl, apiKey)
}

function parsePairingInviteJson(input: string): PairingInvitePayload | null {
  const trimmed = input.trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      const record = asRecord(parsed)
      if (!record) continue
      const payload = parsePairingInviteRecord(record)
      if (payload) return payload
    } catch {
      // Try the next representation.
    }
  }

  return null
}

function firstSearchParam(url: URL, keys: string[]): string | null {
  for (const key of keys) {
    const value = url.searchParams.get(key)
    if (value) {
      const cleaned = cleanInviteValue(value)
      if (cleaned.length > 0) {
        return cleaned
      }
    }
  }
  return null
}

function parsePairingInviteUrl(input: string): PairingInvitePayload | null {
  try {
    const parsed = new URL(input.trim())
    const apiKey = firstSearchParam(parsed, API_KEY_INVITE_KEYS)
    const instanceUrl = firstSearchParam(parsed, INSTANCE_URL_INVITE_KEYS)
      ?? (apiKey && parsed.protocol.startsWith('http') ? parsed.origin : null)
    return buildPairingInvitePayload(instanceUrl, apiKey)
  } catch {
    return null
  }
}

function parsePairingInviteLabeledText(input: string): PairingInvitePayload | null {
  const urlMatch = input.match(
    /(?:instance[_\s-]*url|api[_\s-]*base[_\s-]*url|base[_\s-]*url|endpoint|host|url)\s*[:=]\s*(https?:\/\/[^\s,"'`}]+)/i,
  )
  const keyMatch = input.match(
    /(?:api[_\s-]*key|key|token|invite|pairing[_\s-]*token|one[_\s-]*time[_\s-]*token|credential|secret)\s*[:=]\s*([^\s,"'`}]+)/i,
  )

  return buildPairingInvitePayload(urlMatch?.[1], keyMatch?.[1])
}

export function parsePairingInvitePayload(input: string): PairingInvitePayload | null {
  if (input.trim().length === 0) {
    return null
  }

  return parsePairingInviteJson(input)
    ?? parsePairingInviteUrl(input)
    ?? parsePairingInviteLabeledText(input)
}

export function getDefaultInstanceUrl(): string {
  return DEFAULT_INSTANCE_URL
}

export function getStoredInstanceUrl(): string | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null
  }
  const value = window.localStorage.getItem(INSTANCE_URL_STORAGE)?.trim()
  return value && value.length > 0 ? value : null
}

export function setStoredInstanceUrl(url: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }
  window.localStorage.setItem(INSTANCE_URL_STORAGE, normalizeInstanceUrl(url))
}

export function clearStoredInstanceUrl(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return
  }
  window.localStorage.removeItem(INSTANCE_URL_STORAGE)
}

export function getApiBase(): string {
  if (!isCapacitorNative()) {
    return ''
  }
  return getStoredInstanceUrl() ?? ''
}

export function getWsBase(): string {
  const base = getApiBase()
  if (!base) return ''
  return base.startsWith('https:') ? base.replace(/^https:/, 'wss:') : base.replace(/^http:/, 'ws:')
}

export function getFullUrl(path: string): string {
  return path.startsWith('http') ? path : `${getApiBase()}${path}`
}
