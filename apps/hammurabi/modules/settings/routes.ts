import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { AppSettingsStore, normalizeAppFontScale, normalizeAppTheme } from './store.js'
import { buildMobileSettingsDto } from './mobile-settings-dtos.js'
import { normalizeComposerAbilitySettingsPatch } from './composer-abilities.js'
import { normalizeComposerSkillSlotSettingsPatch } from './composer-skill-slots.js'

export interface SettingsRouterOptions {
  store?: AppSettingsStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

export function createSettingsRouter(options: SettingsRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new AppSettingsStore()
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['commanders:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/', requireReadAccess, async (_req, res) => {
    res.json({ settings: await store.get() })
  })

  router.get('/mobile', requireReadAccess, (_req, res) => {
    res.json(buildMobileSettingsDto())
  })

  router.patch('/', requireWriteAccess, async (req, res) => {
    const body = typeof req.body === 'object' && req.body !== null
      ? req.body as Record<string, unknown>
      : {}
    const patch: Parameters<AppSettingsStore['update']>[0] = {}
    const hasTheme = Object.prototype.hasOwnProperty.call(body, 'theme')
    const hasFontScale = Object.prototype.hasOwnProperty.call(body, 'fontScale')
    const hasComposerAbilities = Object.prototype.hasOwnProperty.call(body, 'composerAbilities')
    const hasComposerSkillSlots = Object.prototype.hasOwnProperty.call(body, 'composerSkillSlots')

    if (hasTheme) {
      const theme = normalizeAppTheme(body.theme)
      if (!theme) {
        res.status(400).json({ error: 'theme must be "light" or "dark"' })
        return
      }
      patch.theme = theme
    }

    if (hasFontScale) {
      const fontScale = normalizeAppFontScale(body.fontScale)
      if (fontScale === null) {
        res.status(400).json({ error: 'fontScale must be a number between 0.8 and 1.6' })
        return
      }
      patch.fontScale = fontScale
    }

    if (hasComposerAbilities) {
      const composerAbilities = normalizeComposerAbilitySettingsPatch(body.composerAbilities)
      if (!composerAbilities.ok) {
        res.status(400).json({ error: composerAbilities.error })
        return
      }
      patch.composerAbilities = composerAbilities.patch
    }

    if (hasComposerSkillSlots) {
      const composerSkillSlots = normalizeComposerSkillSlotSettingsPatch(body.composerSkillSlots)
      if (!composerSkillSlots.ok) {
        res.status(400).json({ error: composerSkillSlots.error })
        return
      }
      patch.composerSkillSlots = composerSkillSlots.patch
    }

    if (!hasTheme && !hasFontScale && !hasComposerAbilities && !hasComposerSkillSlots) {
      res.status(400).json({
        error: 'settings patch must include theme, fontScale, composerAbilities, or composerSkillSlots',
      })
      return
    }

    res.json({ settings: await store.update(patch) })
  })

  return router
}
