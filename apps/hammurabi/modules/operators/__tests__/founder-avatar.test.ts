import { describe, expect, it } from 'vitest'
import { resolveFounderAvatarSrc } from '../founder-avatar'
import type { Operator } from '../types'

function createFounder(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'founder-1',
    kind: 'founder',
    displayName: 'Nick Gu',
    email: 'nick@example.com',
    avatarUrl: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveFounderAvatarSrc', () => {
  it('uses the live avatar preview before stored founder and auth pictures', () => {
    expect(resolveFounderAvatarSrc(
      createFounder({ avatarUrl: 'https://example.com/stored.png' }),
      { user: { picture: 'https://example.com/oauth.png' } },
      { avatarPreview: 'blob:preview' },
    )).toBe('blob:preview')
  })

  it('uses the stored founder avatar before the authenticated user picture', () => {
    expect(resolveFounderAvatarSrc(
      createFounder({ avatarUrl: 'https://example.com/stored.png' }),
      { user: { picture: 'https://example.com/oauth.png' } },
    )).toBe('https://example.com/stored.png')
  })

  it('falls back to the authenticated user picture when the founder avatar is missing', () => {
    expect(resolveFounderAvatarSrc(
      createFounder({ avatarUrl: null }),
      { user: { picture: 'https://example.com/oauth.png' } },
    )).toBe('https://example.com/oauth.png')
  })

  it('reads direct backend AuthUser picture fields for server bootstrap and backfill', () => {
    expect(resolveFounderAvatarSrc(null, {
      picture: 'https://example.com/auth-picture.png',
    })).toBe('https://example.com/auth-picture.png')
  })

  it('normalizes empty strings before applying fallback priority', () => {
    expect(resolveFounderAvatarSrc(
      createFounder({ avatarUrl: '   ' }),
      { user: { picture: '  https://example.com/oauth.png  ' } },
      { avatarPreview: '  ' },
    )).toBe('https://example.com/oauth.png')
  })

  it('reads backend AuthUser metadata picture fields for server bootstrap and backfill', () => {
    expect(resolveFounderAvatarSrc(null, {
      metadata: {
        picture: 'https://example.com/auth-metadata.png',
        avatarUrl: 'https://example.com/auth-avatar-url.png',
      },
    })).toBe('https://example.com/auth-metadata.png')
  })

  it('returns null when all avatar sources are empty', () => {
    expect(resolveFounderAvatarSrc(
      createFounder({ avatarUrl: null }),
      { user: { picture: ' ' } },
    )).toBeNull()
  })
})
