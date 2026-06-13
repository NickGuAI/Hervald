import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  HAMMURABI_MODULE_MANIFESTS,
  HAMMURABI_MODULE_SERVER_METADATA,
} from '../module-manifest'
import { HAMMURABI_MODULE_GRAPH } from '../../src/module-manifest'
import { HAMMURABI_MODULE_STATUSES } from '../../src/types/module-manifest'

const hammurabiRoot = path.resolve(__dirname, '..', '..')
const modulesRoot = path.join(hammurabiRoot, 'modules')

function moduleDirectories(): string[] {
  return readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    .map((entry) => entry.name)
    .sort()
}

describe('Hammurabi module manifest inventory', () => {
  it('classifies every module directory exactly once', () => {
    const graphDirectories = HAMMURABI_MODULE_GRAPH.map((entry) => entry.directory).sort()

    expect(graphDirectories).toEqual(moduleDirectories())
    expect(new Set(graphDirectories).size).toBe(graphDirectories.length)
  })

  it('has matching browser graph and server metadata for every module id', () => {
    const graphIds = HAMMURABI_MODULE_GRAPH.map((entry) => entry.id).sort()
    const serverIds = HAMMURABI_MODULE_SERVER_METADATA.map((entry) => entry.id).sort()
    const manifestIds = HAMMURABI_MODULE_MANIFESTS.map((entry) => entry.graph.id).sort()

    expect(serverIds).toEqual(graphIds)
    expect(manifestIds).toEqual(graphIds)
  })

  it('uses only known module statuses and complete public ownership metadata', () => {
    const validStatuses = new Set(HAMMURABI_MODULE_STATUSES)

    for (const graph of HAMMURABI_MODULE_GRAPH) {
      expect(validStatuses.has(graph.status)).toBe(true)
      expect(graph.id).toBeTruthy()
      expect(graph.label).toBeTruthy()
      expect(graph.summary).toBeTruthy()
      expect(graph.dependencies.modules).toBeDefined()
      expect(graph.dependencies.capabilities).toBeDefined()
      expect(graph.capabilities.provides).toBeDefined()
      expect(graph.capabilities.consumes).toBeDefined()
      expect(graph.ui.kind).toBeTruthy()
      expect(graph.storageKeys).toBeDefined()

      if (graph.status === 'public') {
        const hasRouteOrExplicitEmbedding = graph.ui.routes.length > 0 || graph.ui.kind === 'embedded'

        expect(hasRouteOrExplicitEmbedding).toBe(true)
        expect(graph.routeIds.length + graph.websocketIds.length + graph.ui.routes.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps browser-safe manifest files free of server imports', () => {
    const graphSource = readFileSync(path.join(hammurabiRoot, 'src/module-manifest.ts'), 'utf8')
    const typeSource = readFileSync(path.join(hammurabiRoot, 'src/types/module-manifest.ts'), 'utf8')

    expect(graphSource).not.toMatch(/from ['"](\.\.\/)*server\//)
    expect(typeSource).not.toMatch(/from ['"](\.\.\/)*server\//)
    expect(graphSource).not.toMatch(/node:/)
    expect(typeSource).not.toMatch(/node:/)
  })
})

describe('Hammurabi module manifest declarations', () => {
  it('declares graph route, parser, websocket, and storage ids in server metadata', () => {
    for (const manifest of HAMMURABI_MODULE_MANIFESTS) {
      const declaredRouteIds = new Set(manifest.server.routes.map((route) => route.id))
      const declaredParserIds = new Set(manifest.server.parsers.map((parser) => parser.id))
      const declaredWebsocketIds = new Set(manifest.server.websockets.map((socket) => socket.id))
      const declaredStorageKeys = new Set(manifest.server.storage.keys)

      for (const routeId of manifest.graph.routeIds) {
        expect(declaredRouteIds.has(routeId), `${manifest.graph.id} missing route ${routeId}`).toBe(true)
      }

      for (const parserId of manifest.graph.parserIds) {
        expect(declaredParserIds.has(parserId), `${manifest.graph.id} missing parser ${parserId}`).toBe(true)
      }

      for (const websocketId of manifest.graph.websocketIds) {
        expect(declaredWebsocketIds.has(websocketId), `${manifest.graph.id} missing websocket ${websocketId}`).toBe(true)
      }

      for (const storageKey of manifest.graph.storageKeys) {
        expect(declaredStorageKeys.has(storageKey), `${manifest.graph.id} missing storage ${storageKey}`).toBe(true)
      }
    }
  })

  it('does not allow duplicate declaration ids', () => {
    const routeIds = HAMMURABI_MODULE_SERVER_METADATA.flatMap((module) => (
      module.routes.map((route) => route.id)
    ))
    const parserIds = HAMMURABI_MODULE_SERVER_METADATA.flatMap((module) => (
      module.parsers.map((parser) => parser.id)
    ))
    const websocketIds = HAMMURABI_MODULE_SERVER_METADATA.flatMap((module) => (
      module.websockets.map((socket) => socket.id)
    ))

    expect(new Set(routeIds).size).toBe(routeIds.length)
    expect(new Set(parserIds).size).toBe(parserIds.length)
    expect(new Set(websocketIds).size).toBe(websocketIds.length)
  })

  it('requires every route-owned parser id to be declared by the same module', () => {
    for (const module of HAMMURABI_MODULE_SERVER_METADATA) {
      const parserIds = new Set(module.parsers.map((parser) => parser.id))

      for (const route of module.routes) {
        const routeParserIds = 'parserIds' in route && route.parserIds ? route.parserIds : []

        for (const parserId of routeParserIds) {
          expect(parserIds.has(parserId), `${module.id} route ${route.id} missing parser ${parserId}`).toBe(true)
        }
      }
    }
  })

  it('declares lifecycle hooks explicitly and only references known module owners', () => {
    const moduleIds = new Set<string>(HAMMURABI_MODULE_SERVER_METADATA.map((module) => module.id))

    for (const module of HAMMURABI_MODULE_SERVER_METADATA) {
      const { lifecycle } = module

      expect(lifecycle.mode, `${module.id} missing lifecycle mode`).toBeTruthy()
      expect(Array.isArray(lifecycle.startup), `${module.id} startup lifecycle must be an array`).toBe(true)
      expect(Array.isArray(lifecycle.background), `${module.id} background lifecycle must be an array`).toBe(true)
      expect(Array.isArray(lifecycle.shutdown), `${module.id} shutdown lifecycle must be an array`).toBe(true)

      if (lifecycle.mode === 'none') {
        expect(lifecycle.startup, `${module.id} none lifecycle cannot declare startup hooks`).toHaveLength(0)
        expect(lifecycle.background, `${module.id} none lifecycle cannot declare background hooks`).toHaveLength(0)
        expect(lifecycle.shutdown, `${module.id} none lifecycle cannot declare shutdown hooks`).toHaveLength(0)
      }

      for (const hook of [...lifecycle.startup, ...lifecycle.background, ...lifecycle.shutdown]) {
        expect(moduleIds.has(hook.ownerModuleId), `${module.id} hook ${hook.id} has unknown owner`).toBe(true)
        expect(hook.ownerModuleId, `${module.id} hook ${hook.id} must be owned by the declaring module`).toBe(module.id)
        expect(hook.notes, `${module.id} hook ${hook.id} needs ownership notes`).toBeTruthy()
      }
    }
  })
})
