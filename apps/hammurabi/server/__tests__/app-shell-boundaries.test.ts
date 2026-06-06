import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAMMURABI_MODULE_SERVER_METADATA } from '../module-manifest'

const serverRoot = path.resolve(__dirname, '..')
const indexSource = readFileSync(path.join(serverRoot, 'index.ts'), 'utf8')
const moduleRegistrySource = readFileSync(path.join(serverRoot, 'module-registry.ts'), 'utf8')
const moduleRuntimeSource = readFileSync(path.join(serverRoot, 'module-runtime.ts'), 'utf8')
const moduleRuntimeFactoriesSource = readFileSync(path.join(serverRoot, 'module-runtime-factories.ts'), 'utf8')

describe('server app shell boundaries', () => {
  it('does not mount feature API routes directly from server/index.ts', () => {
    const forbiddenMounts = [
      '/api/agents',
      '/api/approvals',
      '/api/auth',
      '/api/automations',
      '/api/commanders',
      '/api/conversations',
      '/api/modules',
      '/api/operators',
      '/api/org',
      '/api/policies',
      '/api/realtime',
      '/api/settings',
      '/api/skills',
      '/api/whatsapp',
    ]

    for (const mount of forbiddenMounts) {
      expect(indexSource, `Feature mount ${mount} must be declared in the module manifest`).not.toContain(
        `app.use('${mount}'`,
      )
      expect(indexSource, `Feature mount ${mount} must be declared in the module manifest`).not.toContain(
        `app.use("${mount}"`,
      )
    }
  })

  it('keeps feature parser limits in the manifest-owned mount plan', () => {
    expect(indexSource).not.toMatch(/express\.json\(\s*\{[^)]*limit:/s)
    expect(indexSource).not.toMatch(/multer\s*\(/)
    expect(indexSource).toContain('mountDeclaredBodyParsers(app, moduleGraph.mountPlan.parsers)')
  })

  it('derives concrete feature route prefixes from the manifest mount plan', () => {
    const forbiddenConcretePrefixes = [
      '/api/agents',
      '/api/approvals',
      '/api/auth',
      '/api/automations',
      '/api/conversations',
      '/api/modules',
      '/api/operators',
      '/api/realtime',
      '/api/settings',
      '/api/skills',
      '/api/telemetry',
      '/api/whatsapp',
    ]

    expect(moduleRegistrySource).toContain('createManifestMountedModules(moduleGraph')
    expect(moduleRuntimeSource).toContain('deriveRuntimeRoutePrefix')
    for (const prefix of forbiddenConcretePrefixes) {
      expect(moduleRegistrySource, `Route prefix ${prefix} must come from moduleGraph.mountPlan`).not.toContain(
        `routePrefix: '${prefix}'`,
      )
      expect(moduleRegistrySource, `Route prefix ${prefix} must come from moduleGraph.mountPlan`).not.toContain(
        `routePrefix: "${prefix}"`,
      )
    }
    expect(moduleRuntimeFactoriesSource).not.toMatch(/routePrefix:\s*['"]/)
  })

  it('keeps feature runtime construction in module-owned runtime factories', () => {
    const forbiddenRuntimeConstructors = [
      'createAgentsRouter',
      'createAutomationsRouter',
      'createCommandersRouter',
      'createPoliciesRouter',
      'createTelemetryRouterWithHub',
      'createProviderRegistryRouter',
    ]

    expect(moduleRegistrySource).not.toMatch(/from ['"]\.\.\/modules\//)
    expect(moduleRegistrySource).not.toMatch(/\bnew\s+[A-Z][A-Za-z]+Store\b/)
    expect(moduleRegistrySource).not.toMatch(/routeIds:\s*\[/)
    for (const constructorName of forbiddenRuntimeConstructors) {
      expect(moduleRegistrySource).not.toContain(constructorName)
    }

    const nonRuntimeModuleImports = [...moduleRuntimeFactoriesSource.matchAll(/from ['"]\.\.\/modules\/([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((importPath) => !importPath.endsWith('/runtime.js'))

    expect(nonRuntimeModuleImports).toEqual([])
  })

  it('allows split-shell deployments to bind the API runtime to an explicit host', () => {
    expect(indexSource).toContain("const host = process.env.HAMMURABI_HOST?.trim() || undefined")
    expect(indexSource).toContain('server.listen(port, host, () => {')
  })

  it('keeps websocket upgrades under the proxy-owned API roots', () => {
    const websocketPaths = HAMMURABI_MODULE_SERVER_METADATA.flatMap((manifest) => (
      manifest.websockets.map((socket) => socket.path)
    ))

    expect(websocketPaths.length).toBeGreaterThan(0)
    for (const websocketPath of websocketPaths) {
      expect(
        websocketPath.startsWith('/api/') || websocketPath.startsWith('/v1/'),
        `WebSocket path ${websocketPath} must stay under a proxy-owned root`,
      ).toBe(true)
    }
  })
})
