import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { parseMobileRoute } from './route'

interface MobileBottomTabsProps {
  pendingCount: number
}

/**
 * Canonical Hervald mobile bottom tab bar — the single source of the
 * Sessions · Automations · Inbox · Settings IA specified in
 * `assets/mock/Hervald App/Hervald Prototype.html`.
 *
 * Mounted by `src/surfaces/hervald/Shell.tsx` on any Hervald mobile route
 * (so non-Command-Room pages like `/api-keys` also get the canonical tab
 * bar). Self-hides on the immersive chat route `/command-room/sessions/:id`
 * per the mock (L1712 of `mobile.jsx`).
 */
export function MobileBottomTabs({ pendingCount }: MobileBottomTabsProps) {
  const location = useLocation()
  const searchSuffix = location.search || ''

  const { inChat } = useMemo(
    () => parseMobileRoute(location.pathname),
    [location.pathname],
  )

  const modules = useMemo(
    () => [
      {
        name: 'sessions',
        label: 'Sessions',
        icon: 'Crown',
        path: `/command-room/sessions${searchSuffix}`,
      },
      {
        name: 'automations',
        label: 'Automations',
        icon: 'CalendarClock',
        path: `/command-room/automations${searchSuffix}`,
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
