import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useApprovalDecision, type PendingApproval } from '@/hooks/use-approvals'
import { cn } from '@/lib/utils'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import {
  getWorkspaceSourceKey,
  type WorkspaceSource,
} from '@modules/workspace/use-workspace'
import type { SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import {
  GLOBAL_COMMANDER_ID,
  isGlobalCommanderId,
  type CommanderAgentType,
  type CommanderSession,
} from '@modules/commanders/hooks/useCommander'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'
import { MobileApprovalSheet } from '@modules/approvals/MobileApprovalSheet'
import { MobileChatView } from './MobileChatView'
import { MobileInbox } from '@modules/approvals/MobileInbox'
import { MobileSessionsList } from './MobileSessionsList'
import { MobileSettings } from '@modules/settings/MobileSettings'
import { MobileTeamSheet } from './MobileTeamSheet'
import { MobileWorkspaceSheet } from './MobileWorkspaceSheet'
import { orderMobileConversations } from './orderMobileConversations'

type SheetKind = 'team' | 'approval' | 'workspace' | null
type MobileTab = 'sessions' | 'inbox' | 'settings'

function approvalMatchesCommander(approval: PendingApproval, commander: Commander): boolean {
  return approval.commanderId === commander.id || approval.commanderName === commander.name
}

function resolveMobileTab(pathname: string): MobileTab {
  if (pathname.startsWith('/command-room/inbox')) {
    return 'inbox'
  }
  if (pathname.startsWith('/command-room/settings')) {
    return 'settings'
  }
  return 'sessions'
}

export interface MobileCommandRoomProps {
  commanders: Commander[]
  commanderSessions: CommanderSession[]
  workers: Worker[]
  pendingApprovals: PendingApproval[]
  selectedCommanderId: string | null
  onSelectCommanderId: (id: string) => void
  selectedCommanderRunning: boolean
  selectedCommanderAgentType?: CommanderAgentType
  transcript: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  composerSessionName: string
  composerEnabled: boolean
  composerSendReady: boolean
  canQueueDraft: boolean
  theme: 'light' | 'dark'
  onSetTheme: (theme: 'light' | 'dark') => void
  conversations?: ConversationRecord[]
  selectedConversationId?: string | null
  onSelectConversationId?: (conversationId: string | null) => void
  isStreaming?: boolean
  streamStatus?: 'connecting' | 'connected' | 'disconnected' | 'closed' | null
  queueSnapshot: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  onClearQueue: () => void
  onMoveQueuedMessage: (id: string, offset: number) => void
  onRemoveQueuedMessage: (id: string) => void
  onSend?: (payload: SessionComposerSubmitPayload) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
  workspaceSource: WorkspaceSource | null
  onStopCommander?: () => void
  onCreateChatForCommander?: (commanderId: string) => void | Promise<void>
  onCreateConversation?: (
    commanderId: string,
    agentType: AgentType,
    model: string | null,
  ) => Promise<ConversationRecord | null> | ConversationRecord | null
  requestedNewChatCommanderId?: string | null
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
}

export function MobileCommandRoom({
  commanders,
  commanderSessions,
  workers,
  pendingApprovals,
  selectedCommanderId,
  onSelectCommanderId,
  selectedCommanderRunning,
  selectedCommanderAgentType,
  transcript,
  onAnswer,
  composerSessionName,
  composerEnabled,
  composerSendReady,
  canQueueDraft,
  theme,
  onSetTheme,
  conversations,
  selectedConversationId = null,
  onSelectConversationId = () => {},
  isStreaming = false,
  streamStatus,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  onSend,
  onQueue,
  workspaceSource,
  onStopCommander,
  onCreateConversation,
  requestedNewChatCommanderId = null,
  onStartConversation,
  onStopConversation,
  onRenameConversation,
  onSwapConversationProvider,
  onArchiveConversation,
  onRemoveConversation,
}: MobileCommandRoomProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const commanderParam = searchParams.get('commander')?.trim() || null
  const commanderId = commanderParam === 'global' ? GLOBAL_COMMANDER_ID : commanderParam
  const conversationId = searchParams.get('conversation')?.trim() || null
  const tab = resolveMobileTab(location.pathname)
  const inChat = tab === 'sessions' && commanderId !== null && !isGlobalCommanderId(commanderId)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null)
  const [contextFilePaths, setContextFilePaths] = useState<string[]>([])
  const approvalDecision = useApprovalDecision()
  const surface = searchParams.get('surface')
  const surfaceSearch = surface ? `surface=${encodeURIComponent(surface)}` : ''
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${composerSessionName}`,
    [composerSessionName, workspaceSource],
  )

  useEffect(() => {
    if (!commanderId || commanderId === selectedCommanderId) {
      return
    }
    onSelectCommanderId(commanderId)
  }, [commanderId, onSelectCommanderId, selectedCommanderId])

  useEffect(() => {
    if (location.pathname !== '/command-room' || commanderId !== GLOBAL_COMMANDER_ID) {
      return
    }

    const nextParams = new URLSearchParams()
    const surface = searchParams.get('surface')
    if (surface) {
      nextParams.set('surface', surface)
    }
    nextParams.set('commander', 'global')
    nextParams.set('panel', 'automation')
    const nextSearch = nextParams.toString()
    const currentSearch = location.search.startsWith('?')
      ? location.search.slice(1)
      : location.search
    if (location.pathname === '/command-room' && currentSearch === nextSearch) {
      return
    }

    navigate(`/command-room?${nextSearch}`, { replace: true })
  }, [commanderId, location.pathname, location.search, navigate, searchParams])

  useEffect(() => {
    if (!selectedApprovalId) {
      return
    }
    const stillExists = pendingApprovals.some((approval) => approval.id === selectedApprovalId)
    if (!stillExists) {
      setSelectedApprovalId(null)
      setSheet((current) => (current === 'approval' ? null : current))
    }
  }, [pendingApprovals, selectedApprovalId])

  useEffect(() => {
    setContextFilePaths([])
  }, [workspaceSelectionKey])

  const selectedCommander = commanders.find((commander) => commander.id === selectedCommanderId) ?? commanders[0] ?? null
  const activeCommanderId = commanderId ?? selectedCommander?.id ?? null
  const activeCommander = commanders.find((commander) => commander.id === activeCommanderId) ?? selectedCommander
  const activeCommanderApprovals = useMemo(
    () => activeCommander
      ? pendingApprovals.filter((approval) => approvalMatchesCommander(approval, activeCommander))
      : [],
    [activeCommander, pendingApprovals],
  )
  const hasConversationMode = Array.isArray(conversations)
  const activeCommanderWorkers = useMemo(
    () => activeCommander
      ? workers.filter((worker) => worker.commanderId === activeCommander.id)
      : [],
    [activeCommander, workers],
  )
  const activeCommanderSession = useMemo(
    () => activeCommander
      ? commanderSessions.find((session) => session.id === activeCommander.id) ?? null
      : null,
    [activeCommander, commanderSessions],
  )
  const visibleConversations = useMemo(
    () => orderMobileConversations(
      (conversations ?? []).filter((conversation) => (
        conversation.commanderId === activeCommander?.id
        && conversation.status !== 'archived'
      )),
    ),
    [activeCommander?.id, conversations],
  )
  const visibleConversationsRef = useRef<ConversationRecord[]>(visibleConversations)
  visibleConversationsRef.current = visibleConversations
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId)
  selectedConversationIdRef.current = selectedConversationId
  const activeCommanderIdRef = useRef<string | null>(activeCommander?.id ?? null)
  activeCommanderIdRef.current = activeCommander?.id ?? null
  const locationRef = useRef({ pathname: location.pathname, search: location.search })
  locationRef.current = { pathname: location.pathname, search: location.search }
  const routeInChatRef = useRef(inChat)
  routeInChatRef.current = inChat
  const hasConversationModeRef = useRef(hasConversationMode)
  hasConversationModeRef.current = hasConversationMode
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined)
  const selectedApproval = pendingApprovals.find((approval) => approval.id === selectedApprovalId) ?? null

  useEffect(() => {
    const createdAt = activeCommanderSession?.created
    if (!createdAt) {
      setDurationSec(undefined)
      return
    }

    const createdMs = Date.parse(createdAt)
    if (!Number.isFinite(createdMs)) {
      setDurationSec(undefined)
      return
    }

    const updateDuration = () => {
      setDurationSec(Math.max(0, Math.floor((Date.now() - createdMs) / 1000)))
    }

    updateDuration()
    const interval = window.setInterval(updateDuration, 1000)
    return () => window.clearInterval(interval)
  }, [activeCommanderSession?.created])

  function closeSheets() {
    setSheet(null)
    setSelectedApprovalId(null)
  }

  function navigateTo(pathname: string) {
    navigate(`${pathname}${surfaceSearch ? `?${surfaceSearch}` : ''}`)
  }

  const handleSelectConversationId = useCallback((conversationId: string | null) => {
    if (conversationId !== selectedConversationIdRef.current) {
      onSelectConversationId(conversationId)
    }

    if (!hasConversationModeRef.current || !routeInChatRef.current) {
      return
    }

    const activeCommanderId = activeCommanderIdRef.current
    if (!activeCommanderId) {
      return
    }

    const { pathname, search } = locationRef.current
    const params = new URLSearchParams()
    const surface = searchParams.get('surface')
    if (surface) params.set('surface', surface)
    params.set('commander', activeCommanderId)
    if (conversationId) params.set('conversation', conversationId)
    const nextSearch = params.toString()
    const currentSearch = search.startsWith('?')
      ? search.slice(1)
      : search
    const nextPathname = '/command-room'
    if (pathname === nextPathname && currentSearch === nextSearch) {
      return
    }

    navigate(`${nextPathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true })
  }, [navigate, onSelectConversationId, searchParams])

  useEffect(() => {
    if (!inChat || activeCommander || commanders.length === 0) {
      return
    }
    navigate(
      `/command-room${surfaceSearch ? `?${surfaceSearch}` : ''}`,
      { replace: true },
    )
  }, [activeCommander, commanders, inChat, navigate, surfaceSearch])

  useEffect(() => {
    if (!hasConversationMode) {
      return
    }
    if (!inChat || !activeCommander) {
      return
    }
    if (commanderId && commanderId !== selectedCommanderId) {
      return
    }
    if (requestedNewChatCommanderId === activeCommander.id) {
      if (selectedConversationIdRef.current !== null) {
        handleSelectConversationId(null)
      }
      return
    }

    const currentVisibleConversations = visibleConversationsRef.current

    if (currentVisibleConversations.length === 0) {
      if (selectedConversationIdRef.current !== null) {
        handleSelectConversationId(null)
      }
      return
    }

    const requestedConversationId = conversationId
    const requestedConversation = requestedConversationId
      ? currentVisibleConversations.find((conversation) => conversation.id === requestedConversationId)
      : null
    const nextConversationId = requestedConversation?.id
      ?? currentVisibleConversations.find((conversation) => (
        conversation.status === 'active'
        || (conversation.status as string) === 'running'
      ))?.id
      ?? currentVisibleConversations[0]?.id
      ?? null

    if (nextConversationId !== selectedConversationIdRef.current) {
      handleSelectConversationId(nextConversationId)
    }
  }, [
    activeCommander?.id,
    commanderId,
    conversationId,
    handleSelectConversationId,
    inChat,
    requestedNewChatCommanderId,
    selectedCommanderId,
    hasConversationMode,
  ])

  function openApproval(approvalId: string | null) {
    setSelectedApprovalId(approvalId ?? null)
    setSheet('approval')
  }

  function handleSelectCommander(id: string) {
    onSelectCommanderId(id)
    const params = new URLSearchParams()
    const surface = searchParams.get('surface')
    if (surface) {
      params.set('surface', surface)
    }
    if (id === GLOBAL_COMMANDER_ID) {
      params.set('commander', 'global')
      params.set('panel', 'automation')
      navigate(`/command-room?${params.toString()}`)
      return
    }

    params.set('commander', id)
    const activeConversationId = orderMobileConversations(
      (conversations ?? []).filter((conversation) => (
        conversation.commanderId === id
        && conversation.status !== 'archived'
      )),
    ).find((conversation) => (
      conversation.status === 'active'
      || (conversation.status as string) === 'running'
    ))?.id ?? null
    if (activeConversationId) {
      params.set('conversation', activeConversationId)
    }
    navigate(`/command-room?${params.toString()}`)
  }

  function handleAddContextFilePath(filePath: string) {
    setContextFilePaths((current) => (
      current.includes(filePath) ? current : [...current, filePath]
    ))
  }

  function handleRemoveContextFilePath(filePath: string) {
    setContextFilePaths((current) => current.filter((entry) => entry !== filePath))
  }

  return (
    <section
      className={cn(
        // Viewport containment lives at Shell (overflow-x on <main>); this
        // component is a normal flex-fill route body, not a viewport overlay.
        // overflow-x-hidden kept here as defence-in-depth. See #1107.
        'flex min-h-0 flex-1 w-full flex-col overflow-x-hidden',
        'bg-washi-aged/35',
      )}
      data-testid="mobile-command-room"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'sessions' && inChat && activeCommander ? (
          <MobileChatView
            commander={activeCommander}
            workers={activeCommanderWorkers}
            transcript={transcript}
            approvals={activeCommanderApprovals}
            sessionName={composerSessionName}
            composerEnabled={composerEnabled}
            composerSendReady={composerSendReady}
            canQueueDraft={canQueueDraft}
            conversations={hasConversationMode ? visibleConversations : undefined}
            selectedConversationId={hasConversationMode ? selectedConversationId : undefined}
            isStreaming={isStreaming}
            agentType={activeCommanderSession?.agentType ?? selectedCommanderAgentType}
            wsStatus={streamStatus}
            costUsd={activeCommanderSession?.totalCostUsd}
            durationSec={durationSec}
            theme={theme}
            onSetTheme={onSetTheme}
            queueSnapshot={queueSnapshot}
            queueError={queueError}
            isQueueMutating={isQueueMutating}
            onBack={() => navigate('/org')}
            onOpenTeam={() => setSheet('team')}
            onOpenWorkspace={() => setSheet('workspace')}
            onSelectConversationId={handleSelectConversationId}
            onCreateConversation={activeCommander
              ? (agentType, model) => onCreateConversation?.(activeCommander.id, agentType, model) ?? null
              : undefined}
            onStartConversation={onStartConversation}
            onStopConversation={onStopConversation}
            onRenameConversation={onRenameConversation}
            onSwapConversationProvider={onSwapConversationProvider}
            onArchiveConversation={onArchiveConversation}
            onRemoveConversation={onRemoveConversation}
            onStopCommander={selectedCommanderRunning ? onStopCommander : undefined}
            showCreateConversationPanel={requestedNewChatCommanderId === activeCommander.id}
            onAnswer={onAnswer}
            onApproveApproval={async (approval) => {
              await approvalDecision.mutateAsync({ approval, decision: 'approve' })
            }}
            onDenyApproval={async (approval) => {
              await approvalDecision.mutateAsync({ approval, decision: 'reject' })
            }}
            onClearQueue={onClearQueue}
            onMoveQueuedMessage={onMoveQueuedMessage}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            contextFilePaths={contextFilePaths}
            onRemoveContextFilePath={handleRemoveContextFilePath}
            onClearContextFilePaths={() => setContextFilePaths([])}
            onSend={onSend}
            onQueue={onQueue}
          />
        ) : null}

        {tab === 'sessions' && !inChat ? (
          <MobileSessionsList
            commanders={commanders}
            selectedCommanderId={selectedCommanderId}
            workers={workers}
            approvals={pendingApprovals}
            onSelectCommander={handleSelectCommander}
          />
        ) : null}

        {tab === 'inbox' ? (
          <MobileInbox onOpenApproval={(approvalId) => openApproval(approvalId)} />
        ) : null}

        {tab === 'settings' ? <MobileSettings /> : null}
      </div>

      {/*
        The canonical mobile bottom tab bar is owned by the viewport shell
        so every mobile route in the app receives the same IA. The tab bar self-hides on
        the immersive chat route via the `?commander=` query param.
      */}

      <MobileTeamSheet
        open={sheet === 'team'}
        commander={activeCommander}
        workers={workers}
        approvals={pendingApprovals}
        onOpenApproval={openApproval}
        onClose={closeSheets}
      />

      <MobileApprovalSheet
        approval={selectedApproval}
        onClose={closeSheets}
        onApprove={selectedApproval
          ? async () => {
              await approvalDecision.mutateAsync({ approval: selectedApproval, decision: 'approve' })
            }
          : undefined}
        onDeny={selectedApproval
          ? async () => {
              await approvalDecision.mutateAsync({ approval: selectedApproval, decision: 'reject' })
            }
          : undefined}
      />

      <MobileWorkspaceSheet
        open={sheet === 'workspace'}
        source={workspaceSource}
        onSelectFile={handleAddContextFilePath}
        onClose={closeSheets}
      />
    </section>
  )
}
