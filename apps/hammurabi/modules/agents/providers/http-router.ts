import type { AuthUser } from '@gehirn/auth-providers'
import { Router } from 'express'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { combinedAuth } from '../../../server/middleware/combined-auth.js'
import { listProviders } from './registry.js'
import type {
  ProviderAdapter,
  ProviderRegistryEntry,
} from './provider-adapter.js'

export interface ProviderRegistryRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

function toRegistryEntry(provider: ProviderAdapter): ProviderRegistryEntry {
  return {
    id: provider.id,
    label: provider.label,
    eventProvider: provider.eventProvider,
    capabilities: {
      ...provider.capabilities,
    },
    uiCapabilities: {
      ...provider.uiCapabilities,
      permissionModes: provider.uiCapabilities.permissionModes.map((mode) => ({ ...mode })),
      ...(provider.uiCapabilities.infoBanner
        ? { infoBanner: { ...provider.uiCapabilities.infoBanner } }
        : {}),
    },
    ...(provider.machineAuth
      ? {
          machineAuth: {
            cliBinaryName: provider.machineAuth.cliBinaryName,
            ...(provider.machineAuth.installPackageName
              ? { installPackageName: provider.machineAuth.installPackageName }
              : {}),
            authEnvKeys: [...provider.machineAuth.authEnvKeys],
            supportedAuthModes: [...provider.machineAuth.supportedAuthModes],
            requiresSecretModes: provider.machineAuth.supportedAuthModes
              .filter((mode) => provider.machineAuth?.modeRequiresSecret(mode)),
            loginStatusCommand: provider.machineAuth.loginStatusCommand,
          },
        }
      : {}),
  }
}

export function createProviderRegistryRouter(
  options: ProviderRegistryRouterOptions = {},
): Router {
  const router = Router()
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/providers', requireReadAccess, (_req, res) => {
    res.json({
      providers: listProviders().map(toRegistryEntry),
    })
  })

  return router
}
