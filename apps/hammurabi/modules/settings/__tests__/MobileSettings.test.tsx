import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useFounderProfile: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@modules/operators/hooks/useFounderProfile', () => ({
  useFounderProfile: mocks.useFounderProfile,
}))

vi.mock('@modules/telemetry/components/TelemetryPreviewCard', () => ({
  default: () => createElement('div', { 'data-testid': 'telemetry-preview' }, 'TelemetryPreview'),
}))

import { MobileSettings } from '../MobileSettings'

describe('MobileSettings', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset()
    mocks.useFounderProfile.mockReset()
  })

  it('prefers the persisted founder profile over the transient auth user identity', () => {
    mocks.useAuth.mockReturnValue({
      signOut: vi.fn(),
      user: {
        name: 'Google Oauth2 106050570920402391077',
        email: 'google-oauth2|106050570920402391077@auth0.local',
        picture: 'https://example.com/auth0.png',
      },
    })
    mocks.useFounderProfile.mockReturnValue({
      data: {
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: '/api/operators/founder/avatar',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    })

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MobileSettings),
      ),
    )

    expect(html).toContain('Nick Gu')
    expect(html).toContain('nick@example.com')
    expect(html).toContain('/api/operators/founder/avatar')
    expect(html).not.toContain('Google Oauth2 106050570920402391077')
  })
})
