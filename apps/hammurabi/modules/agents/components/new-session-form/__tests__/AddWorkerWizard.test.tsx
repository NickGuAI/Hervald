// @vitest-environment jsdom

import { createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
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

vi.mock('@/hooks/use-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-providers')>()
  return {
    ...actual,
    useProviderRegistry: () => ({
    data: [
      {
        id: 'claude',
        label: 'Claude',
        eventProvider: 'claude',
        uiCapabilities: {
          supportsEffort: true,
          supportsAdaptiveThinking: true,
          supportsSkills: true,
          supportsLoginMode: true,
          permissionModes: [{ value: 'default', label: 'default', description: 'claude' }],
        },
        machineAuth: {
          cliBinaryName: 'claude',
          authEnvKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
          supportedAuthModes: ['setup-token'],
          requiresSecretModes: ['setup-token'],
          loginStatusCommand: 'claude auth status',
        },
      },
      {
        id: 'codex',
        label: 'Codex',
        eventProvider: 'codex',
        uiCapabilities: {
          supportsEffort: false,
          supportsAdaptiveThinking: false,
          supportsSkills: false,
          supportsLoginMode: true,
          permissionModes: [{ value: 'default', label: 'default', description: 'codex' }],
        },
        machineAuth: {
          cliBinaryName: 'codex',
          authEnvKeys: ['OPENAI_API_KEY'],
          supportedAuthModes: ['api-key', 'device-auth'],
          requiresSecretModes: ['api-key'],
          loginStatusCommand: 'codex login status',
        },
      },
      {
        id: 'gemini',
        label: 'Gemini',
        eventProvider: 'gemini',
        uiCapabilities: {
          supportsEffort: false,
          supportsAdaptiveThinking: false,
          supportsSkills: false,
          supportsLoginMode: false,
          forcedTransport: 'stream',
          permissionModes: [{ value: 'default', label: 'default', description: 'gemini' }],
        },
        machineAuth: {
          cliBinaryName: 'gemini',
          authEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
          supportedAuthModes: ['api-key'],
          requiresSecretModes: ['api-key'],
          loginStatusCommand: null,
        },
      },
    ],
    }),
  }
})

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
    machineId: 'atlas-mac-mini',
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
        verificationCommand: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || test -n "$ANTHROPIC_API_KEY" || test -n "$ANTHROPIC_AUTH_TOKEN" || claude auth status)',
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
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

async function flushTasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
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

  flushSync(() => {
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
  await flushTasks()
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
      id: 'atlas-mac-mini',
      label: 'Workshop Mac Mini',
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
      flushSync(() => {
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

  it('renders provider auth cards from the registry for an existing worker', async () => {
    await renderWizard({
      initialMachine: {
        id: 'atlas-mac-mini',
        label: 'Workshop Mac Mini',
        host: 'tail2bb6ea.ts.net',
        user: 'yugu',
        port: 22,
      },
    })

    expect(document.body.textContent).toContain('Configure provider auth on Workshop Mac Mini.')
    expect(document.body.textContent).toContain('Provider auth guide')
    expect(document.body.textContent).toContain('Claude')
    expect(document.body.textContent).toContain('Codex')
    expect(document.body.textContent).toContain('Gemini')
    expect(document.body.textContent).toContain('Save token and verify')
    expect(document.body.textContent).toContain('Save API key and verify')
    expect(document.body.textContent).toContain('Finish worker setup')
  })
})
