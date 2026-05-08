import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ChevronLeft,
  Cpu,
  DollarSign,
  Moon,
  MoreVertical,
  Play,
  Plus,
  Power,
  Square,
  Sun,
  Warehouse,
} from 'lucide-react'
import { useProviderRegistry } from '@/hooks/use-providers'
import { cn, formatCost } from '@/lib/utils'
import type { AgentType, ProviderModelOption, ProviderRegistryEntry, SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import { AddToChatSheet } from '@modules/agents/components/AddToChatSheet'
import Transcript from '@modules/agents/components/Transcript'
import {
  SessionComposer,
  type SessionComposerHandle,
  type SessionComposerSubmitPayload,
} from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
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
  chatLabel?: string
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
  theme: 'light' | 'dark'
  onSetTheme?: (theme: 'light' | 'dark') => void
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
  conversation?: ConversationRecord | null
  onStartConversation?: (conversationId: string) => void | Promise<void>
  onStopConversation?: (conversationId: string) => void | Promise<void>
  onRenameConversation?: (conversationId: string, name: string) => void | Promise<void>
  onSwapConversationProvider?: (
    conversationId: string,
    agentType: AgentType,
    model: string | null,
  ) => void | Promise<void>
  onArchiveConversation?: (conversationId: string) => void | Promise<void>
  onRemoveConversation?: (conversationId: string) => void | Promise<void>
  belowHeader?: ReactNode
}

