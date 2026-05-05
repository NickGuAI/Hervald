import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { AppSettingsStore, normalizeAppTheme } from './store.js'

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

  router.patch('/', requireWriteAccess, async (req, res) => {
    const theme = normalizeAppTheme(req.body?.theme)
    if (!theme) {
      res.status(400).json({ error: 'theme must be "light" or "dark"' })
      return
    }

    res.json({ settings: await store.update({ theme }) })
  })

  return router
}
