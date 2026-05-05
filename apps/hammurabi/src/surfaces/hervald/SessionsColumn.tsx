/**
 * SessionsColumn — 232px left panel for the Hervald Command Room.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │  COMMANDERS · {count}    [+]│  ← ColumnHeader
 *   ├─────────────────────────────┤
 *   │  [●] hera          2 PEND │  ← Commander SessionRows (always shown)
 *   │  [●] jake                   │
 *   │ ▾ WORKERS · {n}         [⌁] │  ← expanded by default
 *   │   pn-920              2d    │
 *   │   srswworker          1d    │
 *   │ ▸ AUTOMATIONS · {n}         │  ← collapsed by default
 *   ├─────────────────────────────┤
 *   │ live · auto-refresh   A− A+ │  ← font-size control
 *   └─────────────────────────────┘
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useProviderRegistry } from '@/hooks/use-providers'
import { Icon, STATE_COLOR } from '@/surfaces/hervald'
import type { AgentSession, AgentType } from '@/types'
import { SessionCard } from '@modules/agents/page-shell/SessionCard'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
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
  /** Request the provider picker for this commander. Does NOT create a chat. */
  onCreateChatForCommander?: (commanderId: string) => void | Promise<void>
  selectedChatId?: string | null
  onSelectChat: (id: string) => void
  onSelectConversation?: (id: string) => void
  onStartConversation?: (id: string) => void
  onStopConversation?: (id: string) => void | Promise<void>
  onRenameConversation?: (id: string, name: string) => void | Promise<void>
  onSwapConversationProvider?: (id: string, agentType: AgentType) => void | Promise<void>
  onArchiveConversation?: (id: string) => void | Promise<void>
  onRemoveConversation?: (id: string) => void | Promise<void>
  commanders: Commander[]
  conversations?: ConversationRecord[]
  workers: Worker[]
  /** Pending approval items. */
  approvals?: Approval[]
  workerSessions?: ChatSession[]
  automationSessions?: ChatSession[]
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

const menuItemStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--hv-fg)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--hv-font-body)',
  fontSize: '12px',
}

const modalLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  color: 'var(--hv-fg)',
}

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--hv-border-hair)',
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--hv-fg)',
  background: 'var(--hv-bg-raised)',
}

const modalActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
}

const modalSecondaryButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid var(--hv-border-hair)',
  padding: '8px 14px',
  background: 'transparent',
  color: 'var(--hv-fg-subtle)',
  cursor: 'pointer',
  fontFamily: 'var(--hv-font-body)',
  fontSize: 12,
}

const modalPrimaryButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid transparent',
  padding: '8px 14px',
  background: 'var(--sumi-black)',
  color: 'var(--washi-white)',
  cursor: 'pointer',
  fontFamily: 'var(--hv-font-body)',
  fontSize: 12,
}

type SectionKey = 'workers' | 'automation'
const COLLAPSE_STORAGE_KEY = 'hervald-sessions-collapsed'
const FONT_SCALE_STORAGE_KEY = 'hervald-sessions-font-scale'
const SHOW_EXITED_STORAGE_KEY = 'hervald-sessions-show-exited'
const DEFAULT_COLLAPSED: Record<SectionKey, boolean> = {
  workers: false,
  automation: true,
}
const DEFAULT_SHOW_EXITED: Record<SectionKey, boolean> = {
  workers: false,
  automation: false,
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
      automation:
        typeof parsed.automation === 'boolean'
          ? parsed.automation
          : typeof (parsed as Record<string, unknown>).cron === 'boolean'
            ? Boolean((parsed as Record<string, unknown>).cron)
            : typeof (parsed as Record<string, unknown>).sentinel === 'boolean'
              ? Boolean((parsed as Record<string, unknown>).sentinel)
              : DEFAULT_COLLAPSED.automation,
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
      automation:
        typeof parsed.automation === 'boolean'
          ? parsed.automation
          : typeof (parsed as Record<string, unknown>).cron === 'boolean'
            ? Boolean((parsed as Record<string, unknown>).cron)
            : typeof (parsed as Record<string, unknown>).sentinel === 'boolean'
              ? Boolean((parsed as Record<string, unknown>).sentinel)
              : DEFAULT_SHOW_EXITED.automation,
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
  const name = typeof conversation.name === 'string' ? conversation.name.trim() : ''
  return name || `chat ${conversation.id.slice(0, 8)}`
}

function formatConversationMeta(conversation: ConversationRecord): string {
  const provider = conversation.agentType ?? 'unassigned'
  const taskTitle = conversation.currentTask?.title?.trim()
  if (taskTitle) {
    return `${provider} · ${taskTitle}`
  }
  return `${provider} · ${conversation.surface} · ${conversation.id.slice(0, 8)}`
}

