import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import { useProviderRegistry } from '@/hooks/use-providers'
import { MobileSessionShell } from '@modules/agents/page-shell/MobileSessionShell'
import type { SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  CreateConversationPanel,
  type CreateConversationReasoningConfig,
} from '@modules/conversation/components/CreateConversationPanel'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { WorkspacePendingFileAnnotation } from '@modules/workspace/use-workspace'
import { orderMobileConversations } from './orderMobileConversations'

interface MobileChatViewProps {
  commander: Commander | null
  workers: Worker[]
  transcript: MsgItem[]
  hasOlderMessages?: boolean
  loadingOlderMessages?: boolean
  onLoadOlderMessages?: () => void
  approvals: PendingApproval[]
  sessionName: string
  composerEnabled: boolean
  composerSendReady: boolean
  canQueueDraft: boolean
  conversations?: ConversationRecord[]
  selectedConversationId?: string | null
  isStreaming?: boolean
  agentType?: AgentType
  wsStatus?: 'connecting' | 'connected' | 'disconnected' | 'closed' | null
  costUsd?: number
  durationSec?: number
  theme: 'light' | 'dark'
  onSetTheme: (theme: 'light' | 'dark') => void
  queueSnapshot: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  onBack: () => void
  onOpenTeam: () => void
  onOpenWorkspace: () => void
  onOpenWorkspaceFile?: (path: string) => void
  onSelectConversationId?: (conversationId: string | null) => void
  onCreateConversation?: (
    agentType: AgentType,
    model: string | null,
    reasoningConfig: CreateConversationReasoningConfig,
  ) => Promise<ConversationRecord | null> | ConversationRecord | null
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
  onStopCommander?: () => void
  showCreateConversationPanel?: boolean
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  onApproveApproval: (approval: PendingApproval) => void | Promise<void>
  onDenyApproval: (approval: PendingApproval) => void | Promise<void>
  onClearQueue: () => void
  onMoveQueuedMessage: (id: string, offset: number) => void
  onRemoveQueuedMessage: (id: string) => void
  contextFilePaths?: string[]
  contextDirectoryPaths?: string[]
  contextFileAnnotations?: WorkspacePendingFileAnnotation[]
  onRemoveContextFilePath?: (filePath: string) => void
  onRemoveContextDirectoryPath?: (directoryPath: string) => void
  onRemoveContextFileAnnotation?: (commentId: string) => void
  onClearContextFilePaths?: () => void
  onSend?: (payload: SessionComposerSubmitPayload) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
}

const EMPTY_QUEUE_SNAPSHOT: SessionQueueSnapshot = {
  currentMessage: null,
  items: [],
  totalCount: 0,
  maxSize: 0,
}

function resolveConversationSessionName(
  conversation: ConversationRecord,
  activeConversationId: string | null,
  activeSessionName: string,
): string {
  const backendSessionName = conversation.sendTarget?.sessionName?.trim()
  if (backendSessionName) {
    return backendSessionName
  }
  if (conversation.id === activeConversationId && activeSessionName.trim()) {
    return activeSessionName
  }
  return conversation.id
}

interface PageDotsProps {
  conversations: readonly ConversationRecord[]
  activeConversationId: string | null
  theme: 'light' | 'dark'
  onSelectConversationId?: (conversationId: string) => void
}

function PageDots({
  conversations,
  activeConversationId,
  theme,
  onSelectConversationId,
}: PageDotsProps) {
  if (conversations.length <= 1) {
    return null
  }

  return (
    <div
      className="mobile-chat-page-dots flex items-center justify-center gap-1.5"
      data-testid="mobile-chat-page-dots"
    >
      {conversations.map((conversation, index) => {
        const active = conversation.id === activeConversationId
        return (
          <button
            key={conversation.id}
            type="button"
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-opacity',
              theme === 'dark' ? 'bg-white' : 'bg-[var(--hv-button-primary-bg)]',
              active ? 'opacity-100' : 'opacity-30',
            )}
            aria-label={`Go to chat ${index + 1}`}
            data-testid="mobile-chat-page-dot"
            onClick={() => onSelectConversationId?.(conversation.id)}
          />
        )
      })}
    </div>
  )
}

