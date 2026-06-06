import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearStoredInstanceUrl,
  getApiBase,
  getDefaultInstanceUrl,
  getFullUrl,
  getStoredInstanceUrl,
  getWsBase,
  isValidInstanceUrl,
  normalizeInstanceUrl,
  parsePairingInvitePayload,
  setStoredInstanceUrl,
} from '../api-base'

const INSTANCE_URL_STORAGE = 'hammurabi_instance_url'

interface ShimWindow {
  Capacitor?: { isNativePlatform: () => boolean }
  localStorage: Storage
}

/**
 * jsdom/`@vitest-environment` is broken on this repo (Node 26 + vitest 2.x);
 * provide a minimal in-memory window/localStorage shim so these tests can run
 * under the default node environment without taking a dependency on Node's
 * experimental native localStorage.
 */
function installWindowShim(): { restore: () => void } {
  const store = new Map<string, string>()
  const localStorage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
  const shim: ShimWindow = { localStorage }
  const previous = (globalThis as { window?: ShimWindow }).window
  ;(globalThis as { window?: ShimWindow }).window = shim
  return {
    restore() {
      if (previous) {
        ;(globalThis as { window?: ShimWindow }).window = previous
      } else {
        delete (globalThis as { window?: unknown }).window
      }
    },
  }
}

function setNativePlatform(native: boolean): void {
  const window = (globalThis as { window?: ShimWindow }).window
  if (!window) return
  window.Capacitor = { isNativePlatform: () => native }
}

describe('api-base instance URL helpers', () => {
  let restore: () => void

  beforeEach(() => {
    ;({ restore } = installWindowShim())
  })

  afterEach(() => {
    restore()
  })

  it('normalizes trailing slashes and whitespace', () => {
    expect(normalizeInstanceUrl('  https://example.com/  ')).toBe('https://example.com')
    expect(normalizeInstanceUrl('https://example.com///')).toBe('https://example.com')
    expect(normalizeInstanceUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('validates http(s) instance URLs', () => {
    expect(isValidInstanceUrl('https://hervald.gehirn.ai')).toBe(true)
    expect(isValidInstanceUrl('http://localhost:20001')).toBe(true)
    expect(isValidInstanceUrl('hervald.gehirn.ai')).toBe(false)
    expect(isValidInstanceUrl('ftp://example.com')).toBe(false)
    expect(isValidInstanceUrl('')).toBe(false)
    expect(isValidInstanceUrl('   ')).toBe(false)
  })

  it('parses flat pairing invite JSON payloads', () => {
    expect(parsePairingInvitePayload(JSON.stringify({
      instanceUrl: ' https://my-hammurabi.example.com/ ',
      apiKey: ' hmk_test ',
    }))).toEqual({
      instanceUrl: 'https://my-hammurabi.example.com',
      apiKey: 'hmk_test',
    })
  })

  it('parses nested pairing invite JSON payloads', () => {
    expect(parsePairingInvitePayload(JSON.stringify({
      type: 'hammurabi.mobile_pairing_invite',
      pairing: { instance_url: 'http://localhost:20001/' },
      credential: { token: 'hmk_local' },
    }))).toEqual({
      instanceUrl: 'http://localhost:20001',
      apiKey: 'hmk_local',
    })
  })

  it('parses one-time token pairing invite JSON payloads', () => {
    expect(parsePairingInvitePayload(JSON.stringify({
      instanceUrl: 'https://pairing.example.com',
      oneTimeToken: 'hmrb_mobile_invite',
    }))).toEqual({
      instanceUrl: 'https://pairing.example.com',
      apiKey: 'hmrb_mobile_invite',
    })
  })

  it('parses pairing invite URLs and copied labeled text', () => {
    expect(parsePairingInvitePayload(
      'hammurabi://connect?instanceUrl=https%3A%2F%2Fself.example.com%2F&token=hmk_deep',
    )).toEqual({
      instanceUrl: 'https://self.example.com',
      apiKey: 'hmk_deep',
    })

    expect(parsePairingInvitePayload(
      'Instance URL: https://my-hammurabi.example.com/\nAPI Key: hmk_labeled',
    )).toEqual({
      instanceUrl: 'https://my-hammurabi.example.com',
      apiKey: 'hmk_labeled',
    })
  })

  it('rejects pairing invites without both URL and credential', () => {
    expect(parsePairingInvitePayload('')).toBeNull()
    expect(parsePairingInvitePayload(JSON.stringify({ instanceUrl: 'https://example.com' })))
      .toBeNull()
    expect(parsePairingInvitePayload('API Key: hmk_missing_url')).toBeNull()
  })

  it('exposes a default suggestion separate from the stored URL', () => {
    expect(getDefaultInstanceUrl()).toMatch(/^https:\/\//)
    expect(getStoredInstanceUrl()).toBeNull()
  })

  it('round-trips the stored instance URL via localStorage', () => {
    setStoredInstanceUrl('https://my-hammurabi.example.com/')
    expect(getStoredInstanceUrl()).toBe('https://my-hammurabi.example.com')

    clearStoredInstanceUrl()
    expect(getStoredInstanceUrl()).toBeNull()
  })

  it('preserves stored value across set/get and exposes raw storage key', () => {
    setStoredInstanceUrl('https://my-hammurabi.example.com')
    const window = (globalThis as { window: ShimWindow }).window
    expect(window.localStorage.getItem(INSTANCE_URL_STORAGE)).toBe(
      'https://my-hammurabi.example.com',
    )
  })

  it('returns relative base on web (non-native)', () => {
    setNativePlatform(false)
    setStoredInstanceUrl('https://my-hammurabi.example.com')
    expect(getApiBase()).toBe('')
    expect(getWsBase()).toBe('')
    expect(getFullUrl('/api/modules')).toBe('/api/modules')
  })

  it('resolves api/ws base from stored URL on native', () => {
    setNativePlatform(true)
    setStoredInstanceUrl('https://my-hammurabi.example.com')
    expect(getApiBase()).toBe('https://my-hammurabi.example.com')
    expect(getWsBase()).toBe('wss://my-hammurabi.example.com')
    expect(getFullUrl('/api/modules')).toBe('https://my-hammurabi.example.com/api/modules')
  })

  it('returns empty base on native when no URL is stored', () => {
    setNativePlatform(true)
    expect(getApiBase()).toBe('')
    expect(getWsBase()).toBe('')
  })

  it('passes through absolute URLs in getFullUrl', () => {
    setNativePlatform(true)
    setStoredInstanceUrl('https://my-hammurabi.example.com')
    expect(getFullUrl('https://other.example.com/api/x')).toBe('https://other.example.com/api/x')
  })

  it('downgrades http: to ws: in getWsBase', () => {
    setNativePlatform(true)
    setStoredInstanceUrl('http://localhost:20001')
    expect(getWsBase()).toBe('ws://localhost:20001')
  })
})
