// @vitest-environment jsdom

import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMachine: vi.fn(),
  setupMachineAuth: vi.fn(),
  useMachineAuthStatus: vi.fn(),
}))

vi.mock('@/hooks/use-agents', () => ({
  createMachine: mocks.createMachine,
  setupMachineAuth: mocks.setupMachineAuth,
  useMachineAuthStatus: mocks.useMachineAuthStatus,
}))

vi.mock('@modules/components/ModalFormContainer', () => ({
  ModalFormContainer: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? createElement('div', null, children) : null),
}))

import { AddWorkerWizard } from '../AddWorkerWizard'

let root: Root | null = null
let container: HTMLDivElement | null = null
let authStatus: {
  machineId: string
  envFile: string | null
  checkedAt: string
  providers: Record<string, Record<string, unknown>>
} | undefined

function baseAuthStatus() {
  return {
    machineId: 'athena-mac-mini',
    envFile: '/Users/yugu/.hammurabi-env',
    checkedAt: '2026-04-29T19:00:00.000Z',
    providers: {
      claude: {
        provider: 'claude',
        label: 'Claude',
        installed: true,
        version: '1.0.31',
        envConfigured: false,
        envSourceKey: null,
        loginConfigured: false,
        configured: false,
        currentMethod: 'missing',
        verificationCommand: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
      },
      codex: {
        provider: 'codex',
        label: 'Codex',
        installed: true,
        version: '0.1.2503271400',
        envConfigured: false,
        envSourceKey: null,
        loginConfigured: false,
        configured: false,
        currentMethod: 'missing',
        verificationCommand: 'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
      },
      gemini: {
        provider: 'gemini',
        label: 'Gemini',
        installed: true,
        version: '0.1.18',
        envConfigured: false,
        envSourceKey: null,
        loginConfigured: false,
        configured: false,
        currentMethod: 'missing',
        verificationCommand: 'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
      },
    },
  }
}

function setElementValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderWizard(props: Partial<ComponentProps<typeof AddWorkerWizard>> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AddWorkerWizard
          open
          onClose={props.onClose ?? vi.fn()}
          onMachineReady={props.onMachineReady}
          initialMachine={props.initialMachine}
        />
      </QueryClientProvider>,
    )
  })
}

describe('AddWorkerWizard', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    authStatus = baseAuthStatus()

    mocks.useMachineAuthStatus.mockImplementation(() => ({
      data: authStatus,
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: authStatus })),
    }))

    mocks.createMachine.mockResolvedValue({
      id: 'athena-mac-mini',
      label: 'Athena Mac Mini',
      host: 'tail2bb6ea.ts.net',
      user: 'yugu',
      port: 22,
    })

    mocks.setupMachineAuth.mockImplementation(async () => {
      authStatus = {
        ...baseAuthStatus(),
        providers: {
          ...baseAuthStatus().providers,
          claude: {
            ...baseAuthStatus().providers.claude,
            envConfigured: true,
            envSourceKey: 'CLAUDE_CODE_OAUTH_TOKEN',
            configured: true,
            currentMethod: 'setup-token',
          },
        },
      }
      return authStatus
    })
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
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('creates a worker, verifies Claude setup-token auth, and finishes with the selected machine', async () => {
    const onClose = vi.fn()
    const onMachineReady = vi.fn()
    await renderWizard({ onClose, onMachineReady })

    const inputs = Array.from(document.body.querySelectorAll('input')) as HTMLInputElement[]
    const labelInput = inputs.find((input) => input.placeholder === 'Athena Mac Mini')
    const hostInput = inputs.find((input) => input.placeholder === 'tail2bb6ea.ts.net')

    await act(async () => {
      if (!labelInput || !hostInput) {
        throw new Error('Worker connection inputs missing')
      }
      setElementValue(labelInput, 'Athena Mac Mini')
      setElementValue(hostInput, 'tail2bb6ea.ts.net')
    })

    const continueButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Continue to provider auth'),
    ) as HTMLButtonElement | undefined

    await act(async () => {
      continueButton?.click()
    })

    expect(mocks.createMachine).toHaveBeenCalledWith({
      id: 'athena-mac-mini',
      label: 'Athena Mac Mini',
      host: 'tail2bb6ea.ts.net',
    })

    const providerCheckboxes = Array.from(
      document.body.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[]
    const codexCheckbox = providerCheckboxes[1]
    const geminiCheckbox = providerCheckboxes[2]

    await act(async () => {
      for (const checkbox of [codexCheckbox, geminiCheckbox]) {
        checkbox?.click()
      }
    })

    const textareas = Array.from(document.body.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    const claudeTokenField = textareas[0]
    expect(claudeTokenField).toBeDefined()

    await act(async () => {
      setElementValue(claudeTokenField, 'claude-token-value')
    })

    const saveTokenButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save token and verify'),
    ) as HTMLButtonElement | undefined

    await act(async () => {
      saveTokenButton?.click()
    })

    expect(mocks.setupMachineAuth).toHaveBeenCalledWith('athena-mac-mini', {
      provider: 'claude',
      mode: 'setup-token',
      secret: 'claude-token-value',
    })
    expect(document.body.textContent).toContain('Claude is ready on this worker.')

    const finishButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Finish worker setup'),
    ) as HTMLButtonElement | undefined

    await act(async () => {
      finishButton?.click()
    })

    expect(onMachineReady).toHaveBeenCalledWith({
      id: 'athena-mac-mini',
      label: 'Athena Mac Mini',
      host: 'tail2bb6ea.ts.net',
      user: 'yugu',
      port: 22,
    })
    expect(onClose).toHaveBeenCalled()
  })
})
