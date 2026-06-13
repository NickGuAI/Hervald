import type { Router } from 'express'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AgentSessionMonitorOptions } from '@gehirn/ai-services'
import type { AppSettingsStore } from '../modules/settings/store.js'
import type {
  ApiKeyJsonStore,
  ApiKeyStoreLike,
} from './api-keys/store.js'
import type { ProviderSecretsStoreLike } from './api-keys/provider-secrets-store.js'
import type { OpenAITranscriptionKeyStoreLike } from './api-keys/transcription-store.js'
import {
  HammurabiModuleLoaderError,
  type HammurabiCapabilityContainer,
  type LoadedHammurabiModuleGraph,
} from './module-loader.js'
import type { HammurabiRuntimeCapabilities } from './module-runtime-capabilities.js'
import type { HammurabiRouteDeclaration } from '../src/types/module-manifest.js'

export interface HammurabiModule {
  name: string
  label: string
  routePrefix: string
  router: Router
  handleUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  shutdown?: () => Promise<void> | void
}

export interface ModuleRegistryOptions {
  apiKeyStore?: ApiKeyStoreLike
  providerSecretsStore?: ProviderSecretsStoreLike
  transcriptionKeyStore?: OpenAITranscriptionKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  /** Max concurrent agent sessions (default 10). Set via HAMMURABI_MAX_AGENT_SESSIONS. */
  maxAgentSessions?: number
  appSettingsStore?: AppSettingsStore
  /** Disable agent session recovery and pruner loops for preflight candidates. */
  initializeAgentSessionRuntimes?: boolean
  /** Disable background scheduler boot in route-level tests that only need registry wiring. */
  initializeAutomationScheduler?: boolean
  /** Disable channel adapter runtimes when a process is only a preflight/API candidate. */
  initializeChannelRuntimes?: boolean
}

export interface ModuleRuntimeContext {
  readonly options: ModuleRegistryOptions
  readonly moduleGraph: LoadedHammurabiModuleGraph
  readonly capabilities: HammurabiCapabilityContainer<HammurabiRuntimeCapabilities>
  readonly internalToken: string
  readonly commandRoomMonitorOptions: AgentSessionMonitorOptions
}

export type ModuleMountStrategy =
  | 'common-static-prefix'
  | 'static-parent'

export interface ModuleRouteRegistration {
  name: string
  routeIds: readonly string[]
  router: Router
  label?: string
  mountStrategy?: ModuleMountStrategy
  handleUpgrade?: HammurabiModule['handleUpgrade']
  shutdown?: HammurabiModule['shutdown']
}

export type ModuleRuntimeFactory = (
  context: ModuleRuntimeContext,
) => ModuleRouteRegistration | readonly ModuleRouteRegistration[] | null | undefined

export function isApiKeyManagementStore(store: ApiKeyStoreLike | undefined): store is ApiKeyJsonStore {
  return Boolean(
    store
    && 'listKeys' in store
    && 'createKey' in store
    && 'revokeKey' in store,
  )
}

function staticSegmentsForMount(mount: string): string[] {
  const normalized = mount.trim().replace(/\/+$/u, '')
  if (!normalized || normalized === '/') {
    return []
  }

  const segments = normalized.split('/').filter(Boolean)
  const staticSegments: string[] = []
  for (const segment of segments) {
    if (segment.startsWith(':') || segment.includes('*')) {
      break
    }
    staticSegments.push(segment)
  }
  return staticSegments
}

function commonPrefix(segmentLists: readonly string[][]): string[] {
  if (segmentLists.length === 0) {
    return []
  }

  const [first, ...rest] = segmentLists
  const prefix: string[] = []
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index]
    if (rest.every((segments) => segments[index] === segment)) {
      prefix.push(segment)
      continue
    }
    break
  }
  return prefix
}

function segmentsToMount(segments: readonly string[]): string {
  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}

export function deriveRuntimeRoutePrefix(
  routes: readonly HammurabiRouteDeclaration[],
  strategy: ModuleMountStrategy = 'common-static-prefix',
): string {
  if (routes.length === 0) {
    throw new HammurabiModuleLoaderError('Runtime module has no route declarations to mount')
  }

  const staticSegments = routes.map((route) => staticSegmentsForMount(route.mount))
  if (strategy === 'static-parent') {
    const parent = staticSegments[0].slice(0, -1)
    return segmentsToMount(parent)
  }

  return segmentsToMount(commonPrefix(staticSegments))
}

