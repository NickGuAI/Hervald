import { describe, expect, it } from 'vitest'
import {
  ALFRED_COMMANDER_AVATAR_URL,
  ASINA_COMMANDER_AVATAR_URL,
  DEFAULT_COMMANDER_AVATAR_URL,
  EINSTEIN_COMMANDER_AVATAR_URL,
  GAIA_COMMANDER_AVATAR_URL,
  LEGACY_GAIA_COMMANDER_AVATAR_URL,
  profileForApiResponse,
  resolveDefaultCommanderAvatarUrl,
  resolveCommanderAvatarUrl,
  sanitizeUiProfile,
} from '../commander-profile.js'
import { ensureCommanderVisualProfile } from '../commander-visual-profile.js'
import { DEFAULT_COMMANDER_PORTRAIT_STYLE_ID } from '../portrait-styles.js'

describe('sanitizeUiProfile', () => {
  it('accepts current profile fields and drops legacy color identity', () => {
    expect(
      sanitizeUiProfile({
        borderColor: '#1a1a1a',
        accentColor: 'rgb(10, 20, 30)',
        speakingTone: 'Dry wit, concise.',
        avatar: '.memory/avatar.png',
        portraitStyleId: 'designer-toy-3d',
      }),
    ).toEqual({
      speakingTone: 'Dry wit, concise.',
      avatar: '.memory/avatar.png',
      portraitStyleId: 'designer-toy-3d',
    })
  })

  it('returns null when a legacy profile only carries identity colors', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'var(--hv-accent-plum)',
        accentColor: 'var(--hv-accent-pine)',
      }),
    ).toBeNull()
  })

  it('rejects path traversal in avatar', () => {
    expect(
      sanitizeUiProfile({
        avatar: '../../../etc/passwd',
      }),
    ).toEqual(null)
  })

  it('accepts bundled commander avatar assets', () => {
    expect(
      sanitizeUiProfile({
        avatar: GAIA_COMMANDER_AVATAR_URL,
      }),
    ).toEqual({
      avatar: GAIA_COMMANDER_AVATAR_URL,
    })
  })

  it('normalizes the legacy Gaia svg avatar to the bundled png', () => {
    expect(
      sanitizeUiProfile({
        avatar: LEGACY_GAIA_COMMANDER_AVATAR_URL,
      }),
    ).toEqual({
      avatar: GAIA_COMMANDER_AVATAR_URL,
    })
  })

  it('rejects absolute avatar paths outside bundled commander assets', () => {
    expect(
      sanitizeUiProfile({
        avatar: '/etc/passwd',
      }),
    ).toEqual(null)
  })

  it('returns null for legacy-only invalid color fields', () => {
    expect(
      sanitizeUiProfile({
        borderColor: 'url(javascript:alert(1))',
      }),
    ).toEqual(null)
  })
})

describe('ensureCommanderVisualProfile', () => {
  it('does not synthesize color identity for missing profiles', () => {
    expect(ensureCommanderVisualProfile('commander-a', null)).toEqual({})
  })

  it('drops explicit legacy colors while preserving current fields', () => {
    expect(
      ensureCommanderVisualProfile('commander-a', {
        borderColor: 'var(--hv-accent-plum)',
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      speakingTone: 'Dry wit, concise.',
    })
  })

  it('normalizes API profile responses without legacy color identity', () => {
    expect(
      profileForApiResponse('commander-a', {
        speakingTone: 'Dry wit, concise.',
      }),
    ).toEqual({
      portraitStyleId: DEFAULT_COMMANDER_PORTRAIT_STYLE_ID,
      speakingTone: 'Dry wit, concise.',
    })
  })

  it('keeps the bundled default avatar URL stable for fresh installs', () => {
    expect(DEFAULT_COMMANDER_AVATAR_URL).toBe('/assets/commanders/atlas-profile.jpg')
  })

  it('keeps the Gaia bundled avatar URL stable', () => {
    expect(GAIA_COMMANDER_AVATAR_URL).toBe('/assets/commanders/gaia-profile.png')
  })

  it('resolves bundled commander avatar URLs without a commander-local file', async () => {
    await expect(resolveCommanderAvatarUrl(
      '00000000-0000-4000-8000-000000000001',
      '/tmp/hammurabi-test-commanders',
      { avatar: GAIA_COMMANDER_AVATAR_URL },
    )).resolves.toBe(GAIA_COMMANDER_AVATAR_URL)
  })

  it('allows callers to provide a narrower default avatar fallback', async () => {
    await expect(resolveCommanderAvatarUrl(
      '00000000-0000-4000-8000-000000000001',
      '/tmp/hammurabi-test-commanders',
      null,
      { defaultAvatarUrl: GAIA_COMMANDER_AVATAR_URL },
    )).resolves.toBe(GAIA_COMMANDER_AVATAR_URL)
  })

  it('uses bundled stock avatars for known starter package templates', () => {
    expect(resolveDefaultCommanderAvatarUrl({ templateId: 'engineering-manager' }))
      .toBe(ASINA_COMMANDER_AVATAR_URL)
    expect(resolveDefaultCommanderAvatarUrl({ templateId: 'general-assistant' }))
      .toBe(ALFRED_COMMANDER_AVATAR_URL)
    expect(resolveDefaultCommanderAvatarUrl({ templateId: 'research-intelligence-analyst' }))
      .toBe(EINSTEIN_COMMANDER_AVATAR_URL)
  })

  it('keeps Gaia and Atlas fallback behavior for non-stock commanders', () => {
    expect(resolveDefaultCommanderAvatarUrl({ host: 'gaia' })).toBe(GAIA_COMMANDER_AVATAR_URL)
    expect(resolveDefaultCommanderAvatarUrl({ templateId: 'custom-package' }))
      .toBe(DEFAULT_COMMANDER_AVATAR_URL)
  })
})
