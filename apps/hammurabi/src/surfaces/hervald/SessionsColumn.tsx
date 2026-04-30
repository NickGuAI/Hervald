/**
 * SessionsColumn — 232px left panel for the Hervald Command Room.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │  COMMANDERS · {count}    [+]│  ← ColumnHeader
 *   ├─────────────────────────────┤
 *   │  [●] jarvis          2 PEND │  ← Commander SessionRows (always shown)
 *   │      ↳ worker-1             │
 *   │  [●] jake                   │
 *   ├─────────────────────────────┤
 *   │  CHATS · {count}         [+]│  ← create agent session
 *   │ ▾ WORKERS · {n}             │  ← expanded by default
 *   │   pn-920              2d    │
 *   │   srswworker          1d    │
 *   │ ▸ CRON · {n}                │  ← collapsed by default
 *   │ ▸ SENTINELS · {n}           │  ← collapsed by default
 *   ├─────────────────────────────┤
 *   │ live · auto-refresh   A− A+ │  ← font-size control
 *   └─────────────────────────────┘
 */
import { useCallback, useEffect, useState } from 'react'
import { Icon, STATE_COLOR } from '@/surfaces/hervald'
import type { AgentSession, AgentType } from '@/types'
import { SessionCard } from '@modules/agents/page-shell/SessionCard'
import { ColumnHeader } from './ColumnHeader'
import { SessionRow } from './SessionRow'
import type { Commander, Worker, Approval } from './SessionRow'

/** A standalone chat session (non-commander). */
export interface ChatSession extends AgentSession {
  id: string
  /** Human-readable age string, e.g. "2d", "3h". */
  age?: string
  lastActivityAt?: string
}

interface SessionsColumnProps {
  selectedCommanderId: string
  onSelectCommander: (id: string) => void
  onCreateCommander: () => void
  onCreateWorker: () => void
  onCreateSession: () => void
  selectedChatId?: string | null
  onSelectChat: (id: string) => void
  commanders: Commander[]
  workers: Worker[]
  /** Pending approval items. */
  approvals?: Approval[]
  workerSessions?: ChatSession[]
  cronSessions?: ChatSession[]
  sentinelSessions?: ChatSession[]
  onKillSession?: (sessionId: string, agentType?: AgentType) => Promise<void>
  onResumeSession?: (sessionId: string) => Promise<void>
  sessionActionError?: string | null
}

const tinyIconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--hv-fg-subtle)',
  cursor: 'pointer',
  padding: 2,
  display: 'flex',
  alignItems: 'center',
}

type SectionKey = 'workers' | 'cron' | 'sentinel'
const COLLAPSE_STORAGE_KEY = 'hervald-sessions-collapsed'
const FONT_SCALE_STORAGE_KEY = 'hervald-sessions-font-scale'
const SHOW_EXITED_STORAGE_KEY = 'hervald-sessions-show-exited'
const DEFAULT_COLLAPSED: Record<SectionKey, boolean> = {
  workers: false,
  cron: true,
  sentinel: true,
}
const DEFAULT_SHOW_EXITED: Record<SectionKey, boolean> = {
  workers: false,
  cron: false,
  sentinel: false,
}
const MIN_SCALE = 0.8
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1
const EXITED_SESSION_STATUSES = new Set(['exited', 'completed'])

function readCollapsedState(): Record<SectionKey, boolean> {
  if (typeof window === 'undefined') return { ...DEFAULT_COLLAPSED }
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_COLLAPSED }
    const parsed = JSON.parse(raw) as Partial<Record<SectionKey, unknown>>
    return {
      workers: typeof parsed.workers === 'boolean' ? parsed.workers : DEFAULT_COLLAPSED.workers,
      cron: typeof parsed.cron === 'boolean' ? parsed.cron : DEFAULT_COLLAPSED.cron,
      sentinel:
        typeof parsed.sentinel === 'boolean' ? parsed.sentinel : DEFAULT_COLLAPSED.sentinel,
    }
  } catch {
    return { ...DEFAULT_COLLAPSED }
  }
}

function readFontScale(): number {
  if (typeof window === 'undefined') return 1
  const raw = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY)
  if (!raw) return 1
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, parsed))
}

function readShowExitedState(): Record<SectionKey, boolean> {
  if (typeof window === 'undefined') return { ...DEFAULT_SHOW_EXITED }
  try {
    const raw = window.localStorage.getItem(SHOW_EXITED_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SHOW_EXITED }
    const parsed = JSON.parse(raw) as Partial<Record<SectionKey, unknown>>
    return {
      workers: typeof parsed.workers === 'boolean' ? parsed.workers : DEFAULT_SHOW_EXITED.workers,
      cron: typeof parsed.cron === 'boolean' ? parsed.cron : DEFAULT_SHOW_EXITED.cron,
      sentinel:
        typeof parsed.sentinel === 'boolean' ? parsed.sentinel : DEFAULT_SHOW_EXITED.sentinel,
    }
  } catch {
    return { ...DEFAULT_SHOW_EXITED }
  }
}

