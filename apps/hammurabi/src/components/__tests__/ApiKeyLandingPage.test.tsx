// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-base')>()
  return {
    ...actual,
    isCapacitorNative: () => true,
  }
})

import { ApiKeyLandingPage } from '../ApiKeyLandingPage'

const API_KEY_STORAGE = 'hammurabi_api_key'
const INSTANCE_URL_STORAGE = 'hammurabi_instance_url'

let root: Root | null = null
let container: HTMLDivElement | null = null
const originalMediaDevices = window.navigator.mediaDevices

function installNativeCapacitorShim() {
  ;(window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
    isNativePlatform: () => true,
  }
}

async function renderPage(onApiKeySubmit = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<ApiKeyLandingPage onApiKeySubmit={onApiKeySubmit} />)
    await Promise.resolve()
  })

  return { onApiKeySubmit }
}

async function setFieldValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!field) {
    throw new Error(`Missing field: ${selector}`)
  }

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set
    if (valueSetter) {
      valueSetter.call(field, value)
    } else {
      field.value = value
    }
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function submitForm() {
  const form = document.querySelector('form')
  if (!form) {
    throw new Error('Missing connect form')
  }

  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flushAsyncWork() {
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 5))
  await Promise.resolve()
}

describe('ApiKeyLandingPage native connection validation', () => {
  beforeEach(() => {
    localStorage.clear()
    installNativeCapacitorShim()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
        await Promise.resolve()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    })
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('does not persist a malformed native instance URL', async () => {
    const { onApiKeySubmit } = await renderPage()

    await setFieldValue('#instance-url', 'hervald.gehirn.ai')
    await setFieldValue('#api-key', 'hmrb_bad_url')
    await submitForm()

    expect(document.body.textContent).toContain('Enter a valid instance URL')
    expect(onApiKeySubmit).not.toHaveBeenCalled()
    expect(localStorage.getItem(INSTANCE_URL_STORAGE)).toBeNull()
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull()
  })

  it('does not persist a valid key that lacks mobile scopes', async () => {
    const { onApiKeySubmit } = await renderPage()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/modules')) {
        return new Response(JSON.stringify({ modules: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/api/auth/mobile/verify')) {
        return new Response(JSON.stringify({ error: 'Insufficient API key scope' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await setFieldValue('#instance-url', 'https://self.example.com/')
    await setFieldValue('#api-key', 'hmrb_wrong_scope')
    await submitForm()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('missing required mobile access scopes')
    expect(onApiKeySubmit).not.toHaveBeenCalled()
    expect(localStorage.getItem(INSTANCE_URL_STORAGE)).toBeNull()
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull()
  })

  it('stores the normalized URL only after URL, key, and scope verification pass', async () => {
    const { onApiKeySubmit } = await renderPage()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    )

    await setFieldValue('#pairing-invite', JSON.stringify({
      instanceUrl: 'https://self.example.com/',
      apiKey: 'hmrb_mobile',
    }))
    await submitForm()

    expect(onApiKeySubmit).toHaveBeenCalledWith('hmrb_mobile')
    expect(localStorage.getItem(INSTANCE_URL_STORAGE)).toBe('https://self.example.com')
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull()
  })

  it('starts QR scanning without requiring BarcodeDetector support', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream))
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector

    await renderPage()
    const scanButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Scan QR')
    if (!scanButton) {
      throw new Error('Missing Scan QR button')
    }

    await act(async () => {
      scanButton.click()
    })
    for (let attempt = 0; attempt < 50 && getUserMedia.mock.calls.length === 0; attempt += 1) {
      await act(async () => {
        await flushAsyncWork()
      })
    }

    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    })
    for (let attempt = 0; attempt < 50 && !document.body.textContent?.includes('Stop scanning'); attempt += 1) {
      await act(async () => {
        await flushAsyncWork()
      })
    }
    expect(document.body.textContent).toContain('Stop scanning')
  })
})
