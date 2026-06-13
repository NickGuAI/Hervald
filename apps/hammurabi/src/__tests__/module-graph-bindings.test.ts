import { describe, expect, it } from 'vitest'
import type { FrontendModuleBinding } from '@/types'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'
import {
  bindFrontendGraphToStaticBindings,
  bindFrontendModulesToGraph,
  findModuleGraphUiRouteMetadata,
  findModuleGraphRoute,
  findModuleGraphWebSocket,
  resolveModuleGraphWebSocketPath,
} from '@/module-graph-bindings'
import { HAMMURABI_MODULE_GRAPH } from '@/module-manifest'
import { moduleComponentBindings } from '@/module-registry'
import { COMMAND_ROOM_ROUTE_METADATA } from '@modules/command-room/route-metadata'

function moduleBinding(overrides: Partial<FrontendModuleBinding> = {}): FrontendModuleBinding {
  return {
    name: 'org',
    routeId: 'org.ui',
    componentKey: 'modules/org/page',
    component: async () => ({ default: () => null }),
    ...overrides,
  }
}

function graph(overrides: Partial<HammurabiModuleGraphResponse> = {}): HammurabiModuleGraphResponse {
  return {
    modules: [
      {
        id: 'org',
        label: 'Org',
        status: 'public',
        summary: 'Org chart.',
        capabilities: {
          provides: [],
          consumes: [],
        },
        dependencies: {
          modules: [],
          capabilities: [],
        },
        ui: {
          kind: 'route',
          routes: [
            {
              id: 'org.ui',
              path: '/org',
              componentKey: 'modules/org/page',
              surfaces: ['desktop'],
            },
          ],
          surfaces: ['desktop'],
        },
      },
    ],
    routes: [
      {
        id: 'org.api',
        moduleId: 'org',
        surface: 'api',
        mount: '/api/org',
        methods: ['GET'],
        auth: 'api-key-or-auth0',
        parserIds: [],
      },
    ],
    parsers: [],
    websockets: [
      {
        id: 'agents.session-stream',
        moduleId: 'agents',
        path: '/api/agents/sessions/:name/ws',
        match: 'exact',
        auth: 'api-key-or-auth0',
      },
    ],
    storage: [],
    nav: [
      {
        moduleId: 'org',
        routeId: 'org.ui',
        path: '/org',
        label: 'Organization',
        icon: 'Building2',
        group: 'primary',
        hidden: false,
        surfaces: ['desktop'],
      },
    ],
    providers: [],
    ...overrides,
  }
}

