// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgTree } from '@modules/org/types'
import { listChannelProviderDescriptors } from '../descriptors'
import type { CommanderChannelBinding, CommanderChannelProvider } from '../types'

const mocks = vi.hoisted(() => ({
  useOrgTree: vi.fn(),
  fetchJson: vi.fn(),
  fetchVoid: vi.fn(),
}))

vi.mock('@modules/org/hooks/useOrgTree', () => ({
  useOrgTree: mocks.useOrgTree,
}))

vi.mock('@/lib/api', () => ({
  fetchJson: mocks.fetchJson,
  fetchVoid: mocks.fetchVoid,
}))

import ChannelsPage from '../page'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
let bindings: CommanderChannelBinding[] = []
let bindingCounter = 0

function createOrgTree(): OrgTree {
  const operator = {
    id: 'founder-1',
    kind: 'founder' as const,
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: null,
    createdAt: '2026-06-03T00:00:00.000Z',
  }

  return {
    operator,
    orgIdentity: {
      name: 'Gehirn Inc.',
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
    },
    archivedCommandersCount: 0,
    commanders: [
      {
        id: 'cmd-1',
        kind: 'commander' as const,
        parentId: operator.id,
        displayName: 'Atlas',
        avatarUrl: null,
        status: 'active',
        costUsd: 0,
        recentActivityAt: null,
        questsInFlight: { active: 0, pending: 0 },
        channels: {},
        activeUiChats: 0,
        counts: { activeQuests: 0, activeWorkers: 0, activeChats: 0 },
        templateId: null,
        replicatedFromCommanderId: null,
      },
    ],
    automations: [],
  }
}

function createBinding(
  provider: CommanderChannelProvider,
  overrides: Partial<CommanderChannelBinding> = {},
): CommanderChannelBinding {
  bindingCounter += 1
  return {
    id: overrides.id ?? `binding-${bindingCounter}`,
    commanderId: overrides.commanderId ?? 'cmd-1',
    provider,
    accountId: overrides.accountId ?? `${provider}-account`,
    displayName: overrides.displayName ?? provider,
    enabled: overrides.enabled ?? true,
    config: overrides.config ?? { provider },
    createdAt: overrides.createdAt ?? '2026-06-03T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-03T00:00:00.000Z',
  }
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
}

function installApiMock(): void {
  mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (url === '/api/commanders/cmd-1/channels/providers') {
      return {
        providers: listChannelProviderDescriptors({
          commanderId: 'cmd-1',
          bindings,
        }),
      }
    }

    if (url === '/api/commanders/channels/providers') {
      return {
        providers: listChannelProviderDescriptors({
          commanderId: 'cmd-1',
          bindings,
        }),
      }
    }

    if (url === '/api/commanders/cmd-1/channels') {
      if (method === 'POST') {
        const body = parseBody(init)
        const binding = createBinding(String(body.provider) as CommanderChannelProvider, {
          accountId: String(body.accountId ?? ''),
          displayName: String(body.displayName ?? ''),
          config: body.config as CommanderChannelBinding['config'],
        })
        bindings = [...bindings, binding]
        return binding
      }
      return bindings
    }

    if (url === '/api/commanders/cmd-1/channels/pairing' && method === 'POST') {
      return {
        provider: 'whatsapp',
        id: 'challenge-1',
        accountId: 'wa-1',
        state: 'pairing',
        connected: false,
        instructions: 'Scan this QR code with WhatsApp.',
        url: 'data:image/png;base64,qr',
        expiresAt: '2026-06-03T00:05:00.000Z',
      }
    }

    if (url.startsWith('/api/commanders/cmd-1/channels/pairing/challenge-1/status')) {
      return {
        provider: 'whatsapp',
        id: 'challenge-1',
        accountId: 'wa-1',
        state: 'connected',
        connected: true,
        instructions: 'Connected.',
      }
    }

    if (url === '/api/commanders/cmd-1/channels/pairing/challenge-1/complete' && method === 'POST') {
      const body = parseBody(init)
      const binding = createBinding('whatsapp', {
        id: 'binding-whatsapp',
        accountId: String(body.accountId ?? 'wa-1'),
        displayName: String(body.displayName ?? 'WhatsApp'),
        config: body.config as CommanderChannelBinding['config'],
      })
      bindings = [...bindings.filter((entry) => entry.provider !== 'whatsapp'), binding]
      return binding
    }

    if (url === '/api/commanders/cmd-1/channels/binding-whatsapp/status') {
      return {
        provider: 'whatsapp',
        accountId: 'wa-1',
        state: 'connected',
        connected: bindings.some((binding) => binding.id === 'binding-whatsapp' && binding.enabled),
        transport: 'baileys',
      }
    }

    throw new Error(`Unhandled fetchJson URL: ${url}`)
  })

  mocks.fetchVoid.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE' && url.startsWith('/api/commanders/cmd-1/channels/')) {
      const bindingId = decodeURIComponent(url.split('/').at(-1) ?? '')
      bindings = bindings.filter((binding) => binding.id !== bindingId)
      return
    }
    throw new Error(`Unhandled fetchVoid URL: ${url}`)
  })
}

async function renderChannelsPage(): Promise<void> {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/channels']}>
          <Routes>
            <Route path="/channels" element={<ChannelsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

async function clickElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

function getProviderButton(provider: CommanderChannelProvider): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`[data-testid="channel-provider-${provider}"]`)
  if (!button) {
    throw new Error(`Missing provider button: ${provider}`)
  }
  return button
}

function getButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) {
    throw new Error(`Missing button with text: ${text}`)
  }
  return button
}

function getInputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = Array.from(document.body.querySelectorAll<HTMLInputElement>('input'))
    .find((candidate) => candidate.placeholder === placeholder)
  if (!input) {
    throw new Error(`Missing input with placeholder: ${placeholder}`)
  }
  return input
}

beforeEach(() => {
  previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  bindingCounter = 0
  bindings = []
  mocks.useOrgTree.mockReturnValue({
    data: createOrgTree(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
  installApiMock()
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  }
  queryClient?.clear()
  container?.remove()
  document.body.innerHTML = ''
  root = null
  container = null
  queryClient = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  vi.clearAllMocks()
})

describe('ChannelsPage support channel icons', () => {
  it('shows a commander loading state before the org tree has loaded', async () => {
    mocks.useOrgTree.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    await renderChannelsPage()

    expect(document.body.textContent).toContain('Loading commanders...')
    expect(document.body.textContent).not.toContain('Failed to load commanders')
  })

  it('shows commander tree errors with a retry action', async () => {
    const refetch = vi.fn()
    mocks.useOrgTree.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('org tree unavailable'),
      refetch,
    })

    await renderChannelsPage()

    expect(document.body.textContent).toContain('Failed to load commanders')
    expect(document.body.textContent).toContain('org tree unavailable')

    await clickElement(getButtonByText('Retry'))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows commander-scoped query errors instead of empty providers or bindings', async () => {
    mocks.fetchJson.mockImplementation(async (url: string) => {
      if (url === '/api/commanders/cmd-1/channels/providers') {
        throw new Error('provider scope unavailable')
      }
      if (url === '/api/commanders/cmd-1/channels') {
        throw new Error('binding scope unavailable')
      }
      if (url === '/api/commanders/channels/providers') {
        return { providers: [] }
      }
      throw new Error(`Unhandled fetchJson URL: ${url}`)
    })

    await renderChannelsPage()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Failed to load channel providers')
    })
    expect(document.body.textContent).toContain('provider scope unavailable')
    expect(document.body.textContent).toContain('Retry')

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Failed to load channel bindings')
    })
    expect(document.body.textContent).toContain('binding scope unavailable')
    expect(document.body.textContent).toContain('Retry')
    expect(document.body.textContent).not.toContain('(no channel providers)')
    expect(document.body.textContent).not.toContain('(no channel bindings)')
  })

  it('renders accessible provider icon buttons beneath the selected commander with connected styling', async () => {
    bindings = [
      createBinding('email', {
        id: 'binding-email',
        accountId: 'assistant@example.com',
        displayName: 'Assistant Email',
      }),
      createBinding('whatsapp', {
        id: 'binding-disabled-whatsapp',
        accountId: 'wa-disabled',
        displayName: 'Dormant WhatsApp',
        enabled: false,
      }),
    ]

    await renderChannelsPage()

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="channel-provider-strip"]')).not.toBeNull()
    })

    const providerButtons = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button[data-testid^="channel-provider-"]'),
    )
    expect(providerButtons).toHaveLength(5)
    expect(document.body.querySelector('[data-testid="channel-provider-strip"]')?.closest('section')?.textContent)
      .toContain('Atlas')

    const emailButton = getProviderButton('email')
    const whatsappButton = getProviderButton('whatsapp')

    expect(emailButton.dataset.connected).toBe('true')
    expect(emailButton.className).toContain('--hv-accent-success')
    expect(emailButton.querySelector('svg')).not.toBeNull()
    expect(whatsappButton.dataset.connected).toBe('false')
    expect(whatsappButton.className).toContain('border-ink-border')

    for (const button of providerButtons) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('aria-label')).toContain('Open pairing and configuration')
    }
  })

  it('opens the descriptor-driven pairing flow in a modal when a provider icon is clicked', async () => {
    await renderChannelsPage()

    await vi.waitFor(() => {
      expect(getProviderButton('whatsapp')).not.toBeNull()
    })

    await clickElement(getProviderButton('whatsapp'))

    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"][aria-label="Pair WhatsApp"]')).not.toBeNull()
    })

    expect(getProviderButton('whatsapp').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('QR Timeout Seconds')
    expect(document.body.textContent).toContain('baileys')
    expect(document.body.textContent).toContain('Not connected')
    expect(getButtonByText('Start Pairing')).not.toBeNull()
  })

  it('refreshes the icon status after pairing completes and after disconnecting', async () => {
    await renderChannelsPage()

    await vi.waitFor(() => {
      expect(getProviderButton('whatsapp').dataset.connected).toBe('false')
    })

    await clickElement(getProviderButton('whatsapp'))
    await changeInput(getInputByPlaceholder("Nick's WhatsApp"), "Nick's WhatsApp")
    await clickElement(getButtonByText('Start Pairing'))

    await vi.waitFor(() => {
      expect(mocks.fetchJson).toHaveBeenCalledWith(
        '/api/commanders/cmd-1/channels/pairing/challenge-1/complete',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await vi.waitFor(() => {
      expect(getProviderButton('whatsapp').dataset.connected).toBe('true')
    })

    const removeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="Remove Nick\\\'s WhatsApp"]')
    expect(removeButton).not.toBeNull()
    await clickElement(removeButton as HTMLButtonElement)

    await vi.waitFor(() => {
      expect(getProviderButton('whatsapp').dataset.connected).toBe('false')
    })
  })
})