type ConversationProviderOption = Pick<ProviderRegistryEntry, 'id' | 'label' | 'availableModels'>

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
  chatLabel,
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
  theme,
  onSetTheme,
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
  conversation = null,
  onStartConversation,
  onStopConversation,
  onRenameConversation,
  onSwapConversationProvider,
  onArchiveConversation,
  onRemoveConversation,
  belowHeader,
}: MobileSessionShellProps) {
  const usesOverlayChrome = rootClassName?.includes('session-view-overlay') ?? false
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showConversationProviderMenu, setShowConversationProviderMenu] = useState(false)
  const [showAddToChatSheet, setShowAddToChatSheet] = useState(false)
  const [isKilling, setIsKilling] = useState(false)
  const [conversationActionBusy, setConversationActionBusy] = useState<string | null>(null)
  const [conversationProviderDraft, setConversationProviderDraft] = useState<AgentType | ''>('')
  const [conversationModelDraft, setConversationModelDraft] = useState('')
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

    const formattedDuration = formatDuration(durationSec)
    if (formattedDuration) {
      parts.push(formattedDuration)
    }

    return parts
  }, [durationSec, wsStatus])

  const workspaceShortcutLabel = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')
    ? '\u2318K'
    : 'Ctrl+K'
  const workerCount = workers?.length ?? 0
  const { data: providers = [] } = useProviderRegistry()
  const providerOptions: ConversationProviderOption[] = useMemo(
    () => providers.length > 0
      ? providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        availableModels: provider.availableModels,
      }))
      : (conversation?.agentType
        ? [{ id: conversation.agentType, label: conversation.agentType, availableModels: [] }]
        : []),
    [conversation?.agentType, providers],
  )
  const conversationName = conversation?.name?.trim() || (conversation ? `chat ${conversation.id.slice(0, 8)}` : '')
  const canStartConversation = conversation?.status === 'idle' || conversation?.status === 'paused'
  const canStopConversation = conversation?.status === 'active'
  const canEditConversationProviderModel = canStartConversation && Boolean(onSwapConversationProvider)
  const activeConversationProvider = providerOptions.find(
    (provider) => provider.id === conversationProviderDraft,
  ) ?? null
  const availableConversationModels: readonly ProviderModelOption[] =
    activeConversationProvider?.availableModels ?? []
  const providerModelChanged = Boolean(conversationProviderDraft)
    && (
      conversationProviderDraft !== (conversation?.agentType ?? '')
      || conversationModelDraft !== (conversation?.model ?? '')
    )
  const showConversationDrawerActions = Boolean(
    conversation && (
      canStartConversation
      || canStopConversation
      || onRenameConversation
      || canEditConversationProviderModel
      || onArchiveConversation
      || onRemoveConversation
    ),
  )

  useEffect(() => {
    if (!conversation) {
      setConversationProviderDraft('')
      setConversationModelDraft('')
      return
    }
    const nextProvider = conversation.agentType
      && providerOptions.some((provider) => provider.id === conversation.agentType)
      ? conversation.agentType
      : providerOptions[0]?.id ?? conversation.agentType ?? ''
    setConversationProviderDraft(nextProvider)
    setConversationModelDraft(conversation.model ?? '')
  }, [conversation?.agentType, conversation?.id, conversation?.model, providerOptions])

  const closeOverflowMenu = useCallback(() => {
    setShowConversationProviderMenu(false)
    setShowOverflowMenu(false)
  }, [])

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

  const handleConversationAction = useCallback(async (
    actionId: string,
    callback: () => Promise<void>,
  ) => {
    setConversationActionBusy(actionId)
    try {
      await callback()
    } finally {
      setConversationActionBusy((current) => (current === actionId ? null : current))
    }
  }, [])

  const handleRename = useCallback(async () => {
    if (!conversation || !onRenameConversation) {
      return
    }
    const nextName = window.prompt('Rename chat', conversationName)
    if (nextName === null) {
      return
    }
    const trimmed = nextName.trim()
    if (!trimmed) {
      return
    }
    await handleConversationAction('rename', async () => {
      await onRenameConversation(conversation.id, trimmed)
      setShowConversationProviderMenu(false)
      setShowOverflowMenu(false)
    })
  }, [
    conversation,
    conversationName,
    handleConversationAction,
    onRenameConversation,
  ])

  const handleConversationProviderDraftChange = useCallback((provider: AgentType) => {
    setConversationProviderDraft(provider)
    const nextModels = providerOptions.find((option) => option.id === provider)?.availableModels ?? []
    setConversationModelDraft((current) => (
      current && nextModels.some((option) => option.id === current)
        ? current
        : ''
    ))
  }, [providerOptions])

  const handleSaveConversationProviderModel = useCallback(async () => {
    if (
      !conversation
      || !onSwapConversationProvider
      || !conversationProviderDraft
      || !providerModelChanged
    ) {
      return
    }
    await handleConversationAction('provider-model', async () => {
      await onSwapConversationProvider(
        conversation.id,
        conversationProviderDraft,
        conversationModelDraft || null,
      )
      setShowConversationProviderMenu(false)
      setShowOverflowMenu(false)
    })
  }, [
    conversation,
    conversationModelDraft,
    conversationProviderDraft,
    handleConversationAction,
    onSwapConversationProvider,
    providerModelChanged,
  ])

  const handleArchive = useCallback(async () => {
    if (!conversation || !onArchiveConversation) {
      return
    }
    await handleConversationAction('archive', async () => {
      await onArchiveConversation(conversation.id)
      setShowConversationProviderMenu(false)
      setShowOverflowMenu(false)
    })
  }, [conversation, handleConversationAction, onArchiveConversation])

  const handleRemove = useCallback(async () => {
    if (!conversation || !onRemoveConversation) {
      return
    }
    const confirmation = window.prompt(
      `Type ${conversationName} to remove this chat and its transcript files.`,
      '',
    )
    if (confirmation !== conversationName) {
      return
    }
    await handleConversationAction('remove', async () => {
      await onRemoveConversation(conversation.id)
      setShowConversationProviderMenu(false)
      setShowOverflowMenu(false)
    })
  }, [
    conversation,
    conversationName,
    handleConversationAction,
    onRemoveConversation,
  ])

  const handleStart = useCallback(async () => {
    if (!conversation || !onStartConversation) {
      return
    }
    await handleConversationAction('start', async () => {
      await onStartConversation(conversation.id)
      closeOverflowMenu()
    })
  }, [closeOverflowMenu, conversation, handleConversationAction, onStartConversation])

  const handleStop = useCallback(async () => {
    if (!conversation || !onStopConversation) {
      return
    }
    await handleConversationAction('stop', async () => {
      await onStopConversation(conversation.id)
      closeOverflowMenu()
    })
  }, [closeOverflowMenu, conversation, handleConversationAction, onStopConversation])

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
            ? 'border-white/10'
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
            aria-label="Back to org"
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
            {chatLabel && (
              <p className="session-header-chat mt-0.5 truncate text-[11px] tracking-wide opacity-70">
                {chatLabel}
              </p>
            )}
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
            <div className="relative shrink-0">
              <button
                type="button"
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur-[2px] transition-colors',
                  theme === 'dark'
                    ? 'text-washi-white/65 hover:bg-white/5'
                    : 'text-sumi-diluted hover:bg-ink-wash',
                )}
                onClick={() => {
                  if (showOverflowMenu) {
                    closeOverflowMenu()
                    return
                  }
                  setShowConversationProviderMenu(false)
                  setShowOverflowMenu(true)
                }}
                aria-label="Session actions"
                aria-expanded={showOverflowMenu}
              >
                <MoreVertical size={16} />
              </button>

              {showOverflowMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={closeOverflowMenu}
                  />

                  <div
                    className={cn(
                      'absolute right-0 top-full z-50 mt-1 min-w-[188px] overflow-hidden rounded-[3px_10px_3px_10px] border p-1 text-sumi-black shadow-ink-md',
                      theme === 'dark'
                        ? 'border-white/10 bg-[#242428]'
                        : 'border-ink-border bg-washi-white',
                    )}
                    data-testid="mobile-session-overflow-menu"
                  >
                    {approvals && approvals.length > 0 && onApprovalDecision && (
                      <SessionApprovalsButton
                        approvals={approvals}
                        onDecision={onApprovalDecision}
                        layout="row"
                        rootClassName="mb-0.5"
                        buttonClassName="!flex !h-auto !w-full !justify-start rounded-md px-3 py-2.5 text-left text-sumi-black hover:bg-ink-wash"
                      />
                    )}

                    {onNewQuest && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash"
                        onClick={() => {
                          composerRef.current?.seedText('Create a new quest on your quest board: ')
                          onNewQuest()
                          closeOverflowMenu()
                        }}
                      >
                        <Plus size={13} className="shrink-0" />
                        New Quest
                      </button>
                    )}

                    {onOpenWorkers && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash"
                        onClick={() => {
                          closeOverflowMenu()
                          onOpenWorkers()
                        }}
                      >
                        <Cpu size={13} className="shrink-0" />
                        <span className="flex-1">Workers</span>
                        {workerCount > 0 && (
                          <span className="font-mono text-[10px] text-sumi-diluted">
                            {workerCount}
                          </span>
                        )}
                      </button>
                    )}

                    {onOpenWorkspace && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash"
                        onClick={() => {
                          closeOverflowMenu()
                          onOpenWorkspace()
                        }}
                      >
                        <Warehouse size={13} className="shrink-0" />
                        <span className="flex-1">Workspace</span>
                        <span className="font-mono text-[10px] text-sumi-diluted">
                          {workspaceShortcutLabel}
                        </span>
                      </button>
                    )}

                    {typeof costUsd === 'number' && (
                      <div className="flex w-full cursor-default items-center gap-2 rounded-md px-3 py-2.5 text-xs text-sumi-black">
                        <DollarSign size={13} className="shrink-0" />
                        <span className="flex-1 text-left">Cost</span>
                        <span className="font-mono opacity-75">{formatCost(costUsd)}</span>
                      </div>
                    )}

                    {onSetTheme && (
                      <>
                        <div className="my-1 h-px bg-ink-border" />
                        <div className="flex items-center gap-3 rounded-md px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-2 text-sumi-black">
                            <Sun size={13} className="shrink-0" />
                            <span>Theme</span>
                          </div>
                          <div
                            className={cn(
                              'ml-auto inline-flex items-center gap-1 rounded-[2px_10px_2px_10px] border p-1',
                              theme === 'dark'
                                ? 'border-white/10 bg-black/20'
                                : 'border-ink-border bg-washi-aged/60',
                            )}
                          >
                            <button
                              type="button"
                              className={cn(
                                'inline-flex items-center gap-1 rounded-[2px_8px_2px_8px] px-2 py-1 text-[10px] font-medium transition-colors',
                                theme === 'light'
                                  ? 'bg-sumi-black text-washi-white'
                                  : theme === 'dark'
                                    ? 'text-white/60 hover:text-washi-white'
                                    : 'text-sumi-diluted hover:text-sumi-black',
                              )}
                              aria-label="Use light theme"
                              aria-pressed={theme === 'light'}
                              onClick={() => onSetTheme('light')}
                            >
                              <Sun size={11} />
                              Light
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex items-center gap-1 rounded-[2px_8px_2px_8px] px-2 py-1 text-[10px] font-medium transition-colors',
                                theme === 'dark'
                                  ? 'bg-sumi-black text-washi-white'
                                  : 'text-sumi-diluted hover:text-sumi-black',
                              )}
                              aria-label="Use dark theme"
                              aria-pressed={theme === 'dark'}
                              onClick={() => onSetTheme('dark')}
                            >
                              <Moon size={11} />
                              Dark
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {showConversationDrawerActions && (
                      <div className="my-1 h-px bg-ink-border" />
                    )}

                    {canStartConversation && onStartConversation && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          void handleStart()
                        }}
                        disabled={conversationActionBusy !== null}
                      >
                        <Play size={13} className="shrink-0" />
                        {conversationActionBusy === 'start' ? 'Starting…' : 'Start chat'}
                      </button>
                    )}

                    {canStopConversation && onStopConversation && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => {
                          void handleStop()
                        }}
                        disabled={conversationActionBusy !== null}
                      >
                        <Square size={13} className="shrink-0" />
                        {conversationActionBusy === 'stop' ? 'Stopping…' : 'Stop chat'}
                      </button>
                    )}

                    {onRenameConversation && conversation && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="mobile-chat-rename-button"
                        onClick={() => {
                          void handleRename()
                        }}
                        disabled={conversationActionBusy !== null}
                      >
                        Rename
                      </button>
                    )}

                    {canEditConversationProviderModel && conversation && (
                      <>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid="mobile-chat-provider-menu-button"
                          onClick={() => setShowConversationProviderMenu((current) => !current)}
                          disabled={conversationActionBusy !== null}
                        >
                          <span>Provider / model</span>
                          <span className="ml-auto">{showConversationProviderMenu ? '▾' : '▸'}</span>
                        </button>
                        {showConversationProviderMenu && (
                          <div
                            className="mt-1 grid gap-2 border-t border-ink-border pl-3 pt-2"
                          >
                            <label className="grid gap-1 px-3 text-[10px] uppercase tracking-[0.08em] text-sumi-diluted">
                              <span>Provider</span>
                              <select
                                className="w-full rounded-md border border-ink-border bg-washi-white px-2 py-2 text-xs normal-case tracking-normal text-sumi-black"
                                data-testid="mobile-chat-provider-select"
                                value={conversationProviderDraft}
                                onChange={(event) =>
                                  handleConversationProviderDraftChange(event.target.value as AgentType)}
                                disabled={conversationActionBusy !== null}
                              >
                                {providerOptions.map((provider) => (
                                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 px-3 text-[10px] uppercase tracking-[0.08em] text-sumi-diluted">
                              <span>Model</span>
                              <select
                                className="w-full rounded-md border border-ink-border bg-washi-white px-2 py-2 text-xs normal-case tracking-normal text-sumi-black"
                                data-testid="mobile-chat-model-select"
                                value={conversationModelDraft}
                                onChange={(event) => setConversationModelDraft(event.target.value)}
                                disabled={conversationActionBusy !== null}
                              >
                                <option value="">Adapter default</option>
                                {availableConversationModels.map((model) => (
                                  <option key={model.id} value={model.id}>{model.label}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="mx-3 mb-1 flex items-center justify-center rounded-md bg-sumi-black px-3 py-2 text-xs text-washi-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                              data-testid="mobile-chat-provider-save-button"
                              onClick={() => {
                                void handleSaveConversationProviderModel()
                              }}
                              disabled={conversationActionBusy !== null || !providerModelChanged}
                            >
                              {conversationActionBusy === 'provider-model' ? 'Saving' : 'Save'}
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {onArchiveConversation && conversation && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="mobile-chat-close-button"
                        onClick={() => {
                          void handleArchive()
                        }}
                        disabled={conversationActionBusy !== null}
                      >
                        Close
                      </button>
                    )}

                    {onRemoveConversation && conversation && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-accent-vermillion transition-colors hover:bg-accent-vermillion/5 disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="mobile-chat-remove-button"
                        onClick={() => {
                          void handleRemove()
                        }}
                        disabled={conversationActionBusy !== null}
                      >
                        Remove
                      </button>
                    )}

                    {onKill && (
                      <>
                        <div className="my-1 h-px bg-ink-border" />
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-accent-vermillion transition-colors hover:bg-accent-vermillion/5 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            closeOverflowMenu()
                            void handleKill()
                          }}
                          disabled={isKilling}
                        >
                          <Power size={13} className="shrink-0" />
                          {isKilling ? 'Killing...' : 'Kill Session'}
                        </button>
                      </>
                    )}

                    <div className="my-1 h-px bg-ink-border" />
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-sumi-diluted transition-colors hover:bg-ink-wash"
                      onClick={() => {
                        closeOverflowMenu()
                        onBack()
                      }}
                    >
                      <ChevronLeft size={13} className="shrink-0" />
                      Back to Org
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {belowHeader && (
          <div className="mt-3 space-y-2">
            {belowHeader}
          </div>
        )}
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
          <div
            className={cn(
              'border-t px-3 py-2',
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
              queueSnapshot={queueSnapshot}
              queueError={queueError}
              isQueueMutating={isQueueMutating}
              onClearQueue={onClearQueue}
              onMoveQueuedMessage={onMoveQueuedMessage}
              onRemoveQueuedMessage={onRemoveQueuedMessage}
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
