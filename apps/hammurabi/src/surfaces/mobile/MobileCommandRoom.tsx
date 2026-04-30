import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApprovalDecision, type PendingApproval } from '@/hooks/use-approvals'
import { cn } from '@/lib/utils'
import type { AgentType, SessionQueueSnapshot } from '@/types'
import {
  getWorkspaceSourceKey,
  type WorkspaceSource,
} from '@modules/workspace/use-workspace'
import type { SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import type { CommanderAgentType, CommanderSession } from '@modules/commanders/hooks/useCommander'
import type { CenterColumnProps } from '@/surfaces/hervald/CenterColumn'
import type { Commander, Worker } from '@/surfaces/hervald/SessionRow'
import { MobileApprovalSheet } from './MobileApprovalSheet'
import { MobileAutomations } from './MobileAutomations'
import { MobileChatView } from './MobileChatView'
import { MobileInbox } from './MobileInbox'
import { MobileSessionsList } from './MobileSessionsList'
import { MobileSettings } from './MobileSettings'
import { MobileTeamSheet } from './MobileTeamSheet'
import { MobileWorkspaceSheet } from './MobileWorkspaceSheet'
import { buildSearchWithSurface, parseMobileRoute } from './route'

type SheetKind = 'team' | 'approval' | 'workspace' | null

function approvalMatchesCommander(approval: PendingApproval, commander: Commander): boolean {
  return approval.commanderId === commander.id || approval.commanderName === commander.name
}

type MobileCommandRoomPanelProps = Pick<
  CenterColumnProps,
  | 'crons'
  | 'cronsLoading'
  | 'cronsError'
  | 'addCron'
  | 'addCronPending'
  | 'toggleCron'
  | 'toggleCronPending'
  | 'toggleCronId'
  | 'updateCron'
  | 'updateCronPending'
  | 'updateCronId'
  | 'triggerCron'
  | 'triggerCronPending'
  | 'triggerCronId'
  | 'deleteCron'
  | 'deleteCronPending'
  | 'deleteCronId'
>

export interface MobileCommandRoomProps extends MobileCommandRoomPanelProps {
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
  onStartCommander?: (agentType: CommanderAgentType) => void
  onStopCommander?: () => void
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
  onStartCommander,
  onStopCommander,
  ...automationProps
}: MobileCommandRoomProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const route = useMemo(() => parseMobileRoute(location.pathname), [location.pathname])
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null)
  const [contextFilePaths, setContextFilePaths] = useState<string[]>([])
  const approvalDecision = useApprovalDecision()
  const surfaceSearch = useMemo(() => buildSearchWithSurface(location.search), [location.search])
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${composerSessionName}`,
    [composerSessionName, workspaceSource],
  )

  useEffect(() => {
    if (!route.redirectTo) {
      return
    }
    navigate(`${route.redirectTo}${surfaceSearch ? `?${surfaceSearch}` : ''}`, { replace: true })
  }, [navigate, route.redirectTo, surfaceSearch])

  useEffect(() => {
    if (!route.commanderId || route.commanderId === selectedCommanderId) {
      return
    }
    onSelectCommanderId(route.commanderId)
  }, [onSelectCommanderId, route.commanderId, selectedCommanderId])

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
  const activeCommanderId = route.commanderId ?? selectedCommander?.id ?? null
  const activeCommander = commanders.find((commander) => commander.id === activeCommanderId) ?? selectedCommander
  const activeCommanderApprovals = useMemo(
    () => activeCommander
      ? pendingApprovals.filter((approval) => approvalMatchesCommander(approval, activeCommander))
      : [],
    [activeCommander, pendingApprovals],
  )
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

  useEffect(() => {
    if (!route.inChat || activeCommander || commanders.length === 0) {
      return
    }
    navigate(
      `/command-room/sessions/${encodeURIComponent(commanders[0].id)}${surfaceSearch ? `?${surfaceSearch}` : ''}`,
      { replace: true },
    )
  }, [activeCommander, commanders, navigate, route.inChat, surfaceSearch])

  function openApproval(approvalId: string | null) {
    setSelectedApprovalId(approvalId ?? null)
    setSheet('approval')
  }

  function handleSelectCommander(id: string) {
    onSelectCommanderId(id)
    navigateTo(`/command-room/sessions/${encodeURIComponent(id)}`)
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
        {route.tab === 'sessions' && route.inChat && activeCommander ? (
          <MobileChatView
            commander={activeCommander}
            workers={activeCommanderWorkers}
            transcript={transcript}
            approvals={activeCommanderApprovals}
            sessionName={composerSessionName}
            composerEnabled={composerEnabled}
            composerSendReady={composerSendReady}
            canQueueDraft={canQueueDraft}
            isStreaming={isStreaming}
            agentType={activeCommanderSession?.agentType ?? selectedCommanderAgentType}
            startAgentType={selectedCommanderAgentType ?? activeCommanderSession?.agentType}
            wsStatus={streamStatus}
            costUsd={activeCommanderSession?.totalCostUsd}
            durationSec={durationSec}
            queueSnapshot={queueSnapshot}
            queueError={queueError}
            isQueueMutating={isQueueMutating}
            onBack={() => navigateTo('/command-room/sessions')}
            onOpenTeam={() => setSheet('team')}
            onOpenWorkspace={() => setSheet('workspace')}
            onStartCommander={selectedCommanderRunning ? undefined : onStartCommander}
            onStopCommander={selectedCommanderRunning ? onStopCommander : undefined}
            onAnswer={onAnswer}
            onApproveApproval={(approval) => approvalDecision.mutateAsync({ approval, decision: 'approve' })}
            onDenyApproval={(approval) => approvalDecision.mutateAsync({ approval, decision: 'reject' })}
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

        {route.tab === 'sessions' && !route.inChat ? (
          <MobileSessionsList
            commanders={commanders}
            selectedCommanderId={selectedCommanderId}
            workers={workers}
            approvals={pendingApprovals}
            onSelectCommander={handleSelectCommander}
          />
        ) : null}

        {route.tab === 'automations' ? (
          <MobileAutomations
            commanders={commanderSessions}
            selectedCommanderId={selectedCommanderId}
            onSelectCommanderId={onSelectCommanderId}
            {...automationProps}
          />
        ) : null}

        {route.tab === 'inbox' ? (
          <MobileInbox onOpenApproval={(approvalId) => openApproval(approvalId)} />
        ) : null}

        {route.tab === 'settings' ? <MobileSettings /> : null}
      </div>

      {/*
        The canonical mobile bottom tab bar is owned by `src/surfaces/hervald/Shell.tsx`
        so every mobile route in the app receives the same IA. The tab bar self-hides on
        the immersive chat route via `parseMobileRoute(...).inChat`.
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
          ? () => approvalDecision.mutateAsync({ approval: selectedApproval, decision: 'approve' })
          : undefined}
        onDeny={selectedApproval
          ? () => approvalDecision.mutateAsync({ approval: selectedApproval, decision: 'reject' })
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
