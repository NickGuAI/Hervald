import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { Activity, BarChart3, ShieldCheck, Users } from 'lucide-react'
import { AgentAvatar, Chip, Sparkline, StatusDot } from '@/surfaces/hervald'
import { usePendingApprovals } from '@/hooks/use-approvals'
import { useAgentSessions, useWorldAgents } from '@/hooks/use-agents'
import { fetchJson } from '@/lib/api'
import { cn, formatCost, timeAgo } from '@/lib/utils'
import { useFleetSessionStreams } from './use-fleet-session-streams'
import {
  buildFleetViewModel,
  FLEET_TIMELINE_SLOT_COUNT,
  type FleetActivityTone,
  type FleetAgentSession,
  type FleetApproval,
  type FleetCommander,
  type FleetCommanderGroup,
  type FleetLaneRow,
  type FleetRowTone,
  type FleetWorldAgent,
} from './view-model'

const WINDOW_OPTIONS = [5, 15, 30, 60] as const
const TIMELINE_GRID_TEMPLATE = '240px minmax(720px, 1fr) 180px'

const ROW_TONE_TO_STATUS_DOT: Record<FleetRowTone, string> = {
  active: 'active',
  blocked: 'blocked',
  stale: 'offline',
  idle: 'idle',
  completed: 'done',
}

const ROW_TONE_TO_CHIP_TONE: Record<FleetRowTone, 'critical' | 'ink' | 'neutral' | 'success' | 'warning'> = {
  active: 'success',
  blocked: 'critical',
  stale: 'warning',
  idle: 'neutral',
  completed: 'ink',
}

function activityCellClassName(tone: FleetActivityTone): string {
  if (tone === 'blocked') {
    return 'border-transparent bg-accent-vermillion/90 shadow-[0_0_0_1px_rgba(194,59,34,0.18)]'
  }
  if (tone === 'tool') {
    return 'border-transparent bg-sumi-mist'
  }
  if (tone === 'active') {
    return 'border-transparent bg-sumi-black'
  }
  return 'border border-dashed border-ink-border/70 bg-washi-aged/20'
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="card-sumi p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-whisper uppercase tracking-[0.2em] text-sumi-mist">{label}</p>
          <p className="mt-3 font-display text-[32px] leading-none text-sumi-black">{value}</p>
          <p className="mt-2 text-sm text-sumi-diluted">{hint}</p>
        </div>
        <Icon size={18} className="text-sumi-diluted" />
      </div>
    </div>
  )
}

function WindowPicker({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="inline-flex rounded-[2px_12px_2px_12px] border border-ink-border bg-washi-aged/60 p-1">
      {WINDOW_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded-[2px_8px_2px_8px] px-3 py-1.5 text-[11px] tracking-[0.08em] transition-colors',
            value === option
              ? 'bg-sumi-black text-washi-white shadow-ink-sm'
              : 'text-sumi-diluted hover:bg-washi-white/70',
          )}
        >
          {option}m
        </button>
      ))}
    </div>
  )
}

