import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  pairMachineDaemon,
  revokeMachineDaemon,
  useMachineDaemonStatus,
  useMachines,
} from '@/hooks/use-agents'
import {
  usePolicySettings,
  useUpdatePolicySettings,
  type ActionPolicySettings,
} from '@/hooks/use-action-policies'
import { useFontScale } from '@/hooks/use-font-scale'
import { useTelemetrySummary } from '@/hooks/use-telemetry'
import { fetchJson } from '@/lib/api'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'
import type { MachineDaemonPairCommand } from '@/types'
import {
  buildMachineDaemonPendingDisplayDto,
} from '@modules/agents/machine-daemon-dtos'
import { resolveFounderAvatarSrc } from '@modules/operators/founder-avatar'
import { useFounderProfile } from '@modules/operators/hooks/useFounderProfile'
import { DEFAULT_ACTION_POLICY_SETTINGS } from '@modules/policies/settings-defaults'
import TelemetryPreviewCard from '@modules/telemetry/components/TelemetryPreviewCard'
import {
  MOBILE_SETTINGS_BASE_PATH,
  findMobileSettingsUiSection,
  useMobileSettingsSections,
  type MobileSettingsSection,
} from './mobile-settings-sections'

/**
 * Version + build identifiers. `APP_VERSION` is read from `package.json` at
 * build time via a lightweight `import.meta.env` bridge — the Vite config
 * exposes `import.meta.env.VITE_APP_VERSION` which defaults to the
 * package.json version string. `BUILD_COMMIT` is the short SHA the server
 * wrapper injects at launch time via `VITE_BUILD_COMMIT` (falls back to
 * empty so the footer just shows the version).
 */
const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.1.0'
const BUILD_COMMIT = (import.meta.env?.VITE_BUILD_COMMIT as string | undefined) ?? ''

type WorkspacePanelDefault = 'open' | 'closed' | 'last-used'

function useWorkspacePreferences() {
  return useQuery({
    queryKey: ['workspace', 'preferences'],
    queryFn: () => fetchJson<{ panelDefault: WorkspacePanelDefault }>('/api/workspace/preferences'),
  })
}

function useUpdateWorkspacePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (panelDefault: WorkspacePanelDefault) => fetchJson<{ panelDefault: WorkspacePanelDefault }>(
      '/api/workspace/preferences',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ panelDefault }),
      },
    ),
    onSuccess: (preferences) => {
      queryClient.setQueryData(['workspace', 'preferences'], preferences)
    },
  })
}

interface MobileSettingsProfile {
  displayName: string
  email: string
  picture: string | null
  onSignOut?: () => void
}

function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || 'Hervald'
  const [first = 'H', second = 'A'] = source.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toLowerCase()
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function activeSectionFromPath(
  pathname: string,
  sections: readonly MobileSettingsSection[],
): MobileSettingsSection | null {
  const prefix = `${MOBILE_SETTINGS_BASE_PATH}/`
  if (!pathname.startsWith(prefix)) {
    return null
  }
  const [sectionId] = pathname.slice(prefix.length).split('/')
  return findMobileSettingsUiSection(sections, sectionId)
}

function withSearch(path: string, search: string): string {
  return search ? `${path}${search}` : path
}

function SettingsHeader({
  title,
  backTo,
}: {
  title: string
  backTo?: string
}) {
  return (
    <div className="px-5 pb-3 pt-4">
      {backTo ? (
        <Link
          to={backTo}
          className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)]"
          aria-label="Back to settings"
        >
          <ArrowLeft size={16} />
        </Link>
      ) : (
        <p className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">hervald</p>
      )}
      <h1 className="mt-1 font-display text-4xl text-[color:var(--hv-fg)]">{title}</h1>
    </div>
  )
}

function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(
      'rounded-[3px_14px_3px_14px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-4',
      className,
    )}>
      {children}
    </div>
  )
}

