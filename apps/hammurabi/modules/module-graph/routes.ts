import { Router } from 'express'
import type { AuthUser } from '@gehirn/auth-providers'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import type { LoadedHammurabiModuleGraph } from '../../server/module-loader.js'
import type { ProviderRegistryCapability } from '../../server/module-runtime-capabilities.js'
import type {
  HammurabiModuleGraphModule,
  HammurabiModuleGraphResponse,
  HammurabiProviderGraphSummary,
} from '../../src/types/module-graph-api.js'

export interface ModuleGraphRouterOptions {
  moduleGraph: LoadedHammurabiModuleGraph
  providerRegistry: ProviderRegistryCapability
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
}

function toModuleGraphModule(manifest: LoadedHammurabiModuleGraph['manifests'][number]): HammurabiModuleGraphModule {
  return {
    id: manifest.graph.id,
    label: manifest.graph.label,
    status: manifest.graph.status,
    summary: manifest.graph.summary,
    capabilities: {
      provides: manifest.graph.capabilities.provides,
      consumes: manifest.graph.capabilities.consumes,
    },
    dependencies: {
      modules: manifest.graph.dependencies.modules,
      capabilities: manifest.graph.dependencies.capabilities,
    },
    ui: {
      kind: manifest.graph.ui.kind,
      routes: manifest.graph.ui.routes.map((route) => ({
        id: route.id,
        path: route.path,
        componentKey: route.componentKey,
        surfaces: route.surfaces,
        ...(route.metadata ? { metadata: route.metadata } : {}),
      })),
      redirects: manifest.graph.ui.redirects?.map((redirect) => ({
        id: redirect.id,
        from: redirect.from,
        ...(redirect.toRouteId ? { toRouteId: redirect.toRouteId } : {}),
        ...(redirect.toPath ? { toPath: redirect.toPath } : {}),
      })),
      surfaces: manifest.graph.ui.surfaces,
    },
  }
}

function providerSummaries(providerRegistry: ProviderRegistryCapability): HammurabiProviderGraphSummary[] {
  return providerRegistry.listProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    eventProvider: provider.eventProvider,
    capabilities: {
      supportsAutomation: provider.capabilities.supportsAutomation,
      supportsCommanderConversation: provider.capabilities.supportsCommanderConversation,
      supportsWorkerDispatch: provider.capabilities.supportsWorkerDispatch,
      supportsMessageImages: provider.capabilities.supportsMessageImages,
    },
    modelIds: provider.availableModels.map((model) => model.id),
    ...(provider.machineAuth
      ? {
          machineAuth: {
            cliBinaryName: provider.machineAuth.cliBinaryName,
            supportedAuthModes: [...provider.machineAuth.supportedAuthModes],
            requiresSecretModes: provider.machineAuth.supportedAuthModes.filter((mode) => (
              provider.machineAuth?.modeRequiresSecret(mode)
            )),
          },
        }
      : {}),
  }))
}

export function createModuleGraphRouter(options: ModuleGraphRouterOptions): Router {
  const router = Router()
  // This endpoint is the authenticated app bootstrap contract. Keep it scoped
  // to valid users/API keys, but do not tie route discovery to one feature's
  // permission such as agents:read.
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    unconfiguredApiKeyMessage: 'Module graph API key is not configured',
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/', requireReadAccess, (_req, res) => {
    const graph = options.moduleGraph
    const modules = graph.manifests.map(toModuleGraphModule)
    const response: HammurabiModuleGraphResponse = {
      modules,
      routes: graph.mountPlan.routes.map((route) => ({
        id: route.id,
        moduleId: route.ownerModuleId,
        surface: route.surface,
        mount: route.mount,
        methods: route.methods,
        auth: route.auth,
        parserIds: route.parserIds ?? [],
      })),
      parsers: graph.mountPlan.parsers.map((parser) => ({
        id: parser.id,
        moduleId: parser.ownerModuleId,
        kind: parser.kind,
        mount: parser.mount,
        ...(parser.limit ? { limit: parser.limit } : {}),
      })),
      websockets: graph.mountPlan.websockets.map((websocket) => ({
        id: websocket.id,
        moduleId: websocket.ownerModuleId,
        path: websocket.path,
        match: websocket.match,
        auth: websocket.auth,
      })),
      storage: graph.mountPlan.storage.map((entry) => ({
        moduleId: entry.ownerModuleId,
        kind: entry.kind,
        keys: entry.keys,
        sharedWith: entry.sharedWith ?? [],
      })),
      nav: modules.flatMap((module) => {
        const manifest = graph.manifestById.get(module.id)
        if (!manifest) {
          return []
        }

        return manifest.graph.ui.routes.flatMap((route) => {
          if (!route.nav) {
            return []
          }

          return [{
            moduleId: manifest.graph.id,
            routeId: route.id,
            path: route.path,
            label: route.nav.label,
            icon: route.nav.icon,
            group: route.nav.group,
            hidden: route.nav.hidden ?? false,
            surfaces: route.nav.surfaces ?? route.surfaces,
            ...(typeof route.nav.order === 'number' ? { order: route.nav.order } : {}),
          }]
        })
      }),
      providers: providerSummaries(options.providerRegistry),
    }

    res.json(response)
  })

  return router
}