interface ConversationChatRowProps {
  conversation: ConversationRecord
  selected: boolean
  onSelect?: (id: string) => void
  onStart?: (id: string) => void
  onStop?: (id: string) => void | Promise<void>
  onRename?: (id: string, name: string) => void | Promise<void>
  onSwapProvider?: (id: string, agentType: AgentType) => void | Promise<void>
  onArchive?: (id: string) => void | Promise<void>
  onRemove?: (id: string) => void | Promise<void>
  providerOptions?: ReadonlyArray<{ id: AgentType; label: string }>
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
  onRename,
  onSwapProvider,
  onArchive,
  onRemove,
  providerOptions = [],
}: ConversationChatRowProps) {
  const canStart = conversation.status === 'idle' || conversation.status === 'paused'
  const canStop = conversation.status === 'active'
  const conversationName = typeof conversation.name === 'string' ? conversation.name : ''
  const [menuOpen, setMenuOpen] = useState(false)
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState(conversationName)
  const [renameBusy, setRenameBusy] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeDraft, setRemoveDraft] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)

  useEffect(() => {
    setRenameDraft(conversationName)
  }, [conversationName])

  const canConfirmRemove = removeDraft === conversationName

  async function handleRenameSubmit(): Promise<void> {
    if (!onRename) {
      return
    }
    setRenameBusy(true)
    try {
      await onRename(conversation.id, renameDraft)
      setRenameOpen(false)
      setMenuOpen(false)
    } finally {
      setRenameBusy(false)
    }
  }

  async function handleSwapProvider(agentType: AgentType): Promise<void> {
    if (!onSwapProvider || agentType === conversation.agentType) {
      return
    }
    await onSwapProvider(conversation.id, agentType)
    setProviderMenuOpen(false)
    setMenuOpen(false)
  }

  async function handleArchive(): Promise<void> {
    if (!onArchive) {
      return
    }
    await onArchive(conversation.id)
    setMenuOpen(false)
  }

  async function handleRemoveSubmit(): Promise<void> {
    if (!onRemove || !canConfirmRemove) {
      return
    }
    setRemoveBusy(true)
    try {
      await onRemove(conversation.id)
      setRemoveOpen(false)
      setMenuOpen(false)
      setRemoveDraft('')
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <>
      <div
        data-testid="commander-chat-row"
        data-conversation-id={conversation.id}
        data-conversation-status={conversation.status}
        style={{
          position: 'relative',
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
              {formatConversationMeta(conversation)}
            </span>
          </span>
        </button>

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

        {(onRename || onSwapProvider || onArchive || onRemove) && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              data-testid="commander-chat-actions-button"
              aria-label={`Actions for ${conversation.name}`}
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen((current) => !current)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 999,
                border: '1px solid var(--hv-border-hair)',
                background: 'transparent',
                color: 'var(--hv-fg-subtle)',
                cursor: 'pointer',
              }}
            >
              <Icon name="more" size={12} />
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label={`Close actions for ${conversation.name}`}
                  onClick={() => {
                    setMenuOpen(false)
                    setProviderMenuOpen(false)
                  }}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    zIndex: 20,
                  }}
                />
                <div
                  data-testid="commander-chat-actions-menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    zIndex: 21,
                    minWidth: 188,
                    padding: 6,
                    borderRadius: 12,
                    border: '1px solid var(--hv-border-hair)',
                    background: 'var(--hv-bg-raised)',
                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.12)',
                  }}
                >
                  {onRename && (
                    <button
                      type="button"
                      data-testid="commander-chat-rename-button"
                      onClick={() => {
                        setRenameDraft(conversationName)
                        setRenameOpen(true)
                        setProviderMenuOpen(false)
                      }}
                      style={menuItemStyle}
                    >
                      Rename
                    </button>
                  )}

                  {onSwapProvider && conversation.status === 'active' && (
                    <>
                      <button
                        type="button"
                        data-testid="commander-chat-provider-menu-button"
                        onClick={() => setProviderMenuOpen((current) => !current)}
                        style={menuItemStyle}
                      >
                        <span>Swap provider</span>
                        <span style={{ marginLeft: 'auto' }}>{providerMenuOpen ? '▾' : '▸'}</span>
                      </button>
                      {providerMenuOpen && (
                        <div
                          data-testid="commander-chat-provider-menu"
                          style={{
                            marginTop: 4,
                            padding: '4px 0 0 10px',
                            borderTop: '1px solid var(--hv-border-hair)',
                          }}
                        >
                          {providerOptions.map((provider) => (
                            <button
                              key={provider.id}
                              type="button"
                              data-testid={`commander-chat-provider-option-${provider.id}`}
                              onClick={() => {
                                void handleSwapProvider(provider.id)
                              }}
                              style={menuItemStyle}
                              disabled={provider.id === conversation.agentType}
                            >
                              <span>{provider.label}</span>
                              {provider.id === conversation.agentType && (
                                <span style={{ marginLeft: 'auto' }}>current</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {onArchive && (
                    <button
                      type="button"
                      data-testid="commander-chat-close-button"
                      onClick={() => {
                        void handleArchive()
                      }}
                      style={menuItemStyle}
                    >
                      Close
                    </button>
                  )}

                  {onRemove && (
                    <button
                      type="button"
                      data-testid="commander-chat-remove-button"
                      onClick={() => {
                        setRemoveDraft('')
                        setRemoveOpen(true)
                        setProviderMenuOpen(false)
                      }}
                      style={{
                        ...menuItemStyle,
                        color: 'var(--vermillion-seal)',
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ModalFormContainer
        open={renameOpen}
        title="Rename chat"
        onClose={() => {
          if (renameBusy) {
            return
          }
          setRenameOpen(false)
        }}
        contentClassName="max-w-md"
      >
        <div data-testid="commander-chat-rename-modal" style={{ display: 'grid', gap: 12 }}>
          <label style={modalLabelStyle}>
            <span>Name</span>
            <input
              data-testid="commander-chat-rename-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              style={modalInputStyle}
            />
          </label>
          <div style={modalActionsStyle}>
            <button
              type="button"
              data-testid="commander-chat-rename-cancel-button"
              onClick={() => setRenameOpen(false)}
              style={modalSecondaryButtonStyle}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="commander-chat-rename-submit-button"
              onClick={() => {
                void handleRenameSubmit()
              }}
              disabled={renameBusy || renameDraft.trim().length === 0}
              style={modalPrimaryButtonStyle}
            >
              Save
            </button>
          </div>
        </div>
      </ModalFormContainer>

      <ModalFormContainer
        open={removeOpen}
        title="Remove chat"
        onClose={() => {
          if (removeBusy) {
            return
          }
          setRemoveOpen(false)
        }}
        contentClassName="max-w-md"
      >
        <div data-testid="commander-chat-remove-modal" style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--hv-fg-subtle)', lineHeight: 1.5 }}>
            Type <strong>{conversationName}</strong> to remove this chat and its transcript files.
          </p>
          <label style={modalLabelStyle}>
            <span>Confirmation</span>
            <input
              data-testid="commander-chat-remove-input"
              value={removeDraft}
              onChange={(event) => setRemoveDraft(event.target.value)}
              style={modalInputStyle}
            />
          </label>
          <div style={modalActionsStyle}>
            <button
              type="button"
              data-testid="commander-chat-remove-cancel-button"
              onClick={() => setRemoveOpen(false)}
              style={modalSecondaryButtonStyle}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="commander-chat-remove-submit-button"
              onClick={() => {
                void handleRemoveSubmit()
              }}
              disabled={removeBusy || !canConfirmRemove}
              style={{
                ...modalPrimaryButtonStyle,
                background: 'var(--vermillion-seal)',
              }}
            >
              Remove forever
            </button>
          </div>
        </div>
      </ModalFormContainer>
    </>
  )
}

export function SessionsColumn({
  selectedCommanderId,
  onSelectCommander,
  onCreateCommander,
  onCreateWorker,
  onCreateSession,
  onCreateChatForCommander,
  selectedChatId = null,
  onSelectChat,
  onSelectConversation,
  onStartConversation,
  onStopConversation,
  onRenameConversation,
  onSwapConversationProvider,
  onArchiveConversation,
  onRemoveConversation,
  commanders,
  conversations = [],
  workers,
  approvals = [],
  workerSessions = [],
  automationSessions = [],
  cronSessions = [],
  sentinelSessions = [],
  onKillSession,
  onResumeSession,
  sessionActionError = null,
}: SessionsColumnProps) {
  const { data: providers = [] } = useProviderRegistry()
  const providerOptions = providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
  }))
  const commanderCount = commanders.filter((commander) => !commander.isVirtual).length

  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(readCollapsedState)
  const [fontScale, setFontScale] = useState<number>(readFontScale)
  const [showExited, setShowExited] = useState<Record<SectionKey, boolean>>(readShowExitedState)
  const mergedAutomationSessions = automationSessions.length > 0
    ? automationSessions
    : [...cronSessions, ...sentinelSessions]

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
              ? conversations.filter((conv) => (
                conv.commanderId === c.id
                && conv.isDefaultConversation !== true
              ))
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
                        onRename={onRenameConversation}
                        onSwapProvider={onSwapConversationProvider}
                        onArchive={onArchiveConversation}
                        onRemove={onRemoveConversation}
                        providerOptions={providerOptions}
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
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <button
                  style={tinyIconBtn}
                  type="button"
                  aria-label="New session"
                  onClick={onCreateSession}
                >
                  <Icon name="sessions" size={13} />
                </button>
                <button
                  style={tinyIconBtn}
                  type="button"
                  aria-label="Add worker"
                  onClick={onCreateWorker}
                >
                  <Icon name="terminal" size={13} />
                </button>
              </div>
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

        <div data-testid="automations-section">
          <SessionListSection
            label="Automations"
            sessions={mergedAutomationSessions}
            collapsed={collapsed.automation}
            onToggle={() => toggle('automation')}
            showExited={showExited.automation}
            onToggleShowExited={() => toggleShowExited('automation')}
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
