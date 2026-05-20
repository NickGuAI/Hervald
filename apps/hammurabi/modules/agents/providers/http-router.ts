import type { AuthUser } from '@gehirn/auth-providers'
import { Router } from 'express'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { combinedAuth } from '../../../server/middleware/combined-auth.js'
import { listProviders } from './registry.js'
import {
  resolveProviderDefaults,
  type ProviderAdapter,
  type ProviderRegistryEntry,
} from './provider-adapter.js'

const DEFAULT_PROVIDER_ID = 'claude'

export interface ProviderRegistryRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

function providerSupportedTransports(
  provider: ProviderAdapter,
): ProviderRegistryEntry['supportedTransports'] {
  return provider.uiCapabilities.forcedTransport === 'stream'
    ? ['stream']
    : ['stream', 'pty']
}

function toRegistryEntry(provider: ProviderAdapter): ProviderRegistryEntry {
  const availableModels = Array.isArray(provider.availableModels) ? provider.availableModels : []
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
    availableModels: availableModels as ProviderRegistryEntry['availableModels'],
    supportedTransports: providerSupportedTransports(provider),
    defaults: resolveProviderDefaults(provider),
    disabledReason: null,
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
    const providers = listProviders().map(toRegistryEntry)
    res.json({
      defaultProviderId: providers.some((provider) => provider.id === DEFAULT_PROVIDER_ID)
        ? DEFAULT_PROVIDER_ID
        : (providers[0]?.id ?? DEFAULT_PROVIDER_ID),
      providers,
    })
  })

  return router
}
