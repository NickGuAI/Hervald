import { useLocation, useSearchParams } from 'react-router-dom'
import type { FrontendNavItem } from '@/types'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import { normalizeCommandRoomRouteMetadata } from '@modules/command-room/route-metadata'
import { MOBILE_SHELL_BOTTOM_PADDING_CLASS } from '@/styles/mobile-shell'
import { MobileBottomTabs } from './MobileBottomTabs'
import { isImmersiveMobileChatRoute } from './mobile-shell-routes'

interface MobileShellChromeState {
  shouldRenderMobileChrome: boolean
  mainPaddingClassName: string
}

interface UseMobileShellChromeStateArgs {
  isMobile: boolean
}

interface MobileShellChromeProps {
  modules: FrontendNavItem[]
  pendingCount: number
}

export function useMobileShellChromeState({
  isMobile,
}: UseMobileShellChromeStateArgs): MobileShellChromeState {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const moduleGraph = useModuleGraphContext()
  const routeMetadata = normalizeCommandRoomRouteMetadata(
    findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
  )
  const inImmersiveChat = isImmersiveMobileChatRoute(
    location.pathname,
    searchParams,
    routeMetadata,
  )

  return {
    shouldRenderMobileChrome: isMobile,
    mainPaddingClassName:
      isMobile && !inImmersiveChat ? MOBILE_SHELL_BOTTOM_PADDING_CLASS : '',
  }
}

export function MobileShellChrome({ modules, pendingCount }: MobileShellChromeProps) {
  return <MobileBottomTabs modules={modules} pendingCount={pendingCount} />
}
