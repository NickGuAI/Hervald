/**
 * SessionsColumn — 232px left panel for the Hervald Command Room.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │  COMMANDERS · {count}    [+]│  ← ColumnHeader
 *   ├─────────────────────────────┤
 *   │  [●] jarvis          2 PEND │  ← Commander SessionRows (always shown)
 *   │  [●] jake                   │
 *   │ ▾ WORKERS · {n}         [⌁] │  ← expanded by default
 *   │   pn-920              2d    │
 *   │   srswworker          1d    │
 *   │ ▸ CRON · {n}                │  ← collapsed by default
 *   │ ▸ SENTINELS · {n}           │  ← collapsed by default
 *   ├─────────────────────────────┤
 *   │ live · auto-refresh   A− A+ │  ← font-size control
 *   └─────────────────────────────┘
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Icon, STATE_COLOR } from '@/surfaces/hervald'
import type { AgentSession, AgentType } from '@/types'
import { SessionCard } from '@modules/agents/page-shell/SessionCard'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
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
  onCreateChatForCommander?: (commanderId: string) => void | Promise<void>
  selectedChatId?: string | null
  onSelectChat: (id: string) => void
  onSelectConversation?: (id: string) => void
  onStartConversation?: (id: string) => void
  onStopConversation?: (id: string) => void | Promise<void>
  commanders: Commander[]
  conversations?: ConversationRecord[]
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
  headerAction?: ReactNode
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
  headerAction,
  showExited,
  onToggleShowExited,
  selectedChatId,
  onSelectChat,
  variant = 'button',
  sessionCardVariant = 'card',
  onKillSession,
  onResumeSession,
}: SessionListSectionProps) {
  if (sessions.length === 0 && !headerAction) return null
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
        {headerAction}
        {sessions.length > 0 && (
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
        )}
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

function formatConversationLabel(conversation: ConversationRecord): string {
  const taskTitle = conversation.currentTask?.title?.trim()
  if (taskTitle) {
    return taskTitle
  }

  return conversation.liveSession?.name ?? `chat ${conversation.id.slice(0, 8)}`
}

interface ConversationChatRowProps {
  conversation: ConversationRecord
  selected: boolean
  onSelect?: (id: string) => void
  onStart?: (id: string) => void
  onStop?: (id: string) => void | Promise<void>
}

/**
 * Per-commander chat row rendered nested inside a `commander-block`. The
 * Start button does a one-click resume — it does NOT open a wizard.
 */
