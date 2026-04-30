import { Fragment, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { StringArrayInput } from '@/components/string-array-input'
import {
  useActionPolicies,
  usePolicySettings,
  usePolicyCommanders,
  useUpdateActionPolicy,
  useUpdatePolicySettings,
  type ActionPolicyKind,
  type ActionPolicyMode,
  type ActionPolicyRecord,
  type ActionPolicyScope,
} from '@/hooks/use-action-policies'
import { useSkills } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

type PolicyGroup = 'Channels' | 'Code & Infra' | 'Skills' | 'Default'

interface BasePolicyRow {
  actionId: string
  name: string
  description: string
  group: PolicyGroup
  kind: ActionPolicyKind
  targetLabel?: string
  allowPlaceholder?: string
  blockPlaceholder?: string
  supportsLists: boolean
}

interface DisplayPolicyRow extends BasePolicyRow {
  policy: ActionPolicyMode
  allowlist: string[]
  blocklist: string[]
  sourceScope?: string
  scope?: string
}

const POLICY_OPTIONS: Array<{ value: ActionPolicyMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'review', label: 'Review' },
  { value: 'block', label: 'Block' },
] as const

const TIMEOUT_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const

const BUILT_IN_ACTIONS: BasePolicyRow[] = [
  {
    actionId: 'send-email',
    name: 'Send Email',
    description: 'External email sends and drafts that reach recipients outside the workspace.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'recipient',
    allowPlaceholder: '*@gehirn.ai',
    blockPlaceholder: '*@external-client.com',
    supportsLists: true,
  },
  {
    actionId: 'send-message',
    name: 'Send Message',
    description: 'Outbound chat, DM, and messaging sends across Slack, Discord, WhatsApp, Telegram, and similar channels.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'channel or recipient',
    allowPlaceholder: 'slack:#ops',
    blockPlaceholder: 'telegram:*',
    supportsLists: true,
  },
  {
    actionId: 'post-social',
    name: 'Post to Social',
    description: 'Publishing content to social platforms such as X, LinkedIn, Circle, or similar networks.',
    group: 'Channels',
    kind: 'action',
    targetLabel: 'platform',
    allowPlaceholder: 'linkedin',
    blockPlaceholder: 'x',
    supportsLists: true,
  },
  {
    actionId: 'push-code-prs',
    name: 'Push Code / PRs',
    description: 'Git pushes, pull request creation, and related code publication actions.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'repo or branch',
    allowPlaceholder: 'NickGuAI/*',
    blockPlaceholder: 'main',
    supportsLists: true,
  },
  {
    actionId: 'deploy',
    name: 'Deploy',
    description: 'Deploys to external services and environments, including production workflows.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'service or environment',
    allowPlaceholder: 'staging',
    blockPlaceholder: 'production',
    supportsLists: true,
  },
  {
    actionId: 'publish-content',
    name: 'Publish Content',
    description: 'Publishing content to external platforms such as docs, reports, blogs, and workspace tools.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'target platform',
    allowPlaceholder: 'notion',
    blockPlaceholder: 'blog:public',
    supportsLists: true,
  },
  {
    actionId: 'calendar-changes',
    name: 'Calendar Changes',
    description: 'Creating or updating external calendar events and related scheduling actions.',
    group: 'Code & Infra',
    kind: 'action',
    targetLabel: 'calendar or event',
    allowPlaceholder: 'primary',
    blockPlaceholder: 'team@group.calendar.google.com',
    supportsLists: true,
  },
] as const

const FALLBACK_ACTION_ID = 'everything-else'

const FALLBACK_ROW: BasePolicyRow = {
  actionId: FALLBACK_ACTION_ID,
  name: 'Everything Else',
  description: 'Fallback policy for unmatched external actions.',
  group: 'Default',
  kind: 'action',
  supportsLists: false,
}

function parseApiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unexpected error'
  }

  const match = error.message.match(/^Request failed \(\d+\): (.+)$/s)
  const raw = match?.[1] ?? error.message

  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string }
    return parsed.error ?? parsed.message ?? error.message
  } catch {
    return raw
  }
}

function findPolicyRecord(
  records: ActionPolicyRecord[],
  row: Pick<BasePolicyRow, 'actionId' | 'name' | 'kind'>,
): ActionPolicyRecord | null {
  const rowNameLower = row.name.toLowerCase()

  return (
    records.find((record) => {
      const recordId = record.actionId || record.id
      if (recordId === row.actionId) {
        return true
      }

      if (record.kind !== row.kind) {
        return false
      }

      return record.name.toLowerCase() === rowNameLower
    }) ?? null
  )
}