export function MobileChatView({
  commander,
  workers,
  transcript,
  hasOlderMessages = false,
  loadingOlderMessages = false,
  onLoadOlderMessages,
  approvals,
  sessionName,
  composerEnabled,
  composerSendReady,
  canQueueDraft,
  conversations,
  selectedConversationId = null,
  isStreaming = false,
  agentType,
  wsStatus,
  costUsd,
  durationSec,
  theme,
  onSetTheme,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onBack,
  onOpenTeam,
  onOpenWorkspace,
  onOpenWorkspaceFile,
  onSelectConversationId,
  onCreateConversation,
  onStartConversation,
  onStopConversation,
  onRenameConversation,
  onSwapConversationProvider,
  onArchiveConversation,
  onRemoveConversation,
  onStopCommander,
  showCreateConversationPanel = false,
  onAnswer,
  onApproveApproval,
  onDenyApproval,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  contextFilePaths = [],
  contextDirectoryPaths = [],
  contextFileAnnotations = [],
  onRemoveContextFilePath,
  onRemoveContextDirectoryPath,
  onRemoveContextFileAnnotation,
  onClearContextFilePaths,
  onSend,
  onQueue,
}: MobileChatViewProps) {
  const { data: providers = [] } = useProviderRegistry()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<number | null>(null)
  const scrollSelectionGuardTimeoutRef = useRef<number | null>(null)
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId)
  const scrollSelectionGuardRef = useRef<{
    previousId: string
    selectedId: string
  } | null>(null)
  const transcriptCacheRef = useRef<Map<string, MsgItem[]>>(new Map())
  const [isCreatingConversation, setIsCreatingConversation] = useState(false)

  const clearScrollSelectionGuard = useCallback(() => {
    scrollSelectionGuardRef.current = null
    if (scrollSelectionGuardTimeoutRef.current !== null) {
      window.clearTimeout(scrollSelectionGuardTimeoutRef.current)
      scrollSelectionGuardTimeoutRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current)
    }
    if (scrollSelectionGuardTimeoutRef.current !== null) {
      window.clearTimeout(scrollSelectionGuardTimeoutRef.current)
    }
  }, [])

  const conversationMode = Array.isArray(conversations)
  const visibleConversations = useMemo(
    () => conversationMode && commander
      ? orderMobileConversations(
        conversations.filter((conversation) => (
          conversation.commanderId === commander.id
          && conversation.displayState?.isVisible !== false
          &&
          conversation.status !== 'archived'
        )),
      )
      : [],
    [commander, conversationMode, conversations],
  )
  const visibleConversationsRef = useRef<ConversationRecord[]>(visibleConversations)
  visibleConversationsRef.current = visibleConversations
  const activeConversation = useMemo(() => {
    if (!conversationMode || visibleConversations.length === 0) {
      return null
    }
    return visibleConversations.find((conversation) => conversation.id === selectedConversationId)
      ?? (selectedConversationId ? null : visibleConversations[0])
      ?? null
  }, [conversationMode, selectedConversationId, visibleConversations])
  const activeConversationId = activeConversation?.id ?? null
  if (conversationMode) {
    const visibleConversationIds = new Set(visibleConversations.map((conversation) => conversation.id))
    Array.from(transcriptCacheRef.current.keys()).forEach((conversationId) => {
      if (!visibleConversationIds.has(conversationId)) {
        transcriptCacheRef.current.delete(conversationId)
      }
    })
    if (
      activeConversationId
      && (
        transcript.length > 0
        || !transcriptCacheRef.current.has(activeConversationId)
      )
    ) {
      transcriptCacheRef.current.set(activeConversationId, transcript)
    }
  } else {
    transcriptCacheRef.current.clear()
  }
  const activeConversationIndex = useMemo(
    () => activeConversationId
      ? visibleConversations.findIndex((conversation) => conversation.id === activeConversationId)
      : -1,
    [activeConversationId, visibleConversations],
  )

  useEffect(() => {
    const previousConversationId = selectedConversationIdRef.current
    if (previousConversationId === selectedConversationId) {
      return
    }

    selectedConversationIdRef.current = selectedConversationId
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current)
      scrollTimeoutRef.current = null
    }
    if (
      previousConversationId
      && selectedConversationId
      && previousConversationId !== selectedConversationId
    ) {
      scrollSelectionGuardRef.current = {
        previousId: previousConversationId,
        selectedId: selectedConversationId,
      }
      if (scrollSelectionGuardTimeoutRef.current !== null) {
        window.clearTimeout(scrollSelectionGuardTimeoutRef.current)
      }
      scrollSelectionGuardTimeoutRef.current = window.setTimeout(() => {
        scrollSelectionGuardRef.current = null
        scrollSelectionGuardTimeoutRef.current = null
      }, 300)
    } else {
      clearScrollSelectionGuard()
    }
  }, [clearScrollSelectionGuard, selectedConversationId])

  const scrollToConversation = useCallback((conversationId: string | null) => {
    if (!conversationId) {
      return
    }
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    const targetIndex = visibleConversationsRef.current.findIndex((conversation) => conversation.id === conversationId)
    if (targetIndex === -1) {
      return
    }
    const targetLeft = targetIndex * container.clientWidth
    if (Math.abs(container.scrollLeft - targetLeft) <= 1) {
      return
    }
    container.scrollTo({ left: targetLeft, behavior: 'auto' })
  }, [])

  useEffect(() => {
    if (activeConversationIndex < 0) {
      return
    }
    scrollToConversation(activeConversationId)
  }, [activeConversationId, activeConversationIndex, scrollToConversation])

  const selectConversationFromScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || container.clientWidth <= 0) {
      return
    }
    const nextIndex = Math.max(
      0,
      Math.min(
        visibleConversations.length - 1,
        Math.round(container.scrollLeft / container.clientWidth),
      ),
    )
    const nextConversation = visibleConversations[nextIndex]
    if (!nextConversation) {
      return
    }
    const selectionGuard = scrollSelectionGuardRef.current
    if (
      selectionGuard
      && nextConversation.id === selectionGuard.previousId
      && nextConversation.id !== selectedConversationIdRef.current
    ) {
      return
    }
    if (
      selectionGuard
      && nextConversation.id !== selectionGuard.previousId
      && nextConversation.id !== selectionGuard.selectedId
    ) {
      clearScrollSelectionGuard()
    }
    if (nextConversation.id !== selectedConversationIdRef.current) {
      onSelectConversationId?.(nextConversation.id)
    }
  }, [
    clearScrollSelectionGuard,
    onSelectConversationId,
    visibleConversations,
  ])

  const handleCarouselScroll = useCallback(() => {
    if (!conversationMode || visibleConversations.length <= 1) {
      return
    }
    selectConversationFromScroll()
    if (scrollTimeoutRef.current !== null) {
      window.clearTimeout(scrollTimeoutRef.current)
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      selectConversationFromScroll()
    }, 100)
  }, [conversationMode, selectConversationFromScroll, visibleConversations.length])

  const resolveFallbackConversationId = useCallback((conversationId: string) => {
    const currentIndex = visibleConversations.findIndex((conversation) => conversation.id === conversationId)
    if (currentIndex === -1) {
      return activeConversationId
    }
    return visibleConversations[currentIndex + 1]?.id
      ?? visibleConversations[currentIndex - 1]?.id
      ?? null
  }, [activeConversationId, visibleConversations])

  const handleArchiveConversation = useCallback(async (conversationId: string) => {
    if (!onArchiveConversation) {
      return
    }
    const nextConversationId = resolveFallbackConversationId(conversationId)
    await onArchiveConversation(conversationId)
    if (conversationId === activeConversationId) {
      onSelectConversationId?.(nextConversationId)
    }
  }, [
    activeConversationId,
    onArchiveConversation,
    onSelectConversationId,
    resolveFallbackConversationId,
  ])

  const handleRemoveConversation = useCallback(async (conversationId: string) => {
    if (!onRemoveConversation) {
      return
    }
    const nextConversationId = resolveFallbackConversationId(conversationId)
    await onRemoveConversation(conversationId)
    if (conversationId === activeConversationId) {
      onSelectConversationId?.(nextConversationId)
    }
  }, [
    activeConversationId,
    onRemoveConversation,
    onSelectConversationId,
    resolveFallbackConversationId,
  ])

  const handleCreateConversation = useCallback(async (
    nextAgentType: AgentType,
    nextModel: string | null,
    reasoningConfig: CreateConversationReasoningConfig,
  ) => {
    if (!commander || !onCreateConversation) {
      return
    }

    setIsCreatingConversation(true)
    try {
      const created = await onCreateConversation(nextAgentType, nextModel, reasoningConfig)
      if (!created) {
        return
      }
      onSelectConversationId?.(created.id)
    } finally {
      setIsCreatingConversation(false)
    }
  }, [
    commander,
    onCreateConversation,
    onSelectConversationId,
  ])

  if (!commander) {
    return null
  }

  if (!conversationMode) {
    return (
      <MobileSessionShell
        sessionName={sessionName}
        sessionLabel={commander.name}
        agentType={agentType}
        commanderId={commander.id}
        wsStatus={wsStatus}
        costUsd={costUsd}
        durationSec={durationSec}
        messages={transcript}
        hasOlderMessages={hasOlderMessages}
        loadingOlderMessages={loadingOlderMessages}
        onLoadOlderMessages={onLoadOlderMessages}
        onAnswer={onAnswer}
        approvals={approvals}
        onApprovalDecision={(approval, decision) =>
          decision === 'approve'
            ? onApproveApproval(approval)
            : onDenyApproval(approval)
        }
        agentAvatarUrl={commander.avatarUrl ?? undefined}
        onSend={onSend ?? (() => undefined)}
        onQueue={canQueueDraft ? onQueue : undefined}
        canQueueDraft={canQueueDraft}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        onClearQueue={onClearQueue}
        onMoveQueuedMessage={onMoveQueuedMessage}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
        composerEnabled={composerEnabled}
        composerSendReady={composerSendReady}
        isStreaming={isStreaming}
        composerPlaceholder={`Send a message to ${commander.name}…`}
        contextFilePaths={contextFilePaths}
        contextDirectoryPaths={contextDirectoryPaths}
        onRemoveContextFilePath={onRemoveContextFilePath}
        onRemoveContextDirectoryPath={onRemoveContextDirectoryPath}
        onClearContextFilePaths={onClearContextFilePaths}
        theme={theme}
        onSetTheme={onSetTheme}
        onBack={onBack}
        onKill={onStopCommander}
        onOpenWorkspace={onOpenWorkspace}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        workers={workers.map((worker) => ({
          id: worker.id,
          label: worker.name,
          status: worker.state,
        }))}
        onOpenWorkers={onOpenTeam}
        rootClassName={`mobile-session-shell session-view-overlay ${theme === 'dark' ? 'hv-dark' : 'hv-light'}`}
        composerDisabledMessage={`Create a chat to message ${commander.name}.`}
        dataTestId="mobile-chat-view"
      />
    )
  }

  if (showCreateConversationPanel || visibleConversations.length === 0) {
    return (
      <MobileSessionShell
        sessionName={sessionName || commander.id}
        sessionLabel={commander.name}
        agentType={agentType}
        commanderId={commander.id}
        wsStatus={wsStatus}
        costUsd={costUsd}
        durationSec={durationSec}
        messages={[]}
        onAnswer={onAnswer}
        approvals={approvals}
        onApprovalDecision={(approval, decision) =>
          decision === 'approve'
            ? onApproveApproval(approval)
            : onDenyApproval(approval)
        }
        agentAvatarUrl={commander.avatarUrl ?? undefined}
        onSend={onSend ?? (() => undefined)}
        canQueueDraft={false}
        queueSnapshot={EMPTY_QUEUE_SNAPSHOT}
        queueError={null}
        isQueueMutating={false}
        onClearQueue={onClearQueue}
        onMoveQueuedMessage={onMoveQueuedMessage}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
        composerEnabled={false}
        composerSendReady={false}
        isStreaming={false}
        composerPlaceholder={`Send a message to ${commander.name}…`}
        theme={theme}
        onSetTheme={onSetTheme}
        onBack={onBack}
        onKill={onStopCommander}
              onOpenWorkspace={onOpenWorkspace}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
        workers={workers.map((worker) => ({
          id: worker.id,
          label: worker.name,
          status: worker.state,
        }))}
        onOpenWorkers={onOpenTeam}
        rootClassName={`mobile-session-shell session-view-overlay ${theme === 'dark' ? 'hv-dark' : 'hv-light'}`}
        composerDisabledMessage={`Create a chat to message ${commander.name}.`}
        dataTestId="mobile-chat-view"
        emptyState={(
          <div
            className="flex flex-1 items-center justify-center px-6 py-10"
            data-testid="mobile-chat-empty-state"
          >
            <CreateConversationPanel
              commanderName={commander.name}
              onCreateChat={(nextAgentType, nextModel, reasoningConfig) => {
                void handleCreateConversation(nextAgentType, nextModel, reasoningConfig)
              }}
              createChatPending={isCreatingConversation}
              defaultAgentType={agentType}
              providerOptions={providers}
            />
          </div>
        )}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="mobile-chat-carousel-shell">
      <div
        ref={scrollContainerRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        data-testid="mobile-chat-carousel"
        onScroll={handleCarouselScroll}
      >
        {visibleConversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId
          const conversationMessages = isActive
            ? transcript
            : transcriptCacheRef.current.get(conversation.id) ?? []
          return (
            <div
              key={conversation.id}
              className="flex min-h-0 min-w-full flex-1 snap-start flex-col"
              data-testid="mobile-chat-page"
              data-conversation-id={conversation.id}
            >
              <MobileSessionShell
                sessionName={resolveConversationSessionName(
                  conversation,
                  activeConversationId,
                  sessionName,
                )}
                sessionLabel={commander.name}
                chatLabel={conversation.name?.trim() || undefined}
                agentType={conversation.liveSession?.agentType ?? conversation.agentType ?? agentType}
                commanderId={commander.id}
                wsStatus={isActive ? wsStatus : null}
                costUsd={isActive ? costUsd : undefined}
                durationSec={isActive ? durationSec : undefined}
                messages={conversationMessages}
                hasOlderMessages={isActive && hasOlderMessages}
                loadingOlderMessages={isActive && loadingOlderMessages}
                onLoadOlderMessages={isActive ? onLoadOlderMessages : undefined}
                onAnswer={onAnswer}
                approvals={approvals}
                onApprovalDecision={(approval, decision) =>
                  decision === 'approve'
                    ? onApproveApproval(approval)
                    : onDenyApproval(approval)
                }
                agentAvatarUrl={commander.avatarUrl ?? undefined}
                onSend={onSend ?? (() => undefined)}
                onQueue={isActive && canQueueDraft ? onQueue : undefined}
                canQueueDraft={isActive && canQueueDraft}
                queueSnapshot={isActive ? queueSnapshot : EMPTY_QUEUE_SNAPSHOT}
                queueError={isActive ? queueError : null}
                isQueueMutating={isActive && isQueueMutating}
                onClearQueue={onClearQueue}
                onMoveQueuedMessage={onMoveQueuedMessage}
                onRemoveQueuedMessage={onRemoveQueuedMessage}
                composerEnabled={isActive ? composerEnabled : false}
                composerSendReady={isActive ? composerSendReady : false}
                isStreaming={isActive ? isStreaming : false}
                composerPlaceholder={`Send a message to ${commander.name}…`}
                contextFilePaths={isActive ? contextFilePaths : []}
                contextDirectoryPaths={isActive ? contextDirectoryPaths : []}
                contextFileAnnotations={isActive ? contextFileAnnotations : []}
                onRemoveContextFilePath={isActive ? onRemoveContextFilePath : undefined}
                onRemoveContextDirectoryPath={isActive ? onRemoveContextDirectoryPath : undefined}
                onRemoveContextFileAnnotation={isActive ? onRemoveContextFileAnnotation : undefined}
                onClearContextFilePaths={isActive ? onClearContextFilePaths : undefined}
                theme={theme}
                onSetTheme={onSetTheme}
                onBack={onBack}
                onKill={onStopCommander}
                onOpenWorkspace={onOpenWorkspace}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
                workers={workers.map((worker) => ({
                  id: worker.id,
                  label: worker.name,
                  status: worker.state,
                }))}
                onOpenWorkers={onOpenTeam}
                rootClassName={`mobile-session-shell session-view-overlay ${theme === 'dark' ? 'hv-dark' : 'hv-light'}`}
                composerDisabledMessage={`Start ${commander.name} to begin chatting.`}
                dataTestId="mobile-chat-view"
                conversation={conversation}
                onStartConversation={onStartConversation}
                onStopConversation={onStopConversation}
                onRenameConversation={onRenameConversation}
                onSwapConversationProvider={onSwapConversationProvider}
                onArchiveConversation={handleArchiveConversation}
                onRemoveConversation={handleRemoveConversation}
                headerAccessory={isActive
                  ? (
                    <PageDots
                      conversations={visibleConversations}
                      activeConversationId={activeConversationId}
                      theme={theme}
                      onSelectConversationId={onSelectConversationId ?? undefined}
                    />
                  )
                  : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
