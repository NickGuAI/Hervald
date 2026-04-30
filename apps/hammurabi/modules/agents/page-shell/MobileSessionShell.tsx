import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Cpu,
  MoreVertical,
  Plus,
  Power,
  Warehouse,
} from 'lucide-react'
import { cn, formatCost } from '@/lib/utils'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import { AddToChatSheet } from '@modules/agents/components/AddToChatSheet'
import Transcript from '@modules/agents/components/Transcript'
import {
  SessionComposer,
  type SessionComposerHandle,
  type SessionComposerSubmitPayload,
} from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  formatQueuePreview,
  getQueuePendingCount,
  getQueuedMessageLabel,
} from '@modules/agents/queue-state'
import { StreamingDots } from './StreamingDots'
import { SessionApprovalsButton } from './SessionApprovalsButton'
import { getKillConfirmationMessage } from './session-helpers'

export interface WorkerBadge {
  id: string
  label: string
  status?: string | null
}

export interface MobileSessionShellProps {
  sessionName: string
  sessionLabel: string
  agentType?: AgentType
  sessionType?: 'stream' | 'pty'
  commanderId?: string | null
  wsStatus?: 'connecting' | 'connected' | 'disconnected' | 'closed' | null
  costUsd?: number
  durationSec?: number
  messages: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  approvals?: PendingApproval[]
  onApprovalDecision?: (
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ) => void | Promise<void>
  agentAvatarUrl?: string
  agentAccentColor?: string
  onSend: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
  canQueueDraft: boolean
  queueSnapshot: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  onClearQueue?: () => void
  onMoveQueuedMessage?: (id: string, offset: number) => void
  onRemoveQueuedMessage?: (id: string) => void
  composerEnabled: boolean
  composerSendReady: boolean
  composerPlaceholder?: string
  composerDisabledMessage?: string
  theme?: 'light' | 'dark'
  onBack: () => void
  onKill?: () => void | Promise<void>
  onOpenWorkspace?: () => void
  onOpenSkills?: () => void
  onNewQuest?: () => void
  workers?: WorkerBadge[]
  onOpenWorkers?: () => void
  rootClassName?: string
  contextFilePaths?: string[]
  onRemoveContextFilePath?: (filePath: string) => void
  onClearContextFilePaths?: () => void
  showComposerWorkspaceShortcut?: boolean
  isStreaming?: boolean
  emptyState?: ReactNode
  dataTestId?: string
}

