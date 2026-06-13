import type {
  FrontendModule,
  FrontendModuleBinding,
  FrontendNavItem,
} from '@/types'
import type {
  HammurabiModuleGraphModule,
  HammurabiModuleGraphNavItem,
  HammurabiModuleGraphResponse,
  HammurabiModuleGraphRoute,
  HammurabiModuleGraphWebSocket,
} from '@/types/module-graph-api'
import type { HammurabiRouteMetadata } from '@/types/module-manifest'

export interface FrontendRedirect {
  id: string
  from: string
  to: string
}

export interface BoundFrontendGraph {
  routes: FrontendModule[]
  nav: FrontendNavItem[]
  redirects: FrontendRedirect[]
}

interface GraphRouteBinding {
  moduleId: string
  routeId: string
  path: string
  componentKey: string
  uiKind: string
}

function graphUiRoutes(graph: HammurabiModuleGraphResponse): Map<string, GraphRouteBinding> {
  const routes = new Map<string, GraphRouteBinding>()

  for (const module of graph.modules) {
    for (const route of module.ui.routes) {
      routes.set(route.id, {
        moduleId: module.id,
        routeId: route.id,
        path: route.path,
        componentKey: route.componentKey,
        uiKind: module.ui.kind,
      })
    }
  }

  return routes
}

function navItemsByRouteId(graph: HammurabiModuleGraphResponse): Map<string, HammurabiModuleGraphNavItem> {
  return new Map(graph.nav.map((item) => [item.routeId, item]))
}

function compareNavOrder(left: FrontendNavItem, right: FrontendNavItem): number {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
}

function bindRouteModules(
  bindings: readonly FrontendModuleBinding[],
  graph: HammurabiModuleGraphResponse,
): FrontendModule[] {
  const routes = graphUiRoutes(graph)
  const navItems = navItemsByRouteId(graph)
  const boundRoutes: FrontendModule[] = []

  for (const binding of bindings) {
    const route = routes.get(binding.routeId)
    if (!route || route.uiKind !== 'route' || route.componentKey !== binding.componentKey) {
      continue
    }

    const nav = navItems.get(binding.routeId)
    boundRoutes.push({
      ...binding,
      label: nav?.label ?? route.moduleId,
      icon: nav?.icon ?? 'Circle',
      path: route.path,
      navGroup: nav?.group ?? 'primary',
      hideFromNav: nav?.hidden ?? true,
      surfaces: nav?.surfaces ?? [],
      order: nav?.order,
    })
  }

  return boundRoutes
}

function bindNavItems(
  graph: HammurabiModuleGraphResponse,
  acceptedRouteIds: ReadonlySet<string>,
): FrontendNavItem[] {
  return [...graph.nav]
    .filter((item) => acceptedRouteIds.has(item.routeId))
    .map((item) => ({
      name: item.moduleId,
      routeId: item.routeId,
      label: item.label,
      icon: item.icon,
      path: item.path,
      navGroup: item.group,
      hideFromNav: item.hidden,
      surfaces: item.surfaces,
      order: item.order,
    }))
    .sort(compareNavOrder)
}

function resolveRedirectTarget(
  modules: readonly HammurabiModuleGraphModule[],
  toRouteId: string | undefined,
  toPath: string | undefined,
): string | null {
  if (toPath) {
    return toPath
  }
  if (!toRouteId) {
    return null
  }

  for (const module of modules) {
    const route = module.ui.routes.find((candidate) => candidate.id === toRouteId)
    if (route) {
      return route.path
    }
  }

  return null
}

function bindRedirects(graph: HammurabiModuleGraphResponse): FrontendRedirect[] {
  return graph.modules.flatMap((module) => (
    module.ui.redirects?.flatMap((redirect) => {
      const target = resolveRedirectTarget(graph.modules, redirect.toRouteId, redirect.toPath)
      return target
        ? [{
            id: redirect.id,
            from: redirect.from,
            to: target,
          }]
        : []
    }) ?? []
  ))
}

export function bindFrontendGraphToStaticBindings(
  bindings: readonly FrontendModuleBinding[],
  graph: HammurabiModuleGraphResponse,
): BoundFrontendGraph {
  const routes = bindRouteModules(bindings, graph)
  const acceptedRouteIds = new Set(routes.map((route) => route.routeId))

  return {
    routes,
    nav: bindNavItems(graph, acceptedRouteIds),
    redirects: bindRedirects(graph),
  }
}

export function bindFrontendModulesToGraph(
  staticModules: readonly FrontendModuleBinding[],
  graph: HammurabiModuleGraphResponse | null | undefined,
): FrontendModule[] {
  if (!graph) {
    return []
  }

  return bindFrontendGraphToStaticBindings(staticModules, graph).routes
}

export function findModuleGraphRoute(
  graph: HammurabiModuleGraphResponse,
  routeId: string,
): HammurabiModuleGraphRoute | null {
  return graph.routes.find((route) => route.id === routeId) ?? null
}

export function findModuleGraphWebSocket(
  graph: HammurabiModuleGraphResponse,
  websocketId: string,
): HammurabiModuleGraphWebSocket | null {
  return graph.websockets.find((websocket) => websocket.id === websocketId) ?? null
}

export function resolveModuleGraphWebSocketPath(
  graph: HammurabiModuleGraphResponse | null | undefined,
  websocketId: string,
  params: Readonly<Record<string, string>>,
): string | null {
  if (!graph) {
    return null
  }

  const websocket = findModuleGraphWebSocket(graph, websocketId)
  if (!websocket) {
    return null
  }

  return websocket.path.replace(/:([A-Za-z0-9_]+)/g, (match, key: string) => {
    const value = params[key]
    return typeof value === 'string' ? encodeURIComponent(value) : match
  })
}

export function findModuleGraphUiRouteMetadata(
  graph: HammurabiModuleGraphResponse | null | undefined,
  routeId: string,
): HammurabiRouteMetadata | null {
  if (!graph) {
    return null
  }

  for (const module of graph.modules) {
    const route = module.ui.routes.find((candidate) => candidate.id === routeId)
    if (route?.metadata) {
      return route.metadata
    }
  }

  return null
}