describe('module graph frontend bindings', () => {
  it('does not synthesize routes when no backend graph is available', () => {
    const modules = [moduleBinding()]

    expect(bindFrontendModulesToGraph(modules, null)).toEqual([])
  })

  it('binds backend route and nav metadata to frontend-owned component allowlists', () => {
    const boundGraph = bindFrontendGraphToStaticBindings([moduleBinding()], graph())
    const bound = boundGraph.routes

    expect(bound).toHaveLength(1)
    expect(bound[0]).toMatchObject({
      name: 'org',
      label: 'Organization',
      icon: 'Building2',
      path: '/org',
      navGroup: 'primary',
      hideFromNav: false,
      componentKey: 'modules/org/page',
    })
    expect(bound[0]?.component).toBeDefined()
    expect(boundGraph.nav).toEqual([
      expect.objectContaining({
        label: 'Organization',
        routeId: 'org.ui',
        surfaces: ['desktop'],
      }),
    ])
  })

  it('drops graph-controlled routes that are missing or try to swap component keys', () => {
    const staticModules = [
      moduleBinding(),
      moduleBinding({
        name: 'automations',
        routeId: 'automations.ui',
        componentKey: 'modules/automations/page',
      }),
      moduleBinding({
        name: 'policies',
        routeId: 'policies.ui',
        componentKey: 'modules/policies/page',
      }),
    ]
    const unsafeGraph = graph({
      modules: [
        {
          id: 'org',
          label: 'Org',
          status: 'public',
          summary: 'Org chart.',
          capabilities: { provides: [], consumes: [] },
          dependencies: { modules: [], capabilities: [] },
          ui: {
            kind: 'route',
            routes: [
              {
                id: 'org.ui',
                path: '/org',
                componentKey: 'modules/org/page',
                surfaces: ['desktop'],
              },
              {
                id: 'policies.ui',
                path: '/policies',
                componentKey: 'modules/other/page',
                surfaces: ['desktop'],
              },
            ],
            surfaces: ['desktop'],
          },
        },
      ],
      nav: [
        {
          moduleId: 'org',
          routeId: 'org.ui',
          path: '/org',
          label: 'Organization',
          icon: 'Building2',
          group: 'primary',
          hidden: false,
          surfaces: ['desktop'],
        },
        {
          moduleId: 'org',
          routeId: 'policies.ui',
          path: '/policies',
          label: 'Policies',
          icon: 'Shield',
          group: 'primary',
          hidden: false,
          surfaces: ['desktop'],
        },
      ],
    })

    const boundGraph = bindFrontendGraphToStaticBindings(staticModules, unsafeGraph)

    expect(boundGraph.routes.map((module) => module.name)).toEqual(['org'])
    expect(boundGraph.nav.map((item) => item.routeId)).toEqual(['org.ui'])
  })

  it('resolves manifest-declared frontend redirects to graph route paths', () => {
    const boundGraph = bindFrontendGraphToStaticBindings([moduleBinding()], graph({
      modules: [
        {
          id: 'org',
          label: 'Org',
          status: 'public',
          summary: 'Org chart.',
          capabilities: { provides: [], consumes: [] },
          dependencies: { modules: [], capabilities: [] },
          ui: {
            kind: 'route',
            routes: [
              {
                id: 'org.ui',
                path: '/org',
                componentKey: 'modules/org/page',
                surfaces: ['desktop'],
              },
            ],
            redirects: [{
              id: 'legacy-org',
              from: '/legacy-org',
              toRouteId: 'org.ui',
            }],
            surfaces: ['desktop'],
          },
        },
      ],
    }))

    expect(boundGraph.redirects).toEqual([{
      id: 'legacy-org',
      from: '/legacy-org',
      to: '/org',
    }])
  })

  it('resolves declared API routes and websocket paths by id', () => {
    const currentGraph = graph()

    expect(findModuleGraphRoute(currentGraph, 'org.api')?.mount).toBe('/api/org')
    expect(findModuleGraphRoute(currentGraph, 'missing')).toBeNull()
    expect(findModuleGraphWebSocket(currentGraph, 'agents.session-stream')?.path).toBe(
      '/api/agents/sessions/:name/ws',
    )
    expect(resolveModuleGraphWebSocketPath(currentGraph, 'agents.session-stream', { name: 'worker/one' })).toBe(
      '/api/agents/sessions/worker%2Fone/ws',
    )
    expect(findModuleGraphWebSocket(currentGraph, 'missing')).toBeNull()
    expect(resolveModuleGraphWebSocketPath(currentGraph, 'missing', { name: 'worker/one' })).toBeNull()
  })

  it('resolves backend-owned UI route metadata by route id', () => {
    const currentGraph = graph({
      modules: [
        {
          id: 'command-room',
          label: 'Command Room',
          status: 'public',
          summary: 'Command room.',
          capabilities: { provides: [], consumes: [] },
          dependencies: { modules: [], capabilities: [] },
          ui: {
            kind: 'route',
            routes: [
              {
                id: 'command-room.ui',
                path: '/command-room',
                componentKey: 'modules/command-room/page',
                surfaces: ['desktop', 'mobile'],
                metadata: COMMAND_ROOM_ROUTE_METADATA,
              },
            ],
            surfaces: ['desktop', 'mobile'],
          },
        },
      ],
    })

    expect(findModuleGraphUiRouteMetadata(currentGraph, 'command-room.ui')).toMatchObject({
      launch: {
        path: '/command-room',
        commanderParam: 'commander',
        conversationParam: 'conversation',
      },
      globalCommander: {
        commanderValue: 'global',
        panelParam: 'panel',
        defaultPanel: 'automation',
      },
    })
    expect(findModuleGraphUiRouteMetadata(currentGraph, 'missing')).toBeNull()
  })

  it('keeps static frontend bindings aligned with browser-safe manifest metadata', () => {
    const uiRoutes = new Map(
      HAMMURABI_MODULE_GRAPH.flatMap((module) =>
        module.ui.routes.map((route) => [route.id, route.componentKey] as const),
      ),
    )

    for (const module of moduleComponentBindings) {
      expect(module.routeId, `${module.name} must declare routeId`).toBeTruthy()
      expect(module.componentKey, `${module.name} must declare componentKey`).toBeTruthy()
      expect(uiRoutes.get(module.routeId), `${module.name} routeId must exist in manifest`).toBe(
        module.componentKey,
      )
    }
  })

  it('keeps desktop nav manifest order aligned with the top bar sequence', () => {
    const orderedDesktopNav = HAMMURABI_MODULE_GRAPH.flatMap((module) =>
      module.ui.routes.flatMap((route) => {
        const nav = route.nav
        const surfaces = nav?.surfaces ?? route.surfaces
        if (!nav || nav.hidden || !surfaces.includes('desktop')) {
          return []
        }

        return [
          {
            label: nav.label,
            group: nav.group,
            order: nav.order ?? Number.MAX_SAFE_INTEGER,
          },
        ]
      }),
    ).sort((left, right) => left.order - right.order)

    const primaryNav = orderedDesktopNav.filter((item) => (item.group ?? 'primary') === 'primary')
    const secondaryNav = orderedDesktopNav.filter((item) => item.group === 'secondary')
    const secondaryNavOrder = secondaryNav.length > 0
      ? Math.min(...secondaryNav.map((item) => item.order))
      : Number.MAX_SAFE_INTEGER
    const topBarLabels = [
      ...primaryNav.filter((item) => item.order < secondaryNavOrder).map((item) => item.label),
      ...(secondaryNav.length > 0 ? ['Ops'] : []),
      ...primaryNav.filter((item) => item.order >= secondaryNavOrder).map((item) => item.label),
    ]

    expect(topBarLabels).toEqual([
      'Org',
      'Command Room',
      'Marketplace',
      'Ops',
      'Channels',
      'Settings',
    ])
  })
})
