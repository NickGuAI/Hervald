import { Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { FOUNDER_SETUP_PATH } from '@modules/onboarding/contracts'
import { useFounderSetupStatus } from '@modules/onboarding/hooks/useFounderOnboarding'
import type { FrontendModule } from '@/types'
import { Shell } from '@/surfaces/desktop/Shell'

const AutomationsPage = lazy(() => import('@modules/automations/page'))

interface ModuleRoute {
  path: string
  Component: LazyExoticComponent<ComponentType>
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-3 w-3 animate-breathe rounded-full bg-sumi-mist" />
    </div>
  )
}

function StartupError({
  error,
  onRetry,
}: {
  error: Error
  onRetry: () => void
}) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-8">
      <div className="card-sumi flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-medium text-sumi-black">Hervald</h1>
        <p className="text-sm text-sumi-diluted">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

export function AuthenticatedAppRouter({
  modules,
}: {
  modules: FrontendModule[]
}) {
  const onboardingModule = modules.find((module) => module.path === FOUNDER_SETUP_PATH)
  const shellModules = useMemo(
    () => modules.filter((module) => module.path !== FOUNDER_SETUP_PATH),
    [modules],
  )
  const shellModuleRoutes = useMemo<ModuleRoute[]>(
    () => shellModules.map((module) => ({
      path: module.path,
      Component: lazy(module.component),
    })),
    [shellModules],
  )
  const OnboardingPage = useMemo(
    () => (onboardingModule ? lazy(onboardingModule.component) : null),
    [onboardingModule],
  )
  const founderSetup = useFounderSetupStatus()

  if (!OnboardingPage) {
    throw new Error(`Onboarding route "${FOUNDER_SETUP_PATH}" is not registered`)
  }

  if (founderSetup.error) {
    return (
      <StartupError
        error={founderSetup.error as Error}
        onRetry={() => {
          void founderSetup.refetch()
        }}
      />
    )
  }

  if (founderSetup.isLoading || !founderSetup.data) {
    return <Loading />
  }

  if (founderSetup.data.needsSetup) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path={`${FOUNDER_SETUP_PATH}/*`} element={<OnboardingPage />} />
          <Route path="*" element={<Navigate to={FOUNDER_SETUP_PATH} replace />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Shell modules={modules}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/org" replace />} />
          <Route path={FOUNDER_SETUP_PATH} element={<Navigate to="/command-room" replace />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/command-room/automations" element={<Navigate to="/automations" replace />} />
          {shellModuleRoutes.map((route) => (
            <Route
              key={route.path}
              path={`${route.path}/*`}
              element={<route.Component />}
            />
          ))}
        </Routes>
      </Suspense>
    </Shell>
  )
}