function ProfileCard({
  profile,
  className,
}: {
  profile: MobileSettingsProfile
  className?: string
}) {
  return (
    <SettingsPanel className={cn('mx-4', className)}>
      <div className="flex items-center gap-3">
        {profile.picture ? (
          <img
            src={profile.picture}
            alt={profile.displayName}
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--hv-button-primary-bg)] font-display text-lg italic text-[color:var(--hv-fg-inverse)]">
            {initials(profile.displayName, profile.email)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[color:var(--hv-fg)]">
            {profile.displayName}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--hv-fg-subtle)]">
            {profile.email}
          </p>
        </div>

        <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-moss-stone">
          active
        </span>
      </div>

      {profile.onSignOut ? (
        <button
          type="button"
          onClick={profile.onSignOut}
          className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)] transition-colors hover:text-[color:var(--hv-fg)]"
        >
          <LogOut size={13} />
          Sign out
        </button>
      ) : null}
    </SettingsPanel>
  )
}

function FullPageLink({ section }: { section: MobileSettingsSection }) {
  if (!section.fullPagePath) {
    return null
  }

  return (
    <Link
      to={section.fullPagePath}
      className="mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)] transition-colors hover:text-[color:var(--hv-fg)]"
    >
      Open full page
      <ExternalLink size={13} />
    </Link>
  )
}

function MobileSettingsIndex({
  profile,
  search,
  sections,
}: {
  profile: MobileSettingsProfile
  search: string
  sections: readonly MobileSettingsSection[]
}) {
  return (
    <>
      <SettingsHeader title="Settings" />

      <div className="hv-scroll flex-1 overflow-y-auto px-0 pb-5">
        <ProfileCard profile={profile} />

        <div className="mt-4 px-3">
          <div className="overflow-hidden rounded-[3px_14px_3px_14px] border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]">
            {sections.map((section, index) => {
              const Icon = section.icon
              return (
                <Link
                  key={section.id}
                  to={withSearch(section.path, search)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)]"
                  style={{
                    borderBottom: index < sections.length - 1
                      ? '1px solid var(--hv-border-hair)'
                      : 'none',
                  }}
                >
                  <Icon size={15} className="shrink-0 text-[color:var(--hv-fg-subtle)]" />
                  <span className="flex-1">{section.label}</span>
                  <ChevronRight size={14} className="text-[color:var(--hv-fg-faint)]" />
                </Link>
              )
            })}
          </div>
        </div>

        <div className="px-4 pt-5">
          <TelemetryPreviewCard />
        </div>

        <VersionFooter />
      </div>
    </>
  )
}

function AccountPanel({
  profile,
  section,
}: {
  profile: MobileSettingsProfile
  section: MobileSettingsSection
}) {
  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} className="mx-0" />
      <SettingsPanel>
        <div className="space-y-3 text-sm">
          <SettingRow label="Display name" value={profile.displayName} />
          <SettingRow label="Email" value={profile.email} />
        </div>
        <FullPageLink section={section} />
      </SettingsPanel>
    </div>
  )
}

function TelemetryPanel({ section }: { section: MobileSettingsSection }) {
  const summaryQuery = useTelemetrySummary()
  const summary = summaryQuery.data

  if (summaryQuery.isLoading && !summary) {
    return <SettingsPanel>Loading telemetry...</SettingsPanel>
  }

  if (summaryQuery.error && !summary) {
    return <SettingsPanel>Telemetry is unavailable.</SettingsPanel>
  }

  return (
    <SettingsPanel>
      {summary ? (
        <div className="space-y-3 text-sm">
          <SettingRow label="Today" value={formatCost(summary.costToday)} />
          <SettingRow label="This week" value={formatCost(summary.costWeek)} />
          <SettingRow label="This month" value={formatCost(summary.costMonth)} />
          <SettingRow
            label="Sessions"
            value={`${summary.activeSessions} active / ${summary.totalSessions} total`}
          />
          <SettingRow label="Tokens today" value={formatNumber(summary.totalTokensToday)} />
          <SettingRow label="Top model" value={summary.topModels[0]?.model ?? 'None'} />
        </div>
      ) : (
        <p className="text-sm text-[color:var(--hv-fg-subtle)]">No telemetry summary is available.</p>
      )}
      <FullPageLink section={section} />
    </SettingsPanel>
  )
}

