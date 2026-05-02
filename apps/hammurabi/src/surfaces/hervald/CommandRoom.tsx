/**
 * Hervald — Command Room Assembly.
 *
 * Three-column layout: SessionsColumn (232px) | CenterColumn (fluid) | TeamColumn (260px).
 * Manages shared state: selected commander, active tab, selected worker, workspace modal.
 *
 * ┌──────────┬────────────────────────────┬───────────┐
 * │ Sessions │       Center Column        │   Team    │
 * │  (232px) │         (1fr)              │  (260px)  │
 * │          │                            │           │
 * │ Cmdrs    │  [Chat][Quests][Sentinels] │  TEAM · N │
 * │ Chats    │  ┌──────────────────────┐  │  workers  │
 * │          │  │  Chat / Placeholder  │  │           │
 * │          │  └──────────────────────┘  │  Detail   │
 * │          │  [Composer]                │           │
 * └──────────┴────────────────────────────┴───────────┘
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  getDebriefStatus,
  killSession,
  resumeSession as resumeAgentSession,
  triggerPreKillDebrief,
  useAgentSessions,
  useMachines,
} from '@/hooks/use-agents'
import { usePendingApprovals } from '@/hooks/use-approvals'
import { useAgentSessionStream } from '@/hooks/use-agent-session-stream'
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  buildCommanderSessionName,
  isOwnedByCommander,
  workerLifecycle,
} from '@gehirn/hammurabi-cli/session-contract'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
import type {
  AgentSession,
  AgentType,
  SessionQueueSnapshot,
} from '@/types'
import { AddWorkerWizard } from '@modules/agents/components/AddWorkerWizard'
import {
  formatError,
  isNotFoundRequestFailure,
  shouldAttemptDebriefOnKill,
} from '@modules/agents/page-shell/session-helpers'
import { supportsQueuedDrafts } from '@modules/agents/queue-capability'
import { runQueueMutationRequest } from '@modules/agents/queue-mutation'
import {
  clearSessionQueue,
  fetchSessionQueueSnapshot,
  queueSessionMessage,
  removeQueuedSessionMessage,
  reorderSessionQueue,
} from '@modules/agents/session-queue-api'
import {
  EMPTY_QUEUE_SNAPSHOT,
  normalizeQueueSnapshot,
} from '@modules/agents/queue-state'
import {
  GLOBAL_COMMANDER_ID,
  isGlobalCommanderId,
  useCommander,
  type CommanderAgentType,
  type CommanderSession,
} from '@modules/commanders/hooks/useCommander'
import {
  useCreateConversation,
  useConversationMessage,
  useConversations,
  useStartConversation,
  useStopConversation,
} from '@modules/conversation/hooks/use-conversations'
import { CreateCommanderWizard } from '@modules/commanders/components/CreateCommanderWizard'
import { SessionsColumn } from './SessionsColumn'
import type { ChatSession } from './SessionsColumn'
import type { Commander, Worker, Approval } from './SessionRow'
import { CenterColumn } from './CenterColumn'
import type { HervaldCommander } from './CenterColumn'
import { TeamColumn } from './TeamColumn'
import { WorkspaceModal } from './WorkspaceModal'
import { getWorkspaceSourceKey, type WorkspaceSource } from '@modules/workspace/use-workspace'
import { mapSessionMessagesToTranscript } from './transcript'
import { MobileCommandRoom } from '@/surfaces/mobile/MobileCommandRoom'

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '232px 1fr 260px',
  minWidth: 1100,
  width: '100%',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
}

const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100%',
  minWidth: '100%',
  overflow: 'hidden',
}

const COMMAND_ROOM_TABS = new Set(['chat', 'quests', 'sentinels', 'cron', 'identity'])
const HERVALD_THEME_STORAGE_KEY = 'hervald-command-room-theme'
type SessionGroup = 'workers' | 'cron' | 'sentinel'
const GLOBAL_COMMANDER_ROW: Commander = {
  id: GLOBAL_COMMANDER_ID,
  name: 'Global',
  status: 'idle',
  description: 'unattached automations',
  iconName: 'globe',
  isVirtual: true,
}

function resolvePanelTab(panel: string | null): string {
  return panel && COMMAND_ROOM_TABS.has(panel) ? panel : 'chat'
}

function readStoredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.localStorage.getItem(HERVALD_THEME_STORAGE_KEY) === 'dark'
    ? 'dark'
    : 'light'
}

function formatQueueError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function resolveWorkspaceSource({
  activeSessionName,
  selectedCommanderId,
}: {
  activeSessionName?: string | null
  selectedCommanderId?: string | null
}): WorkspaceSource | null {
  if (activeSessionName) {
    return {
      kind: 'agent-session',
      sessionName: activeSessionName,
      // Worker sessions can mutate their own workspace concurrently, so the
      // desktop Cmd+K surface stays read-only for this source for now.
      readOnly: true,
    }
  }

  if (selectedCommanderId && !isGlobalCommanderId(selectedCommanderId)) {
    return {
      kind: 'commander',
      commanderId: selectedCommanderId,
      // Commander workspaces are user-owned, so desktop Cmd+K should expose
      // the full edit affordances already implemented by WorkspacePanel.
      readOnly: false,
    }
  }

  return null
}

function resolveSessionGroup(session: {
  name?: unknown
  sessionType?: unknown
}): SessionGroup {
  if (session.sessionType === 'sentinel') {
    return 'sentinel'
  }
  if (session.sessionType === 'cron') {
    return 'cron'
  }
  return 'workers'
}

function formatSessionAge(lastActivityAt: unknown): string | undefined {
  if (typeof lastActivityAt !== 'string') {
    return undefined
  }

  const timestamp = Date.parse(lastActivityAt)
  if (Number.isNaN(timestamp)) {
    return undefined
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMinutes < 60) {
    return `${Math.max(elapsedMinutes, 1)}m`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}h`
  }

  return `${Math.floor(elapsedHours / 24)}d`
}

interface HervaldCommanderSession extends CommanderSession {
  name: string
  status: string
  description?: string
  contextConfig?: {
    fatPinInterval: number
  }
  runtime?: {
    heartbeatCount: number
  }
}

interface HervaldAgentSession extends AgentSession {
  id?: string
  lastActivityAt?: string
}

function mapAgentSessionToChatSession(session: HervaldAgentSession): ChatSession {
  const spawnedBy = typeof session.spawnedBy === 'string'
    ? session.spawnedBy
    : null
  const processAlive = typeof session.processAlive === 'boolean'
    ? session.processAlive
    : undefined
  const sessionName = String(session.name || session.id || '')

  return {
    id: sessionName,
    name: sessionName,
    label: typeof session.label === 'string' ? session.label : undefined,
    created: typeof session.created === 'string' ? session.created : new Date(0).toISOString(),
    pid: typeof session.pid === 'number' ? session.pid : 0,
    age: formatSessionAge(session.lastActivityAt),
    status: typeof session.status === 'string' ? session.status : undefined,
    agentType: typeof session.agentType === 'string' ? session.agentType : undefined,
    sessionType: typeof session.sessionType === 'string' ? session.sessionType : undefined,
    transportType: session.transportType === 'pty' || session.transportType === 'stream'
      ? session.transportType
      : undefined,
    lastActivityAt: typeof session.lastActivityAt === 'string' ? session.lastActivityAt : undefined,
    cwd: typeof session.cwd === 'string' ? session.cwd : undefined,
    host: typeof session.host === 'string' ? session.host : undefined,
    spawnedBy: spawnedBy ?? undefined,
    spawnedWorkers: Array.isArray(session.spawnedWorkers)
      ? session.spawnedWorkers.filter((worker): worker is string => typeof worker === 'string')
      : undefined,
    workerSummary: session.workerSummary,
    processAlive,
    hadResult: typeof session.hadResult === 'boolean' ? session.hadResult : undefined,
    resumedFrom: typeof session.resumedFrom === 'string' ? session.resumedFrom : undefined,
    resumeAvailable: typeof session.resumeAvailable === 'boolean' ? session.resumeAvailable : undefined,
    queuedMessageCount: typeof session.queuedMessageCount === 'number'
      ? session.queuedMessageCount
      : undefined,
    effort: session.effort,
    adaptiveThinking: session.adaptiveThinking,
  }
}

export function CommandRoom() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const commanderState = useCommander()
  const queryClient = useQueryClient()
  const { data: rawAgentSessions = [], refetch: refetchAgentSessions } = useAgentSessions()
  const { data: pendingApprovals = [] } = usePendingApprovals()
  const { data: machines } = useMachines()
  const panelParam = searchParams.get('panel')

  /* ---- Live data ---- */
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(readStoredTheme)
  const [queueSnapshot, setQueueSnapshot] = useState<SessionQueueSnapshot>(EMPTY_QUEUE_SNAPSHOT)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [isQueueMutating, setIsQueueMutating] = useState(false)

  /* ---- Shared state ---- */
  const activeTab = resolvePanelTab(panelParam)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>()
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [contextFilePaths, setContextFilePaths] = useState<string[]>([])
  const [showCreateCommanderForm, setShowCreateCommanderForm] = useState(false)
  const [showAddWorkerForm, setShowAddWorkerForm] = useState(false)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)

  /* ---- Derived ---- */
  const machineList = machines ?? []
  const selectedCommanderId = commanderState.selectedCommanderId ?? ''
  const selectedCommander = commanderState.selectedCommander as HervaldCommanderSession | null
  const isGlobalScope = !selectedChatSessionId && isGlobalCommanderId(selectedCommanderId)
  const agentSessions = rawAgentSessions as HervaldAgentSession[]
  const {
    conversations,
    selectedConversation,
  } = useConversations(
    !selectedCommanderId || isGlobalScope ? null : selectedCommanderId,
    selectedConversationId,
  )
  const createConversation = useCreateConversation()
  const startConversation = useStartConversation()
  const stopConversation = useStopConversation()
  const conversationMessageMutation = useConversationMessage()
  const {
    workers,
    workerSessions,
    cronSessions,
    sentinelSessions,
  } = useMemo(() => {
    const nextWorkers: Worker[] = []
    const nextWorkerSessions: ChatSession[] = []
    const nextCronSessions: ChatSession[] = []
    const nextSentinelSessions: ChatSession[] = []

    for (const session of agentSessions) {
      if (!isRecord(session)) {
        continue
      }

      const spawnedBy = typeof session.spawnedBy === 'string'
        ? session.spawnedBy
        : null
      const creator = typeof session.creator === 'object' && session.creator !== null
        ? session.creator
        : undefined
      const semanticSessionType = typeof session.sessionType === 'string'
        ? session.sessionType
        : null
      const processAlive = typeof session.processAlive === 'boolean'
        ? session.processAlive
        : undefined
      const lifecycle = workerLifecycle({
        status: typeof session.status === 'string' ? session.status : undefined,
        processAlive,
      })
      const sessionName = String(session.name || session.id || '')
      const nextSession = mapAgentSessionToChatSession(session)

      if (creator?.kind === 'commander') {
        nextWorkers.push({
          id: sessionName,
          name: sessionName,
          label: typeof session.label === 'string' ? session.label : semanticSessionType ?? 'worker',
          kind: semanticSessionType ?? 'worker',
          state: lifecycle,
          creator,
          commanderId: creator.id,
          processAlive,
          resumeAvailable: typeof session.resumeAvailable === 'boolean' ? session.resumeAvailable : undefined,
        })
      }

      if (semanticSessionType === 'commander') {
        continue
      }

      const group = resolveSessionGroup(session)
      if (group === 'sentinel') {
        nextSentinelSessions.push(nextSession)
      } else if (group === 'cron') {
        nextCronSessions.push(nextSession)
      } else {
        nextWorkerSessions.push(nextSession)
      }
    }

    return {
      workers: nextWorkers,
      workerSessions: nextWorkerSessions,
      cronSessions: nextCronSessions,
      sentinelSessions: nextSentinelSessions,
    }
  }, [agentSessions])
  const approvals = useMemo(() => pendingApprovals.flatMap((approval) => {
    if (!isRecord(approval)) {
      return []
    }

    const rawWorkerId = typeof approval.raw.workerId === 'string'
      ? approval.raw.workerId
      : null
    const contextWorkerId = approval.context && typeof approval.context.workerId === 'string'
      ? approval.context.workerId
      : null

    return [{
      id: approval.id,
      commanderId: approval.commanderId ?? approval.sessionName ?? '',
      workerId: rawWorkerId ?? contextWorkerId ?? approval.sessionName ?? '',
      action: approval.actionLabel,
    }]
  }) as Approval[], [pendingApprovals])
  const availableSessions = useMemo(
    () => [...workerSessions, ...cronSessions, ...sentinelSessions],
    [cronSessions, sentinelSessions, workerSessions],
  )
  const selectedStandaloneSession = availableSessions.find((session) => session.id === selectedChatSessionId) ?? null
  const selectedConversationSession = selectedConversation?.liveSession
    ? mapAgentSessionToChatSession(selectedConversation.liveSession as HervaldAgentSession)
    : null
  const activeStandaloneSession = activeTab === 'chat' ? selectedStandaloneSession : null
  const activeConversationSession = activeTab === 'chat' ? selectedConversationSession : null
  const activeChatSession = activeStandaloneSession ?? activeConversationSession
  const streamSessionName = activeStandaloneSession?.id
    ?? (activeTab === 'chat' ? selectedConversation?.liveSession?.name : undefined)
    ?? (!selectedConversation && !isGlobalScope && selectedCommanderId
      ? buildCommanderSessionName(selectedCommanderId)
      : undefined)
  const composerSessionName = activeStandaloneSession?.id
    ?? (selectedConversation ? `conversation-${selectedConversation.id}` : streamSessionName ?? 'hervald-command-room')
  const workspaceSource = resolveWorkspaceSource({
    activeSessionName: activeStandaloneSession?.id,
    selectedCommanderId: isGlobalScope ? null : selectedCommanderId,
  })
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${composerSessionName}`,
    [composerSessionName, workspaceSource],
  )
  const commanderSessionRunning = selectedCommander?.state === 'running'
  const activeChatIsStream = activeChatSession ? activeChatSession.transportType !== 'pty' : true
  const selectedConversationRunning = activeStandaloneSession
    ? activeChatIsStream && activeStandaloneSession.processAlive !== false
    : selectedConversationSession
      ? selectedConversationSession.transportType !== 'pty' && selectedConversationSession.processAlive !== false
    : commanderSessionRunning
  const selectedConversationAgentType = activeStandaloneSession?.agentType
    ?? selectedConversationSession?.agentType
    ?? selectedCommander?.agentType
  const canQueueDraft = selectedConversation
    ? Boolean(selectedConversationSession?.transportType !== 'pty')
        && supportsQueuedDrafts(selectedConversationAgentType)
    : activeChatIsStream && supportsQueuedDrafts(selectedConversationAgentType)
  const showCommanderRuntimeControls = !activeStandaloneSession && !selectedConversation
  const {
    messages: sessionMessages,
    sendInput,
    answerQuestion,
    isStreaming,
    status: streamStatus,
  } = useAgentSessionStream(streamSessionName, {
    enabled: selectedConversationRunning,
    onQueueUpdate: setQueueSnapshot,
  })
  const composerEnabled = isGlobalScope
    ? false
    : activeStandaloneSession
      ? streamStatus === 'connected' && activeChatIsStream && activeStandaloneSession.processAlive !== false
      : selectedConversation
        ? selectedConversation.status !== 'archived'
        : streamStatus === 'connected' && commanderSessionRunning
  const composerSendReady = selectedConversation ? true : streamStatus === 'connected'
  const transcript = mapSessionMessagesToTranscript(sessionMessages)
  const sessionCommanders: Commander[] = useMemo(() => [
    GLOBAL_COMMANDER_ROW,
    ...commanderState.commanders.map((commander) => ({
      id: commander.id,
      name: commander.displayName?.trim() || commander.host,
      // Preserve the raw identity fields so <AgentAvatar /> can derive the
      // initial-letter fallback from the same source the row title uses.
      displayName: commander.displayName,
      host: commander.host,
      status: commander.state,
      description: commander.persona?.trim() || commander.currentTask?.title,
      // Wire the backend-supplied UI identity (ui.accentColor + avatarUrl)
      // so every surface that renders a Commander gets the correct avatar.
      avatarUrl: commander.avatarUrl ?? null,
      ui: commander.ui ?? null,
    })),
  ], [commanderState.commanders])
  const mobileCommanders = useMemo(
    () => sessionCommanders.filter((commander) => !commander.isVirtual),
    [sessionCommanders],
  )
  const selectedCommanderRunning = selectedCommander?.state === 'running'
  const handleActiveTabChange = useCallback((nextTab: string) => {
    const resolvedTab = resolvePanelTab(nextTab)
    const desiredPanel = resolvedTab === 'chat' ? null : resolvedTab
    if (panelParam === desiredPanel) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    if (desiredPanel) {
      nextParams.set('panel', desiredPanel)
    } else {
      nextParams.delete('panel')
    }
    setSearchParams(nextParams, { replace: true })
  }, [panelParam, searchParams, setSearchParams])

  const refreshSessions = useCallback(async () => {
    await refetchAgentSessions()
  }, [refetchAgentSessions])

  const handleAddContextFilePath = useCallback((filePath: string) => {
    setContextFilePaths((current) => (
      current.includes(filePath) ? current : [...current, filePath]
    ))
  }, [])

  const handleRemoveContextFilePath = useCallback((filePath: string) => {
    setContextFilePaths((current) => current.filter((entry) => entry !== filePath))
  }, [])

  const handleClearContextFilePaths = useCallback(() => {
    setContextFilePaths([])
  }, [])

  useEffect(() => {
    if (isGlobalScope && activeTab !== 'cron') {
      handleActiveTabChange('cron')
    }
  }, [activeTab, handleActiveTabChange, isGlobalScope])

  useEffect(() => {
    window.localStorage.setItem(HERVALD_THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    setContextFilePaths([])
  }, [workspaceSelectionKey])

  useEffect(() => {
    if (selectedChatSessionId && !availableSessions.some((session) => session.id === selectedChatSessionId)) {
      setSelectedChatSessionId(null)
    }
  }, [availableSessions, selectedChatSessionId])

  useEffect(() => {
    if (!selectedCommanderId || isGlobalCommanderId(selectedCommanderId)) {
      if (selectedConversationId !== null) {
        setSelectedConversationId(null)
      }
      return
    }

    if (
      selectedConversationId &&
      !conversations.some((conversation) => conversation.id === selectedConversationId)
    ) {
      setSelectedConversationId(null)
    }
  }, [conversations, selectedCommanderId, selectedConversationId])

  /* ---- Workspace modal keyboard shortcut ---- */
  const handleWorkspaceKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && workspaceSource) {
        e.preventDefault()
        setWorkspaceOpen((prev) => !prev)
      }
    },
    [workspaceSource],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleWorkspaceKey)
    return () => document.removeEventListener('keydown', handleWorkspaceKey)
  }, [handleWorkspaceKey])

  const handleKillSession = useCallback(async (
    sessionName: string,
    agentType?: AgentType,
    selectedSessionType?: SessionType,
  ) => {
    setSessionActionError(null)

    try {
      const isStream = selectedSessionType === 'stream'
      const shouldDebrief = isStream && shouldAttemptDebriefOnKill(agentType)

      if (shouldDebrief) {
        try {
          const preResp = await triggerPreKillDebrief(sessionName)
          if (preResp.debriefStarted && preResp.timeoutMs) {
            const deadline = Date.now() + preResp.timeoutMs
            const pollIntervalMs = 2000
            while (Date.now() < deadline) {
              const { status } = await getDebriefStatus(sessionName)
              if (status === 'completed' || status === 'timed-out') {
                break
              }
              await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
            }
          }
        } catch (caughtError) {
          if (!isNotFoundRequestFailure(caughtError)) {
            throw caughtError
          }
        }
      }

      await killSession(sessionName)
      setSelectedChatSessionId((current) => (current === sessionName ? null : current))
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to kill session')
      setSessionActionError(message)
      throw caughtError
    }
  }, [refreshSessions])

  const handleResumeSession = useCallback(async (sessionName: string) => {
    setSessionActionError(null)

    try {
      const resumed = await resumeAgentSession(sessionName)
      setSelectedChatSessionId(resumed.name)
      handleActiveTabChange('chat')
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to resume session')
      setSessionActionError(message)
      throw caughtError
    }
  }, [handleActiveTabChange, refreshSessions])

  const handleDismissWorker = useCallback(async (worker: Worker) => {
    setSessionActionError(null)

    try {
      await killSession(worker.name)
      setSelectedWorkerId((current) => (current === worker.id ? undefined : current))
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to dismiss worker')
      setSessionActionError(message)
      throw caughtError
    }
  }, [refreshSessions])

  const fetchQueueSnapshot = useCallback(async (): Promise<SessionQueueSnapshot> => {
    if (!streamSessionName) {
      return EMPTY_QUEUE_SNAPSHOT
    }

    const nextQueue = await fetchSessionQueueSnapshot(streamSessionName)
    return normalizeQueueSnapshot(nextQueue)
  }, [streamSessionName])

  const refreshQueueSnapshot = useCallback(async (): Promise<void> => {
    if (!streamSessionName || !canQueueDraft || !selectedConversationRunning) {
      setQueueSnapshot(EMPTY_QUEUE_SNAPSHOT)
      return
    }

    setQueueSnapshot(await fetchQueueSnapshot())
  }, [canQueueDraft, fetchQueueSnapshot, selectedConversationRunning, streamSessionName])

  useEffect(() => {
    let cancelled = false
    setQueueError(null)

    if (!streamSessionName || !canQueueDraft || !selectedConversationRunning) {
      setQueueSnapshot(EMPTY_QUEUE_SNAPSHOT)
      return
    }

    void (async () => {
      try {
        const nextQueue = await fetchQueueSnapshot()
        if (!cancelled) {
          setQueueSnapshot(nextQueue)
        }
      } catch {
        if (!cancelled) {
          setQueueSnapshot(EMPTY_QUEUE_SNAPSHOT)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [canQueueDraft, fetchQueueSnapshot, selectedConversationRunning, streamSessionName])

  /* ---- Build CenterColumn commander shape ---- */
  const centerCommander: HervaldCommander = activeStandaloneSession
    ? {
        id: '',
        name: activeStandaloneSession.label ?? activeStandaloneSession.name,
        status: activeStandaloneSession.status ?? 'active',
        description: activeStandaloneSession.transportType === 'pty'
          ? 'interactive terminal session'
          : 'standalone chat session',
        agentType: activeStandaloneSession.agentType,
      }
    : isGlobalScope
      ? {
          id: '',
          name: 'Global',
          status: 'idle',
          description: 'unattached automations',
        }
    : selectedCommander
      ? {
          ...selectedCommander,
          id: selectedCommander.id,
          name: selectedCommander.displayName?.trim() || selectedCommander.host,
          status: selectedConversation?.status ?? selectedCommander.state,
          description: selectedConversation?.currentTask?.title
            ?? selectedCommander.persona?.trim()
            ?? selectedCommander.currentTask?.title,
          cost: selectedConversation?.totalCostUsd ?? selectedCommander.totalCostUsd,
          agentType: selectedConversationSession?.agentType ?? selectedCommander.agentType,
        }
      : { id: '', name: 'No commander', status: 'offline' }

  /* ---- Workers for the selected commander ---- */
  const commanderWorkers = workers.filter(
    (worker) => isOwnedByCommander(worker, selectedCommanderId),
  )
  const commanderApprovals = approvals.filter(
    (a) => a.commanderId === selectedCommanderId,
  )
  const teamCommander = activeStandaloneSession
    ? {
        id: '',
        name: activeStandaloneSession.name,
        status: activeStandaloneSession.status ?? 'active',
      }
    : {
        id: centerCommander.id,
        name: centerCommander.name,
        status: centerCommander.status,
      }
  const teamWorkers = activeStandaloneSession ? [] : commanderWorkers
  const teamApprovals = activeStandaloneSession ? [] : commanderApprovals

  const submitConversationMessage = useCallback(async ({
    message,
    queue = false,
  }: {
    message: string
    queue?: boolean
  }): Promise<boolean> => {
    if (!selectedConversation) {
      return false
    }

    setSessionActionError(null)

    try {
      const response = await conversationMessageMutation.mutateAsync({
        conversationId: selectedConversation.id,
        message,
        queue,
      })
      return response.accepted
    } catch (caughtError) {
      setSessionActionError(
        formatError(
          caughtError,
          queue ? 'Failed to queue conversation message' : 'Failed to send conversation message',
        ),
      )
      return false
    }
  }, [conversationMessageMutation, selectedConversation])

  const applyQueueMutation = useCallback(async (
    request: () => Promise<unknown>,
    mutationErrorFallback: string,
    refreshErrorFallback: string,
  ): Promise<boolean> => {
    if (!streamSessionName || !canQueueDraft) {
      return false
    }

    setIsQueueMutating(true)
    setQueueError(null)

    try {
      return await runQueueMutationRequest(request, refreshQueueSnapshot, {
        onMutationError: (error) => {
          setQueueError(formatQueueError(error, mutationErrorFallback))
        },
        onRefreshError: (error) => {
          setQueueError(formatQueueError(error, refreshErrorFallback))
        },
      })
    } finally {
      setIsQueueMutating(false)
    }
  }, [canQueueDraft, refreshQueueSnapshot, streamSessionName])

  const handleSend = useCallback(async ({ text, images }: { text: string; images?: { mediaType: string; data: string }[] }) => {
    const trimmed = text.trim()
    const attachedImages = images && images.length > 0 ? images : undefined

    if (selectedConversation) {
      if (attachedImages?.length) {
        if (!streamSessionName) {
          setSessionActionError('Start or resume the conversation before sending images.')
          return false
        }
        return sendInput({ text: trimmed, images: attachedImages })
      }

      if (!trimmed) {
        return false
      }

      return submitConversationMessage({ message: trimmed })
    }

    if (!streamSessionName) {
      return false
    }

    if (!activeChatSession && !selectedCommanderId) {
      return false
    }

    if (!activeChatSession && !commanderSessionRunning) {
      return false
    }

    return sendInput({ text: trimmed, images: attachedImages })
  }, [
    commanderSessionRunning,
    activeChatSession,
    selectedConversation,
    selectedCommanderId,
    streamSessionName,
    sendInput,
    submitConversationMessage,
  ])

  const handleQueue = useCallback(async ({ text, images }: { text: string; images?: { mediaType: string; data: string }[] }) => {
    const trimmed = text.trim()
    const queuedImages = images && images.length > 0 ? images : undefined
    if (!trimmed && !queuedImages) {
      return
    }

    if (selectedConversation) {
      if (queuedImages?.length) {
        if (!streamSessionName) {
          setSessionActionError('Start or resume the conversation before queueing images.')
          return
        }
        await applyQueueMutation(
          () => queueSessionMessage(streamSessionName, {
            text: trimmed,
            images: queuedImages,
          }),
          'Failed to queue message',
          'Queue updated, but failed to refresh queue',
        )
        return
      }

      if (!trimmed) {
        return
      }

      await submitConversationMessage({ message: trimmed, queue: true })
      return
    }

    if (!streamSessionName) {
      return
    }

    if (!activeChatSession && !selectedCommanderId) {
      return
    }

    if (!activeChatSession && !commanderSessionRunning) {
      return
    }

    await applyQueueMutation(
      () => queueSessionMessage(streamSessionName, {
        text: trimmed,
        images: queuedImages,
      }),
      'Failed to queue message',
      'Queue updated, but failed to refresh queue',
    )
  }, [
    applyQueueMutation,
    commanderSessionRunning,
    activeChatSession,
    selectedConversation,
    selectedCommanderId,
    streamSessionName,
    submitConversationMessage,
  ])

  const handleStartCommander = useCallback(async (agentType?: CommanderAgentType) => {
    if (!selectedCommanderId || isGlobalScope) {
      return
    }

    await commanderState.startCommander(
      selectedCommanderId,
      agentType ?? selectedCommander?.agentType ?? 'claude',
    )
  }, [commanderState, isGlobalScope, selectedCommander?.agentType, selectedCommanderId])

  const handleStopCommander = useCallback(async () => {
    if (!selectedCommanderId || isGlobalScope) {
      return
    }

    await commanderState.stopCommander(selectedCommanderId)
  }, [commanderState, isGlobalScope, selectedCommanderId])

  const handleMoveQueuedMessage = useCallback(async (messageId: string, offset: number) => {
    if (!streamSessionName || !canQueueDraft) {
      return
    }

    const currentIndex = queueSnapshot.items.findIndex((message) => message.id === messageId)
    const nextIndex = currentIndex + offset
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= queueSnapshot.items.length) {
      return
    }

    const reordered = [...queueSnapshot.items]
    const [moved] = reordered.splice(currentIndex, 1)
    if (!moved) {
      return
    }
    reordered.splice(nextIndex, 0, moved)

    await applyQueueMutation(
      () => reorderSessionQueue(streamSessionName, reordered.map((message) => message.id)),
      'Failed to reorder queued messages',
      'Queue reordered, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, queueSnapshot.items, streamSessionName])

  const handleRemoveQueuedMessage = useCallback(async (messageId: string) => {
    if (!streamSessionName || !canQueueDraft) {
      return
    }

    await applyQueueMutation(
      () => removeQueuedSessionMessage(streamSessionName, messageId),
      'Failed to remove queued message',
      'Queue updated, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, streamSessionName])

  const handleClearQueue = useCallback(async () => {
    if (!streamSessionName || !canQueueDraft) {
      return
    }

    await applyQueueMutation(
      () => clearSessionQueue(streamSessionName),
      'Failed to clear queued messages',
      'Queue cleared, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, streamSessionName])

  const handleOpenAddWorker = useCallback(() => {
    setShowAddWorkerForm(true)
  }, [])

  const handleCreateChatForCommander = useCallback(async (commanderId: string) => {
    setSessionActionError(null)

    try {
      const created = await createConversation.mutateAsync({
        commanderId,
        surface: 'ui',
      })
      setSelectedConversationId(created.id)
      setSelectedChatSessionId(null)
      handleActiveTabChange('chat')
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to create chat'))
    }
  }, [createConversation, handleActiveTabChange])

  const handleStartConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    const conversation = conversations.find((entry) => entry.id === conversationId)
    const persistedAgentType = conversation?.agentType
    const targetAgentType: AgentType = (persistedAgentType ?? selectedCommander?.agentType ?? 'claude') as AgentType

    try {
      const started = await startConversation.mutateAsync({
        conversationId,
        agentType: targetAgentType,
      })
      setSelectedConversationId(started.id)
      setSelectedChatSessionId(null)
      handleActiveTabChange('chat')
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to start conversation'))
    }
  }, [conversations, handleActiveTabChange, selectedCommander?.agentType, startConversation])

  const handleStopConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    try {
      await stopConversation.mutateAsync({ conversationId })
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to stop conversation'))
      throw error
    }
  }, [stopConversation])

  const handleOpenCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(true)
  }, [])

  const handleCloseAddWorker = useCallback(() => {
    setShowAddWorkerForm(false)
  }, [])

  const handleCloseCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(false)
  }, [])

  const handleCreateCommander = useCallback(async (
    input: Parameters<typeof commanderState.createCommander>[0],
  ) => {
    const createdCommander = await commanderState.createCommander(input)
    setSelectedChatSessionId(null)
    setSelectedConversationId(null)
    commanderState.setSelectedCommanderId(createdCommander.id)
  }, [commanderState])

  if (isMobile) {
    return (
      <MobileCommandRoom
        commanders={mobileCommanders}
        commanderSessions={commanderState.commanders}
        workers={workers}
        pendingApprovals={pendingApprovals}
        selectedCommanderId={selectedCommanderId || null}
        onSelectCommanderId={(id) => {
          setSelectedChatSessionId(null)
          setSelectedConversationId(null)
          commanderState.setSelectedCommanderId(id)
        }}
        selectedCommanderRunning={selectedCommanderRunning}
        selectedCommanderAgentType={selectedCommander?.agentType}
        transcript={transcript}
        onAnswer={(toolId, answers) => {
          answerQuestion(toolId, answers)
        }}
        composerSessionName={composerSessionName}
        composerEnabled={composerEnabled}
        composerSendReady={composerSendReady}
        canQueueDraft={canQueueDraft}
        isStreaming={isStreaming}
        streamStatus={streamStatus}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        onClearQueue={() => { void handleClearQueue() }}
        onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
        onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
        onQueue={handleQueue}
        onSend={handleSend}
        workspaceSource={workspaceSource}
        onStartCommander={showCommanderRuntimeControls ? (agentType) => { void handleStartCommander(agentType) } : undefined}
        onStopCommander={showCommanderRuntimeControls ? () => { void handleStopCommander() } : undefined}
        crons={commanderState.crons}
        cronsLoading={commanderState.cronsLoading}
        cronsError={commanderState.cronsError}
        addCron={commanderState.addCron}
        addCronPending={commanderState.addCronPending}
        toggleCron={commanderState.toggleCron}
        toggleCronPending={commanderState.toggleCronPending}
        toggleCronId={commanderState.toggleCronId}
        updateCron={commanderState.updateCron}
        updateCronPending={commanderState.updateCronPending}
        updateCronId={commanderState.updateCronId}
        triggerCron={commanderState.triggerCron}
        triggerCronPending={commanderState.triggerCronPending}
        triggerCronId={commanderState.triggerCronId}
        deleteCron={commanderState.deleteCron}
        deleteCronPending={commanderState.deleteCronPending}
        deleteCronId={commanderState.deleteCronId}
      />
    )
  }

  return (
    <div
      data-testid="command-room-shell"
      className={theme === 'dark' ? 'hv-dark' : 'hv-light'}
      style={shellStyle}
    >
      <div style={gridStyle}>
        <SessionsColumn
          selectedCommanderId={selectedCommanderId}
          onSelectCommander={(id) => {
            setSelectedChatSessionId(null)
            setSelectedConversationId(null)
            commanderState.setSelectedCommanderId(id)
            if (id === GLOBAL_COMMANDER_ID) {
              handleActiveTabChange('cron')
            }
          }}
          onCreateCommander={handleOpenCreateCommander}
          onCreateWorker={handleOpenAddWorker}
          onCreateSession={() => undefined}
          onCreateChatForCommander={handleCreateChatForCommander}
          selectedChatId={selectedStandaloneSession?.id ?? selectedConversation?.id ?? null}
          onSelectChat={(id) => {
            setSelectedChatSessionId(id)
            handleActiveTabChange('chat')
          }}
          onSelectConversation={(id) => {
            setSelectedConversationId(id)
            setSelectedChatSessionId(null)
            handleActiveTabChange('chat')
          }}
          onStartConversation={handleStartConversation}
          onStopConversation={handleStopConversation}
          commanders={sessionCommanders}
          conversations={conversations}
          workers={workers}
          approvals={approvals}
          workerSessions={workerSessions}
          cronSessions={cronSessions}
          sentinelSessions={sentinelSessions}
          onKillSession={handleKillSession}
          onResumeSession={handleResumeSession}
          sessionActionError={sessionActionError}
        />

        <CenterColumn
          commander={centerCommander}
          isGlobalScope={isGlobalScope}
          hasSelectedConversation={Boolean(selectedConversation)}
          activeChatSession={activeChatSession}
          transcript={transcript}
          workers={commanderWorkers.map((w) => ({
            id: w.id,
            name: w.name,
            state: w.state || 'idle',
          }))}
          activeTab={activeTab}
          setActiveTab={handleActiveTabChange}
          crons={commanderState.crons}
          cronsLoading={commanderState.cronsLoading}
          cronsError={commanderState.cronsError}
          addCron={commanderState.addCron}
          addCronPending={commanderState.addCronPending}
          toggleCron={commanderState.toggleCron}
          toggleCronPending={commanderState.toggleCronPending}
          toggleCronId={commanderState.toggleCronId}
          updateCron={commanderState.updateCron}
          updateCronPending={commanderState.updateCronPending}
          updateCronId={commanderState.updateCronId}
          triggerCron={commanderState.triggerCron}
          triggerCronPending={commanderState.triggerCronPending}
          triggerCronId={commanderState.triggerCronId}
          deleteCron={commanderState.deleteCron}
          deleteCronPending={commanderState.deleteCronPending}
          deleteCronId={commanderState.deleteCronId}
          onCloseActiveChat={() => setSelectedChatSessionId(null)}
          onKillSession={(sessionName, agentType) =>
            handleKillSession(sessionName, agentType, activeChatSession?.transportType)
          }
          onOpenWorkspace={workspaceSource ? () => setWorkspaceOpen(true) : undefined}
          onStartCommander={showCommanderRuntimeControls ? (agentType) => { void handleStartCommander(agentType) } : undefined}
          onStopCommander={showCommanderRuntimeControls ? () => { void handleStopCommander() } : undefined}
          onAnswer={(toolId, answers) => {
            answerQuestion(toolId, answers)
          }}
          composerSessionName={composerSessionName}
          composerEnabled={composerEnabled}
          composerSendReady={composerSendReady}
          canQueueDraft={canQueueDraft}
          contextFilePaths={contextFilePaths}
          onRemoveContextFilePath={handleRemoveContextFilePath}
          onClearContextFilePaths={handleClearContextFilePaths}
          onQueue={(payload) => { void handleQueue(payload) }}
          onSend={(payload) => { void handleSend(payload) }}
          queueSnapshot={queueSnapshot}
          queueError={queueError}
          isQueueMutating={isQueueMutating}
          onClearQueue={() => { void handleClearQueue() }}
          onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
          onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
          theme={theme}
          onSetTheme={setTheme}
        />

        <TeamColumn
          commander={teamCommander}
          workers={teamWorkers}
          approvals={teamApprovals.map((a) => ({
            id: a.id,
            commanderId: a.commanderId || '',
            workerId: a.workerId || '',
            action: a.action || '',
          }))}
          selectedWorkerId={activeStandaloneSession ? undefined : selectedWorkerId}
          onSelectWorker={setSelectedWorkerId}
          onOpenWorkspace={workspaceSource ? () => setWorkspaceOpen(true) : () => undefined}
          onDismissWorker={(worker) => { void handleDismissWorker(worker) }}
        />
      </div>

      <WorkspaceModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        source={workspaceSource}
        onInsertPath={handleAddContextFilePath}
      />
      <ModalFormContainer
        open={showCreateCommanderForm}
        title="New Commander"
        onClose={handleCloseCreateCommander}
      >
        <CreateCommanderWizard
          onAdd={handleCreateCommander}
          isPending={commanderState.createCommanderPending}
          onClose={handleCloseCreateCommander}
          onWizardCreated={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['commanders', 'sessions'] }),
              queryClient.invalidateQueries({ queryKey: ['agents', 'sessions'] }),
            ])
          }}
        />
      </ModalFormContainer>
      <ModalFormContainer
        open={showAddWorkerForm}
        title="Add Worker"
        onClose={handleCloseAddWorker}
      >
        <AddWorkerWizard
          onCreated={async () => {
            handleCloseAddWorker()
          }}
        />
      </ModalFormContainer>
    </div>
  )
}
