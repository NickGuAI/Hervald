import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import {
  probeProviderAuthSnapshots,
  useProviderAuthSnapshots,
} from '@/hooks/use-agents'
import { useProviderRegistry } from '@/hooks/use-providers'
import type { AgentType, ProviderAuthSnapshot, ProviderAuthStatus, ProviderRegistryEntry } from '@/types'

type ProviderAuthRow = {
  provider: ProviderRegistryEntry
  snapshot: ProviderAuthSnapshot | null
}

type AuthGuidance = {
  provider: AgentType
  message: string
  commands: string[]
}

function formatAuthDetail(snapshot: ProviderAuthSnapshot): string {
  const account = snapshot.accountEmail ?? snapshot.accountId
  const target = `${snapshot.scopeId} on ${snapshot.host}`
  return account ? `${target} (${account})` : target
}

function snapshotTime(snapshot: ProviderAuthSnapshot): number {
  const time = Date.parse(snapshot.lastCheckedAt)
  return Number.isNaN(time) ? 0 : time
}

function statusLabel(status: ProviderAuthStatus | 'missing'): string {
  switch (status) {
    case 'ready':
      return 'Connected'
    case 'auth_required':
      return 'Auth required'
    case 'unknown':
      return 'Unknown'
    case 'missing':
      return 'Not connected'
  }
}

function statusBadgeClass(status: ProviderAuthStatus | 'missing'): string {
  switch (status) {
    case 'ready':
      return 'badge-sumi badge-active'
    case 'auth_required':
      return 'badge-sumi text-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)]'
    case 'unknown':
    case 'missing':
      return 'badge-sumi badge-idle'
  }
}

function statusIcon(status: ProviderAuthStatus | 'missing') {
  if (status === 'ready') {
    return <CheckCircle2 size={16} className="text-[color:var(--hv-accent-success)]" />
  }
  if (status === 'auth_required') {
    return <ShieldAlert size={16} className="text-[color:var(--hv-accent-danger)]" />
  }
  return <ShieldCheck size={16} className="text-[color:var(--hv-fg-faint)]" />
}

function nativeLoginCommands(provider: ProviderRegistryEntry): string[] | null {
  if (provider.id === 'codex') {
    return ['codex login status', 'codex login']
  }
  if (provider.id === 'claude') {
    return ['claude auth status', 'claude auth login']
  }
  return null
}

function actionLabel(provider: ProviderRegistryEntry, status: ProviderAuthStatus | 'missing'): string {
  if (nativeLoginCommands(provider)) {
    return status === 'ready' ? 'Auth status' : 'Login steps'
  }
  return 'Configure'
}

function buildAuthGuidance(provider: ProviderRegistryEntry, snapshot: ProviderAuthSnapshot | null): AuthGuidance {
  const host = snapshot?.host ?? 'local'
  const nativeCommands = nativeLoginCommands(provider)
  if (nativeCommands) {
    const target = host === 'local' ? 'the Hervald host' : host
    return {
      provider: provider.id,
      message: `${provider.label} uses native CLI authentication on ${target}.`,
      commands: nativeCommands,
    }
  }

  const authEnvKeys = provider.machineAuth?.authEnvKeys ?? []
  const cli = provider.machineAuth?.cliBinaryName ?? provider.id
  const keyList = authEnvKeys.length > 0 ? authEnvKeys.join(' or ') : 'the provider API key'
  const command = authEnvKeys.length > 0
    ? `${cli} --version && test -n "$${authEnvKeys[0]}"`
    : `${cli} --version`

  return {
    provider: provider.id,
    message: `${provider.label} uses machine auth. Configure ${keyList} on ${host === 'local' ? 'the Hervald host' : host}, then refresh this panel.`,
    commands: [command],
  }
}

