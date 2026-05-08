import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { isImmersiveMobileChatRoute } from './mobile-shell-routes'

interface MobileBottomTabsProps {
  pendingCount: number
}

/**
 * Canonical Hervald mobile bottom tab bar — the single source of the
 * Org · Automations · Inbox · Settings IA specified in
 * `assets/mock/Hervald App/Hervald Prototype.html`.
 *
 * Mounted by `src/surfaces/mobile/MobileShell.tsx` on any Hervald mobile route
 * (so non-Command-Room pages like `/api-keys` also get the canonical tab
 * bar). Self-hides on the immersive chat route `/command-room?commander=<id>`
 * per the mock (L1712 of `mobile.jsx`).
 */
export function MobileBottomTabs({ pendingCount }: MobileBottomTabsProps) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const inChat = isImmersiveMobileChatRoute(location.pathname, searchParams)
  const surfaceSearch = searchParams.get('surface')
  const searchSuffix = surfaceSearch ? `?surface=${encodeURIComponent(surfaceSearch)}` : ''

  const modules = useMemo(
    () => [
      {
        name: 'org',
        label: 'Org',
        icon: 'Users',
        path: '/org',
      },
      {
        name: 'automations',
        label: 'Automations',
        icon: 'CalendarClock',
        path: `/automations${searchSuffix}`,
      },
      {
        name: 'inbox',
        label: 'Inbox',
        icon: 'ClipboardCheck',
        path: `/command-room/inbox${searchSuffix}`,
        badge: pendingCount,
      },
      {
        name: 'settings',
        label: 'Settings',
        icon: 'Settings',
        path: `/command-room/settings${searchSuffix}`,
      },
    ],
    [pendingCount, searchSuffix],
  )

  // Immersive chat view hides the tab bar per the canonical mock.
  if (inChat) {
    return null
  }

  return (
    <div data-testid="hervald-mobile-tabs">
      <BottomNav modules={modules} forceVisible />
    </div>
  )
}
