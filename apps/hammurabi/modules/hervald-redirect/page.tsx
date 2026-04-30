import { Navigate, useLocation } from 'react-router-dom'

const PANEL_BY_PATH: Record<string, string | undefined> = {
  '/agents': undefined,
  '/commanders': undefined,
  '/quests': 'quests',
  '/sentinels': 'sentinels',
  '/workspace': undefined,
}

export default function HervaldLegacyRedirectPage() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const panel = Object.entries(PANEL_BY_PATH).find(([path]) =>
    location.pathname === path || location.pathname.startsWith(path + '/')
  )?.[1]

  if (panel) {
    params.set('panel', panel)
  }

  const search = params.toString()
  return <Navigate to={`/command-room${search ? `?${search}` : ''}`} replace />
}
