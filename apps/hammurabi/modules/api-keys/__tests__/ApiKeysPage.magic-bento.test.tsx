// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useApiKeys: vi.fn(),
  useCreateApiKey: vi.fn(),
  useCreateMobileAccessInvite: vi.fn(),
  useRevokeApiKey: vi.fn(),
  useOpenAITranscriptionSettings: vi.fn(),
  useGeminiImageGenerationSettings: vi.fn(),
  useSetOpenAITranscriptionKey: vi.fn(),
  useClearOpenAITranscriptionKey: vi.fn(),
  useSetGeminiImageGenerationKey: vi.fn(),
  useClearGeminiImageGenerationKey: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/hooks/use-api-keys', () => ({
  useApiKeys: mocks.useApiKeys,
  useCreateApiKey: mocks.useCreateApiKey,
  useCreateMobileAccessInvite: mocks.useCreateMobileAccessInvite,
  useRevokeApiKey: mocks.useRevokeApiKey,
  useOpenAITranscriptionSettings: mocks.useOpenAITranscriptionSettings,
  useGeminiImageGenerationSettings: mocks.useGeminiImageGenerationSettings,
  useSetOpenAITranscriptionKey: mocks.useSetOpenAITranscriptionKey,
  useClearOpenAITranscriptionKey: mocks.useClearOpenAITranscriptionKey,
  useSetGeminiImageGenerationKey: mocks.useSetGeminiImageGenerationKey,
  useClearGeminiImageGenerationKey: mocks.useClearGeminiImageGenerationKey,
}))

vi.mock('../components/AccountProfileCard', () => ({
  AccountProfileCard: () => <form data-testid="account-profile-card">Account Profile</form>,
}))

vi.mock('@modules/org-identity/components/OrgIdentityCard', () => ({
  OrgIdentityCard: () => <form data-testid="org-identity-card">Org Identity</form>,
}))

vi.mock('@modules/agents/components/ProviderAuthPanel', () => ({
  ProviderAuthPanel: () => <section data-testid="provider-auth-panel">Provider Auth</section>,
}))

vi.mock('qrcode', () => {
  const toDataURL = vi.fn(async (payload: string) => `data:image/png;base64,${payload}`)
  return {
    default: { toDataURL },
    toDataURL,
  }
})

import ApiKeysPage from '../page'

let root: Root | null = null
let container: HTMLDivElement | null = null

function resetHookMocks() {
  mocks.useAuth.mockReturnValue({
    signOut: vi.fn(),
    user: { name: 'Nick Gu', email: 'nick@example.com' },
  })
  mocks.useApiKeys.mockReturnValue({
    data: [
      {
        id: 'key-1',
        name: 'Telemetry Ingest',
        prefix: 'hmrb_live',
        createdBy: 'Nick',
        createdAt: '2026-05-01T00:00:00.000Z',
        lastUsedAt: null,
        scopes: ['agents:read'],
      },
    ],
    isLoading: false,
    error: null,
  })
  mocks.useCreateApiKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useCreateMobileAccessInvite.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useRevokeApiKey.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useOpenAITranscriptionSettings.mockReturnValue({
    data: { configured: true, updatedAt: '2026-05-01T00:00:00.000Z' },
    error: null,
  })
  mocks.useGeminiImageGenerationSettings.mockReturnValue({
    data: { configured: false, updatedAt: null },
    error: null,
  })
  mocks.useSetOpenAITranscriptionKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useClearOpenAITranscriptionKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useSetGeminiImageGenerationKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
  mocks.useClearGeminiImageGenerationKey.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })
}

describe('ApiKeysPage MagicBento settings layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHookMocks()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
  })

  it('renders settings sections inside the Sumi-e MagicBento grid with desktop spans', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<ApiKeysPage />)
      await Promise.resolve()
    })

    expect(document.querySelector('[data-testid="settings-magic-bento"]')?.className).toContain('hv-magic-bento')
    expect(document.querySelector('[data-testid="settings-bento-org"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-account"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-provider-auth"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-transcription"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-image-generation"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-mobile-access"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-managed-keys"]')?.getAttribute('data-bento-span')).toBe('6')
    expect(document.querySelector('[data-testid="settings-bento-sign-out"]')?.getAttribute('data-bento-span')).toBe('3')
    expect(document.querySelector('[data-testid="settings-bento-create-key"]')?.getAttribute('data-bento-span')).toBe('9')
    expect(document.body.textContent).toContain('Mobile Access')
    expect(document.body.textContent).toContain('agents:read')
    expect(document.body.textContent).toContain('commanders:write')
    expect(document.body.textContent).toContain('services:write')
    expect(document.body.textContent).toContain('telemetry:read')
    expect(document.body.textContent).toContain('Provider Auth')
    expect(document.body.textContent).toContain('Managed Keys')
    expect(document.body.textContent).toContain('Create Key')

    const expirySelect = document.querySelector(
      '[data-testid="mobile-access-expiry-select"]',
    ) as HTMLSelectElement | null
    expect(expirySelect).not.toBeNull()
    expect(Array.from(expirySelect?.options ?? []).map((option) => option.value)).toEqual([
      '',
      '900',
      '3600',
      '21600',
      '86400',
    ])
  })

  it('generates and displays a copyable mobile access invite from the selected expiry', async () => {
    const createMobileInvite = vi.fn(async () => ({
      invite: 'hmrb_mobile_invite',
      qrPayload: 'hmrb_mobile_invite',
      expiresAt: '2026-06-02T02:00:00.000Z',
      scopes: [
        'agents:read',
        'agents:write',
        'commanders:read',
        'commanders:write',
        'services:read',
        'services:write',
        'skills:read',
        'telemetry:read',
      ],
      instanceUrl: 'https://hervald.gehirn.ai',
      keyPrefix: 'hmrb_mobile',
    }))
    mocks.useCreateMobileAccessInvite.mockReturnValue({
      mutateAsync: createMobileInvite,
      isPending: false,
      error: null,
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<ApiKeysPage />)
      await Promise.resolve()
    })

    const expirySelect = document.querySelector(
      '[data-testid="mobile-access-expiry-select"]',
    ) as HTMLSelectElement
    await act(async () => {
      expirySelect.value = '21600'
      expirySelect.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const form = document.querySelector('[data-testid="mobile-access-form"]') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(createMobileInvite).toHaveBeenCalledWith({
      expiresInSeconds: 21600,
      scopes: [
        'agents:read',
        'agents:write',
        'commanders:read',
        'commanders:write',
        'services:read',
        'services:write',
        'skills:read',
        'telemetry:read',
      ],
    })
    expect(document.body.textContent).toContain('hmrb_mobile_invite')
    expect(document.body.textContent).toContain('https://hervald.gehirn.ai')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (document.querySelector('img[alt="Mobile access pairing QR"]')) break
      await act(async () => {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    expect(document.querySelector('img[alt="Mobile access pairing QR"]')).not.toBeNull()
  })
})
