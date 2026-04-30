/**
 * Mobile route helpers.
 *
 * Shared by `MobileCommandRoom` (which owns the tab routing + screen mounting)
 * and `MobileBottomTabs` (which owns the tab-bar chrome and self-hides on
 * the immersive chat route). Mirrors the canonical mobile IA from
 * `apps/hammurabi/assets/mock/Hervald App/Hervald Prototype.html`.
 */

export type MobileTab = 'sessions' | 'automations' | 'inbox' | 'settings'

export interface MobileRoute {
  tab: MobileTab
  inChat: boolean
  commanderId: string | null
  redirectTo: string | null
}

export function parseMobileRoute(pathname: string): MobileRoute {
  if (pathname === '/command-room' || pathname === '/command-room/') {
    return {
      tab: 'sessions',
      inChat: false,
      commanderId: null,
      redirectTo: '/command-room/sessions',
    }
  }

  const sessionsMatch = pathname.match(/^\/command-room\/sessions\/([^/]+)\/?$/)
  if (sessionsMatch) {
    return {
      tab: 'sessions',
      inChat: true,
      commanderId: decodeURIComponent(sessionsMatch[1]),
      redirectTo: null,
    }
  }

  if (pathname.startsWith('/command-room/sessions')) {
    return { tab: 'sessions', inChat: false, commanderId: null, redirectTo: null }
  }
  if (pathname.startsWith('/command-room/automations')) {
    return { tab: 'automations', inChat: false, commanderId: null, redirectTo: null }
  }
  if (pathname.startsWith('/command-room/inbox')) {
    return { tab: 'inbox', inChat: false, commanderId: null, redirectTo: null }
  }
  if (pathname.startsWith('/command-room/settings')) {
    return { tab: 'settings', inChat: false, commanderId: null, redirectTo: null }
  }

  return {
    tab: 'sessions',
    inChat: false,
    commanderId: null,
    redirectTo: '/command-room/sessions',
  }
}

export function buildSearchWithSurface(search: string): string {
  const params = new URLSearchParams(search)
  const nextParams = new URLSearchParams()
  const surface = params.get('surface')
  if (surface) {
    nextParams.set('surface', surface)
  }
  return nextParams.toString()
}
