// @vitest-environment jsdom

import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderAuthSnapshot, ProviderRegistryEntry } from '@/types'

const mocks = vi.hoisted(() => ({
  useProviderRegistry: vi.fn(),
  useProviderAuthSnapshots: vi.fn(),
  probeProviderAuthSnapshots: vi.fn(),
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
  getProviderLabel: (providers: Array<{ id: string; label: string }>, providerId: string) =>
    providers.find((provider) => provider.id === providerId)?.label ?? providerId,
}))

vi.mock('@/hooks/use-agents', () => ({
  useProviderAuthSnapshots: mocks.useProviderAuthSnapshots,
  probeProviderAuthSnapshots: mocks.probeProviderAuthSnapshots,
}))

import { ProviderAuthPanel } from '../ProviderAuthPanel'

let root: Root | null = null
let container: HTMLDivElement | null = null
let refetchSnapshots: ReturnType<typeof vi.fn>
let openWindow: ReturnType<typeof vi.fn>

const baseCapabilities: ProviderRegistryEntry['capabilities'] = {
  supportsAutomation: true,
  supportsCommanderConversation: true,
  supportsWorkerDispatch: true,
  supportsMessageImages: true,
}

const baseUiCapabilities: ProviderRegistryEntry['uiCapabilities'] = {
  supportsEffort: false,
  supportsAdaptiveThinking: false,
  supportsMaxThinkingTokens: false,
  supportsSkills: false,
  supportsLoginMode: false,
  permissionModes: [
    {
      value: 'default',
      label: 'Default',
      description: 'Use provider-managed permissions.',
    },
  ],
}

function providerEntry(
  id: string,
  label: string,
  machineAuth?: ProviderRegistryEntry['machineAuth'],
): ProviderRegistryEntry {
  return {
    id,
    label,
    eventProvider: id,
    capabilities: baseCapabilities,
    uiCapabilities: baseUiCapabilities,
    availableModels: [],
    supportedTransports: ['stream'],
    defaults: {
      transportType: 'stream',
      permissionMode: 'default',
      model: null,
    },
    disabledReason: null,
    ...(machineAuth ? { machineAuth } : {}),
  }
}

function machineAuth(
  cliBinaryName: string,
  authEnvKeys: string[],
  supportedAuthModes: NonNullable<ProviderRegistryEntry['machineAuth']>['supportedAuthModes'] = ['api-key'],
  loginStatusCommand: string | null = null,
): NonNullable<ProviderRegistryEntry['machineAuth']> {
  return {
    cliBinaryName,
    authEnvKeys,
    supportedAuthModes,
    requiresSecretModes: supportedAuthModes.filter((mode) => mode === 'api-key'),
    loginStatusCommand,
  }
}

function setProviderRegistry(providers: ProviderRegistryEntry[]) {
  mocks.useProviderRegistry.mockReturnValue({ data: providers })
}

function defaultProviderRegistry(): ProviderRegistryEntry[] {
  return [
    providerEntry(
      'codex',
      'Codex',
      machineAuth('codex', ['OPENAI_API_KEY'], ['api-key', 'device-auth'], 'codex login status'),
    ),
    providerEntry(
      'claude',
      'Claude Code',
      machineAuth(
        'claude',
        ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
        ['api-key', 'device-auth'],
        'claude auth status',
      ),
    ),
    providerEntry('gemini', 'Gemini CLI', machineAuth('gemini', ['GEMINI_API_KEY', 'GOOGLE_API_KEY'])),
    providerEntry('opencode', 'OpenCode', machineAuth('opencode', ['OPENCODE_API_KEY'])),
  ]
}

function renderPanel() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  return act(async () => {
    flushSync(() => {
      root?.render(<ProviderAuthPanel />)
    })
  })
}

function renderedText(): string {
  return container?.textContent ?? ''
}

function setSnapshots(snapshots: ProviderAuthSnapshot[]) {
  mocks.useProviderAuthSnapshots.mockReturnValue({
    data: { snapshots },
    refetch: refetchSnapshots,
  })
}