export function ProviderAuthPanel() {
  const { data: providers = [] } = useProviderRegistry()
  const snapshotsQuery = useProviderAuthSnapshots()
  const [isProbing, setIsProbing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [authGuidance, setAuthGuidance] = useState<AuthGuidance | null>(null)
  const snapshots = snapshotsQuery.data?.snapshots ?? []

  const snapshotsByProvider = useMemo(() => {
    const rowProviderIds = new Set(providers.filter((provider) => provider.machineAuth).map((provider) => provider.id))
    const byProvider = new Map<AgentType, ProviderAuthSnapshot>()
    for (const providerId of rowProviderIds) {
      const latestSnapshot = snapshots
        .filter((snapshot) => snapshot.provider === providerId)
        .sort((left, right) => snapshotTime(right) - snapshotTime(left))[0]
      if (latestSnapshot) {
        byProvider.set(providerId, latestSnapshot)
      }
    }
    return byProvider
  }, [providers, snapshots])

  const rows: ProviderAuthRow[] = useMemo(
    () =>
      providers
        .filter((provider) => provider.machineAuth)
        .map((provider) => ({
          provider,
          snapshot: snapshotsByProvider.get(provider.id) ?? null,
        })),
    [providers, snapshotsByProvider],
  )

  const rowProviderIds = useMemo(() => new Set(rows.map((row) => row.provider.id)), [rows])
  const authRequiredCount = snapshots.filter(
    (snapshot) =>
      rowProviderIds.has(snapshot.provider) &&
      snapshot.status === 'auth_required',
  ).length

  async function handleProbe(): Promise<void> {
    setIsProbing(true)
    setActionError(null)
    try {
      await probeProviderAuthSnapshots()
      await snapshotsQuery.refetch()
      setAuthGuidance(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to refresh provider auth status.')
    } finally {
      setIsProbing(false)
    }
  }

  function handleReauth(provider: ProviderRegistryEntry, snapshot: ProviderAuthSnapshot | null): void {
    setActionError(null)
    setAuthGuidance(buildAuthGuidance(provider, snapshot))
  }

  return (
    <div className="flex h-full flex-col" data-testid="provider-auth-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="section-title">Provider Auth</p>
          <p className="mt-2 text-sm text-[color:var(--hv-fg-subtle)]">
            Runtime provider credentials
          </p>
        </div>
        <ShieldCheck size={20} className="mt-0.5 text-[color:var(--hv-fg-faint)]" />
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((row) => {
          const snapshot = row.snapshot
          const status = snapshot?.status ?? 'missing'

          return (
            <div
              key={row.provider.id}
              data-testid={`provider-auth-row-${row.provider.id}`}
              className="rounded-lg border border-[var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-3"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 shrink-0">{statusIcon(status)}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[color:var(--hv-fg)]">{row.provider.label}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[color:var(--hv-fg-muted)]">
                      {snapshot ? formatAuthDetail(snapshot) : 'Current user on local'}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={statusBadgeClass(status)}>{statusLabel(status)}</span>
                  <button
                    type="button"
                    onClick={() => void handleReauth(row.provider, snapshot)}
                    data-testid={`provider-auth-action-${row.provider.id}`}
                    className="btn-primary inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    <Terminal size={13} />
                    {actionLabel(row.provider, status)}
                  </button>
                </div>
              </div>

              {snapshot?.detail && (
                <p className="mt-2 line-clamp-2 text-[11px] text-[color:var(--hv-accent-danger)]">
                  {snapshot.detail}
                </p>
              )}

              {authGuidance?.provider === row.provider.id && (
                <p className="mt-2 text-[11px] leading-5 text-[color:var(--hv-fg-muted)]">
                  {authGuidance.message}{' '}
                  {authGuidance.commands.map((command, index) => (
                    <span key={command}>
                      {index === 0 ? 'Run ' : ' Then run '}
                      <code className="rounded bg-[var(--hv-bg-overlay)] px-1 py-0.5">{command}</code>.
                    </span>
                  ))}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-whisper text-[color:var(--hv-fg-faint)]">
          {authRequiredCount > 0
            ? `${authRequiredCount} provider credential${authRequiredCount === 1 ? '' : 's'} need attention`
            : 'No provider auth failures detected'}
        </p>
        <button
          type="button"
          onClick={() => void handleProbe()}
          className="badge-sumi inline-flex items-center gap-1 px-2 py-1 text-[10px] text-[color:var(--hv-fg-muted)] hover:bg-[var(--hv-bg-overlay)]"
          disabled={isProbing}
        >
          <RefreshCw size={12} className={isProbing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {actionError && (
        <p className="mt-2 text-xs text-[color:var(--hv-accent-danger)]">{actionError}</p>
      )}
    </div>
  )
}