function Legend() {
  const items: Array<{ label: string; tone: FleetActivityTone }> = [
    { label: 'active', tone: 'active' },
    { label: 'tool', tone: 'tool' },
    { label: 'blocked', tone: 'blocked' },
    { label: 'idle', tone: 'idle' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-sumi-mist"
        >
          <span className={cn('h-2.5 w-2.5 rounded-[2px_6px_2px_6px]', activityCellClassName(item.tone))} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function LoadCard({
  card,
}: {
  card: FleetCommanderGroup
}) {
  return (
    <div className="rounded-[2px_16px_2px_16px] border border-ink-border bg-washi-white/90 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-sumi-black">{card.commanderLabel}</p>
          <p className="mt-1 text-xs text-sumi-diluted">
            {card.workerCount} delegated lane{card.workerCount === 1 ? '' : 's'}
          </p>
        </div>
        {card.approvalCount > 0 && <Chip tone="critical">{card.approvalCount} pend</Chip>}
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <Sparkline
          values={card.loadTrend}
          width={120}
          height={28}
          color={card.blockedRowCount > 0 ? 'var(--vermillion-seal)' : 'var(--sumi-black)'}
        />
        <div className="text-right text-[11px] leading-5 text-sumi-diluted">
          <div>{card.activeRowCount} active</div>
          <div>{card.blockedRowCount} blocked</div>
        </div>
      </div>
    </div>
  )
}

function TimelineAxis({
  windowMinutes,
}: {
  windowMinutes: number
}) {
  const labels = [
    `${windowMinutes}m ago`,
    `${Math.round((windowMinutes * 2) / 3)}m`,
    `${Math.round(windowMinutes / 3)}m`,
    'now',
  ]

  return (
    <div
      className="grid items-end gap-4 border-b border-ink-border/80 px-5 py-3 md:px-6"
      style={{ gridTemplateColumns: TIMELINE_GRID_TEMPLATE }}
    >
      <div className="text-whisper uppercase tracking-[0.18em] text-sumi-mist">Lane</div>
      <div className="flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.18em] text-sumi-mist">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="text-right text-whisper uppercase tracking-[0.18em] text-sumi-mist">Status</div>
    </div>
  )
}

function FleetRow({
  row,
}: {
  row: FleetLaneRow
}) {
  return (
    <div
      className="grid items-center gap-4 border-b border-ink-border/60 px-5 py-3 last:border-b-0 md:px-6"
      style={{ gridTemplateColumns: TIMELINE_GRID_TEMPLATE }}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-3" style={{ paddingLeft: row.depth * 18 }}>
          {row.depth === 0 ? (
            <AgentAvatar
              commander={{
                accent: row.accentColor,
                avatar: row.label.charAt(0).toUpperCase(),
              }}
              size={30}
              active={row.statusTone === 'active' || row.statusTone === 'blocked'}
            />
          ) : (
            <span className="mt-2">
              <StatusDot
                state={ROW_TONE_TO_STATUS_DOT[row.statusTone]}
                pulse={row.statusTone === 'active'}
              />
            </span>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn(
                'truncate text-sumi-black',
                row.depth === 0 ? 'font-display text-lg' : 'font-mono text-sm',
              )}
              >
                {row.label}
              </p>
              <Chip tone={row.depth === 0 ? 'ink' : 'neutral'}>{row.roleLabel}</Chip>
            </div>
            <p className="mt-1 truncate text-xs text-sumi-diluted">{row.caption}</p>
            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-sumi-mist">
              {row.sessionName}
            </p>
          </div>
        </div>
      </div>

      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${FLEET_TIMELINE_SLOT_COUNT}, minmax(0, 1fr))` }}
      >
        {row.activity.map((slotTone, index) => (
          <span
            key={`${row.id}-${index}`}
            className={cn('h-6 rounded-[2px_6px_2px_6px] transition-colors', activityCellClassName(slotTone))}
            title={`${row.label} · ${slotTone}`}
          />
        ))}
      </div>

      <div className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {row.pendingApprovalCount > 0 && <Chip tone="critical">{row.pendingApprovalCount} pend</Chip>}
          {row.queuedCount > 0 && <Chip tone="warning">{row.queuedCount} queued</Chip>}
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <StatusDot
            state={ROW_TONE_TO_STATUS_DOT[row.statusTone]}
            pulse={row.statusTone === 'active'}
          />
          <span className="text-[10px] uppercase tracking-[0.16em] text-sumi-mist">
            {row.statusLabel}
          </span>
        </div>
        <div className="mt-2 font-mono text-sm text-sumi-black">{formatCost(row.costUsd)}</div>
        <div className="text-[11px] text-sumi-diluted">{timeAgo(row.lastUpdatedAt)}</div>
      </div>
    </div>
  )
}

function FleetGroup({
  group,
}: {
  group: FleetCommanderGroup
}) {
  return (
    <section className="overflow-hidden rounded-[2px_18px_2px_18px] border border-ink-border bg-washi-white/85">
      <div
        className="grid items-center gap-4 bg-washi-aged/70 px-5 py-3 md:px-6"
        style={{ gridTemplateColumns: TIMELINE_GRID_TEMPLATE }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar
            commander={{
              accent: group.accentColor,
              avatar: group.commanderLabel.charAt(0).toUpperCase(),
            }}
            size={32}
            active={group.activeRowCount > 0 || group.blockedRowCount > 0}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-display text-xl text-sumi-black">{group.commanderLabel}</p>
              <Chip tone={ROW_TONE_TO_CHIP_TONE[group.rows[0]?.statusTone ?? 'idle']}>
                {group.commanderState}
              </Chip>
            </div>
            <p className="mt-1 text-xs text-sumi-diluted">
              {group.workerCount} worker lane{group.workerCount === 1 ? '' : 's'} · {group.rows.length} total
            </p>
          </div>
        </div>

        <div className="hidden justify-center md:flex">
          <Sparkline
            values={group.loadTrend}
            width={220}
            height={30}
            color={group.blockedRowCount > 0 ? 'var(--vermillion-seal)' : 'var(--sumi-black)'}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Chip tone="success">{group.activeRowCount} active</Chip>
          {group.blockedRowCount > 0 && <Chip tone="critical">{group.blockedRowCount} blocked</Chip>}
          {group.approvalCount > 0 && <Chip tone="warning">{group.approvalCount} approvals</Chip>}
        </div>
      </div>

      <div>
        {group.rows.map((row) => (
          <FleetRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  )
}

export default function FleetPage() {
  const [windowMinutes, setWindowMinutes] = useState<number>(30)
  const { data: sessions = [] } = useAgentSessions()
  const { data: worldAgents = [] } = useWorldAgents()
  const { data: approvals = [] } = usePendingApprovals({ refetchIntervalMs: 10_000 })
  const { data: commanders = [], isLoading } = useQuery({
    queryKey: ['commanders', 'fleet'],
    queryFn: () => fetchJson<FleetCommander[]>('/api/commanders'),
  })

  const fleetSessions = sessions as FleetAgentSession[]
  const fleetWorldAgents = worldAgents as FleetWorldAgent[]
  const fleetApprovals = approvals as FleetApproval[]
  const streamedSessionNames = fleetSessions
    .filter((session) => (
      session.transportType === 'stream'
      && (
        session.sessionType === 'commander'
        || Boolean(session.spawnedBy)
      )
    ))
    .map((session) => session.name)
  const { streams } = useFleetSessionStreams(streamedSessionNames, { enabled: commanders.length > 0 })

  const fleet = buildFleetViewModel({
    commanders,
    sessions: fleetSessions,
    worldAgents: fleetWorldAgents,
    approvals: fleetApprovals,
    streams,
    nowMs: Date.now(),
    windowMinutes,
  })

  const onlineCommanderCount = commanders.filter((commander) => commander.state !== 'stopped').length
  const activeSessionCount = fleetSessions.filter(
    (session) => session.status === 'active' || session.status === 'idle',
  ).length
  const attentionSessionCount = fleetSessions.filter(
    (session) => session.status === 'active' || session.status === 'stale',
  ).length

  return (
    <div className="min-h-full bg-[var(--hv-bg)] px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-ink-border bg-washi-white/80 px-3 py-1 text-whisper uppercase tracking-[0.18em] text-sumi-mist">
            <BarChart3 size={14} />
            Fleet
          </div>
          <div>
            <h1 className="font-display text-display text-sumi-black">Commander Fleet</h1>
            <p className="mt-2 max-w-3xl text-sm text-sumi-diluted">
              Swim lanes across every commander and live sub-agent session, with current status,
              cost, and recent activity pulled from the existing session stream.
            </p>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            icon={Users}
            label="Commanders"
            value={`${onlineCommanderCount} / ${commanders.length}`}
            hint="Running, idle, or paused commanders"
          />
          <SummaryCard
            icon={Activity}
            label="Sessions"
            value={String(activeSessionCount)}
            hint="Active or idle agent sessions"
          />
          <SummaryCard
            icon={ShieldCheck}
            label="Attention"
            value={String(attentionSessionCount)}
            hint="Active or stale sessions worth checking"
          />
        </section>

        <section className="card-sumi overflow-hidden">
          <div className="border-b border-ink-border px-5 py-4 md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="font-display text-2xl text-sumi-black">Fleet Swim Lanes</h2>
                <p className="mt-1 text-sm text-sumi-diluted">
                  Grouped by commander, with inline approval pressure and a recent activity window.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
                <Legend />
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-10">
              <div className="h-3 w-3 animate-breathe rounded-full bg-sumi-mist" />
            </div>
          ) : commanders.length === 0 ? (
            <div className="p-8 text-sm text-sumi-diluted">No commanders available.</div>
          ) : (
            <>
              <div className="border-b border-ink-border/70 bg-washi-aged/40 px-5 py-4 md:px-6">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {fleet.groups.map((group) => (
                    <LoadCard key={group.commanderId} card={group} />
                  ))}
                </div>
              </div>

              <TimelineAxis windowMinutes={windowMinutes} />

              <div className="overflow-x-auto px-4 py-5 md:px-5">
                <div className="min-w-[1180px] space-y-5">
                  {fleet.groups.map((group) => (
                    <FleetGroup key={group.commanderId} group={group} />
                  ))}
                </div>
              </div>

              <div className="border-t border-ink-border bg-washi-aged/50 px-5 py-3 text-xs text-sumi-diluted md:px-6">
                Showing {fleet.visibleRowCount} live lane{fleet.visibleRowCount === 1 ? '' : 's'} across{' '}
                {fleet.groups.length} commander group{fleet.groups.length === 1 ? '' : 's'}.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
