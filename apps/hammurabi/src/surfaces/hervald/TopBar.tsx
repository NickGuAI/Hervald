/**
 * Hervald — Dark top bar.
 *
 * Replaces the left sidebar. Full-width, 48px, #0e0e10 background.
 * Vermillion dot + italic "Hervald" branding, breadcrumb nav,
 * inline tab navigation, status counters, and ops overflow.
 */
import { NavLink, useLocation } from 'react-router-dom'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

interface NavItem {
  name: string
  label: string
  path: string
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
}

/** Status counts displayed in the top bar */
export interface TopBarCounts {
  running: number
  stale: number
  exited: number
  pending: number
}

interface TopBarProps {
  modules: NavItem[]
  counts?: TopBarCounts
}

/** Short uppercase labels for top bar tab nav */
const TAB_LABELS: Record<string, string> = {
  'command-room': 'Command Room',
  fleet: 'Fleet',
  'api-keys': 'Settings',
  telemetry: 'Telemetry',
  services: 'Services',
  policies: 'Policies',
}

/** Breadcrumb labels (full names) */
const BREADCRUMB_LABELS: Record<string, string> = {
  'command-room': 'COMMAND ROOM',
  fleet: 'FLEET',
  telemetry: 'TELEMETRY',
  services: 'SERVICES',
  policies: 'POLICIES',
  'api-keys': 'SETTINGS',
}

const headerStyle: CSSProperties = {
  height: 48,
  flexShrink: 0,
  padding: '0 22px',
  background: '#0e0e10',
  color: 'var(--washi-white)',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  borderBottom: '1px solid #000',
}

const brandingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const dotStyle: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: 'var(--vermillion-seal)',
  display: 'inline-block',
}

const nameStyle: CSSProperties = {
  fontFamily: 'var(--hv-font-primary)',
  fontStyle: 'italic',
  fontSize: 15,
  color: 'var(--washi-white)',
}

const separatorStyle: CSSProperties = {
  color: '#3a3a3d',
  margin: '0 4px',
}

const breadcrumbStyle: CSSProperties = {
  fontFamily: 'var(--hv-font-body)',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--washi-white)',
}

const tabBase: CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 10px',
  fontFamily: 'var(--hv-font-body)',
  fontSize: 10.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  textDecoration: 'none',
}

const countersStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  fontSize: 10.5,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#a09d96',
}

const countValueStyle: CSSProperties = {
  color: 'var(--washi-white)',
  fontWeight: 500,
}

const overflowButtonStyle: CSSProperties = {
  ...tabBase,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const overflowMenuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  minWidth: 180,
  padding: 8,
  background: '#18181b',
  border: '1px solid #26262b',
  borderRadius: 10,
  boxShadow: '0 16px 32px rgba(0, 0, 0, 0.35)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  zIndex: 20,
}

function isModuleActive(module: NavItem, pathname: string) {
  return pathname === module.path || pathname.startsWith(module.path + '/')
}

export function TopBar({ modules, counts }: TopBarProps) {
  const location = useLocation()
  const [showOverflow, setShowOverflow] = useState(false)
  const overflowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showOverflow) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (!overflowRef.current?.contains(target)) {
        setShowOverflow(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showOverflow])

  // Resolve current module name from path
  const currentModule = modules.find(
    (m) => isModuleActive(m, location.pathname),
  )
  const breadcrumb = currentModule
    ? BREADCRUMB_LABELS[currentModule.name] || currentModule.label.toUpperCase()
    : 'COMMAND ROOM'

  const primaryTabs = modules.filter(
    (m) => !m.hideFromNav && (m.navGroup ?? 'primary') === 'primary',
  )
  const secondaryTabs = modules.filter(
    (m) => !m.hideFromNav && m.navGroup === 'secondary',
  )
  const activeSecondary = secondaryTabs.some((mod) => isModuleActive(mod, location.pathname))

  const { running = 0, stale = 0, exited = 0, pending = 0 } = counts || {}

  return (
    <header style={headerStyle}>
      {/* Branding */}
      <div style={brandingStyle}>
        <span style={dotStyle} />
        <span style={nameStyle}>Hervald</span>
      </div>

      <span style={separatorStyle}>/</span>

      {/* Breadcrumb — current page */}
      <span style={breadcrumbStyle}>{breadcrumb}</span>

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Tab navigation */}
      <nav style={{ display: 'flex', gap: 4, marginRight: 16 }}>
        {primaryTabs.map((mod) => (
          <NavLink
            key={mod.name}
            to={mod.path}
            style={({ isActive }) => ({
              ...tabBase,
              color: isActive ? 'var(--washi-white)' : '#6f6c67',
              borderBottom: isActive
                ? '1px solid var(--washi-white)'
                : '1px solid transparent',
            })}
          >
            {TAB_LABELS[mod.name] || mod.label}
          </NavLink>
        ))}
        {secondaryTabs.length > 0 && (
          <div ref={overflowRef} style={{ position: 'relative' }}>
            <button
              type="button"
              style={{
                ...overflowButtonStyle,
                color: activeSecondary || showOverflow ? 'var(--washi-white)' : '#6f6c67',
                borderBottom:
                  activeSecondary || showOverflow
                    ? '1px solid var(--washi-white)'
                    : '1px solid transparent',
              }}
              onClick={() => setShowOverflow((current) => !current)}
            >
              Ops
            </button>
            {showOverflow && (
              <div style={overflowMenuStyle}>
                {secondaryTabs.map((mod) => (
                  <NavLink
                    key={mod.name}
                    to={mod.path}
                    onClick={() => setShowOverflow(false)}
                    style={({ isActive }) => ({
                      ...tabBase,
                      color: isActive ? 'var(--washi-white)' : '#a09d96',
                      borderBottom: 'none',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                    })}
                  >
                    {TAB_LABELS[mod.name] || mod.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Status counters */}
      <div style={countersStyle}>
        <span>
          <b style={countValueStyle}>{running}</b> running
        </span>
        <span style={{ color: '#3a3a3d' }}>·</span>
        <span>
          <b style={countValueStyle}>{stale}</b> stale
        </span>
        <span style={{ color: '#3a3a3d' }}>·</span>
        <span>
          <b style={countValueStyle}>{exited}</b> exited
        </span>
        <span style={{ color: '#3a3a3d' }}>·</span>
        <span style={{ color: 'var(--vermillion-seal)' }}>
          <b style={{ fontWeight: 500 }}>{pending}</b> pending
        </span>
      </div>
    </header>
  )
}
