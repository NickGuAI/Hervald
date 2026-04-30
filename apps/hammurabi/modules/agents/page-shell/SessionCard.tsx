import { useEffect, useId, useRef, useState } from 'react'
import { ChevronRight, Cpu, Monitor } from 'lucide-react'
import { timeAgo, cn } from '@/lib/utils'
import type { AgentType, Machine } from '@/types'
import { DEFAULT_CLAUDE_EFFORT_LEVEL } from '../../claude-effort.js'
import {
  fallbackWorkerSummary,
  getKillConfirmationMessage,
  isWorkerOrchestrationComplete,
  type AgentSessionWithWorkers,
} from './session-helpers'

const ROW_STATUS_DOT_CLASS: Record<string, string> = {
  active: 'bg-emerald-600',
  completed: 'bg-sumi-diluted',
  exited: 'bg-sumi-diluted',
  idle: 'bg-sumi-mist',
  stale: 'bg-amber-700',
}

export interface SessionCardProps {
  session: AgentSessionWithWorkers
  machine?: Machine
  selected: boolean
  variant?: 'card' | 'row'
  onSelect: () => void
  onKill: () => Promise<void> | void
  onResume: () => Promise<void> | void
  onNavigateToSession?: (sessionName: string) => void
}

export function SessionCard({
  session,
  machine,
  selected,
  variant = 'card',
  onSelect,
  onKill,
  onResume,
  onNavigateToSession,
}: SessionCardProps) {
  const detailsId = useId()
  const rowButtonRef = useRef<HTMLButtonElement | null>(null)
  const isCommander = session.sessionType === 'commander'
  const Icon = Monitor
  const isRemote = Boolean(session.host)
  const transportType = session.transportType
    ?? (session.sessionType === 'pty' || session.sessionType === 'stream' ? session.sessionType : undefined)
  const isStream = transportType === 'stream'
  const rawAgentType = typeof session.agentType === 'string' ? session.agentType : null
  const agentBadge = rawAgentType && rawAgentType !== 'claude'
    ? rawAgentType
    : null
  const workerSummary = isStream
    ? (session.workerSummary ?? fallbackWorkerSummary(session.spawnedWorkers?.length ?? 0))
    : null
  const shouldShowWorkerSummary = Boolean(
    isStream
    && workerSummary
    && (workerSummary.total > 0 || (session.spawnedWorkers?.length ?? 0) > 0),
  )
  const processAlive = session.processAlive !== false
  const workerOrchestrationComplete = isWorkerOrchestrationComplete(workerSummary)
  const canResume = isStream && session.resumeAvailable === true
  const queuedMessageCount = typeof session.queuedMessageCount === 'number'
    ? session.queuedMessageCount
    : 0
  const sessionLabel = session.label ?? session.name
  const rowHostLabel = machine?.label ?? machine?.host ?? session.host ?? null
  const sessionStatus = session.status
    ?? (!processAlive ? (session.hadResult ? 'completed' : 'exited') : null)
    ?? (workerOrchestrationComplete && !isCommander ? 'completed' : null)
  const rowStatusClass = ROW_STATUS_DOT_CLASS[sessionStatus ?? 'idle'] ?? ROW_STATUS_DOT_CLASS.idle
  const rowMeta = [
    rawAgentType,
    rowHostLabel,
    sessionStatus,
  ].filter((value): value is string => Boolean(value))
  const [isExpanded, setIsExpanded] = useState(variant === 'row' && selected)

  useEffect(() => {
    if (variant !== 'row') {
      return
    }
    if (!selected) {
      setIsExpanded(false)
    }
  }, [selected, variant])

  const handleResume = () => {
    void Promise.resolve(onResume()).catch(() => {
      // error handled by page-level state
    })
  }

  const handleKill = () => {
    const confirmed = window.confirm(getKillConfirmationMessage(session.name, rawAgentType as AgentType | null))
    if (!confirmed) {
      return
    }
    void Promise.resolve(onKill()).catch(() => {
      // error handled by page-level session action state
    })
  }

  const handleDismiss = () => {
    void Promise.resolve(onKill()).catch(() => {})
  }

  const sessionActions = (
    <>
      {canResume && processAlive && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleResume()
          }}
          className="badge-sumi px-2 py-1 text-[10px] text-accent-indigo hover:bg-accent-indigo/10 transition-colors"
        >
          Resume
        </button>
      )}
      {processAlive ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleKill()
          }}
          className="badge-sumi px-2 py-1 text-[10px] text-accent-vermillion hover:bg-accent-vermillion/10 transition-colors"
        >
          Kill
        </button>
      ) : (
        <>
          {canResume && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                handleResume()
              }}
              className="badge-sumi px-2 py-1 text-[10px] text-accent-indigo hover:bg-accent-indigo/10 transition-colors"
            >
              Resume
            </button>
          )}
          <span className="badge-sumi px-2 py-1 text-[10px] bg-ink-wash text-sumi-diluted">
            {session.hadResult ? 'completed' : 'exited'}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleDismiss()
            }}
            className="badge-sumi px-2 py-1 text-[10px] text-sumi-diluted hover:text-accent-vermillion hover:bg-accent-vermillion/10 transition-colors"
          >
            Dismiss
          </button>
        </>
      )}
    </>
  )

  const sessionLifecycleMeta = (
    <>
      <div
        className={cn(
          'flex items-center gap-4 text-whisper text-sumi-diluted',
          variant === 'row' && 'mt-3 flex-wrap border-t border-ink-border pt-3',
          variant !== 'row' && 'mt-3',
        )}
      >
        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          PID {session.pid}
        </span>
        <span>{variant === 'row' ? `Started ${timeAgo(session.created)}` : timeAgo(session.created)}</span>
        {session.agentType === 'claude' && (
          <span>effort {session.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL}</span>
        )}
      </div>

      {shouldShowWorkerSummary && workerSummary && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-whisper font-mono">
          {workerSummary.running > 0 && (
            <span className="text-emerald-600">● {workerSummary.running} running</span>
          )}
          {workerSummary.starting > 0 && (
            <span className="text-sumi-mist">○ {workerSummary.starting} starting</span>
          )}
          {workerSummary.down > 0 && (
            <span className="text-accent-vermillion">⊘ {workerSummary.down} down</span>
          )}
          {workerSummary.done > 0
            && workerSummary.running === 0
            && workerSummary.down === 0
            && workerSummary.starting === 0 && (
            <span className="text-sumi-diluted">✓ {workerSummary.done} done</span>
          )}
        </div>
      )}

      {isStream && session.spawnedBy && (
        <div className="mt-2 text-whisper text-sumi-diluted">
          ↖ spawned by: <span className="font-mono">{session.spawnedBy}</span>
        </div>
      )}

      {isStream && session.resumedFrom && (
        <div className="mt-2 text-whisper text-sumi-diluted">
          {variant === 'row' ? 'Resume-from-previous:' : '↺ resumed from:'}{' '}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (session.resumedFrom) {
                onNavigateToSession?.(session.resumedFrom)
              }
            }}
            className="font-mono underline decoration-sumi-mist/80 underline-offset-2 hover:text-sumi-gray"
          >
            {session.resumedFrom}
          </button>
        </div>
      )}
    </>
  )

  if (variant === 'row') {
    return (
      <div
        className="w-full"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !isExpanded) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          setIsExpanded(false)
          rowButtonRef.current?.focus()
        }}
      >
        <button
          ref={rowButtonRef}
          type="button"
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          onClick={() => {
            onSelect()
            setIsExpanded((current) => (selected ? !current : true))
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return
            }
            event.preventDefault()
            onSelect()
            setIsExpanded((current) => (selected ? !current : true))
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-200 ease-gentle',
            'hover:bg-ink-wash focus-visible:bg-ink-wash focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sumi-black/10',
            (selected || isExpanded) && 'bg-ink-wash',
          )}
        >
          <div
            data-session-card-row-content
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap"
          >
            <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', rowStatusClass)} />
            <span
              title={sessionLabel}
              className="min-w-0 shrink truncate font-mono text-xs text-sumi-black"
            >
              {sessionLabel}
            </span>
            {rowMeta.length > 0 && (
              <span className="truncate text-[11px] text-sumi-diluted">
                · {rowMeta.join(' · ')}
              </span>
            )}
          </div>

          <ChevronRight
            size={15}
            className={cn(
              'shrink-0 text-sumi-mist transition-transform duration-200',
              isExpanded && 'rotate-90 text-sumi-gray',
            )}
          />
        </button>

        {isExpanded && (
          <div
            id={detailsId}
            role="region"
            aria-label={`${sessionLabel} lifecycle controls`}
            className="mx-2 mb-2 rounded-md border border-ink-border bg-washi-white px-3 pb-3 pt-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              {sessionActions}
            </div>
            {sessionLifecycleMeta}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        onSelect()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'w-full text-left p-5 card-sumi transition-all duration-300 ease-gentle',
        'cursor-pointer',
        transportType === 'pty' && 'border-2 border-sumi-black',
        workerOrchestrationComplete && !isCommander && 'opacity-75',
        selected && 'ring-1 ring-sumi-black/10 shadow-ink-md',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <Icon size={18} className="shrink-0 text-sumi-diluted" />
          <span className="font-mono text-sm text-sumi-black truncate">{sessionLabel}</span>
          {transportType === 'pty' && (
            <span className="badge-sumi bg-ink-wash text-sumi-gray text-[10px]">pty</span>
          )}
          {agentBadge && (
            <span className="badge-sumi text-[10px] bg-accent-indigo/10 text-accent-indigo">{agentBadge}</span>
          )}
          {isRemote && (
            <span className="badge-sumi bg-ink-wash text-sumi-gray text-[10px]">
              {machine ? `${machine.label} · ${machine.host}` : session.host}
            </span>
          )}
          {workerOrchestrationComplete && !isCommander && (
            <span className="badge-sumi bg-ink-wash text-sumi-diluted text-[10px]">completed</span>
          )}
          {session.status === 'stale' && (
            <span className="badge-sumi bg-amber-500/10 text-amber-700 text-[10px]">stale</span>
          )}
          {queuedMessageCount > 0 && (
            <span className="badge-sumi bg-sky-500/10 text-sky-700 text-[10px]">
              {queuedMessageCount} queued
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {sessionActions}
          <ChevronRight
            size={16}
            className={cn(
              'text-sumi-mist transition-transform duration-300',
              selected && 'rotate-90 text-sumi-gray',
            )}
          />
        </div>
      </div>

      {sessionLifecycleMeta}
    </div>
  )
}
