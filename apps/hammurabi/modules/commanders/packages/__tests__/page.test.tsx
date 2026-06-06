// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
}))

import CommanderPackagesPage from '../page'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  mocks.fetchJson.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
  vi.clearAllMocks()
})

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/marketplace']}>
          <CommanderPackagesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('CommanderPackagesPage', () => {
  it('renders package stock avatar previews when the marketplace response includes them', async () => {
    mocks.fetchJson.mockResolvedValue({
      packages: [
        {
          id: 'engineering-manager',
          version: '1.0.0',
          displayName: 'Asina',
          role: 'Engineering Manager',
          summary: 'Owns delivery.',
          description: 'Keeps engineering work moving.',
          skills: [],
          automations: [
            {
              id: 'issue-triage-sweep',
              label: 'Issue triage sweep',
              purpose: 'Review open engineering issues.',
              trigger: 'schedule',
              schedule: '0 15 * * 1-5',
              status: 'paused',
            },
          ],
          examples: [],
          onboarding: 'Open the commander and start with the current project.',
          uiProfile: {
            avatar: '/assets/commanders/asina-profile.svg',
          },
          installState: {
            installed: false,
            commanderId: null,
            displayName: null,
          },
        },
      ],
    })

    await renderPage()

    await vi.waitFor(() => {
      expect(document.querySelector('img[alt="Asina stock avatar"]')?.getAttribute('src'))
        .toBe('/assets/commanders/asina-profile.svg')
      expect(document.body.textContent).toContain('Issue triage sweep')
      expect(document.body.textContent).toContain('0 15 * * 1-5 - Review open engineering issues.')
    })
  })

  it('routes installed commander cards to the command room', async () => {
    mocks.fetchJson.mockResolvedValue({
      packages: [
        {
          id: 'engineering-manager',
          version: '1.0.0',
          displayName: 'Asina',
          role: 'Engineering Manager',
          summary: 'Owns delivery.',
          description: 'Keeps engineering work moving.',
          skills: [
            {
              id: 'engineering-review',
              label: 'Engineering Review',
              required: true,
              purpose: 'Review changes.',
            },
          ],
          automations: [],
          examples: [],
          onboarding: 'Open the commander and start with the current project.',
          uiProfile: {
            avatar: '/assets/commanders/asina-profile.svg',
          },
          installState: {
            installed: true,
            commanderId: 'cmd-asina',
            displayName: 'Asina',
          },
        },
      ],
    })

    await renderPage()

    let link: HTMLAnchorElement | undefined
    await vi.waitFor(() => {
      link = Array.from(document.querySelectorAll('a'))
        .find((anchor) => anchor.textContent?.trim() === 'Open Commander')
      expect(link).not.toBeUndefined()
    })
    expect(link?.getAttribute('href')).toBe('/command-room?commander=cmd-asina')
  })

  it('reserves mobile bottom-nav space for marketplace install actions', async () => {
    mocks.fetchJson.mockResolvedValue({
      packages: [],
    })

    await renderPage()

    const styleText = document.querySelector('style')?.textContent ?? ''
    expect(styleText).toContain('@media (max-width: 767px)')
    expect(styleText).toContain('padding: 18px 16px calc(7rem + env(safe-area-inset-bottom, 0px))')
    expect(styleText).toContain('scroll-margin-bottom: calc(7rem + env(safe-area-inset-bottom, 0px))')
  })
})