interface SessionListSectionProps {
  label: string
  sessions: ChatSession[]
  collapsed: boolean
  onToggle: () => void
  showExited: boolean
  onToggleShowExited: () => void
  selectedChatId: string | null
  onSelectChat: (id: string) => void
  variant?: 'button' | 'session-card'
  sessionCardVariant?: 'card' | 'row'
  onKillSession?: (sessionId: string, agentType?: AgentType) => Promise<void>
  onResumeSession?: (sessionId: string) => Promise<void>
}

function SessionListSection({
  label,
  sessions,
  collapsed,
  onToggle,
  showExited,
  onToggleShowExited,
  selectedChatId,
  onSelectChat,
  variant = 'button',
  sessionCardVariant = 'card',
  onKillSession,
  onResumeSession,
}: SessionListSectionProps) {
  if (sessions.length === 0) return null
  const visibleSessions = showExited
    ? sessions
    : sessions.filter((session) => !EXITED_SESSION_STATUSES.has(session.status ?? ''))

  return (
    <>
      <div
        style={{
          width: '100%',
          padding: '22px 20px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            color: 'var(--hv-fg-faint)',
            fontFamily: 'var(--hv-font-body)',
            fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
          }}
        >
          <span style={{ fontSize: 10, width: 8 }}>{collapsed ? '▸' : '▾'}</span>
          <span>{label}</span>
          <span>· {visibleSessions.length}</span>
        </button>
        <button
          type="button"
          onClick={onToggleShowExited}
          aria-pressed={showExited}
          aria-label={`${showExited ? 'Hide' : 'Show'} exited ${label.toLowerCase()} sessions`}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--hv-fg-subtle)',
            fontFamily: 'var(--hv-font-body)',
            fontSize: 'calc(10px * var(--hv-sessions-scale, 1))',
            letterSpacing: '0.02em',
            cursor: 'pointer',
            padding: 0,
            textTransform: 'none',
            flexShrink: 0,
          }}
        >
          {showExited ? 'hide exited' : 'show exited'}
        </button>
      </div>

      {!collapsed &&
        visibleSessions.map((s) => (
          variant === 'session-card' && onKillSession && onResumeSession ? (
            <div
              key={s.id}
              style={{
                padding: '8px 16px 0',
              }}
            >
              <SessionCard
                session={s}
                selected={selectedChatId === s.id}
                variant={sessionCardVariant}
                onSelect={() => onSelectChat(s.id)}
                onKill={() => onKillSession(s.id, s.agentType)}
                onResume={() => onResumeSession(s.id)}
                onNavigateToSession={onSelectChat}
              />
            </div>
          ) : (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectChat(s.id)}
              style={{
                width: '100%',
                padding: '6px 20px 6px 34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background:
                  selectedChatId === s.id ? 'var(--hv-ink-wash-02)' : 'transparent',
                borderLeft:
                  selectedChatId === s.id
                    ? '2px solid var(--sumi-black)'
                    : '2px solid transparent',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--hv-font-mono)',
                fontSize: 'calc(12px * var(--hv-sessions-scale, 1))',
                color:
                  selectedChatId === s.id ? 'var(--hv-fg)' : 'var(--hv-fg-faint)',
                gap: 8,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: STATE_COLOR[s.status ?? 'idle'] ?? STATE_COLOR.idle,
                    marginRight: 8,
                    flexShrink: 0,
                  }}
                  aria-hidden
                />
                <span
                  title={s.label ?? s.name}
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {s.label ?? s.name}
                </span>
              </span>
              {s.age && (
                <span
                  style={{
                    fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
                    letterSpacing: '0.02em',
                    marginLeft: 8,
                    flexShrink: 0,
                  }}
                >
                  {s.age}
                </span>
              )}
            </button>
          )
        ))}
    </>
  )
}

