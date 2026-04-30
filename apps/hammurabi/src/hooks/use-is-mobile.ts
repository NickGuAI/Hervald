import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

function readSurfaceOverride(): boolean | null {
  if (typeof window === 'undefined') {
    return null
  }

  const override = new URLSearchParams(window.location.search).get('surface')
  if (override === 'mobile') {
    return true
  }
  if (override === 'desktop') {
    return false
  }
  return null
}

function readIsMobile(): boolean {
  const override = readSurfaceOverride()
  if (override !== null) {
    return override
  }

  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia(MOBILE_QUERY).matches
}

/**
 * Returns true when the viewport is narrower than 768px (below the `md` breakpoint).
 * `?surface=mobile` and `?surface=desktop` override the viewport check so the mobile
 * shell can be exercised from a desktop browser.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(readIsMobile)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mql = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(readIsMobile())
    const handler = () => update()

    update()
    mql.addEventListener('change', handler)
    window.addEventListener('popstate', update)

    return () => {
      mql.removeEventListener('change', handler)
      window.removeEventListener('popstate', update)
    }
  }, [])

  return isMobile
}