function ConversationChatRow({
  conversation,
  selected,
  onSelect,
  onStart,
  onStop,
}: ConversationChatRowProps) {
  const canStart = conversation.status === 'idle' || conversation.status === 'paused'
  const canStop = conversation.status === 'active'

  return (
    <div
      data-testid="commander-chat-row"
      data-conversation-id={conversation.id}
      data-conversation-status={conversation.status}
      style={{
        width: '100%',
        padding: '6px 20px 6px 34px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: selected ? 'var(--hv-ink-wash-02)' : 'transparent',
        borderLeft: selected
          ? '2px solid var(--sumi-black)'
          : '2px solid transparent',
      }}
    >
      <button
        type="button"
        data-testid="commander-chat-row-button"
        onClick={() => onSelect?.(conversation.id)}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          cursor: onSelect ? 'pointer' : 'default',
          padding: 0,
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: STATE_COLOR[conversation.status] ?? STATE_COLOR.idle,
            flexShrink: 0,
          }}
        />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            data-testid="commander-chat-row-label"
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--hv-font-mono)',
              fontSize: 'calc(11.5px * var(--hv-sessions-scale, 1))',
              color: selected ? 'var(--hv-fg)' : 'var(--hv-fg-faint)',
            }}
          >
            {formatConversationLabel(conversation)}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--hv-font-body)',
              fontSize: 'calc(10px * var(--hv-sessions-scale, 1))',
              color: 'var(--hv-fg-subtle)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {conversation.surface} · {conversation.id.slice(0, 8)}
          </span>
        </span>
      </button>

      <span
        data-testid="commander-chat-row-status"
        style={{
          flexShrink: 0,
          padding: '2px 6px',
          borderRadius: 999,
          background: 'var(--hv-ink-wash-02)',
          color: 'var(--hv-fg-subtle)',
          fontFamily: 'var(--hv-font-body)',
          fontSize: 'calc(9.5px * var(--hv-sessions-scale, 1))',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {conversation.status}
      </span>

      {canStart && onStart && (
        <button
          type="button"
          data-testid="commander-chat-start-button"
          onClick={(event) => {
            event.stopPropagation()
            onStart(conversation.id)
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--hv-border-hair)',
            borderRadius: 999,
            color: 'var(--hv-fg-subtle)',
            cursor: 'pointer',
            padding: '3px 8px',
            fontFamily: 'var(--hv-font-mono)',
            fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          Start
        </button>
      )}

      {canStop && onStop && (
        <button
          type="button"
          data-testid="commander-chat-stop-button"
          onClick={(event) => {
            event.stopPropagation()
            void onStop(conversation.id)
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--hv-border-hair)',
            borderRadius: 999,
            color: 'var(--hv-fg-subtle)',
            cursor: 'pointer',
            padding: '3px 8px',
            fontFamily: 'var(--hv-font-mono)',
            fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          Stop
        </button>
      )}
    </div>
  )
}

export function SessionsColumn({
  selectedCommanderId,
  onSelectCommander,
  onCreateCommander,
  onCreateWorker,
  onCreateSession: _onCreateSession,
  onCreateChatForCommander,
  selectedChatId = null,
  onSelectChat,
  onSelectConversation,
  onStartConversation,
  onStopConversation,
  commanders,
  conversations = [],
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
      data-testid="sessions-column"
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
        data-testid="sessions-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0 20px',
        }}
      >
        {/* Section 1 — Commanders (always visible). Each commander's chats are
            rendered nested under that commander when the commander is selected. */}
        <div data-testid="commanders-list">
          {commanders.map((c) => {
            const isSelected = selectedCommanderId === c.id
            const commanderConversations = isSelected
              ? conversations.filter((conv) => conv.commanderId === c.id)
              : []

            return (
              <div
                key={c.id}
                data-testid="commander-block"
                data-commander-id={c.id}
              >
                <SessionRow
                  commander={c}
                  selected={isSelected}
                  onClick={() => onSelectCommander(c.id)}
                  onCreateChat={
                    isSelected && !c.isVirtual && onCreateChatForCommander
                      ? () => { void onCreateChatForCommander(c.id) }
                      : undefined
                  }
                  approvals={approvals.filter((a) => a.commanderId === c.id)}
                />

                {isSelected && commanderConversations.length > 0 && (
                  <div
                    data-testid="commander-chat-list"
                    data-commander-id={c.id}
                    style={{ paddingBottom: 6 }}
                  >
                    {commanderConversations.map((conversation) => (
                      <ConversationChatRow
                        key={conversation.id}
                        conversation={conversation}
                        selected={selectedChatId === conversation.id}
                        onSelect={onSelectConversation}
                        onStart={onStartConversation}
                        onStop={onStopConversation}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {sessionActionError && (
          <div
            data-testid="sessions-action-error"
            style={{
              padding: '12px 20px 0',
              color: 'var(--vermillion-seal)',
              fontSize: 'calc(10.5px * var(--hv-sessions-scale, 1))',
              lineHeight: 1.5,
            }}
          >
            {sessionActionError}
          </div>
        )}

        <div data-testid="workers-section">
          <SessionListSection
            label="Workers"
            sessions={workerSessions}
            collapsed={collapsed.workers}
            onToggle={() => toggle('workers')}
            headerAction={(
              <button
                style={tinyIconBtn}
                type="button"
                aria-label="Add worker"
                onClick={onCreateWorker}
              >
                <Icon name="terminal" size={13} />
              </button>
            )}
            showExited={showExited.workers}
            onToggleShowExited={() => toggleShowExited('workers')}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            variant="session-card"
            sessionCardVariant="row"
            onKillSession={onKillSession}
            onResumeSession={onResumeSession}
          />
        </div>

        <div data-testid="cron-section">
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
        </div>

        <div data-testid="sentinel-section">
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
      </div>

      {/* Footer */}
      <div
        data-testid="sessions-footer"
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
