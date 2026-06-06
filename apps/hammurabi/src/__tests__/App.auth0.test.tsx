// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth0ProviderProps: null as null | {
    cacheLocation?: string
    useRefreshTokens?: boolean
    useRefreshTokensFallback?: boolean
    authorizationParams?: {
      audience?: string
      redirect_uri?: string
      scope?: string
    }
  },
  getAccessTokenSilently: vi.fn(),
  isAuthenticated: false,
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: (props: Record<string, unknown>) => {
    mocks.auth0ProviderProps = props as typeof mocks.auth0ProviderProps
    return <>{props.children as ReactNode}</>
  },
  useAuth0: () => ({
    isLoading: false,
    isAuthenticated: mocks.isAuthenticated,
    getAccessTokenSilently: mocks.getAccessTokenSilently,
    loginWithRedirect: mocks.loginWithRedirect,
    logout: mocks.logout,
  }),
}))

vi.mock('@/components/LandingPage', () => ({
  LandingPage: () => null,
}))

vi.mock('@/components/ApiKeyLandingPage', () => ({
  ApiKeyLandingPage: ({ onApiKeySubmit }: { onApiKeySubmit: (key: string) => void }) => (
    <button
      type="button"
      data-testid="api-key-submit"
      onClick={() => onApiKeySubmit(' bootstrap-key ')}
    >
      Sign in
    </button>
  ),
}))

vi.mock('@/app/AuthenticatedAppRouter', () => ({
  AuthenticatedAppRouter: () => null,
}))

vi.mock('@/module-registry', () => ({
  moduleComponentBindings: [],
}))

import App from '../App'
import { fetchJson, setAccessTokenResolver, setAuthMode, setUnauthorizedHandler } from '../lib/api'

let root: Root | null = null
let container: HTMLDivElement | null = null

function healthyGatewayResponse() {
  return new Response(JSON.stringify({ version: 'test' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function renderApp(path: string) {
  window.history.replaceState({}, document.title, path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('App Auth0 configuration', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.auth0ProviderProps = null
    mocks.getAccessTokenSilently.mockResolvedValue('auth0-token')
    mocks.loginWithRedirect.mockResolvedValue(undefined)
    mocks.isAuthenticated = false
    vi.stubEnv('VITE_AUTH0_DOMAIN', 'auth.example.com')
    vi.stubEnv('VITE_AUTH0_AUDIENCE', 'https://pmai-api')
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', 'client-id')
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
    localStorage.clear()
    setAccessTokenResolver(null)
    setAuthMode('anonymous')
    setUnauthorizedHandler(null)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps the Auth0 redirect_uri pinned to origin on deep links', async () => {
    await renderApp('/command-room?commander=gaia&conversation=abc')

    expect(mocks.auth0ProviderProps?.authorizationParams?.redirect_uri).toBe(
      window.location.origin,
    )
  })

  it('configures Auth0 with durable refresh-token settings', async () => {
    await renderApp('/org')

    expect(mocks.auth0ProviderProps?.cacheLocation).toBe('localstorage')
    expect(mocks.auth0ProviderProps?.useRefreshTokens).toBe(true)
    expect(mocks.auth0ProviderProps?.useRefreshTokensFallback).toBe(true)
    expect(mocks.auth0ProviderProps?.authorizationParams).toEqual(expect.objectContaining({
      audience: 'https://pmai-api',
      scope: expect.stringContaining('offline_access'),
    }))
  })

  it('preserves /welcome after bootstrap API-key sign-in', async () => {
    vi.stubEnv('VITE_AUTH0_DOMAIN', '')
    vi.stubEnv('VITE_AUTH0_AUDIENCE', '')
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', '')

    await renderApp('/welcome')

    await act(async () => {
      const button = document.body.querySelector('[data-testid="api-key-submit"]') as HTMLButtonElement | null
      button?.click()
      await Promise.resolve()
    })

    expect(localStorage.getItem('hammurabi_api_key')).toBe('bootstrap-key')
    expect(window.location.pathname).toBe('/welcome')
  })

  it('routes root bootstrap API-key sign-in to /welcome by default', async () => {
    vi.stubEnv('VITE_AUTH0_DOMAIN', '')
    vi.stubEnv('VITE_AUTH0_AUDIENCE', '')
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', '')

    await renderApp('/')

    await act(async () => {
      const button = document.body.querySelector('[data-testid="api-key-submit"]') as HTMLButtonElement | null
      button?.click()
      await Promise.resolve()
    })

    expect(localStorage.getItem('hammurabi_api_key')).toBe('bootstrap-key')
    expect(window.location.pathname).toBe('/welcome')
  })

  it('clears stored API key and native instance URL after API-key auth is rejected', async () => {
    vi.stubEnv('VITE_AUTH0_DOMAIN', '')
    vi.stubEnv('VITE_AUTH0_AUDIENCE', '')
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', '')
    localStorage.setItem('hammurabi_api_key', 'expired-mobile-key')
    localStorage.setItem('hammurabi_instance_url', 'https://self.example.com')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 })),
    )

    await renderApp('/welcome')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/401/)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(localStorage.getItem('hammurabi_api_key')).toBeNull()
    expect(localStorage.getItem('hammurabi_instance_url')).toBeNull()
  })

  it('redirects Auth0 users to re-authenticate when silent token recovery fails', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockRejectedValue(
      Object.assign(new Error('login required'), { error: 'login_required' }),
    )
    const fetchMock = vi.fn().mockResolvedValue(healthyGatewayResponse())
    vi.stubGlobal('fetch', fetchMock)

    await renderApp('/command-room?commander=atlas#chat')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/Auth0 session expired/)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/health', { cache: 'no-store' })
    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/command-room?commander=atlas#chat' },
    })
  })

  it('keeps Auth0 recovery inside the app while gateway health is unavailable', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockRejectedValue(
      Object.assign(new Error('login required'), { error: 'login_required' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
    )

    await renderApp('/command-room?commander=atlas#chat')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/Auth0 session expired/)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.loginWithRedirect).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="auth-recovery-unavailable"]')?.textContent)
      .toContain('Hervald is reconnecting')
  })

  it('clears unavailable Auth0 recovery state after the auth session ends', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockRejectedValue(
      Object.assign(new Error('login required'), { error: 'login_required' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
    )

    await renderApp('/command-room?commander=atlas#chat')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/Auth0 session expired/)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.querySelector('[data-testid="auth-recovery-unavailable"]')).not.toBeNull()

    mocks.isAuthenticated = false
    await act(async () => {
      root?.render(<App />)
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.querySelector('[data-testid="auth-recovery-unavailable"]')).toBeNull()
  })

  it('redirects Auth0 users to re-authenticate on API 401 without logging out locally', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockResolvedValue('fresh-token')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/health')) {
          return Promise.resolve(healthyGatewayResponse())
        }
        return Promise.resolve(new Response('{"error":"Unauthorized"}', { status: 401 }))
      }),
    )

    await renderApp('/settings')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/401/)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/settings' },
    })
  })
})
