import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useFontScale: vi.fn(),
  useFounderProfile: vi.fn(),
  useMachines: vi.fn(),
  useMachineDaemonStatus: vi.fn(),
  usePolicySettings: vi.fn(),
  useTelemetrySummary: vi.fn(),
  useTheme: vi.fn(),
  useUpdatePolicySettings: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@modules/operators/hooks/useFounderProfile', () => ({
  useFounderProfile: mocks.useFounderProfile,
}))

vi.mock('@/hooks/use-agents', () => ({
  pairMachineDaemon: vi.fn(),
  revokeMachineDaemon: vi.fn(),
  useMachineDaemonStatus: mocks.useMachineDaemonStatus,
  useMachines: mocks.useMachines,
}))

vi.mock('@/hooks/use-action-policies', () => ({
  usePolicySettings: mocks.usePolicySettings,
  useUpdatePolicySettings: mocks.useUpdatePolicySettings,
}))

vi.mock('@/hooks/use-font-scale', () => ({
  useFontScale: mocks.useFontScale,
}))

vi.mock('@/hooks/use-telemetry', () => ({
  useTelemetrySummary: mocks.useTelemetrySummary,
}))

vi.mock('@/lib/theme-context', () => ({
  useTheme: mocks.useTheme,
}))

vi.mock('@modules/telemetry/components/TelemetryPreviewCard', () => ({
  default: () => createElement('div', { 'data-testid': 'telemetry-preview' }, 'TelemetryPreview'),
}))

import { MobileSettings } from '../MobileSettings'
import { MOBILE_SETTINGS_SECTIONS, getMobileSettingsPath } from '../mobile-settings-sections'

function renderMobileSettings(initialEntry = '/command-room/settings'): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        createElement(MobileSettings),
      ),
    ),
  )
}

