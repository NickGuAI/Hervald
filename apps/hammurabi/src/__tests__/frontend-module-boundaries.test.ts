import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = path.resolve(__dirname, '..')

function readSource(relativePath: string): string {
  return readFileSync(path.join(srcRoot, relativePath), 'utf8')
}

describe('frontend module graph boundaries', () => {
  it('keeps app routes and redirects graph declared', () => {
    const routerSource = readSource('app/AuthenticatedAppRouter.tsx')

    expect(routerSource).toContain('bindFrontendGraphToStaticBindings')
    expect(routerSource).toContain('boundGraph.redirects.map')
    expect(routerSource).not.toContain('AutomationsPage')
    expect(routerSource).not.toContain('path="/automations"')
    expect(routerSource).not.toContain('path="/command-room/automations"')
  })

  it('keeps desktop and mobile nav labels graph hydrated', () => {
    expect(readSource('surfaces/desktop/TopBar.tsx')).not.toContain('TAB_LABELS')
    expect(readSource('components/BottomNav.tsx')).not.toContain('SHORT_LABELS')

    const mobileTabsSource = readSource('surfaces/mobile/MobileBottomTabs.tsx')
    expect(mobileTabsSource).toContain('module.surfaces.includes')
    expect(mobileTabsSource).not.toContain("name: 'automations'")
    expect(mobileTabsSource).not.toContain("path: '/org'")
  })

  it('keeps desktop shell layout-only and free of feature fetch ownership', () => {
    const shellSource = readSource('surfaces/desktop/Shell.tsx')

    expect(shellSource).not.toContain('useAgentSessions')
    expect(shellSource).not.toContain('usePendingApprovals')
    expect(shellSource).not.toContain('workerLifecycle')
  })
})
