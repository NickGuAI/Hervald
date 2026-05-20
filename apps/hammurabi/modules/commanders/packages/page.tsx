import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchJson } from '@/lib/api'

interface CommanderPackageSkill {
  id: string
  label: string
  required: boolean
  purpose: string
}

interface CommanderPackageExample {
  id: string
  title: string
  body: string
}

interface CommanderPackageResponse {
  id: string
  version: string
  displayName: string
  role: string
  summary: string
  description: string
  skills: CommanderPackageSkill[]
  examples: CommanderPackageExample[]
  onboarding: string
  installState: {
    installed: boolean
    commanderId: string | null
    displayName: string | null
  }
}

interface PackageListResponse {
  packages: CommanderPackageResponse[]
}

const PACKAGES_QUERY_KEY = ['commanders', 'packages'] as const

async function listCommanderPackages(): Promise<PackageListResponse> {
  return fetchJson<PackageListResponse>('/api/commanders/packages')
}

async function installCommanderPackage(packageId: string): Promise<unknown> {
  return fetchJson(`/api/commanders/packages/${encodeURIComponent(packageId)}/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

function PackageCard({
  pkg,
  installing,
  onInstall,
}: {
  pkg: CommanderPackageResponse
  installing: boolean
  onInstall: (packageId: string) => void
}) {
  const requiredSkills = pkg.skills.filter((skill) => skill.required)
  const optionalSkills = pkg.skills.filter((skill) => !skill.required)

  return (
    <article className="hv-marketplace-card" data-testid={`commander-package-${pkg.id}`}>
      <header>
        <div>
          <p className="hv-marketplace-eyebrow">{pkg.role}</p>
          <h2>{pkg.displayName}</h2>
        </div>
        <span className={pkg.installState.installed ? 'hv-marketplace-badge-installed' : 'hv-marketplace-badge'}>
          {pkg.installState.installed ? 'Installed' : `v${pkg.version}`}
        </span>
      </header>

      <p className="hv-marketplace-summary">{pkg.summary}</p>
      <p className="hv-marketplace-description">{pkg.description}</p>

      <section aria-label={`${pkg.displayName} required skills`}>
        <h3>Required Skills</h3>
        <div className="hv-marketplace-skill-grid">
          {requiredSkills.map((skill) => (
            <div key={skill.id} className="hv-marketplace-skill">
              <strong>{skill.label}</strong>
              <span>{skill.purpose}</span>
            </div>
          ))}
        </div>
      </section>

      {optionalSkills.length > 0 ? (
        <section aria-label={`${pkg.displayName} optional skills`}>
          <h3>Optional Skills</h3>
          <div className="hv-marketplace-skill-grid">
            {optionalSkills.map((skill) => (
              <div key={skill.id} className="hv-marketplace-skill hv-marketplace-skill-muted">
                <strong>{skill.label}</strong>
                <span>{skill.purpose}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="hv-marketplace-details">
        <summary>Onboarding guide</summary>
        <pre>{pkg.onboarding.trim()}</pre>
      </details>

      <details className="hv-marketplace-details">
        <summary>Examples</summary>
        {pkg.examples.map((example) => (
          <pre key={example.id}>{example.body.trim()}</pre>
        ))}
      </details>

      <footer>
        {pkg.installState.installed && pkg.installState.commanderId ? (
          <Link
            className="hv-marketplace-button hv-marketplace-button-ghost"
            to={`/org?commander=${encodeURIComponent(pkg.installState.commanderId)}`}
          >
            Open Commander
          </Link>
        ) : null}
        <button
          type="button"
          className="hv-marketplace-button hv-marketplace-button-primary"
          onClick={() => onInstall(pkg.id)}
          disabled={installing || pkg.installState.installed}
          data-testid={`install-commander-package-${pkg.id}`}
        >
          {pkg.installState.installed ? 'Installed' : installing ? 'Installing...' : 'Hire Commander'}
        </button>
      </footer>
    </article>
  )
}

export default function CommanderPackagesPage() {
  const queryClient = useQueryClient()
  const packagesQuery = useQuery({
    queryKey: PACKAGES_QUERY_KEY,
    queryFn: listCommanderPackages,
  })
  const installMutation = useMutation({
    mutationFn: installCommanderPackage,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PACKAGES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['commanders'] }),
      ])
    },
  })

  const packages = packagesQuery.data?.packages ?? []
  const installedCount = useMemo(
    () => packages.filter((pkg) => pkg.installState.installed).length,
    [packages],
  )

  return (
    <main className="hv-marketplace-page" data-testid="commander-marketplace-page">
      <style>{`
        .hv-marketplace-page {
          min-height: calc(100vh - 52px);
          background: var(--hv-bg-raised);
          color: var(--hv-fg);
          font-family: var(--hv-font-body);
          padding: clamp(18px, 3vw, 34px);
        }
        .hv-marketplace-shell {
          width: min(1180px, 100%);
          margin: 0 auto;
        }
        .hv-marketplace-header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: var(--hv-space-4);
          margin-bottom: var(--hv-space-5);
        }
        .hv-marketplace-eyebrow {
          margin: 0;
          color: var(--hv-fg-subtle);
          font-size: var(--hv-text-whisper);
          letter-spacing: var(--hv-track-section);
          text-transform: uppercase;
        }
        .hv-marketplace-header h1,
        .hv-marketplace-card h2 {
          margin: var(--hv-space-1) 0 0;
          font-family: var(--hv-font-primary);
          font-weight: 300;
          line-height: 1;
        }
        .hv-marketplace-header h1 {
          font-size: clamp(36px, 4vw, 58px);
        }
        .hv-marketplace-status {
          border: 1px solid var(--hv-border-firm);
          background: var(--hv-bg);
          border-radius: var(--hv-radius-carved);
          box-shadow: var(--hv-shadow-block);
          padding: 10px 14px;
          color: var(--hv-fg-muted);
        }
        .hv-marketplace-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--hv-space-4);
        }
        .hv-marketplace-card {
          display: flex;
          flex-direction: column;
          gap: var(--hv-space-4);
          border: 1px solid var(--hv-border-firm);
          border-radius: var(--hv-radius-carved-lg);
          background: var(--hv-bg);
          box-shadow: var(--hv-shadow-rest);
          padding: var(--hv-space-5);
        }
        .hv-marketplace-card header,
        .hv-marketplace-card footer {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: var(--hv-space-3);
        }
        .hv-marketplace-card footer {
          align-items: center;
          margin-top: auto;
        }
        .hv-marketplace-card h2 {
          font-size: clamp(28px, 3vw, 38px);
        }
        .hv-marketplace-card h3 {
          margin: 0 0 var(--hv-space-2);
          font-size: var(--hv-text-small);
          letter-spacing: var(--hv-track-label);
          text-transform: uppercase;
          color: var(--hv-fg-subtle);
        }
        .hv-marketplace-summary,
        .hv-marketplace-description {
          margin: 0;
          color: var(--hv-fg-muted);
          line-height: var(--hv-leading-normal);
        }
        .hv-marketplace-summary {
          color: var(--hv-fg);
        }
        .hv-marketplace-badge,
        .hv-marketplace-badge-installed {
          flex: 0 0 auto;
          border-radius: var(--hv-radius-carved-sm);
          padding: 5px 8px;
          font-size: var(--hv-text-whisper);
          letter-spacing: var(--hv-track-whisper);
          text-transform: uppercase;
        }
        .hv-marketplace-badge {
          background: var(--hv-badge-neutral-bg);
          color: var(--hv-badge-neutral-fg);
        }
        .hv-marketplace-badge-installed {
          background: var(--hv-badge-success-bg);
          color: var(--hv-badge-success-fg);
        }
        .hv-marketplace-skill-grid {
          display: grid;
          gap: var(--hv-space-2);
        }
        .hv-marketplace-skill {
          border: 1px solid var(--hv-border-hair);
          border-radius: var(--hv-radius-carved);
          background: var(--hv-bg-raised);
          padding: var(--hv-space-3);
        }
        .hv-marketplace-skill strong,
        .hv-marketplace-skill span {
          display: block;
        }
        .hv-marketplace-skill strong {
          font-weight: 500;
        }
        .hv-marketplace-skill span {
          margin-top: 3px;
          color: var(--hv-fg-muted);
          line-height: var(--hv-leading-normal);
        }
        .hv-marketplace-skill-muted {
          opacity: 0.78;
        }
        .hv-marketplace-details {
          border-top: 1px solid var(--hv-border-hair);
          padding-top: var(--hv-space-3);
        }
        .hv-marketplace-details summary {
          cursor: pointer;
          color: var(--hv-fg);
        }
        .hv-marketplace-details pre {
          white-space: pre-wrap;
          margin: var(--hv-space-3) 0 0;
          color: var(--hv-fg-muted);
          font-family: var(--hv-font-mono);
          font-size: var(--hv-text-small);
          line-height: var(--hv-leading-normal);
        }
        .hv-marketplace-button {
          min-height: 42px;
          border-radius: var(--hv-radius-carved);
          border: 1px solid var(--hv-border-firm);
          padding: 10px 16px;
          color: var(--hv-fg);
          text-decoration: none;
          cursor: pointer;
        }
        .hv-marketplace-button-primary {
          background: var(--hv-button-primary-bg);
          color: var(--hv-button-primary-fg);
          box-shadow: var(--hv-shadow-block);
        }
        .hv-marketplace-button-ghost {
          background: transparent;
          color: var(--hv-fg-muted);
        }
        .hv-marketplace-button:disabled {
          cursor: not-allowed;
          opacity: 0.48;
          box-shadow: none;
        }
        .hv-marketplace-empty {
          border: 1px solid var(--hv-border-soft);
          background: var(--hv-bg);
          border-radius: var(--hv-radius-carved-lg);
          padding: var(--hv-space-5);
          color: var(--hv-fg-muted);
        }
        @media (max-width: 1180px) {
          .hv-marketplace-grid {
            grid-template-columns: 1fr;
          }
          .hv-marketplace-header {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>

      <div className="hv-marketplace-shell">
        <header className="hv-marketplace-header">
          <div>
            <p className="hv-marketplace-eyebrow">Hervald / Commander Marketplace</p>
            <h1>Hire a bundled commander</h1>
          </div>
          <div className="hv-marketplace-status" data-testid="commander-marketplace-status">
            {installedCount} of {packages.length} installed
          </div>
        </header>

        {packagesQuery.isLoading ? (
          <div className="hv-marketplace-empty">Loading commander packages...</div>
        ) : null}

        {packagesQuery.error ? (
          <div className="hv-marketplace-empty" role="alert">
            {packagesQuery.error instanceof Error ? packagesQuery.error.message : 'Unable to load packages.'}
          </div>
        ) : null}

        {!packagesQuery.isLoading && packages.length === 0 ? (
          <div className="hv-marketplace-empty">No bundled commander packages found.</div>
        ) : null}

        <section className="hv-marketplace-grid" aria-label="Bundled commander packages">
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              installing={installMutation.isPending && installMutation.variables === pkg.id}
              onInstall={(packageId) => installMutation.mutate(packageId)}
            />
          ))}
        </section>
      </div>
    </main>
  )
}