function buildBuiltInRows(records: ActionPolicyRecord[]): DisplayPolicyRow[] {
  return BUILT_IN_ACTIONS.map((row) => {
    const record = findPolicyRecord(records, row)
    return {
      ...row,
      policy: record?.policy ?? 'review',
      allowlist: record?.allowlist ?? [],
      blocklist: record?.blocklist ?? [],
      sourceScope: record?.sourceScope,
      scope: record?.scope,
    }
  })
}

function buildSkillRows(records: ActionPolicyRecord[], skills: Array<{ name: string; description: string }>): DisplayPolicyRow[] {
  return [...skills]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => {
      const baseRow: BasePolicyRow = {
        actionId: `skill:${skill.name}`,
        name: `/${skill.name}`,
        description:
          skill.description ||
          'User-invocable skill discovered automatically. Inner tool calls inherit this policy.',
        group: 'Skills',
        kind: 'skill',
        supportsLists: false,
      }
      const record =
        findPolicyRecord(records, baseRow) ??
        records.find((candidate) => candidate.actionId === skill.name || candidate.id === skill.name) ??
        null

      return {
        ...baseRow,
        policy: record?.policy ?? 'review',
        allowlist: record?.allowlist ?? [],
        blocklist: record?.blocklist ?? [],
        sourceScope: record?.sourceScope,
        scope: record?.scope,
      }
    })
}

function buildFallbackRow(records: ActionPolicyRecord[]): DisplayPolicyRow {
  const record = findPolicyRecord(records, FALLBACK_ROW)
  return {
    ...FALLBACK_ROW,
    policy: record?.policy ?? 'review',
    allowlist: [],
    blocklist: [],
    sourceScope: record?.sourceScope,
    scope: record?.scope,
  }
}

function isInheritedRow(row: DisplayPolicyRow, scope: ActionPolicyScope): boolean {
  if (scope === 'global') {
    return false
  }

  if (row.sourceScope) {
    return row.sourceScope !== scope
  }

  if (row.scope) {
    return row.scope !== scope
  }

  return true
}

function scopeLabel(scope: ActionPolicyScope, commanders: Array<{ id: string; displayName?: string; host: string }>): string {
  if (scope === 'global') {
    return 'Global'
  }

  const commanderId = scope.replace(/^commander:/, '')
  const commander = commanders.find((candidate) => candidate.id === commanderId)
  const label = commander?.displayName?.trim() || commander?.host || commanderId
  return `Commander: ${label}`
}

function rulesSummaryLabel(row: DisplayPolicyRow): string {
  if (row.group === 'Default') {
    return 'fallback'
  }
  if (!row.supportsLists) {
    return 'skill'
  }

  const totalRules = row.allowlist.length + row.blocklist.length
  return `${totalRules} rule${totalRules === 1 ? '' : 's'}`
}

