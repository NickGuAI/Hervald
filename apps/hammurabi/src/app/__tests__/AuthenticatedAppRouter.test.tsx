// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FrontendModuleBinding } from '@/types'
import type { HammurabiModuleGraphResponse } from '@/types/module-graph-api'
import type { OnboardingStatus } from '@modules/onboarding/contracts'

const mocks = vi.hoisted(() => ({
  useOnboardingStatus: vi.fn(),
}))

vi.mock('@modules/onboarding/hooks/useFounderOnboarding', () => ({
  useOnboardingStatus: mocks.useOnboardingStatus,
}))

vi.mock('@/surfaces/desktop/Shell', () => ({
  Shell: ({ children, modules }: { children: ReactNode; modules: unknown[] }) => (
    <div data-testid="shell" data-module-count={modules.length}>{children}</div>
  ),
}))

vi.mock('../use-shell-counts', () => ({
  useShellCounts: () => ({ running: 0, stale: 0, exited: 0, pending: 0 }),
}))

import { AuthenticatedAppRouter } from '../AuthenticatedAppRouter'

let root: Root | null = null
let container: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

function createBinding(routeId: string, componentKey: string, testId: string): FrontendModuleBinding {
  return {
    name: testId,
    routeId,
    componentKey,
    component: async () => ({
      default: () => <div data-testid={testId}>{testId}</div>,
    }),
  }
}

const testBindings: FrontendModuleBinding[] = [
  createBinding('onboarding.ui', 'modules/onboarding/page', 'welcome-page'),
  createBinding('command-room.ui', 'modules/command-room/page', 'command-room-page'),
  createBinding('org.ui', 'modules/org/page', 'org-page'),
  createBinding('automations.ui', 'modules/automations/page', 'automations-page'),
]

const moduleGraph: HammurabiModuleGraphResponse = {
  modules: [
    {
      id: 'onboarding',
      label: 'Onboarding',
      status: 'public',
      summary: 'Founder setup.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop'],
        routes: [{
          id: 'onboarding.ui',
          path: '/welcome',
          componentKey: 'modules/onboarding/page',
          surfaces: ['desktop'],
        }],
      },
    },
    {
      id: 'command-room',
      label: 'Command Room',
      status: 'public',
      summary: 'Commander workspace.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop'],
        routes: [{
          id: 'command-room.ui',
          path: '/command-room',
          componentKey: 'modules/command-room/page',
          surfaces: ['desktop'],
        }],
        redirects: [{
          id: 'command-room.legacy-automations-redirect',
          from: '/command-room/automations',
          toRouteId: 'automations.ui',
        }],
      },
    },
    {
      id: 'org',
      label: 'Org',
      status: 'public',
      summary: 'Organization.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['desktop', 'mobile'],
        routes: [{
          id: 'org.ui',
          path: '/org',
          componentKey: 'modules/org/page',
          surfaces: ['desktop', 'mobile'],
        }],
      },
    },
    {
      id: 'automations',
      label: 'Automations',
      status: 'public',
      summary: 'Automation dashboard.',
      capabilities: { provides: [], consumes: [] },
      dependencies: { modules: [], capabilities: [] },
      ui: {
        kind: 'route',
        surfaces: ['mobile'],
        routes: [{
          id: 'automations.ui',
          path: '/automations',
          componentKey: 'modules/automations/page',
          surfaces: ['mobile'],
        }],
      },
    },
  ],
  routes: [],
  parsers: [],
  websockets: [],
  storage: [],
  nav: [
    {
      moduleId: 'org',
      routeId: 'org.ui',
      path: '/org',
      label: 'Org',
      icon: 'Users',
      group: 'primary',
      hidden: false,
      surfaces: ['desktop', 'mobile'],
      order: 10,
    },
    {
      moduleId: 'command-room',
      routeId: 'command-room.ui',
      path: '/command-room',
      label: 'Command Room',
      icon: 'RadioTower',
      group: 'primary',
      hidden: false,
      surfaces: ['desktop'],
      order: 20,
    },
    {
      moduleId: 'automations',
      routeId: 'automations.ui',
      path: '/automations',
      label: 'Automations',
      icon: 'CalendarClock',
      group: 'primary',
      hidden: false,
      surfaces: ['mobile'],
      order: 30,
    },
  ],
  providers: [],
}

function onboardingStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  const founderSetup = overrides.founderSetup ?? {
    setupComplete: true,
    defaultValues: {
      orgDisplayName: 'Gehirn Inc.',
      founderDisplayName: 'Nick Gu',
      founderEmail: 'nick@example.com',
    },
    validationErrors: {},
    nextRoute: '/org',
  }
  const gaia = overrides.gaia ?? {
    commanderId: 'commander-gaia',
    displayName: 'Gaia',
    avatarUrl: '/assets/commanders/gaia-profile.png',
    exists: true,
    conversationId: 'conversation-gaia',
    defaultProviderId: 'claude',
  }
  const starterWorkforce = overrides.starterWorkforce ?? {
    packages: [],
    installedCount: 3,
    totalCount: 3,
    skipped: false,
    complete: true,
  }

  return {
    currentStepId: 'launch',
    steps: [
      { id: 'instance', label: 'Instance ready', state: 'complete', summary: 'Local Hervald app and bootstrap admin are available.' },
      { id: 'founder-org', label: 'Founder + organization', state: founderSetup.setupComplete ? 'complete' : 'current', summary: 'Create founder and organization.' },
      { id: 'gaia', label: 'Gaia commander', state: gaia.exists ? 'complete' : 'current', summary: 'Seed Gaia.' },
      { id: 'starter-workforce', label: 'Starter workforce', state: starterWorkforce.complete ? 'complete' : 'current', summary: 'Install starter commanders.' },
      { id: 'providers-machines', label: 'Providers + machines', state: 'complete', summary: 'Providers and machines ready.' },
      { id: 'launch', label: 'Launch', state: 'current', summary: 'Open Hervald.' },
    ],
    founderSetup,
    gaia,
    starterWorkforce,
    providers: [],
    machines: [{
      id: 'local',
      label: 'Local',
      transport: 'local',
      state: 'ready',
      envFile: null,
      cwd: null,
      summary: 'Local machine ready.',
    }],
    receipt: {
      url: 'http://localhost:20001/org',
      account: 'local bootstrap admin',
      organization: founderSetup.defaultValues.orgDisplayName || null,
      founder: founderSetup.defaultValues.founderDisplayName || null,
      commander: gaia.exists ? gaia.displayName : null,
      machine: 'Local',
      providerSummary: 'Provider ready',
    },
    launchTarget: '/command-room?commander=commander-gaia&conversation=conversation-gaia',
    ...overrides,
  }
}

async function renderRouter(initialEntry: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AuthenticatedAppRouter componentBindings={testBindings} moduleGraph={moduleGraph} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

describe('AuthenticatedAppRouter', () => {
  beforeEach(() => {
    mocks.useOnboardingStatus.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    queryClient?.clear()
    queryClient = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('keeps existing founders in the normal shell and does not show onboarding', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="command-room-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="welcome-page"]')).toBeNull()
  })

  it('registers the top-level automations route inside the shell', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/automations')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="automations-page"]')).not.toBeNull()
    })
  })

  it('keeps launch-ready welcome visits mounted for the explicit launch action', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/welcome')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="welcome-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="shell"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="org-page"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })

  it('redirects the legacy command-room automations path to the top-level route', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room/automations')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="automations-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })

  it('routes missing-founder sessions to onboarding before the shell mounts', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus({
        currentStepId: 'founder-org',
        founderSetup: {
          setupComplete: false,
          defaultValues: {
            orgDisplayName: '',
            founderDisplayName: '',
            founderEmail: '',
          },
          validationErrors: {
            orgDisplayName: 'Org display name is required.',
            founderDisplayName: 'Founder display name is required.',
            founderEmail: 'Founder email is required.',
          },
          nextRoute: '/welcome',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/command-room')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="welcome-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="shell"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="command-room-page"]')).toBeNull()
  })

  it('keeps founder-complete but Gaia-incomplete sessions on welcome before the shell mounts', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus({
        currentStepId: 'gaia',
        gaia: {
          commanderId: null,
          displayName: 'Gaia',
          avatarUrl: '/assets/commanders/gaia-profile.png',
          exists: false,
          conversationId: null,
          defaultProviderId: 'claude',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/org')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="welcome-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="shell"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="org-page"]')).toBeNull()
  })

  it('does not lock completed installs out of the shell when provider readiness regresses', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus({
        currentStepId: 'providers-machines',
        steps: [
          { id: 'instance', label: 'Instance ready', state: 'complete', summary: 'Local Hervald app and bootstrap admin are available.' },
          { id: 'founder-org', label: 'Founder + organization', state: 'complete', summary: 'Founder exists.' },
          { id: 'gaia', label: 'Gaia commander', state: 'complete', summary: 'Gaia exists.' },
          { id: 'starter-workforce', label: 'Starter workforce', state: 'complete', summary: 'Starter commanders are installed.' },
          { id: 'providers-machines', label: 'Providers + machines', state: 'warning', summary: 'Provider auth needs attention.' },
          { id: 'launch', label: 'Launch', state: 'pending', summary: 'Open Hervald.' },
        ],
        providers: [{
          id: 'claude',
          label: 'Claude',
          cliBinaryName: 'claude',
          installed: true,
          authConfigured: false,
          authMode: 'missing',
          state: 'warning',
          shortAction: 'Run claude login and return here.',
          verificationCommand: 'claude auth status',
          envSourceKey: null,
        }],
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/org')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="org-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="welcome-page"]')).toBeNull()
  })

  it('treats a skipped starter workforce as a completed initial onboarding gate', async () => {
    mocks.useOnboardingStatus.mockReturnValue({
      data: onboardingStatus({
        starterWorkforce: {
          packages: [],
          installedCount: 0,
          totalCount: 3,
          skipped: true,
          complete: true,
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    await renderRouter('/org')

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="shell"]')).not.toBeNull()
      expect(document.body.querySelector('[data-testid="org-page"]')).not.toBeNull()
    })
    expect(document.body.querySelector('[data-testid="welcome-page"]')).toBeNull()
  })
})