function formatDuration(durationSec?: number): string | null {
  if (typeof durationSec !== 'number' || Number.isNaN(durationSec) || durationSec < 0) {
    return null
  }

  const minutes = Math.floor(durationSec / 60)
  const seconds = Math.floor(durationSec % 60)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function MobileSessionShell({
  sessionName,
  sessionLabel,
  agentType,
  wsStatus,
  costUsd,
  durationSec,
  messages,
  onAnswer,
  approvals,
  onApprovalDecision,
  agentAvatarUrl,
  agentAccentColor,
  onSend,
  onQueue,
  canQueueDraft,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  composerEnabled,
  composerSendReady,
  composerPlaceholder,
  composerDisabledMessage,
  theme = 'light',
  onBack,
  onKill,
  onOpenWorkspace,
  onNewQuest,
  workers,
  onOpenWorkers,
  rootClassName,
  contextFilePaths = [],
  onRemoveContextFilePath,
  onClearContextFilePaths,
  showComposerWorkspaceShortcut = false,
  isStreaming = false,
  emptyState,
  dataTestId,
}: MobileSessionShellProps) {
  const usesOverlayChrome = rootClassName?.includes('session-view-overlay') ?? false
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showAddToChatSheet, setShowAddToChatSheet] = useState(false)
  const [isKilling, setIsKilling] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const composerRef = useRef<SessionComposerHandle>(null)
  const emptyStateActive = Boolean(emptyState) && !composerEnabled

  useEffect(() => {
    if (!onOpenWorkspace) {
      return
    }

    function handleWorkspaceShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenWorkspace()
      }
    }

    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [onOpenWorkspace])

  const metaParts = useMemo(() => {
    const parts: string[] = []
    if (wsStatus) {
      parts.push(wsStatus)
    }

    if (typeof costUsd === 'number') {
      parts.push(formatCost(costUsd))
    }

    const formattedDuration = formatDuration(durationSec)
    if (formattedDuration) {
      parts.push(formattedDuration)
    }

    return parts
  }, [costUsd, durationSec, wsStatus])

  const currentQueuedMessage = queueSnapshot.currentMessage ?? null
  const queueItems = queueSnapshot.items
  const totalQueuedCount = getQueuePendingCount(queueSnapshot)
  const workspaceShortcutLabel = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')
    ? '\u2318K'
    : 'Ctrl+K'
  const queueStatusText = currentQueuedMessage
    ? `Working on ${getQueuedMessageLabel(currentQueuedMessage)}`
    : totalQueuedCount > 0
      ? `${totalQueuedCount} queued`
      : 'Queue empty'
  const canClearQueue = (totalQueuedCount > 0 || currentQueuedMessage !== null) && !isQueueMutating
  const workerCount = workers?.length ?? 0

  const handleKill = useCallback(async () => {
    if (!onKill || isKilling) {
      return
    }

    const confirmed = window.confirm(getKillConfirmationMessage(sessionName, agentType))
    if (!confirmed) {
      return
    }

    setIsKilling(true)
    try {
      await onKill()
    } finally {
      setIsKilling(false)
    }
  }, [agentType, isKilling, onKill, sessionName])

  const handleOpenAddToChat = useCallback(() => {
    setShowAddToChatSheet(true)
  }, [])

  const handleCloseAddToChat = useCallback(() => {
    setShowAddToChatSheet(false)
  }, [])

  const handlePickImage = useCallback(() => {
    composerRef.current?.openImagePicker()
  }, [])

  const handlePickSkill = useCallback(() => {
    composerRef.current?.openSkillsPicker()
  }, [])

  const handlePickFile = useCallback(() => {
    onOpenWorkspace?.()
  }, [onOpenWorkspace])

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden',
        theme === 'dark'
          ? 'bg-[#17171a] text-washi-white'
          : 'bg-washi-white text-sumi-black',
        rootClassName,
      )}
      data-testid={dataTestId ?? 'mobile-session-shell'}
    >
      <header
        className={cn(
          'session-header border-b px-3 pb-3 pt-4',
          theme === 'dark'
            ? 'border-white/10 bg-[#1d1d21]'
            : 'border-ink-border bg-washi-white',
        )}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              'session-back inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md transition-colors',
              theme === 'dark'
                ? 'text-washi-white/75 hover:bg-white/5'
                : 'text-sumi-diluted hover:bg-ink-wash',
            )}
            onClick={onBack}
            aria-label="Back to sessions"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="session-header-center min-w-0 flex-1 text-center">
            <p className={cn(
              'session-header-name truncate font-mono text-sm',
              theme === 'dark' ? 'text-washi-white' : 'text-sumi-black',
            )}
            >
              {sessionLabel}
            </p>
            {metaParts.length > 0 && (
              <p
                className={cn(
                  'session-header-meta mt-1 text-[11px] uppercase tracking-[0.08em]',
                  theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                )}
              >
                {wsStatus && (
                  <span
                    className={cn(
                      'mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle',
                      wsStatus === 'connected'
                        ? 'bg-emerald-500'
                        : wsStatus === 'connecting'
                          ? 'bg-amber-400'
                          : 'bg-sumi-mist',
                    )}
                  />
                )}
                {metaParts.join(' · ')}
              </p>
            )}
          </div>

          <div className="session-header-actions flex shrink-0 items-center gap-1">
            <SessionApprovalsButton
              approvals={approvals}
              onDecision={onApprovalDecision}
            />

            <div className="relative shrink-0">
              <button
                type="button"
                className={cn(
                  'inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md transition-colors',
                  theme === 'dark'
                    ? 'text-washi-white/65 hover:bg-white/5'
                    : 'text-sumi-diluted hover:bg-ink-wash',
                )}
                onClick={() => setShowOverflowMenu((prev) => !prev)}
                aria-label="Session actions"
                aria-expanded={showOverflowMenu}
              >
                <MoreVertical size={16} />
              </button>

              {showOverflowMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowOverflowMenu(false)}
                  />

                  <div
                    className={cn(
                      'absolute right-0 top-full z-50 mt-1 min-w-[188px] overflow-hidden rounded-[3px_10px_3px_10px] border p-1 shadow-ink-md',
                      theme === 'dark'
                        ? 'border-white/10 bg-[#242428]'
                        : 'border-ink-border bg-washi-white',
                    )}
                  >
                    {onNewQuest && (
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors',
                          theme === 'dark'
                            ? 'text-washi-white/85 hover:bg-white/5'
                            : 'text-sumi-black hover:bg-ink-wash',
                        )}
                        onClick={() => {
                          composerRef.current?.seedText('Create a new quest on your quest board: ')
                          onNewQuest()
                          setShowOverflowMenu(false)
                        }}
                      >
                        <Plus size={13} className="shrink-0" />
                        New Quest
                      </button>
                    )}

                    {onOpenWorkers && (
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors',
                          theme === 'dark'
                            ? 'text-washi-white/85 hover:bg-white/5'
                            : 'text-sumi-black hover:bg-ink-wash',
                        )}
                        onClick={() => {
                          setShowOverflowMenu(false)
                          onOpenWorkers()
                        }}
                      >
                        <Cpu size={13} className="shrink-0" />
                        <span className="flex-1">Workers</span>
                        {workerCount > 0 && (
                          <span className={cn(
                            'font-mono text-[10px]',
                            theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                          )}
                          >
                            {workerCount}
                          </span>
                        )}
                      </button>
                    )}

                    {onOpenWorkspace && (
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors',
                          theme === 'dark'
                            ? 'text-washi-white/85 hover:bg-white/5'
                            : 'text-sumi-black hover:bg-ink-wash',
                        )}
                        onClick={() => {
                          setShowOverflowMenu(false)
                          onOpenWorkspace()
                        }}
                      >
                        <Warehouse size={13} className="shrink-0" />
                        <span className="flex-1">Workspace</span>
                        <span className={cn(
                          'font-mono text-[10px]',
                          theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                        )}
                        >
                          {workspaceShortcutLabel}
                        </span>
                      </button>
                    )}

                    {onKill && (
                      <>
                        <div className={cn('my-1 h-px', theme === 'dark' ? 'bg-white/10' : 'bg-ink-border')} />
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-accent-vermillion transition-colors hover:bg-accent-vermillion/5 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            setShowOverflowMenu(false)
                            void handleKill()
                          }}
                          disabled={isKilling}
                        >
                          <Power size={13} className="shrink-0" />
                          {isKilling ? 'Killing...' : 'Kill Session'}
                        </button>
                      </>
                    )}

                    <div className={cn('my-1 h-px', theme === 'dark' ? 'bg-white/10' : 'bg-ink-border')} />
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs transition-colors',
                        theme === 'dark'
                          ? 'text-washi-white/65 hover:bg-white/5'
                          : 'text-sumi-diluted hover:bg-ink-wash',
                      )}
                      onClick={() => {
                        setShowOverflowMenu(false)
                        onBack()
                      }}
                    >
                      <ChevronLeft size={13} className="shrink-0" />
                      Back to Sessions
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {emptyStateActive ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {emptyState}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Transcript
              messages={messages}
              sessionId={sessionName}
              onAnswer={onAnswer}
              dark={theme === 'dark'}
              className={usesOverlayChrome
                ? undefined
                : cn(
                  'h-full flex-1 px-4 py-4',
                  theme === 'dark' ? 'hervald-chat-pane hv-dark' : 'bg-washi-aged/30',
                )}
              agentAvatarUrl={agentAvatarUrl}
              agentAccentColor={agentAccentColor}
            />
            {isStreaming && (
              <div className="px-4 pb-2">
                <StreamingDots />
              </div>
            )}
          </div>

          {canQueueDraft && (
            <div
              className={cn(
                'border-t px-3 py-3',
                theme === 'dark'
                  ? 'border-white/10 bg-[#1d1d21]'
                  : 'border-ink-border bg-washi-white',
              )}
            >
              <div
                className={cn(
                  'rounded-xl border',
                  theme === 'dark'
                    ? 'border-white/10 bg-white/[0.03]'
                    : 'border-ink-border bg-washi-aged/35',
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={queueExpanded}
                  aria-label="Toggle queue details"
                  data-testid="mobile-queue-header"
                  className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5"
                  onClick={() => setQueueExpanded((prev) => !prev)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setQueueExpanded((prev) => !prev)
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {queueExpanded ? (
                      <ChevronUp
                        size={14}
                        className={cn(
                          'shrink-0',
                          theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                        )}
                      />
                    ) : (
                      <ChevronDown
                        size={14}
                        className={cn(
                          'shrink-0',
                          theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                        )}
                      />
                    )}
                    <span className={cn(
                      'shrink-0 font-mono text-[11px] uppercase tracking-[0.2em]',
                      theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                    )}
                    >
                      Queue
                    </span>
                    <span className={cn(
                      'truncate text-xs',
                      theme === 'dark' ? 'text-white/55' : 'text-sumi-diluted',
                    )}
                    >
                      {queueStatusText}
                      {queueSnapshot.maxSize ? ` · ${totalQueuedCount}/${queueSnapshot.maxSize}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      'shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      theme === 'dark'
                        ? 'border-white/10 text-white/55 hover:bg-white/5'
                        : 'border-ink-border text-sumi-diluted hover:bg-ink-wash',
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      onClearQueue?.()
                    }}
                    disabled={!canClearQueue || !onClearQueue}
                  >
                    Clear
                  </button>
                </div>

                {queueExpanded && (
                  <div
                    data-testid="mobile-queue-details"
                    className={cn(
                      'border-t px-3 py-3',
                      theme === 'dark' ? 'border-white/10' : 'border-ink-border',
                    )}
                  >
                    {currentQueuedMessage && (
                      <div
                        className={cn(
                          'rounded-lg border px-3 py-2',
                          theme === 'dark'
                            ? 'border-emerald-400/25 bg-emerald-400/10'
                            : 'border-emerald-500/20 bg-emerald-500/5',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="badge-sumi bg-emerald-500/10 text-[10px] text-emerald-500">
                            Working on
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wide text-emerald-500">
                            {getQueuedMessageLabel(currentQueuedMessage)}
                          </span>
                        </div>
                        <p className={cn(
                          'mt-2 text-sm leading-relaxed',
                          theme === 'dark' ? 'text-washi-white' : 'text-sumi-black',
                        )}
                        >
                          {formatQueuePreview(currentQueuedMessage)}
                        </p>
                      </div>
                    )}

                    {queueItems.length > 0 ? (
                      <div className={cn('space-y-2', currentQueuedMessage ? 'mt-3' : '')}>
                        {queueItems.map((message, index) => (
                          <div
                            key={message.id}
                            className={cn(
                              'rounded-lg border px-3 py-2',
                              theme === 'dark'
                                ? 'border-white/10 bg-white/[0.04]'
                                : 'border-ink-border bg-washi-white',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    'font-mono text-[10px]',
                                    theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                                  )}
                                  >
                                    #{index + 1}
                                  </span>
                                  <span className="badge-sumi bg-black/5 text-[10px] text-sumi-diluted">
                                    {getQueuedMessageLabel(message)}
                                  </span>
                                </div>
                                <p className={cn(
                                  'mt-1 text-sm leading-relaxed',
                                  theme === 'dark' ? 'text-washi-white' : 'text-sumi-black',
                                )}
                                >
                                  {formatQueuePreview(message)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className={cn(
                                    'rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                                    theme === 'dark'
                                      ? 'border-white/10 text-white/55 hover:bg-white/5'
                                      : 'border-ink-border text-sumi-diluted hover:bg-ink-wash',
                                  )}
                                  onClick={() => onMoveQueuedMessage?.(message.id, -1)}
                                  disabled={index === 0 || isQueueMutating || !onMoveQueuedMessage}
                                  aria-label={`Move queued message ${index + 1} up`}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className={cn(
                                    'rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                                    theme === 'dark'
                                      ? 'border-white/10 text-white/55 hover:bg-white/5'
                                      : 'border-ink-border text-sumi-diluted hover:bg-ink-wash',
                                  )}
                                  onClick={() => onMoveQueuedMessage?.(message.id, 1)}
                                  disabled={index === queueItems.length - 1 || isQueueMutating || !onMoveQueuedMessage}
                                  aria-label={`Move queued message ${index + 1} down`}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-accent-vermillion/30 px-2 py-1 text-[11px] text-accent-vermillion transition-colors hover:bg-accent-vermillion/10 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() => onRemoveQueuedMessage?.(message.id)}
                                  disabled={isQueueMutating || !onRemoveQueuedMessage}
                                  aria-label={`Remove queued message ${index + 1}`}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : !currentQueuedMessage ? (
                      <p className={cn(
                        'text-[11px]',
                        theme === 'dark' ? 'text-white/45' : 'text-sumi-mist',
                      )}
                      >
                        Press Tab or click Queue to stack a follow-up without interrupting the current turn.
                      </p>
                    ) : null}

                    {queueError && (
                      <div className="mt-3 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-[11px] text-accent-vermillion">
                        {queueError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className={cn(
              'border-t px-3 py-3',
              theme === 'dark'
                ? 'border-white/10 bg-[#1d1d21]'
                : 'border-ink-border bg-washi-white',
            )}
          >
            <SessionComposer
              ref={composerRef}
              sessionName={sessionName}
              agentType={agentType}
              theme={theme}
              variant="mobile"
              disabled={!composerEnabled}
              disabledMessage={composerDisabledMessage}
              sendReady={composerSendReady}
              isStreaming={isStreaming}
              onQueue={canQueueDraft ? onQueue : undefined}
              onSend={onSend}
              placeholder={composerPlaceholder}
              contextFilePaths={contextFilePaths}
              onRemoveContextFilePath={onRemoveContextFilePath}
              onClearContextFilePaths={onClearContextFilePaths}
              onOpenWorkspace={onOpenWorkspace}
              onOpenAddToChat={handleOpenAddToChat}
              showWorkspaceShortcut={showComposerWorkspaceShortcut}
            />
          </div>
        </>
      )}

      <AddToChatSheet
        open={showAddToChatSheet}
        onClose={handleCloseAddToChat}
        onPickImage={handlePickImage}
        onPickSkill={handlePickSkill}
        onPickFile={handlePickFile}
      />
    </section>
  )
}