function NotificationsPanel({ section }: { section: MobileSettingsSection }) {
  const settingsQuery = usePolicySettings()
  const updateSettings = useUpdatePolicySettings()
  const settings = settingsQuery.data ?? DEFAULT_ACTION_POLICY_SETTINGS
  const disabled = settingsQuery.isLoading || updateSettings.isPending

  function update(patch: Partial<ActionPolicySettings>) {
    updateSettings.mutate({
      ...settings,
      ...patch,
    })
  }

  return (
    <SettingsPanel>
      <div className="space-y-4">
        <label className="block text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          Timeout action
          <select
            value={settings.timeoutAction}
            disabled={disabled}
            onChange={(event) => update({ timeoutAction: event.target.value as 'auto' | 'block' })}
            className="mt-2 w-full rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--hv-fg)]"
          >
            <option value="block">Block when unanswered</option>
            <option value="auto">Auto-approve when unanswered</option>
          </select>
        </label>

        <label className="block text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          Timeout minutes
          <input
            type="number"
            min={1}
            value={settings.timeoutMinutes}
            disabled={disabled}
            onChange={(event) => update({
              timeoutMinutes: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
            })}
            className="mt-2 w-full rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--hv-fg)]"
          />
        </label>

        <label className="block text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          Standing approval days
          <input
            type="number"
            min={1}
            value={settings.standingApprovalExpiryDays}
            disabled={disabled}
            onChange={(event) => update({
              standingApprovalExpiryDays: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
            })}
            className="mt-2 w-full rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--hv-fg)]"
          />
        </label>
      </div>
      <FullPageLink section={section} />
    </SettingsPanel>
  )
}

function MachinesPanel() {
  const machinesQuery = useMachines()
  const machines = machinesQuery.data ?? []

  if (machinesQuery.isLoading && machines.length === 0) {
    return <SettingsPanel>Loading machines...</SettingsPanel>
  }

  if (machinesQuery.error && machines.length === 0) {
    return <SettingsPanel>Machines are unavailable.</SettingsPanel>
  }

  return (
    <SettingsPanel>
      <div className="space-y-3">
        <SettingRow label="Registered" value={formatNumber(machines.length)} />
        {machines.length === 0 ? (
          <p className="text-sm text-[color:var(--hv-fg-subtle)]">No machines are registered.</p>
        ) : (
          <div className="space-y-2">
            {machines.map((machine) => (
              <MachineCard key={machine.id} machine={machine} />
            ))}
          </div>
        )}
      </div>
    </SettingsPanel>
  )
}

