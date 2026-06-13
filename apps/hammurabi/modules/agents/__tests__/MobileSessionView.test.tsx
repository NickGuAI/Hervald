// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileSessionView } from '../page-shell/MobileSessionView'
import type { MobileSessionShell } from '../page-shell/MobileSessionShell'

type ShellProps = ComponentProps<typeof MobileSessionShell>

const mocks = vi.hoisted(() => ({
  pendingRequest: new Promise<never>(() => {
    // Keep startup requests unresolved so this test only exercises sheet markup.
  }),
}))

vi.mock('@/hooks/use-is-mobile', () => ({
  useIsMobile: () => true,
}))

vi.mock('@/hooks/use-agent-session-stream', () => ({
  issueAgentSessionStreamTicket: vi.fn(() => mocks.pendingRequest),
  postInputViaHttpFallback: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  fetchJson: vi.fn(() => mocks.pendingRequest),
  getAccessToken: vi.fn(),
  isAuthRecoveryRequiredError: vi.fn(() => false),
}))

vi.mock('../../workspace/use-workspace', () => ({
  openWorkspaceTarget: vi.fn(),
}))

vi.mock('../page-shell/MobileSessionShell', () => ({
  MobileSessionShell: ({ onOpenWorkers }: ShellProps) => (
    <button type="button" onClick={onOpenWorkers} aria-label="Open workers">
      Open workers
    </button>
  ),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderMobileSessionView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  flushSync(() => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MobileSessionView
          sessionName="commander-atlas"
          onClose={vi.fn()}
          onKill={vi.fn(async () => undefined)}
        />
      </QueryClientProvider>,
    )
  })
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector(`button[aria-label="${label}"]`)
  expect(button, `Expected button with aria-label: ${label}`).not.toBeNull()
  return button as HTMLButtonElement
}

function findButtonByText(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label))
  expect(button, `Expected button with text: ${label}`).not.toBeNull()
  return button as HTMLButtonElement
}

function expectMobileTapTarget(button: HTMLButtonElement) {
  expect(button.classList.contains('min-h-[44px]')).toBe(true)
  expect(button.classList.contains('min-w-[44px]')).toBe(true)
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
  }

  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('MobileSessionView', () => {
  it('labels Workers and Dispatch sheet close buttons with 44px tap targets', () => {
    renderMobileSessionView()

    flushSync(() => {
      findButtonByLabel('Open workers').click()
    })

    const workersClose = findButtonByLabel('Close workers')
    expectMobileTapTarget(workersClose)

    flushSync(() => {
      findButtonByText('+ Dispatch New').click()
    })

    const dispatchClose = findButtonByLabel('Close dispatch worker')
    expectMobileTapTarget(dispatchClose)
  })
})
