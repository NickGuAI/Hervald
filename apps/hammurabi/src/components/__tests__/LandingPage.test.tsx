// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loginWithRedirect: vi.fn(),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    loginWithRedirect: mocks.loginWithRedirect,
    isLoading: false,
  }),
}))

import { LandingPage } from '../LandingPage'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderLanding(path: string) {
  window.history.replaceState({}, document.title, path)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<LandingPage />)
    await Promise.resolve()
  })
}

async function clickSignIn() {
  let button: HTMLButtonElement | null = null
  await vi.waitFor(() => {
    button = Array.from(container?.querySelectorAll('button') ?? [])
      .find((candidate) => candidate.textContent?.trim() === 'Sign in') ?? null
    if (!button) {
      throw new Error('Missing sign in button')
    }
  })
  if (!button) {
    throw new Error('Missing sign in button')
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('LandingPage', () => {
  beforeEach(() => {
    mocks.loginWithRedirect.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ version: 'dev' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
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
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('defaults Auth0 sign-in return path to org', async () => {
    await renderLanding('/')
    await clickSignIn()

    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/org' },
    })
  })

  it('preserves deliberate deep links for Auth0 sign-in', async () => {
    await renderLanding('/command-room?commander=gaia')
    await clickSignIn()

    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/command-room?commander=gaia' },
    })
  })

  it('does not leave the app for Auth0 sign-in while gateway health is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })))

    await renderLanding('/command-room?commander=gaia')
    await clickSignIn()

    expect(mocks.loginWithRedirect).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Hervald is reconnecting')
  })

  it('allows Auth0 sign-in when the health probe is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await renderLanding('/command-room?commander=gaia')
    await clickSignIn()

    expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/command-room?commander=gaia' },
    })
  })
})