export default function PoliciesPage() {
  const [scope, setScope] = useState<ActionPolicyScope>('global')
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({
    'send-email': true,
  })

  const commandersQuery = usePolicyCommanders()
  const policiesQuery = useActionPolicies(scope)
  const settingsQuery = usePolicySettings()
  const skillsQuery = useSkills()
  const updatePolicy = useUpdateActionPolicy(scope)
  const updateSettings = useUpdatePolicySettings()

  const commanders = commandersQuery.data ?? []
  const skills = (skillsQuery.data ?? [])
    .filter((skill) => skill.userInvocable)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
    }))
  const records = policiesQuery.data ?? []
  const settings = settingsQuery.data ?? {
    timeoutMinutes: 15,
    timeoutAction: 'block' as const,
    standingApprovalExpiryDays: 30,
  }

  const channelsRows = buildBuiltInRows(records).filter((row) => row.group === 'Channels')
  const codeInfraRows = buildBuiltInRows(records).filter((row) => row.group === 'Code & Infra')
  const skillRows = buildSkillRows(records, skills)
  const fallbackRow = buildFallbackRow(records)

  const groups: Array<{ label: PolicyGroup; rows: DisplayPolicyRow[] }> = [
    { label: 'Channels', rows: channelsRows },
    { label: 'Code & Infra', rows: codeInfraRows },
    { label: 'Skills', rows: skillRows },
    { label: 'Default', rows: [fallbackRow] },
  ]

  const pageError =
    (policiesQuery.error instanceof Error ? parseApiErrorMessage(policiesQuery.error) : null) ??
    (settingsQuery.error instanceof Error ? parseApiErrorMessage(settingsQuery.error) : null) ??
    (commandersQuery.error instanceof Error ? parseApiErrorMessage(commandersQuery.error) : null) ??
    (skillsQuery.error instanceof Error ? parseApiErrorMessage(skillsQuery.error) : null)
  const mutationError =
    (updatePolicy.error instanceof Error ? parseApiErrorMessage(updatePolicy.error) : null) ??
    (updateSettings.error instanceof Error ? parseApiErrorMessage(updateSettings.error) : null)

  function toggleExpanded(actionId: string) {
    setExpandedRows((current) => ({
      ...current,
      [actionId]: !current[actionId],
    }))
  }

  function handlePolicyUpdate(
    row: DisplayPolicyRow,
    nextValues: Partial<Pick<DisplayPolicyRow, 'policy' | 'allowlist' | 'blocklist'>>,
  ) {
    updatePolicy.mutate({
      scope,
      actionId: row.actionId,
      id: row.actionId,
      name: row.name,
      kind: row.kind,
      policy: nextValues.policy ?? row.policy,
      allowlist: nextValues.allowlist ?? row.allowlist,
      blocklist: nextValues.blocklist ?? row.blocklist,
      description: row.description,
      group: row.group,
      targetLabel: row.targetLabel,
    })
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink-border bg-washi-aged/40 px-5 py-5 md:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} className="mt-0.5 text-sumi-diluted" />
            <div>
              <h2 className="font-display text-display text-sumi-black">Action Policies</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sumi-diluted">
                Configure which external actions run automatically, require review, or stay blocked.
                Built-in actions use allowlists and blocklists, and user-invocable skills are discovered automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-[17rem]">
              <label className="section-title mb-1.5 block" htmlFor="policies-scope-select">
                Scope
              </label>
              <div className="inline-flex w-full rounded-full border border-ink-border bg-washi-aged p-1">
                <select
                  id="policies-scope-select"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as ActionPolicyScope)}
                  className="w-full rounded-full bg-transparent px-4 py-2 text-sm text-sumi-black focus:outline-none"
                >
                  <option value="global">Global</option>
                  {commanders.map((commander) => (
                    <option key={commander.id} value={`commander:${commander.id}`}>
                      Commander: {commander.displayName?.trim() || commander.host}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void Promise.all([
                  policiesQuery.refetch(),
                  settingsQuery.refetch(),
                  commandersQuery.refetch(),
                  skillsQuery.refetch(),
                ])
              }}
              className="card-sumi inline-flex items-center justify-center gap-2 px-4 py-3 text-sm text-sumi-black transition-colors hover:bg-ink-wash"
            >
              <RefreshCw
                size={14}
                className={
                  policiesQuery.isFetching || commandersQuery.isFetching || skillsQuery.isFetching
                    || settingsQuery.isFetching
                    ? 'animate-spin'
                    : ''
                }
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="card-sumi flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="section-title">Active Scope</p>
              <p className="mt-2 text-sm text-sumi-black">{scopeLabel(scope, commanders)}</p>
              <p className="mt-1 text-sm text-sumi-diluted">
                Default action policy is <span className="font-medium text-sumi-black">Review</span>.
                Allowlists override to Auto and blocklists override to Block.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="badge-sumi">{channelsRows.length} channel actions</span>
              <span className="badge-sumi">{codeInfraRows.length} code &amp; infra actions</span>
              <span className="badge-sumi">{skillRows.length} discovered skills</span>
              <span className="badge-sumi">Fallback policy</span>
            </div>
          </div>

          <div className="card-sumi flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock3 size={16} className="text-sumi-diluted" />
                <p className="section-title">Queue Defaults</p>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sumi-diluted">
                Configure what happens when a queued approval sits without a human response.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-[12rem]">
                <label className="section-title mb-1.5 block" htmlFor="approval-timeout-minutes">
                  Timeout Window
                </label>
                <select
                  id="approval-timeout-minutes"
                  value={settings.timeoutMinutes}
                  onChange={(event) =>
                    updateSettings.mutate({
                      ...settings,
                      timeoutMinutes: Number.parseInt(event.target.value, 10) || settings.timeoutMinutes,
                    })
                  }
                  className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist"
                >
                  {TIMEOUT_MINUTE_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minute{minutes === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[12rem]">
                <label className="section-title mb-1.5 block" htmlFor="approval-timeout-action">
                  No-Response Action
                </label>
                <select
                  id="approval-timeout-action"
                  value={settings.timeoutAction}
                  onChange={(event) =>
                    updateSettings.mutate({
                      ...settings,
                      timeoutAction: event.target.value === 'auto' ? 'auto' : 'block',
                    })
                  }
                  className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist"
                >
                  <option value="block">Reject after timeout</option>
                  <option value="auto">Auto-approve after timeout</option>
                </select>
              </div>
            </div>
          </div>

          {(pageError || mutationError) && (
            <div className="flex items-start gap-2 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{mutationError ?? pageError}</span>
            </div>
          )}

          <div className="card-sumi overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-washi-aged text-xs uppercase tracking-[0.18em] text-sumi-mist">
                  <tr>
                    <th className="w-14 px-4 py-3"> </th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Scope State</th>
                    <th className="w-[180px] px-4 py-3">Policy</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ label, rows }) => (
                    <Fragment key={label}>
                      <tr className="border-t border-ink-border/60 bg-white/40">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {label === 'Skills' ? (
                              <Sparkles size={14} className="text-sumi-diluted" />
                            ) : (
                              <ShieldCheck size={14} className="text-sumi-diluted" />
                            )}
                            <span className="section-title">{label}</span>
                          </div>
                        </td>
                      </tr>

                      {rows.length === 0 ? (
                        <tr className="border-t border-ink-border/40">
                          <td colSpan={4} className="px-4 py-5 text-sm text-sumi-diluted">
                            {label === 'Skills'
                              ? 'No user-invocable skills were discovered yet.'
                              : 'No policy rows are available in this group.'}
                          </td>
                        </tr>
                      ) : (
                        rows.map((row) => {
                          const expanded = Boolean(expandedRows[row.actionId])
                          const savingThisRow =
                            updatePolicy.isPending &&
                            updatePolicy.variables?.actionId === row.actionId
                          const inherited = isInheritedRow(row, scope)

                          return (
                            <Fragment key={row.actionId}>
                              <tr className="border-t border-ink-border/60">
                                <td className="px-4 py-3 align-top">
                                  {row.supportsLists ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(row.actionId)}
                                      className="rounded-lg p-1 text-sumi-diluted transition-colors hover:bg-ink-wash hover:text-sumi-black"
                                      aria-label={expanded ? `Collapse ${row.name} rules` : `Expand ${row.name} rules`}
                                    >
                                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </button>
                                  ) : (
                                    <span className="badge-sumi">Skill</span>
                                  )}
                                </td>

                                <td className="px-4 py-3 align-top">
                                  <div className="min-w-0">
                                    <div className="font-mono text-sm text-sumi-black">{row.name}</div>
                                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-sumi-diluted">
                                      {row.description}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {row.targetLabel ? (
                                        <span className="badge-sumi">{row.targetLabel}</span>
                                      ) : null}
                                      <span className="badge-sumi">{rulesSummaryLabel(row)}</span>
                                      {savingThisRow ? <span className="badge-sumi">Saving...</span> : null}
                                    </div>
                                  </div>
                                </td>

                                <td className="px-4 py-3 align-top">
                                  <div className="flex flex-wrap gap-2">
                                    <span
                                      className={cn(
                                        'badge-sumi',
                                        inherited ? 'bg-ink-wash text-sumi-diluted' : 'badge-active',
                                      )}
                                    >
                                      {inherited ? 'Inherited from Global' : scope === 'global' ? 'Global Default' : 'Commander Override'}
                                    </span>
                                  </div>
                                </td>

                                <td className="px-4 py-3 align-top">
                                  <label className="sr-only" htmlFor={`policy-select-${row.actionId}`}>
                                    {row.name} policy
                                  </label>
                                  <select
                                    id={`policy-select-${row.actionId}`}
                                    value={row.policy}
                                    onChange={(event) =>
                                      handlePolicyUpdate(row, {
                                        policy: event.target.value as ActionPolicyMode,
                                      })
                                    }
                                    className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist"
                                  >
                                    {POLICY_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>

                              {row.supportsLists && expanded ? (
                                <tr className="border-t border-ink-border/40 bg-white/40">
                                  <td colSpan={4} className="px-4 pb-4 pt-1">
                                    <div className="grid gap-4 lg:grid-cols-2">
                                      <StringArrayInput
                                        label={`Auto-approve when ${row.targetLabel} matches`}
                                        description={`Patterns here bypass review for ${row.name.toLowerCase()} when the ${row.targetLabel} matches.`}
                                        values={row.allowlist}
                                        placeholder={row.allowPlaceholder}
                                        emptyMessage={`No auto-approve patterns for ${row.name.toLowerCase()} yet.`}
                                        addLabel="Add allow rule"
                                        onChange={(nextAllowlist) =>
                                          handlePolicyUpdate(row, { allowlist: nextAllowlist })
                                        }
                                      />

                                      <StringArrayInput
                                        label={`Always block when ${row.targetLabel} matches`}
                                        description={`Patterns here force ${row.name.toLowerCase()} to block before it reaches an external target.`}
                                        values={row.blocklist}
                                        placeholder={row.blockPlaceholder}
                                        emptyMessage={`No block patterns for ${row.name.toLowerCase()} yet.`}
                                        addLabel="Add block rule"
                                        onChange={(nextBlocklist) =>
                                          handlePolicyUpdate(row, { blocklist: nextBlocklist })
                                        }
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          )
                        })
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
