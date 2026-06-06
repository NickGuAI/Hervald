// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderAuthSnapshot, ProviderRegistryEntry } from '@/types'

const mocks = vi.hoisted(() => ({
  useProviderRegistry: vi.fn(),
  useProviderAuthSnapshots: vi.fn(),
  probeProviderAuthSnapshots: vi.fn(),
  startProviderReauth: vi.fn(),
}))

vi.mock('@/hooks/use-providers', () => ({
  useProviderRegistry: mocks.useProviderRegistry,
  getProviderLabel: (providers: Array<{ id: string; label: string }>, providerId: string) =>
    providers.find((provider) => provider.id === providerId)?.label ?? providerId,
}))

vi.mock('@/hooks/use-agents', () => ({
  useProviderAuthSnapshots: mocks.useProviderAuthSnapshots,
  probeProviderAuthSnapshots: mocks.probeProviderAuthSnapshots,
  startProviderReauth: mocks.startProviderReauth,
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
    root?.render(<ProviderAuthPanel />)
    await Promise.resolve()
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
    mocks.startProviderReauth.mockResolvedValue({
      provider: 'codex',
      scopeId: 'human:nick',
      host: 'local',
      state: 'oauth-state',
      authorizationUrl: 'https://auth.example.test/authorize',
      callbackUrl: 'https://hammurabi.example.test/api/agents/provider-auth/oauth/callback',
      expiresAt: '2026-06-04T00:05:00.000Z',
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
    expect(renderedText()).toContain('Connect')
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

  it('starts a default current-user reauth flow before any auth failure snapshot exists', async () => {
    await renderPanel()

    const connectButton = container?.querySelector<HTMLButtonElement>('[data-testid="provider-auth-action-codex"]')
    expect(connectButton).toBeDefined()

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.startProviderReauth).toHaveBeenCalledWith({ provider: 'codex' })
    expect(openWindow).toHaveBeenCalledWith(
      'https://auth.example.test/authorize',
      '_blank',
      'noopener,noreferrer',
    )
    expect(refetchSnapshots).toHaveBeenCalled()
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

    const loginStepsButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('Login steps'))
    expect(loginStepsButton).toBeDefined()

    await act(async () => {
      loginStepsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.startProviderReauth).not.toHaveBeenCalled()
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

    expect(mocks.startProviderReauth).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
    expect(renderedText()).toContain('OPENCODE_API_KEY')
    expect(renderedText()).toContain('opencode --version')
  })
})
