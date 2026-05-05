import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { OrgIdentityStore, OrgIdentityValidationError } from './store.js'

export interface OrgIdentityRouterOptions {
  store?: OrgIdentityStore
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

export function createOrgIdentityRouter(options: OrgIdentityRouterOptions = {}): Router {
  const router = Router()
  const store = options.store ?? new OrgIdentityStore()

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
    requiredApiKeyScopes: ['org:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/', requireReadAccess, async (_req, res) => {
    res.json(await store.get())
  })

  router.patch('/', requireWriteAccess, async (req, res) => {
    try {
      res.json(await store.updateName(req.body?.name))
    } catch (error) {
      if (error instanceof OrgIdentityValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      throw error
    }
  })

  return router
}
