import { describe, expect, it } from 'vitest'

import {
  createHammurabiCapabilityContainer,
  HammurabiModuleLoaderError,
  loadHammurabiModules,
} from '../module-loader'
import { HAMMURABI_MODULE_MANIFESTS } from '../module-manifest'
import type { HammurabiModuleManifest } from '../../src/types/module-manifest'

const baseManifest = HAMMURABI_MODULE_MANIFESTS.find((manifest) => manifest.graph.id === 'settings')!

function cloneManifest(
  overrides: {
    graph?: Partial<HammurabiModuleManifest['graph']>
    server?: Partial<HammurabiModuleManifest['server']>
  } = {},
): HammurabiModuleManifest {
  const graph = {
    ...baseManifest.graph,
    ...overrides.graph,
  }
  const server = {
    ...baseManifest.server,
    ...overrides.server,
  }

  return {
    graph,
    server,
  } as HammurabiModuleManifest
}

const settingsFixture = cloneManifest({
  graph: {
    dependencies: {
      modules: [],
      capabilities: [],
    },
    capabilities: {
      provides: ['settings.app-settings'],
      consumes: [],
    },
  },
})

describe('loadHammurabiModules', () => {
  it('loads the current manifest inventory into a mount plan without changing runtime behavior', () => {
    const loaded = loadHammurabiModules()

    expect(loaded.manifestById.get('settings')?.graph.label).toBe('App Settings')
    expect(loaded.capabilityProviders.get('api-key-store')).toBe('api-keys')
    expect(loaded.capabilityConsumers.get('auth.api-keys')).toContain('settings')
    expect(loaded.mountPlan.routes.some((route) => route.id === 'settings.api')).toBe(true)
    expect(loaded.mountPlan.parsers.some((parser) => parser.id === 'agents.image-json')).toBe(true)
    expect(loaded.mountPlan.websockets.some((socket) => socket.id === 'agents.session-stream')).toBe(true)
  })

  it('rejects duplicate module ids', () => {
    const duplicate = cloneManifest({
      graph: {
        dependencies: {
          modules: [],
          capabilities: [],
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [settingsFixture, duplicate] })).toThrow(
      /Duplicate module id "settings"/,
    )
  })

  it('rejects enabled modules with disabled dependencies', () => {
    expect(() => loadHammurabiModules({ enabledModuleIds: ['settings'] })).toThrow(
      /depends on disabled or missing module "api-keys"/,
    )
  })

  it('rejects duplicate route ids', () => {
    const duplicateRoute = cloneManifest({
      graph: {
        id: 'settings-copy',
        directory: 'settings-copy',
        dependencies: { modules: [], capabilities: [] },
        capabilities: { provides: ['settings-copy.store'], consumes: [] },
      },
      server: {
        id: 'settings-copy',
        directory: 'settings-copy',
        routes: baseManifest.server.routes.map((route) => ({
          ...route,
          ownerModuleId: 'settings-copy',
        })),
        storage: {
          ...baseManifest.server.storage,
          ownerModuleId: 'settings-copy',
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [settingsFixture, duplicateRoute] })).toThrow(
      /Duplicate route id "settings.api"/,
    )
  })

  it('rejects duplicate capability providers', () => {
    const duplicateCapability = cloneManifest({
      graph: {
        id: 'settings-copy',
        directory: 'settings-copy',
        dependencies: { modules: [], capabilities: [] },
      },
      server: {
        id: 'settings-copy',
        directory: 'settings-copy',
        routes: [],
        storage: {
          ...baseManifest.server.storage,
          ownerModuleId: 'settings-copy',
          keys: [],
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [settingsFixture, duplicateCapability] })).toThrow(
      /Capability "settings.app-settings" is provided by both "settings" and "settings-copy"/,
    )
  })

  it('rejects undeclared capability consumption', () => {
    const missingProvider = cloneManifest({
      graph: {
        dependencies: { modules: [], capabilities: [] },
        capabilities: {
          provides: ['settings.app-settings'],
          consumes: ['missing.capability'],
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [missingProvider], externalCapabilities: [] })).toThrow(
      /consumes undeclared capability "missing.capability"/,
    )
  })

  it('rejects duplicate owned storage keys', () => {
    const duplicateStorageOwner = cloneManifest({
      graph: {
        id: 'settings-copy',
        directory: 'settings-copy',
        dependencies: { modules: [], capabilities: [] },
        capabilities: { provides: ['settings-copy.store'], consumes: [] },
      },
      server: {
        id: 'settings-copy',
        directory: 'settings-copy',
        routes: [],
        storage: {
          ...baseManifest.server.storage,
          ownerModuleId: 'settings-copy',
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [settingsFixture, duplicateStorageOwner] })).toThrow(
      /Storage key "settings.app" is owned by both "settings" and "settings-copy"/,
    )
  })

  it('rejects lifecycle hooks declared by a non-owning module', () => {
    const mismatchedLifecycleOwner = cloneManifest({
      graph: {
        dependencies: { modules: [], capabilities: [] },
        capabilities: {
          provides: ['settings.app-settings'],
          consumes: [],
        },
      },
      server: {
        lifecycle: {
          mode: 'shutdown',
          startup: [],
          background: [],
          shutdown: [
            {
              id: 'settings.shutdown',
              ownerModuleId: 'api-keys',
              notes: 'Invalid cross-module lifecycle ownership fixture.',
            },
          ],
        },
      },
    })

    expect(() => loadHammurabiModules({ manifests: [mismatchedLifecycleOwner] })).toThrow(
      /Lifecycle hook "settings.shutdown" is declared by "settings" but owned by "api-keys"/,
    )
  })
})

describe('HammurabiCapabilityContainer', () => {
  it('tracks explicit providers and consumers', () => {
    const container = createHammurabiCapabilityContainer<{ 'settings.app-settings': { read(): string } }>()
    const value = { read: () => 'ok' }

    container.provide('settings.app-settings', 'settings', value)

    expect(container.consume('settings.app-settings', 'command-room')).toBe(value)
    expect(container.snapshot().providers.get('settings.app-settings')).toBe('settings')
    expect(container.snapshot().consumers.get('settings.app-settings')).toEqual(['command-room'])
  })

  it('rejects duplicate providers and missing providers', () => {
    const container = createHammurabiCapabilityContainer<{ cap: string }>()

    container.provide('cap', 'one', 'value')

    expect(() => container.provide('cap', 'two', 'value')).toThrow(HammurabiModuleLoaderError)
    expect(() => createHammurabiCapabilityContainer<{ cap: string }>().consume('cap', 'consumer')).toThrow(
      /consumes undeclared capability "cap"/,
    )
  })

  it('rejects capabilities provided under a different runtime module owner', () => {
    const container = createHammurabiCapabilityContainer<{ cap: string }>()

    expect(() => {
      container.withProviderModule('workspace', () => {
        container.provide('cap', 'agents', 'value')
      })
    }).toThrow(/Runtime module "workspace" cannot provide capability "cap" as owner "agents"/)

    container.withProviderModule('workspace', () => {
      container.provide('cap', 'workspace', 'value')
    })

    expect(container.snapshot().providers.get('cap')).toBe('workspace')
  })
})
