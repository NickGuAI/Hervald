import { useLocation, useSearchParams } from 'react-router-dom'
import { MobileBottomTabs } from './MobileBottomTabs'
import {
  MOBILE_SHELL_BOTTOM_PADDING_CLASS,
  isImmersiveMobileChatRoute,
} from './mobile-shell-routes'

interface MobileShellChromeState {
  shouldRenderMobileChrome: boolean
  mainPaddingClassName: string
}

interface UseMobileShellChromeStateArgs {
  isMobile: boolean
}

interface MobileShellChromeProps {
  pendingCount: number
}

export function useMobileShellChromeState({
  isMobile,
}: UseMobileShellChromeStateArgs): MobileShellChromeState {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const inImmersiveChat = isImmersiveMobileChatRoute(
    location.pathname,
    searchParams,
  )

  return {
    shouldRenderMobileChrome: isMobile,
    mainPaddingClassName:
      isMobile && !inImmersiveChat ? MOBILE_SHELL_BOTTOM_PADDING_CLASS : '',
  }
}

export function MobileShellChrome({ pendingCount }: MobileShellChromeProps) {
  return <MobileBottomTabs pendingCount={pendingCount} />
}
