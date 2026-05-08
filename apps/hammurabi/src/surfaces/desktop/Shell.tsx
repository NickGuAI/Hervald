/**
 * Hervald — Desktop shell.
 *
 * Owns the desktop TopBar and viewport frame. Mobile chrome/safe-area policy
 * is delegated to `src/surfaces/mobile/MobileShell`.
 */
import { useMemo } from 'react'
import { workerLifecycle } from '@gehirn/hammurabi-cli/session-contract'
import { useAgentSessions } from '@/hooks/use-agents'
import { usePendingApprovals } from '@/hooks/use-approvals'
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  MobileShellChrome,
  useMobileShellChromeState,
} from '@/surfaces/mobile/MobileShell'
import { TopBar } from './TopBar'
import type { TopBarCounts } from './TopBar'

interface NavItem {
  name: string
  label: string
  icon: string
  path: string
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
}

interface ShellProps {
  modules: NavItem[]
  children: React.ReactNode
}

function useTopBarCounts(): TopBarCounts {
  const { data: sessions = [] } = useAgentSessions()
  const { data: approvals = [] } = usePendingApprovals()

  return useMemo(() => {
    let running = 0
    let stale = 0
    let exited = 0

    for (const session of sessions) {
      const lifecycle = workerLifecycle({
        status: session.status,
        processAlive: session.processAlive,
      })
      if (lifecycle === 'running') running += 1
      if (lifecycle === 'stale') stale += 1
      if (lifecycle === 'exited') exited += 1
    }

    return {
      running,
      stale,
      exited,
      pending: approvals.length,
    }
  }, [approvals.length, sessions])
}

export function Shell({ modules, children }: ShellProps) {
  const counts = useTopBarCounts()
  const isMobile = useIsMobile()
  const mobileChrome = useMobileShellChromeState({ isMobile })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        background: 'var(--hv-bg)',
        overflow: 'hidden',
      }}
    >
      {/* TopBar — hidden on mobile, visible from md up */}
      <div className="hidden md:block">
        <TopBar modules={modules} counts={counts} />
      </div>

      {/* Main content — add bottom padding on mobile for the tab bar + safe-area.
          overflowX:hidden contains horizontal overflow at the architectural
          boundary that owns viewport bounds (Shell). Route children do not need
          their own viewport-frame overlay — see #1107.
          Padding gate matches the MobileShell mount gate: apply only when
          mobile chrome is visible, so immersive chat (where MobileBottomTabs
          self-hides) does not leak a ~4rem white bar — see #1152. */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          minWidth: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          background: 'var(--hv-bg)',
        }}
        className={[
          mobileChrome.mainPaddingClassName,
          'md:pb-0',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </main>

      {/*
        Canonical Hervald mobile tab bar — Org · Sessions · Automations ·
        Inbox · Settings. Self-hides on immersive chat routes. Rendered here (not
        inside MobileCommandRoom) so every mobile route in the app —
        including non-Command-Room pages — gets the same canonical IA.
      */}
      {mobileChrome.shouldRenderMobileChrome ? (
        <MobileShellChrome pendingCount={counts.pending} />
      ) : null}
    </div>
  )
}
