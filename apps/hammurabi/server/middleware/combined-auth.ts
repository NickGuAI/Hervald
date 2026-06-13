import type { RequestHandler } from 'express'
import { bearerTokenFromHeader, type AuthUser } from '@gehirn/auth-providers'
import { authorizeApiKeyRequest, type ApiKeyAuthOptions } from './auth.js'
import {
  authorizeAuth0Request,
  auth0UserHasRequiredPermissions,
  createAuth0Verifier,
  type Auth0AuthorizationResult,
  type Auth0Options,
} from './auth0.js'
import { secureTokenEqual } from './secure-compare.js'

export interface CombinedAuthOptions extends ApiKeyAuthOptions, Auth0Options {
  requiredApiKeyScopes?: readonly string[]
  /**
   * Browser/Auth0 permissions may be coarser than API-key scopes. When omitted,
   * Auth0 keeps the legacy behavior and uses requiredApiKeyScopes.
   */
  requiredAuth0Permissions?: readonly string[]
  auth0PermissionMode?: 'all' | 'any'
  unconfiguredApiKeyMessage?: string
  optional?: boolean
  /** Server-generated token accepted via `x-hammurabi-internal-token` header. */
  internalToken?: string
  /** Route-local scopes granted only to the internal token synthetic user. */
  internalApiKeyScopes?: readonly string[]
}

export function auth0UserHasCombinedPermissions(
  user: AuthUser,
  options: CombinedAuthOptions,
): boolean {
  const requiredPermissions = options.requiredAuth0Permissions ?? options.requiredApiKeyScopes
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true
  }

  if (options.auth0PermissionMode === 'any') {
    return requiredPermissions.some((permission) =>
      auth0UserHasRequiredPermissions(user, [permission]),
    )
  }

  return auth0UserHasRequiredPermissions(user, requiredPermissions)
}

function internalUserForRoute(options: CombinedAuthOptions): AuthUser {
  const scopes = [...(options.internalApiKeyScopes ?? options.requiredApiKeyScopes ?? [])]
  const permissions = options.requiredAuth0Permissions
    ? [...options.requiredAuth0Permissions]
    : scopes
  return {
    id: 'internal',
    email: 'system',
    metadata: {
      scopes,
      permissions,
    },
  }
}

export function combinedAuth(options: CombinedAuthOptions = {}): RequestHandler {
  const verifyAuth0Token = createAuth0Verifier(options)

  return async (req, res, next) => {
    // Internal server-to-self calls are route-scoped: the synthetic user only
    // receives the scopes declared by this specific middleware instance.
    if (options.internalToken) {
      const provided = req.header('x-hammurabi-internal-token')
      if (secureTokenEqual(provided, options.internalToken)) {
        req.user = internalUserForRoute(options)
        req.authMode = 'api-key'
        next()
        return
      }
    }

    const bearerToken = bearerTokenFromHeader(req.header('authorization'))
    let auth0AttemptResult: Auth0AuthorizationResult | null = null

    if (bearerToken) {
      auth0AttemptResult = await authorizeAuth0Request(req, options, verifyAuth0Token)
      if (auth0AttemptResult.ok) {
        if (!auth0UserHasCombinedPermissions(auth0AttemptResult.user, options)) {
          if (options.optional) {
            next()
            return
          }

          res.status(403).json({ error: 'Insufficient permissions' })
          return
        }

        req.user = auth0AttemptResult.user
        req.authMode = 'auth0'
        next()
        return
      }
    }

    const apiKeyAuthorization = await authorizeApiKeyRequest(req, {
      apiKeyStore: options.apiKeyStore,
      requiredScopes: options.requiredApiKeyScopes,
      unconfiguredMessage: options.unconfiguredApiKeyMessage,
      now: options.now,
    })
    if (apiKeyAuthorization.ok) {
      req.user = apiKeyAuthorization.user
      req.authMode = 'api-key'
      next()
      return
    }

    if (options.optional) {
      next()
      return
    }

    res
      .status(apiKeyAuthorization.status)
      .json({ error: apiKeyAuthorization.error })
  }
}

export function optionalCombinedAuth(
  options: Omit<CombinedAuthOptions, 'optional'> = {},
): RequestHandler {
  return combinedAuth({
    ...options,
    optional: true,
  })
}
