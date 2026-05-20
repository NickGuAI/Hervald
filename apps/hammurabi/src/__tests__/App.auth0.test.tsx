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

  it('redirects Auth0 users to re-authenticate when silent token recovery fails', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockRejectedValue(
      Object.assign(new Error('login required'), { error: 'login_required' }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await renderApp('/command-room?commander=atlas#chat')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/Auth0 session expired/)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/command-room?commander=atlas#chat' },
    })
  })

  it('redirects Auth0 users to re-authenticate on API 401 without logging out locally', async () => {
    mocks.isAuthenticated = true
    mocks.getAccessTokenSilently.mockResolvedValue('fresh-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"Unauthorized"}', { status: 401 }),
      ),
    )

    await renderApp('/settings')

    await expect(fetchJson('/api/modules')).rejects.toThrow(/401/)

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/settings' },
    })
  })
})