function extractClassNameForAriaLabel(html: string, ariaLabel: string): string {
  const escapedLabel = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<[^>]+aria-label="${escapedLabel}"[^>]*class="([^"]*)"|<[^>]+class="([^"]*)"[^>]*aria-label="${escapedLabel}"`).exec(html)
  return match?.[1] ?? match?.[2] ?? ''
}

describe('MobileSettings', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset()
    mocks.useFontScale.mockReset()
    mocks.useFounderProfile.mockReset()
    mocks.useMachines.mockReset()
    mocks.useMachineDaemonStatus.mockReset()
    mocks.usePolicySettings.mockReset()
    mocks.useTelemetrySummary.mockReset()
    mocks.useTheme.mockReset()
    mocks.useUpdatePolicySettings.mockReset()

    mocks.useAuth.mockReturnValue({ signOut: vi.fn(), user: null })
    mocks.useFontScale.mockReturnValue({
      fontScale: 1,
      setFontScale: vi.fn(),
      adjustFontScale: vi.fn(),
      resetFontScale: vi.fn(),
      minFontScale: 0.8,
      maxFontScale: 1.6,
      fontScaleStep: 0.1,
      isLoading: false,
      isSaving: false,
    })
    mocks.useFounderProfile.mockReturnValue({ data: null })
    mocks.useMachines.mockReturnValue({ data: [], isLoading: false, error: null })
    mocks.useMachineDaemonStatus.mockReturnValue({ data: null, isLoading: false, error: null })
    mocks.usePolicySettings.mockReturnValue({
      data: {
        timeoutMinutes: 15,
        timeoutAction: 'block',
        standingApprovalExpiryDays: 14,
      },
      isLoading: false,
      error: null,
    })
    mocks.useTelemetrySummary.mockReturnValue({ data: null, isLoading: false, error: null })
    mocks.useTheme.mockReturnValue({
      theme: 'light',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    })
    mocks.useUpdatePolicySettings.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('prefers the persisted founder profile over the transient auth user identity', () => {
    mocks.useAuth.mockReturnValue({
      signOut: vi.fn(),
      user: {
        name: 'Google Oauth2 106050570920402391077',
        email: 'google-oauth2|106050570920402391077@auth0.local',
        picture: 'https://example.com/auth0.png',
      },
    })
    mocks.useFounderProfile.mockReturnValue({
      data: {
        id: 'founder-1',
        kind: 'founder',
        displayName: 'Nick Gu',
        email: 'nick@example.com',
        avatarUrl: '/api/operators/founder/avatar',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    })

    const html = renderMobileSettings()

    expect(html).toContain('Nick Gu')
    expect(html).toContain('nick@example.com')
    expect(html).toContain('/api/operators/founder/avatar')
    expect(html).not.toContain('Google Oauth2 106050570920402391077')
  })

  it('keeps all settings rows inside the mobile settings route', () => {
    const html = renderMobileSettings('/command-room/settings?surface=capacitor')

    for (const section of MOBILE_SETTINGS_SECTIONS) {
      expect(html).toContain(`href="${getMobileSettingsPath(section.id)}?surface=capacitor"`)
    }

    expect(html).toContain('Machines')
    expect(html).not.toContain('Runtime')
    expect(html).not.toContain('/api-keys#appearance')
    expect(html).not.toContain('/api-keys#about')
    expect(html).not.toContain('/policies#notifications')
  })

  it('keeps the settings detail back control at 44px with an accessible name', () => {
    const html = renderMobileSettings('/command-room/settings/appearance')
    const className = extractClassNameForAriaLabel(html, 'Back to settings')
    const classes = className.split(/\s+/)

    expect(html).toContain('aria-label="Back to settings"')
    expect(classes).toContain('h-11')
    expect(classes).toContain('w-11')
    expect(classes).not.toContain('h-8')
    expect(classes).not.toContain('w-8')
  })

  it('renders telemetry from the backend summary hook on the mobile telemetry panel', () => {
    mocks.useTelemetrySummary.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        costToday: 1.25,
        costWeek: 3.5,
        costMonth: 10,
        inputTokensToday: 120,
        inputTokensWeek: 120,
        inputTokensMonth: 120,
        outputTokensToday: 80,
        outputTokensWeek: 80,
        outputTokensMonth: 80,
        totalTokensToday: 200,
        totalTokensWeek: 200,
        totalTokensMonth: 200,
        activeSessions: 2,
        totalSessions: 5,
        topModels: [{ model: 'gpt-5.5', cost: 1.25, calls: 4 }],
        topAgents: [],
        dailyCosts: [],
      },
    })

    const html = renderMobileSettings('/command-room/settings/telemetry')

    expect(html).toContain('Telemetry')
    expect(html).toContain('$1.25')
    expect(html).toContain('2 active / 5 total')
    expect(html).toContain('gpt-5.5')
  })

  it('renders notification settings from the policy settings hook', () => {
    const html = renderMobileSettings('/command-room/settings/notifications')

    expect(html).toContain('Notifications')
    expect(html).toContain('Timeout action')
    expect(html).toContain('value="15"')
    expect(html).toContain('value="14"')
  })

  it('renders machines from the machine registry hook', () => {
    mocks.useMachines.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        {
          id: 'macmini',
          label: 'Mac Mini',
          host: '100.64.1.1',
          transport: 'daemon',
          cwd: '/Users/nick/App',
        },
      ],
    })
    mocks.useMachineDaemonStatus.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        machineId: 'macmini',
        displayLabel: 'Mac Mini',
        paired: true,
        connected: true,
        connectionState: 'connected',
        connectionLabel: 'connected',
        selectedTransport: 'daemon',
        providerAuthReady: true,
        providerAuthState: 'ready',
        providerAuthLabel: 'providers ready',
        launchable: true,
        launchUnsupportedReason: null,
        allowedActions: [
          { id: 'rotate', label: 'Rotate Pairing' },
          { id: 'revoke', label: 'Revoke' },
        ],
        pairedAt: '2026-05-19T00:00:00.000Z',
        revokedAt: null,
        connectedAt: '2026-05-19T00:01:00.000Z',
        lastSeenAt: '2026-05-19T00:01:00.000Z',
        connectionId: 'conn-1',
        daemonVersion: '0.1.0',
        protocolVersion: 1,
        pid: 123,
        platform: 'darwin',
        arch: 'arm64',
        activeProcesses: 0,
        providerHealth: {},
      },
    })

    const html = renderMobileSettings('/command-room/settings/machines')

    expect(html).toContain('Machines')
    expect(html).toContain('Mac Mini')
    expect(html).toContain('100.64.1.1')
    expect(html).toContain('connected')
    expect(html).toContain('providers ready')
    expect(html).toContain('Rotate Pairing')
    expect(html).toContain('Revoke')
    expect(html).not.toContain('Runtime')
  })

  it('renders machine cards from backend display labels and action DTOs', () => {
    mocks.useMachines.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        {
          id: 'local',
          label: 'Local (this server)',
          host: null,
          transport: 'local',
        },
        {
          id: 'ssh-1',
          label: 'SSH Mac',
          host: '100.64.1.1',
          transport: 'ssh',
        },
        {
          id: 'paired-1',
          label: 'Paired Mac',
          host: null,
          transport: 'daemon',
        },
        {
          id: 'connected-1',
          label: 'Connected Mac',
          host: null,
          transport: 'daemon',
        },
        {
          id: 'missing-auth-1',
          label: 'Missing Auth Mac',
          host: null,
          transport: 'daemon',
        },
      ],
    })
    mocks.useMachineDaemonStatus.mockImplementation((machineId: string) => ({
      isLoading: false,
      error: null,
      data: {
        machineId,
        displayLabel: {
          'ssh-1': 'SSH Mac',
          'paired-1': 'Paired Mac',
          'connected-1': 'Connected Mac',
          'missing-auth-1': 'Missing Auth Mac',
        }[machineId] ?? 'Local (this server)',
        paired: machineId !== 'ssh-1',
        connected: machineId === 'connected-1' || machineId === 'missing-auth-1',
        connectionState: {
          'ssh-1': 'ssh-local',
          'paired-1': 'paired',
          'connected-1': 'connected',
          'missing-auth-1': 'connected',
        }[machineId] ?? 'local',
        connectionLabel: {
          'ssh-1': 'ssh/local',
          'paired-1': 'paired',
          'connected-1': 'connected',
          'missing-auth-1': 'connected',
        }[machineId] ?? 'local',
        selectedTransport: machineId === 'ssh-1' ? 'ssh' : 'daemon',
        providerAuthReady: machineId === 'connected-1',
        providerAuthState: machineId === 'connected-1'
          ? 'ready'
          : machineId === 'ssh-1'
            ? 'not-checked'
            : 'missing',
        providerAuthLabel: machineId === 'connected-1'
          ? 'providers ready'
          : machineId === 'ssh-1'
            ? 'not checked'
            : 'providers missing',
        launchable: machineId === 'connected-1',
        launchUnsupportedReason: machineId === 'connected-1' ? null : 'not launchable',
        allowedActions: machineId === 'ssh-1'
          ? [{ id: 'pair', label: 'Pair Daemon' }]
          : [
              { id: 'rotate', label: 'Rotate Pairing' },
              { id: 'revoke', label: 'Revoke' },
            ],
        pairedAt: machineId === 'ssh-1' ? null : '2026-05-19T00:00:00.000Z',
        revokedAt: null,
        connectedAt: machineId === 'connected-1' || machineId === 'missing-auth-1'
          ? '2026-05-19T00:01:00.000Z'
          : null,
        lastSeenAt: null,
        connectionId: null,
        daemonVersion: null,
        protocolVersion: null,
        pid: null,
        platform: null,
        arch: null,
        activeProcesses: null,
        providerHealth: {},
      },
    }))

    const html = renderMobileSettings('/command-room/settings/machines')

    expect(html).toContain('Local (this server)')
    expect(html).toContain('SSH Mac')
    expect(html).toContain('ssh/local')
    expect(html).toContain('Paired Mac')
    expect(html).toContain('paired')
    expect(html).toContain('Connected Mac')
    expect(html).toContain('connected')
    expect(html).toContain('providers ready')
    expect(html).toContain('Missing Auth Mac')
    expect(html).toContain('providers missing')
  })

  it('renders appearance from the shared theme context', () => {
    mocks.useTheme.mockReturnValue({
      theme: 'dark',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    })

    const html = renderMobileSettings('/command-room/settings/appearance')

    expect(html).toContain('Appearance')
    expect(html).toContain('Light')
    expect(html).toContain('Dark')
    expect(html).toContain('Text size')
    expect(html).toContain('100%')
    expect(html).toContain('aria-label="Decrease text size"')
    expect(html).toContain('aria-label="Increase text size"')
    expect(html).toContain('bg-[var(--hv-button-primary-bg)]')
  })
})
