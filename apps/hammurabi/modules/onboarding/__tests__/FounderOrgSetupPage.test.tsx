// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import { FounderOrgSetupPage } from '../FounderOrgSetupPage'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function flushReact() {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/welcome']}>
          <AuthProvider signOut={() => {}} user={undefined}>
            <Routes>
              <Route path="/welcome" element={<FounderOrgSetupPage />} />
              <Route path="/org" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await flushReact()
}

function getInput(testId: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
  if (!input) {
    throw new Error(`Missing input ${testId}`)
  }
  return input
}

async function setInputValue(testId: string, value: string) {
  const input = getInput(testId)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flushReact()
}

async function clickSubmit(times: number = 1) {
  const form = document.body.querySelector<HTMLFormElement>('[data-testid="founder-org-setup-form"]')
  if (!form) {
    throw new Error('Missing setup form')
  }

  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
  })
  await flushReact()
}

describe('FounderOrgSetupPage', () => {
  beforeEach(() => {
    mocks.fetchJson.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      await flushReact()
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('submits founder and org setup, then routes to the org first-run flow', async () => {
    mocks.fetchJson.mockResolvedValue({
      operator: {
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: null,
        createdAt: '2026-05-05T00:00:00.000Z',
      },
      orgIdentity: {
        name: 'Gehirn Inc.',
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    })

    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick@example.com')
    await clickSubmit()

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledTimes(1)
    })

    expect(mocks.fetchJson).toHaveBeenCalledWith('/api/org', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }))
    const request = mocks.fetchJson.mock.calls[0]?.[1] as { body?: string }
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      displayName: 'Gehirn Inc.',
      founder: {
        displayName: 'Nick Gu',
        email: 'nick@example.com',
      },
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/org?firstRun=true')
    })
  })

  it('shows inline validation errors and blocks invalid submission', async () => {
    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick-at-example.com')
    await clickSubmit()

    expect(document.body.textContent).toContain('Founder email must be a valid email address.')
    expect(mocks.fetchJson).not.toHaveBeenCalled()
  })

  it('locks duplicate clicks so double-submit only issues one POST', async () => {
    let resolveRequest: ((value: unknown) => void) | null = null
    mocks.fetchJson.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve
    }))

    await renderPage()
    await setInputValue('org-display-name-input', 'Gehirn Inc.')
    await setInputValue('founder-display-name-input', 'Nick Gu')
    await setInputValue('founder-email-input', 'nick@example.com')
    await clickSubmit(2)

    expect(mocks.fetchJson).toHaveBeenCalledTimes(1)

    resolveRequest?.({
      operator: {
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: null,
        createdAt: '2026-05-05T00:00:00.000Z',
      },
      orgIdentity: {
        name: 'Gehirn Inc.',
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="location"]')?.textContent).toBe('/org?firstRun=true')
    })
  })
})