function authSnapshot(
  overrides: Partial<ProviderAuthSnapshot> & Pick<ProviderAuthSnapshot, 'provider'>,
): ProviderAuthSnapshot {
  const { provider, ...rest } = overrides
  return {
    provider,
    scopeId: overrides.scopeId ?? 'commander-1',
    host: overrides.host ?? 'local',
    status: overrides.status ?? 'auth_required',
    lastCheckedAt: overrides.lastCheckedAt ?? '2026-06-04T00:00:00.000Z',
    ...rest,
  }
}

describe('ProviderAuthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refetchSnapshots = vi.fn(async () => ({ data: { snapshots: [] } }))
    openWindow = vi.fn()
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: openWindow,
    })
    setProviderRegistry(defaultProviderRegistry())
    setSnapshots([])
    mocks.probeProviderAuthSnapshots.mockResolvedValue({ snapshots: [] })
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
    vi.restoreAllMocks()
  })

  it('renders visible provider auth controls without requiring snapshots', async () => {
    await renderPanel()

    expect(container?.querySelector('[data-testid="provider-auth-panel"]')).not.toBeNull()
    expect(renderedText()).toContain('Provider Auth')
    expect(renderedText()).toContain('Codex')
    expect(renderedText()).toContain('Claude Code')
    expect(renderedText()).toContain('Gemini CLI')
    expect(renderedText()).toContain('OpenCode')
    expect(renderedText()).toContain('Not connected')
    expect(renderedText()).toContain('Login steps')
  })

  it('renders every machine-auth provider from the registry without a panel allowlist', async () => {
    setProviderRegistry([
      ...defaultProviderRegistry(),
      providerEntry('test-runner', 'Test Runner', machineAuth('test-runner', ['TEST_RUNNER_API_KEY'])),
      providerEntry('docs-only', 'Docs Only'),
    ])

    await renderPanel()

    expect(container?.querySelector('[data-testid="provider-auth-row-codex"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="provider-auth-row-claude"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="provider-auth-row-gemini"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="provider-auth-row-opencode"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="provider-auth-row-test-runner"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="provider-auth-row-docs-only"]')).toBeNull()
    expect(renderedText()).toContain('Test Runner')
  })

  it('shows native Codex login instructions before any auth failure snapshot exists', async () => {
    await renderPanel()

    const loginStepsButton = container?.querySelector<HTMLButtonElement>('[data-testid="provider-auth-action-codex"]')
    expect(loginStepsButton).toBeDefined()

    await act(async () => {
      loginStepsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(openWindow).not.toHaveBeenCalled()
    expect(refetchSnapshots).not.toHaveBeenCalled()
    expect(renderedText()).toContain('Codex uses native CLI authentication')
    expect(renderedText()).toContain('codex login status')
    expect(renderedText()).toContain('codex login')
  })

  it('shows native Claude Code login instructions instead of starting Hervald OAuth', async () => {
    setSnapshots([
      authSnapshot({
        provider: 'claude',
        scopeId: 'commander-atlas',
        host: 'home-mac',
        detail: 'Claude Code login required.',
      }),
    ])

    await renderPanel()

    expect(renderedText()).toContain('Auth required')
    expect(renderedText()).toContain('commander-atlas on home-mac')
    expect(renderedText()).toContain('Claude Code login required.')

    const loginStepsButton = container?.querySelector<HTMLButtonElement>('[data-testid="provider-auth-action-claude"]')
    expect(loginStepsButton).toBeDefined()

    await act(async () => {
      loginStepsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(openWindow).not.toHaveBeenCalled()
    expect(renderedText()).toContain('claude auth status')
    expect(renderedText()).toContain('claude auth login')
    expect(renderedText()).toContain('home-mac')
  })

  it('shows API-key setup guidance for machine-auth providers without starting OAuth', async () => {
    await renderPanel()

    const configureButton = container?.querySelector<HTMLButtonElement>('[data-testid="provider-auth-action-opencode"]')
    expect(configureButton).toBeDefined()

    await act(async () => {
      configureButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(openWindow).not.toHaveBeenCalled()
    expect(renderedText()).toContain('OPENCODE_API_KEY')
    expect(renderedText()).toContain('opencode --version')
  })
})
