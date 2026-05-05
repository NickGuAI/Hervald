import { useEffect, useState } from 'react'

const NARROW_QUERY = '(max-width: 767px)'
const COARSE_PHONE_QUERY = '(pointer: coarse) and (max-width: 932px)'

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

  return (
    window.matchMedia(NARROW_QUERY).matches
    || window.matchMedia(COARSE_PHONE_QUERY).matches
  )
}

/**
 * Returns true when the viewport is narrower than 768px or when a coarse-pointer
 * phone remains within the landscape mobile envelope. `?surface=mobile` and
 * `?surface=desktop` override the viewport check so the mobile shell can be
 * exercised from a desktop browser.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(readIsMobile)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const narrowMql = window.matchMedia(NARROW_QUERY)
    const coarsePhoneMql = window.matchMedia(COARSE_PHONE_QUERY)
    const update = () => setIsMobile(readIsMobile())
    const handler = () => update()

    update()
    narrowMql.addEventListener('change', handler)
    coarsePhoneMql.addEventListener('change', handler)
    window.addEventListener('popstate', update)

    return () => {
      narrowMql.removeEventListener('change', handler)
      coarsePhoneMql.removeEventListener('change', handler)
      window.removeEventListener('popstate', update)
    }
  }, [])

  return isMobile
}