export function SessionsColumn({
  selectedCommanderId,
  onSelectCommander,
  onCreateCommander,
  onCreateWorker,
  onCreateSession,
  selectedChatId = null,
  onSelectChat,
  commanders,
  workers,
  approvals = [],
  workerSessions = [],
  cronSessions = [],
  sentinelSessions = [],
  onKillSession,
  onResumeSession,
  sessionActionError = null,
}: SessionsColumnProps) {
  const commanderCount = commanders.filter((commander) => !commander.isVirtual).length
  const chatCount = workerSessions.length + cronSessions.length + sentinelSessions.length

  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(readCollapsedState)
  const [fontScale, setFontScale] = useState<number>(readFontScale)
  const [showExited, setShowExited] = useState<Record<SectionKey, boolean>>(readShowExitedState)

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed))
    } catch {
      // ignore
    }
  }, [collapsed])

  useEffect(() => {
    try {
      window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale))
    } catch {
      // ignore
    }
  }, [fontScale])

  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_EXITED_STORAGE_KEY, JSON.stringify(showExited))
    } catch {
      // ignore
    }
  }, [showExited])

  const toggle = useCallback((key: SectionKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const adjustScale = useCallback((delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 100) / 100
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    })
  }, [])

  const toggleShowExited = useCallback((key: SectionKey) => {
    setShowExited((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <aside
      style={
        {
          width: 232,
          background: 'var(--hv-bg-raised)',
          borderRight: '1px solid var(--hv-border-hair)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
          ['--hv-sessions-scale' as string]: String(fontScale),
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <ColumnHeader
        label={
          <>
            COMMANDERS
            <span style={{ color: 'var(--hv-fg-faint)', marginLeft: 6 }}>
              · {commanderCount}
            </span>
          </>
        }
        right={
          <button
            style={tinyIconBtn}
            type="button"
            aria-label="New commander"
            onClick={onCreateCommander}
          >
            <Icon name="plus" size={13} />
          </button>
        }
      />

      {/* Scrollable session list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0 20px',
        }}
      >
        {/* Section 1 — Commanders (always visible) */}
        {commanders.map((c) => (
          <SessionRow
            key={c.id}
            commander={c}
            selected={selectedCommanderId === c.id}
            onClick={() => onSelectCommander(c.id)}
            workers={workers.filter((w) => w.commanderId === c.id)}
            approvals={approvals.filter((a) => a.commanderId === c.id)}
          />
        ))}

        <ColumnHeader
          label={
            <>
              CHATS
              <span style={{ color: 'var(--hv-fg-faint)', marginLeft: 6 }}>
                · {chatCount}
              </span>
            </>
          }
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                style={tinyIconBtn}
                type="button"
                aria-label="Add worker"
                onClick={onCreateWorker}
              >
                <Icon name="terminal" size={13} />
              </button>
              <button
                style={tinyIconBtn}
                type="button"
                aria-label="New session"
                onClick={onCreateSession}
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
          }
          style={{
            paddingTop: 18,
            paddingBottom: 8,
            borderTop: '1px solid var(--hv-border-hair)',
            borderBottom: 'none',
            background: 'var(--hv-bg-raised)',
          }}
        />

        {sessionActionError && (
          <div
            style={{
              padding: '0 20px 8px',
              color: 'var(--vermillion-seal)',
              fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
              lineHeight: 1.5,
            }}
          >
            {sessionActionError}
          </div>
        )}

        <SessionListSection
          label="Workers"
          sessions={workerSessions}
          collapsed={collapsed.workers}
          onToggle={() => toggle('workers')}
          showExited={showExited.workers}
          onToggleShowExited={() => toggleShowExited('workers')}
          selectedChatId={selectedChatId}
          onSelectChat={onSelectChat}
          variant="session-card"
          sessionCardVariant="row"
          onKillSession={onKillSession}
          onResumeSession={onResumeSession}
        />

        <SessionListSection
          label="Cron"
          sessions={cronSessions}
          collapsed={collapsed.cron}
          onToggle={() => toggle('cron')}
          showExited={showExited.cron}
          onToggleShowExited={() => toggleShowExited('cron')}
          selectedChatId={selectedChatId}
          onSelectChat={onSelectChat}
        />

        <SessionListSection
          label="Sentinels"
          sessions={sentinelSessions}
          collapsed={collapsed.sentinel}
          onToggle={() => toggle('sentinel')}
          showExited={showExited.sentinel}
          onToggleShowExited={() => toggleShowExited('sentinel')}
          selectedChatId={selectedChatId}
          onSelectChat={onSelectChat}
        />
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '10px 12px 12px 20px',
          borderTop: '1px solid var(--hv-border-hair)',
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--hv-fg-faint)',
          fontFamily: 'var(--hv-font-body)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span>live · auto-refresh</span>
        <span
          role="group"
          aria-label="Text size"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <button
            type="button"
            aria-label="Decrease text size"
            onClick={() => adjustScale(-SCALE_STEP)}
            disabled={fontScale <= MIN_SCALE + 1e-6}
            style={{
              background: 'transparent',
              border: '1px solid var(--hv-border-hair)',
              color: 'var(--hv-fg-subtle)',
              padding: '1px 6px',
              fontFamily: 'var(--hv-font-body)',
              fontSize: 10,
              letterSpacing: '0.02em',
              cursor: fontScale <= MIN_SCALE + 1e-6 ? 'not-allowed' : 'pointer',
              opacity: fontScale <= MIN_SCALE + 1e-6 ? 0.4 : 1,
              borderRadius: 2,
            }}
          >
            A−
          </button>
          <button
            type="button"
            aria-label="Increase text size"
            onClick={() => adjustScale(SCALE_STEP)}
            disabled={fontScale >= MAX_SCALE - 1e-6}
            style={{
              background: 'transparent',
              border: '1px solid var(--hv-border-hair)',
              color: 'var(--hv-fg-subtle)',
              padding: '1px 6px',
              fontFamily: 'var(--hv-font-body)',
              fontSize: 12,
              letterSpacing: '0.02em',
              cursor: fontScale >= MAX_SCALE - 1e-6 ? 'not-allowed' : 'pointer',
              opacity: fontScale >= MAX_SCALE - 1e-6 ? 0.4 : 1,
              borderRadius: 2,
            }}
          >
            A+
          </button>
        </span>
      </div>
    </aside>
  )
}
