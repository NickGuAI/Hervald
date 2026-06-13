/**
 * Hervald — Desktop shell.
 *
 * Owns the desktop TopBar and viewport frame. Mobile chrome/safe-area policy
 * is delegated to `src/surfaces/mobile/MobileShell`.
 */
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  MobileShellChrome,
  useMobileShellChromeState,
} from '@/surfaces/mobile/MobileShell'
import type { FrontendNavItem } from '@/types'
import { ApprovalNotificationCenter } from '@modules/approvals/ApprovalNotificationCenter'
import { TopBar } from './TopBar'
import type { TopBarCounts } from './TopBar'

interface ShellProps {
  modules: FrontendNavItem[]
  counts?: TopBarCounts
  children: React.ReactNode
}

const EMPTY_TOP_BAR_COUNTS: TopBarCounts = {
  running: 0,
  stale: 0,
  exited: 0,
  pending: 0,
}

export function Shell({ modules, counts = EMPTY_TOP_BAR_COUNTS, children }: ShellProps) {
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

      <ApprovalNotificationCenter />

      {/* Main content — add bottom padding on mobile for the tab bar + safe-area.
          overflowX:hidden contains horizontal overflow at the architectural
          boundary that owns viewport bounds (Shell). Route children do not need
          their own viewport-frame overlay — see issue 1107.
          Padding gate matches the MobileShell mount gate: apply only when
          mobile chrome is visible, so immersive chat (where MobileBottomTabs
          self-hides) does not leak a ~4rem white bar — see issue 1152. */}
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
        <MobileShellChrome modules={modules} pendingCount={counts.pending} />
      ) : null}
    </div>
  )
}
