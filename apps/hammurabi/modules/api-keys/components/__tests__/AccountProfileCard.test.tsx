// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useFounderProfile: vi.fn(),
  useUpdateFounderProfile: vi.fn(),
  useUploadFounderAvatar: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@modules/operators/hooks/useFounderProfile', () => ({
  useFounderProfile: mocks.useFounderProfile,
  useUpdateFounderProfile: mocks.useUpdateFounderProfile,
  useUploadFounderAvatar: mocks.useUploadFounderAvatar,
}))

import { AccountProfileCard } from '../AccountProfileCard'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null
let originalCreateObjectUrl: typeof URL.createObjectURL | undefined
let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined

describe('AccountProfileCard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    originalCreateObjectUrl = URL.createObjectURL
    originalRevokeObjectUrl = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:founder-avatar-preview')
    URL.revokeObjectURL = vi.fn()

    mocks.useAuth.mockReset()
    mocks.useFounderProfile.mockReset()
    mocks.useUpdateFounderProfile.mockReset()
    mocks.useUploadFounderAvatar.mockReset()
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
    URL.createObjectURL = originalCreateObjectUrl as typeof URL.createObjectURL
    URL.revokeObjectURL = originalRevokeObjectUrl as typeof URL.revokeObjectURL
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    vi.clearAllMocks()
  })

  it('submits the founder profile form with the current name and selected avatar', async () => {
    const founder = {
      id: 'founder-1',
      kind: 'founder' as const,
      displayName: 'Nick Gu',
      email: 'nick@example.com',
      avatarUrl: '/api/operators/founder/avatar',
      createdAt: '2026-05-01T00:00:00.000Z',
    }
    const updateMutateAsync = vi.fn(async ({ displayName }: { displayName: string }) => ({
      ...founder,
      displayName,
    }))
    const uploadMutateAsync = vi.fn(async () => ({
      avatarUrl: '/api/operators/founder/avatar',
    }))

    mocks.useAuth.mockReturnValue({
      signOut: vi.fn(),
      user: {
        name: 'Google Oauth2 106050570920402391077',
        email: 'google-oauth2|106050570920402391077@auth0.local',
      },
    })
    mocks.useFounderProfile.mockReturnValue({
      data: founder,
      error: null,
    })
    mocks.useUpdateFounderProfile.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    })
    mocks.useUploadFounderAvatar.mockReturnValue({
      mutateAsync: uploadMutateAsync,
      isPending: false,
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<AccountProfileCard />)
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="account-profile-display-name"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="account-profile-avatar-input"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="account-profile-save-button"]')).not.toBeNull()
    })

    const displayNameInput = document.body.querySelector<HTMLInputElement>('[data-testid="account-profile-display-name"]')
    const avatarInput = document.body.querySelector<HTMLInputElement>('[data-testid="account-profile-avatar-input"]')
    const saveButton = document.body.querySelector<HTMLButtonElement>('[data-testid="account-profile-save-button"]')

    const avatarFile = new File(['avatar-bytes'], 'founder.png', { type: 'image/png' })
    await act(async () => {
      if (!avatarInput) {
        throw new Error('Missing avatar input')
      }

      Object.defineProperty(avatarInput, 'files', {
        configurable: true,
        value: [avatarFile],
      })
      avatarInput.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      saveButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateMutateAsync).toHaveBeenCalledWith({
      displayName: 'Nick Gu',
    })
    expect(uploadMutateAsync).toHaveBeenCalledWith({
      file: avatarFile,
    })
  })
})