function assertExplicitAggregateMountStrategy(
  registration: ModuleRouteRegistration,
  routes: readonly HammurabiRouteDeclaration[],
  routePrefix: string,
): void {
  if (registration.mountStrategy || routes.length <= 1) {
    return
  }

  const primaryStaticSegments = staticSegmentsForMount(routes[0].mount)
  const routePrefixSegments = staticSegmentsForMount(routePrefix)
  if (routePrefixSegments.length >= primaryStaticSegments.length) {
    return
  }

  throw new HammurabiModuleLoaderError(
    `Runtime module "${registration.name}" routeIds [${registration.routeIds.join(', ')}] collapse `
    + `from "${segmentsToMount(primaryStaticSegments)}" to "${routePrefix}". `
    + 'Set mountStrategy explicitly for aggregate routers.',
  )
}

export function createManifestMountedModules(
  moduleGraph: LoadedHammurabiModuleGraph,
  registrations: readonly ModuleRouteRegistration[],
): HammurabiModule[] {
  const routeById = new Map(moduleGraph.mountPlan.routes.map((route) => [route.id, route]))

  const modules = registrations.map((registration) => {
    const declaredRoutes = registration.routeIds.map((routeId) => {
      const route = routeById.get(routeId)
      if (!route) {
        throw new HammurabiModuleLoaderError(
          `Runtime module "${registration.name}" references missing route declaration: ${registration.routeIds.join(', ')}`,
        )
      }
      return route
    })

    for (const route of declaredRoutes) {
      const manifest = moduleGraph.manifestById.get(route.ownerModuleId)
      if (!manifest) {
        throw new HammurabiModuleLoaderError(
          `Runtime module "${registration.name}" references disabled owner module "${route.ownerModuleId}"`,
        )
      }
      if (manifest.graph.status === 'retired') {
        throw new HammurabiModuleLoaderError(
          `Runtime module "${registration.name}" cannot mount retired module "${route.ownerModuleId}"`,
        )
      }
    }

    const primaryRoute = declaredRoutes[0]
    const primaryManifest = moduleGraph.manifestById.get(primaryRoute.ownerModuleId)
    if (!primaryManifest) {
      throw new HammurabiModuleLoaderError(
        `Runtime module "${registration.name}" references disabled owner module "${primaryRoute.ownerModuleId}"`,
      )
    }

    const routePrefix = deriveRuntimeRoutePrefix(declaredRoutes, registration.mountStrategy)
    assertExplicitAggregateMountStrategy(registration, declaredRoutes, routePrefix)

    return {
      name: registration.name,
      label: registration.label ?? primaryManifest.graph.label,
      routePrefix,
      router: registration.router,
      ...(registration.handleUpgrade ? { handleUpgrade: registration.handleUpgrade } : {}),
      ...(registration.shutdown ? { shutdown: registration.shutdown } : {}),
    }
  })

  validateDeclaredWebSocketHandlers(moduleGraph, modules)

  return modules
}

function validateDeclaredWebSocketHandlers(
  moduleGraph: LoadedHammurabiModuleGraph,
  modules: readonly HammurabiModule[],
): void {
  const moduleByName = new Map(modules.map((module) => [module.name, module]))
  const declaredWebsockets = moduleGraph.mountPlan.websockets ?? []

  for (const declaration of declaredWebsockets) {
    const ownerModule = moduleByName.get(declaration.ownerModuleId)
    if (!ownerModule) {
      throw new HammurabiModuleLoaderError(
        `WebSocket "${declaration.id}" is declared by "${declaration.ownerModuleId}" `
        + 'but no runtime module with that name is registered',
      )
    }
    if (!ownerModule.handleUpgrade) {
      throw new HammurabiModuleLoaderError(
        `WebSocket "${declaration.id}" is declared by "${declaration.ownerModuleId}" `
        + 'but that runtime does not register an upgrade handler',
      )
    }
  }
}
