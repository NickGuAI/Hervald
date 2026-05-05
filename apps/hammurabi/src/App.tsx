import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { LandingPage } from '@/components/LandingPage'
import { ApiKeyLandingPage } from '@/components/ApiKeyLandingPage'
import { Shell } from '@/surfaces/hervald/Shell'
import { AuthProvider } from '@/contexts/AuthContext'
import { modules } from '@/module-registry'
import { setAccessTokenResolver, setUnauthorizedHandler } from '@/lib/api'
import { isCapacitorNative } from '@/lib/api-base'
import { ThemeProvider } from '@/lib/theme-context'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { ApprovalCenter } from '../modules/approvals/ApprovalCenter'

const API_KEY_STORAGE = 'hammurabi_api_key'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
    },
  },
})

function Loading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-3 h-3 rounded-full bg-sumi-mist animate-breathe" />
    </div>
  )
}

// Build lazy components from module registry
const moduleRoutes = modules.map((mod) => ({
  path: mod.path,
  Component: lazy(mod.component),
}))

function AppFrame({
  signOut,
  user,
}: {
  signOut: () => void
  user?: {
    name?: string | null
    email?: string | null
    picture?: string | null
  }
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider signOut={signOut} user={user}>
            <Shell modules={modules}>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/org" replace />} />
                  {moduleRoutes.map((route) => (
                    <Route
                      key={route.path}
                      path={route.path + '/*'}
                      element={<route.Component />}
                    />
                  ))}
                </Routes>
              </Suspense>
            </Shell>
            {/*
              ApprovalCenter is the global desktop floating drawer. Mobile has
              the canonical /command-room/inbox route as its native approvals
              surface, so the global drawer must NOT render on mobile — it
              would overlay every Hervald mobile route (including the Inbox
              tab itself) with a duplicate approvals queue. Gate at the mount
              layer, not inside ApprovalCenter's render, so mobile doesn't pay
              the hook + subscription cost.
            */}
            <DesktopOnlyApprovalCenter />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function DesktopOnlyApprovalCenter() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return null
  }
  return <ApprovalCenter />
}

function AuthTokenBridge() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0()

  useEffect(() => {
    setAccessTokenResolver(async () => {
      if (!isAuthenticated) {
        return null
      }

      try {
        return await getAccessTokenSilently()
      } catch {
        return null
      }
    })

    return () => {
      setAccessTokenResolver(null)
    }
  }, [getAccessTokenSilently, isAuthenticated])

  return null
}

function AuthGuard({
  onApiKeySubmit,
}: {
  onApiKeySubmit: (key: string) => void
}) {
  const { isLoading, isAuthenticated } = useAuth0()

  if (isLoading) {
    return <Loading />
  }

  if (!isAuthenticated) {
    return <LandingPage onApiKeySubmit={onApiKeySubmit} />
  }

  return <Auth0AppFrame />
}

function Auth0AppFrame() {
  const { logout, user } = useAuth0()
  const signOut = useCallback(() => {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }, [logout])
  return <AppFrame signOut={signOut} user={user} />
}

export default function App() {
  const domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim() ?? ''
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE?.trim() ?? ''
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim() ?? ''
  const auth0Enabled = Boolean(domain && audience && clientId)

  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    const storedKey = typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE) : null
    if (storedKey) {
      setAccessTokenResolver(() => Promise.resolve(storedKey))
    }
    return storedKey
  })

  function handleApiKeySubmit(key: string) {
    const trimmed = key.trim()
    if (!trimmed) return
    localStorage.setItem(API_KEY_STORAGE, trimmed)
    setAccessTokenResolver(() => Promise.resolve(trimmed))
    setApiKeyState(trimmed)
  }

  const handleSignOut = useCallback(() => {
    localStorage.removeItem(API_KEY_STORAGE)
    setAccessTokenResolver(null)
    setApiKeyState(null)
  }, [])

  useEffect(() => {
    if (apiKey) {
      setAccessTokenResolver(() => Promise.resolve(apiKey))
      return () => setAccessTokenResolver(null)
    }
  }, [apiKey])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      handleSignOut()
    })
    return () => setUnauthorizedHandler(null)
  }, [handleSignOut])

  // API key auth: bypass Auth0, use stored key for all requests
  if (apiKey) {
    return <AppFrame signOut={handleSignOut} />
  }

  // Capacitor: Auth0 checkSession hangs in WebView (iframe/cookie restrictions).
  // Skip Auth0 and use API key only.
  if (!auth0Enabled || isCapacitorNative()) {
    if (apiKey) {
      return <AppFrame signOut={handleSignOut} />
    }
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ApiKeyLandingPage onApiKeySubmit={handleApiKeySubmit} />
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        audience,
        redirect_uri: window.location.origin,
      }}
    >
      <AuthTokenBridge />
      <AuthGuard onApiKeySubmit={handleApiKeySubmit} />
    </Auth0Provider>
  )
}