function MachineCard({
  machine,
}: {
  machine: NonNullable<ReturnType<typeof useMachines>['data']>[number]
}) {
  const queryClient = useQueryClient()
  const daemonStatusQuery = useMachineDaemonStatus(machine.id)
  const daemonStatus = daemonStatusQuery.data
  const [lastPairCommand, setLastPairCommand] = useState<MachineDaemonPairCommand | null>(null)
  const pairMutation = useMutation({
    mutationFn: () => pairMachineDaemon(machine.id, {
      label: machine.label,
      ...(machine.cwd ? { cwd: machine.cwd } : {}),
    }),
    onSuccess: async (response) => {
      setLastPairCommand(response.pairing.command)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] }),
        queryClient.invalidateQueries({ queryKey: ['agents', 'machines', machine.id, 'daemon-status'] }),
      ])
    },
  })
  const revokeMutation = useMutation({
    mutationFn: () => revokeMachineDaemon(machine.id),
    onSuccess: async () => {
      setLastPairCommand(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] }),
        queryClient.invalidateQueries({ queryKey: ['agents', 'machines', machine.id, 'daemon-status'] }),
      ])
    },
  })
  const pendingDisplay = buildMachineDaemonPendingDisplayDto({
    ...machine,
    ...(machine.daemon
      ? {
          daemon: {
            pairedAt: machine.daemon.pairedAt ?? undefined,
            revokedAt: machine.daemon.revokedAt ?? undefined,
            lastSeenAt: machine.daemon.lastSeenAt ?? undefined,
            daemonVersion: machine.daemon.daemonVersion ?? undefined,
          },
        }
      : {}),
  })
  const allowedActions = daemonStatus?.allowedActions ?? pendingDisplay.allowedActions
  const pairAction = allowedActions.find((action) => (
    action.id === 'pair' || action.id === 'rotate'
  ))
  const revokeAction = allowedActions.find((action) => action.id === 'revoke')
  const statusLabel = daemonStatus?.connectionLabel ?? pendingDisplay.connectionLabel
  const providerLabel = daemonStatus?.providerAuthLabel ?? pendingDisplay.providerAuthLabel

  return (
    <div className="rounded-md border border-[color:var(--hv-border-hair)] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-[color:var(--hv-fg)]">
          {daemonStatus?.displayLabel ?? pendingDisplay.displayLabel}
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          {machine.transport ?? (machine.host ? 'ssh' : 'local')}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--hv-fg-subtle)]">
        {machine.host ?? 'localhost'}
      </p>
      {machine.cwd ? (
        <p className="mt-1 truncate font-mono text-[10px] text-[color:var(--hv-fg-faint)]">
          {machine.cwd}
        </p>
      ) : null}
      {machine.id !== 'local' ? (
        <div className="mt-3 space-y-2 border-t border-[color:var(--hv-border-hair)] pt-2">
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[color:var(--hv-fg-subtle)]">
            <span>Daemon: <span className="text-[color:var(--hv-fg)]">{statusLabel}</span></span>
            <span>Auth: <span className="text-[color:var(--hv-fg)]">{providerLabel}</span></span>
            {daemonStatus?.daemonVersion ? (
              <span className="col-span-2">Version: {daemonStatus.daemonVersion}</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            {pairAction ? (
              <button
                type="button"
                disabled={pairMutation.isPending}
                onClick={() => pairMutation.mutate()}
                className="rounded-[2px_8px] border border-[color:var(--hv-fg)] px-3 py-1.5 text-[11px] text-[color:var(--hv-fg)] shadow-[2px_2px_0_var(--hv-fg)] disabled:opacity-50"
              >
                {pairAction.label}
              </button>
            ) : null}
            {revokeAction ? (
              <button
                type="button"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate()}
                className="rounded-[2px_8px] border border-[color:var(--hv-border-strong)] px-3 py-1.5 text-[11px] text-[color:var(--hv-fg-subtle)] disabled:opacity-50"
              >
                {revokeAction.label}
              </button>
            ) : null}
          </div>
          {lastPairCommand ? (
            <div className="space-y-2">
              <code className="block whitespace-pre-wrap break-words rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-2 text-[10px] text-[color:var(--hv-fg-subtle)]">
                {lastPairCommand.shortCommand}
              </code>
              <details className="rounded border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-2 py-1 text-[10px] text-[color:var(--hv-fg-subtle)]">
                <summary className="cursor-pointer uppercase tracking-[0.08em]">
                  {lastPairCommand.disclosureLabel}
                </summary>
                <code className="mt-2 block whitespace-pre-wrap break-words text-[10px]">
                  {lastPairCommand.fullCommand}
                </code>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AppearancePanel() {
  const { theme, setTheme, isLoading, isSaving } = useTheme()
  const {
    fontScale,
    setFontScale,
    adjustFontScale,
    minFontScale,
    maxFontScale,
    fontScaleStep,
    isLoading: isFontScaleLoading,
    isSaving: isFontScaleSaving,
  } = useFontScale()
  const workspacePreferences = useWorkspacePreferences()
  const updateWorkspacePreferences = useUpdateWorkspacePreferences()
  const disabled = isLoading || isSaving
  const fontScaleDisabled = disabled || isFontScaleLoading || isFontScaleSaving
  const canDecreaseFontScale = fontScale > minFontScale + 1e-6
  const canIncreaseFontScale = fontScale < maxFontScale - 1e-6

  return (
    <SettingsPanel>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTheme('light')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors',
            theme === 'light'
              ? 'border-[color:var(--hv-fg)] bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
              : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)]',
          )}
        >
          <Sun size={15} />
          Light
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTheme('dark')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors',
            theme === 'dark'
              ? 'border-[color:var(--hv-fg)] bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
              : 'border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-[color:var(--hv-fg)]',
          )}
        >
          <Moon size={15} />
          Dark
        </button>
      </div>
      <div className="mt-5 border-t border-[color:var(--hv-border-hair)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
            Text size
          </span>
          <span className="font-mono text-xs text-[color:var(--hv-fg)]">
            {Math.round(fontScale * 100)}%
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            aria-label="Decrease text size"
            disabled={fontScaleDisabled || !canDecreaseFontScale}
            onClick={() => adjustFontScale(-fontScaleStep)}
            className="h-9 w-10 rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-xs text-[color:var(--hv-fg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            A−
          </button>
          <input
            type="range"
            aria-label="Text size"
            min={minFontScale}
            max={maxFontScale}
            step={fontScaleStep}
            value={fontScale}
            disabled={fontScaleDisabled}
            onChange={(event) => setFontScale(Number(event.target.value))}
            className="min-w-0 flex-1 accent-sumi-black"
          />
          <button
            type="button"
            aria-label="Increase text size"
            disabled={fontScaleDisabled || !canIncreaseFontScale}
            onClick={() => adjustFontScale(fontScaleStep)}
            className="h-9 w-10 rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] text-xs text-[color:var(--hv-fg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            A+
          </button>
        </div>
      </div>
      <div className="mt-5 border-t border-[color:var(--hv-border-hair)] pt-4">
        <label className="grid gap-2 text-xs uppercase tracking-[0.08em] text-[color:var(--hv-fg-subtle)]">
          <span>Workspace panel</span>
          <select
            value={workspacePreferences.data?.panelDefault ?? 'last-used'}
            disabled={workspacePreferences.isLoading || updateWorkspacePreferences.isPending}
            onChange={(event) => {
              updateWorkspacePreferences.mutate(event.target.value as WorkspacePanelDefault)
            }}
            className="rounded-md border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-3 py-2 text-sm normal-case tracking-normal text-[color:var(--hv-fg)]"
          >
            <option value="open">Open by default</option>
            <option value="closed">Closed by default</option>
            <option value="last-used">Last used</option>
          </select>
        </label>
      </div>
    </SettingsPanel>
  )
}

