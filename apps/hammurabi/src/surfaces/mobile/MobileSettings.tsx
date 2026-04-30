import { Link } from 'react-router-dom'
import { Bell, Bolt, ChevronRight, CircleUserRound, Eye, Info, LogOut, RadioTower } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import TelemetryPreviewCard from '@modules/telemetry/components/TelemetryPreviewCard'

/**
 * Version + build identifiers. `APP_VERSION` is read from `package.json` at
 * build time via a lightweight `import.meta.env` bridge — the Vite config
 * exposes `import.meta.env.VITE_APP_VERSION` which defaults to the
 * package.json version string. `BUILD_COMMIT` is the short SHA the server
 * wrapper injects at launch time via `VITE_BUILD_COMMIT` (falls back to
 * empty so the footer just shows the version).
 */
const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.1.0'
const BUILD_COMMIT = (import.meta.env?.VITE_BUILD_COMMIT as string | undefined) ?? ''

const SETTINGS_SECTIONS = [
  {
    key: 'account',
    label: 'Account',
    icon: CircleUserRound,
    to: '/api-keys',
  },
  {
    key: 'telemetry',
    label: 'Telemetry',
    icon: RadioTower,
    to: '/telemetry',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: Bell,
    to: '/policies#notifications',
  },
  {
    key: 'runtime',
    label: 'Runtime',
    icon: Bolt,
    to: '/services',
  },
  {
    key: 'appearance',
    label: 'Appearance',
    icon: Eye,
    to: '/api-keys#appearance',
  },
  {
    key: 'about',
    label: 'About',
    icon: Info,
    to: '/api-keys#about',
  },
] as const

function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || 'Hervald'
  const [first = 'H', second = 'A'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toLowerCase()
}

export function MobileSettings() {
  const auth = useAuth()
  const user = auth?.user

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-settings">
      <div className="px-5 pb-3 pt-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-sumi-diluted">hervald</p>
        <h1 className="mt-1 font-display text-4xl text-sumi-black">Settings</h1>
      </div>

      <div className="hv-scroll flex-1 overflow-y-auto px-0 pb-5">
        <div className="mx-4 rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white px-4 py-4">
          <div className="flex items-center gap-3">
            {user?.picture ? (
              <img
                src={user.picture}
                alt={user.name ?? 'Profile'}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sumi-black font-display text-lg italic text-washi-white">
                {initials(user?.name, user?.email)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sumi-black">
                {user?.name ?? 'Operator'}
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-sumi-diluted">
                {user?.email ?? 'Signed in with an API key'}
              </p>
            </div>

            <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-moss-stone">
              active
            </span>
          </div>

          {auth?.signOut ? (
            <button
              type="button"
              onClick={auth.signOut}
              className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-sumi-diluted transition-colors hover:text-sumi-black"
            >
              <LogOut size={13} />
              Sign out
            </button>
          ) : null}
        </div>

        <div className="mt-4 px-3">
          <div className="overflow-hidden rounded-[3px_14px_3px_14px] border border-ink-border/70 bg-washi-white">
            {SETTINGS_SECTIONS.map((section, index) => {
              const Icon = section.icon
              return (
                <Link
                  key={section.key}
                  to={section.to}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-sumi-black transition-colors hover:bg-ink-wash/40"
                  style={{
                    borderBottom: index < SETTINGS_SECTIONS.length - 1
                      ? '1px solid var(--hv-border-hair)'
                      : 'none',
                  }}
                >
                  <Icon size={15} className="shrink-0 text-sumi-diluted" />
                  <span className="flex-1">{section.label}</span>
                  <ChevronRight size={14} className="text-sumi-mist" />
                </Link>
              )
            })}
          </div>
        </div>

        <div className="px-4 pt-5">
          <TelemetryPreviewCard />
        </div>

        <div className="px-6 pt-4 text-center text-[10px] uppercase tracking-[0.14em] text-sumi-mist">
          hervald · v{APP_VERSION}{BUILD_COMMIT ? ` · build ${BUILD_COMMIT}` : ''}
        </div>
      </div>
    </section>
  )
}
