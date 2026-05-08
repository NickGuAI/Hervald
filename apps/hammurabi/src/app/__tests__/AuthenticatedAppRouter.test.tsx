// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FrontendModule } from '@/types'

const mocks = vi.hoisted(() => ({
  useFounderSetupStatus: vi.fn(),
}))

vi.mock('@modules/onboarding/hooks/useFounderOnboarding', () => ({
  useFounderSetupStatus: mocks.useFounderSetupStatus,
}))

vi.mock('@/surfaces/desktop/Shell', () => ({
  Shell: ({ children }: { children: ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}))

vi.mock('@modules/automations/page', () => ({
  default: () => <div data-testid="automations-page">automations</div>,
}))

import { AuthenticatedAppRouter } from '../AuthenticatedAppRouter'

let root: Root | null = null
let container: HTMLDivElement | null = null

function createModule(path: string, testId: string): FrontendModule {
  return {
    name: testId,
    label: testId,
    icon: 'Circle',
    path,
    component: async () => ({
      default: () => <div data-testid={testId}>{testId}</div>,
    }),
  }
}

const testModules: FrontendModule[] = [
  {
    ...createModule('/welcome', 'welcome-page'),
    hideFromNav: true,
  },
  createModule('/command-room', 'command-room-page'),
  createModule('/org', 'org-page'),
]

async function renderRouter(initialEntry: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthenticatedAppRouter modules={testModules} />
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
}

describe('AuthenticatedAppRouter', () => {
  beforeEach(() => {
    mocks.useFounderSetupStatus.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('keeps existing founders in the normal shell and does not show onboarding', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: { needsSetup: false },
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
    mocks.useFounderSetupStatus.mockReturnValue({
      data: { needsSetup: false },
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

  it('redirects the legacy command-room automations path to the top-level route', async () => {
    mocks.useFounderSetupStatus.mockReturnValue({
      data: { needsSetup: false },
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
    mocks.useFounderSetupStatus.mockReturnValue({
      data: { needsSetup: true },
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
})
