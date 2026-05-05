import { NavLink } from 'react-router-dom'
import type { LucideProps } from 'lucide-react'
import {
  Monitor,
  BarChart3,
  Server,
  Settings,
  Users,
  Crown,
  ClipboardCheck,
  Clock3,
  Swords,
  CalendarClock,
  FolderOpen,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  Monitor,
  BarChart3,
  Server,
  Users,
  Crown,
  ClipboardCheck,
  Clock3,
  Swords,
  CalendarClock,
  FolderOpen,
  ShieldCheck,
  Settings,
}

/** Short labels for mobile bottom nav */
const SHORT_LABELS: Record<string, string> = {
  'command-room': 'Command',
  'api-keys': 'Settings',
}

interface NavItem {
  name: string
  label: string
  icon: string
  path: string
  badge?: number
  hideFromNav?: boolean
  navGroup?: 'primary' | 'secondary'
}

export function BottomNav({
  modules,
  forceVisible = false,
}: {
  modules: NavItem[]
  forceVisible?: boolean
}) {
  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-20 flex items-stretch justify-around border-t border-ink-border bg-washi-white pb-[env(safe-area-inset-bottom,0px)]',
        !forceVisible && 'md:hidden',
      )}
    >
      {modules.filter((mod) => !mod.hideFromNav && (mod.navGroup ?? 'primary') === 'primary').map((mod) => {
        const Icon = iconMap[mod.icon]
        return (
          <NavLink
            key={mod.name}
            to={mod.path}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center gap-1 pt-2.5 pb-2 text-sumi-black/70 transition-colors duration-300',
                isActive && 'text-sumi-black',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  {Icon && <Icon size={24} />}
                  {mod.badge && mod.badge > 0 ? (
                    <span className="absolute right-[-6px] top-0 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent-vermillion px-1 text-[9px] font-semibold leading-none text-washi-white">
                      {mod.badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-[12px] uppercase tracking-wider">
                  {SHORT_LABELS[mod.name] ?? mod.label}
                </span>
                <span className={cn('block w-1 h-1 rounded-full', isActive ? 'bg-sumi-black' : 'bg-transparent')} />
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