function AboutPanel() {
  return (
    <SettingsPanel>
      <div className="space-y-3 text-sm">
        <SettingRow label="Product" value="Hervald" />
        <SettingRow label="Version" value={APP_VERSION} />
        {BUILD_COMMIT ? <SettingRow label="Build" value={BUILD_COMMIT} /> : null}
      </div>
    </SettingsPanel>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] py-2 last:border-b-0">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--hv-fg-subtle)]">
        {label}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-[color:var(--hv-fg)]">
        {value}
      </span>
    </div>
  )
}

function MobileSettingsDetail({
  section,
  profile,
  search,
}: {
  section: MobileSettingsSection
  profile: MobileSettingsProfile
  search: string
}) {
  return (
    <>
      <SettingsHeader
        title={section.label}
        backTo={withSearch(MOBILE_SETTINGS_BASE_PATH, search)}
      />
      <div className="hv-scroll flex-1 overflow-y-auto px-4 pb-5">
        {section.id === 'account' ? <AccountPanel profile={profile} section={section} /> : null}
        {section.id === 'telemetry' ? <TelemetryPanel section={section} /> : null}
        {section.id === 'notifications' ? <NotificationsPanel section={section} /> : null}
        {section.id === 'machines' ? <MachinesPanel /> : null}
        {section.id === 'appearance' ? <AppearancePanel /> : null}
        {section.id === 'about' ? <AboutPanel /> : null}
        <VersionFooter />
      </div>
    </>
  )
}

function VersionFooter() {
  return (
    <div className="px-6 pt-4 text-center text-[10px] uppercase tracking-[0.14em] text-[color:var(--hv-fg-faint)]">
      hervald · v{APP_VERSION}{BUILD_COMMIT ? ` · build ${BUILD_COMMIT}` : ''}
    </div>
  )
}

export function MobileSettings() {
  const auth = useAuth()
  const { data: founder } = useFounderProfile()
  const { data: sections = [] } = useMobileSettingsSections()
  const location = useLocation()
  const user = auth?.user
  const profile: MobileSettingsProfile = {
    displayName: founder?.displayName ?? user?.name ?? 'Operator',
    email: founder?.email ?? user?.email ?? 'Signed in with an API key',
    picture: resolveFounderAvatarSrc(founder, auth),
    onSignOut: auth?.signOut,
  }
  const section = activeSectionFromPath(location.pathname, sections)

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mobile-settings">
      {section ? (
        <MobileSettingsDetail
          section={section}
          profile={profile}
          search={location.search}
        />
      ) : (
        <MobileSettingsIndex profile={profile} search={location.search} sections={sections} />
      )}
    </section>
  )
}
