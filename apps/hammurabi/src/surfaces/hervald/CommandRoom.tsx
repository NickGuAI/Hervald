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
 * │ Cmdrs    │  [Chat][Quests][Automations] │ TEAM · N │
 * │ Chats    │  ┌──────────────────────┐  │  workers  │
 * │          │  │  Chat / Placeholder  │  │           │
 * │          │  └──────────────────────┘  │  Detail   │
 * │          │  [Composer]                │           │
 * └──────────┴────────────────────────────┴───────────┘
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  createSession,
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
import { createHttpConversationDispatcher } from '@/hooks/send-dispatcher'
import { useTheme } from '@/lib/theme-context'
import {
  isOwnedByCommander,
  workerLifecycle,
} from '@gehirn/hammurabi-cli/session-contract'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'
import type {
  AgentSession,
  AgentType,
  SessionQueueSnapshot,
  SessionTransportType,
} from '@/types'
import { AddWorkerWizard } from '@modules/agents/components/AddWorkerWizard'
import { NewSessionForm } from '@modules/agents/components/NewSessionForm'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '@modules/claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '@modules/claude-effort.js'
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
  type CommanderSession,
} from '@modules/commanders/hooks/useCommander'
import {
  ACTIVE_CONVERSATION_FETCH_STALE_MS,
  commanderActiveConversationQueryKey,
  fetchCommanderActiveConversation,
  useCreateConversation,
  useDeleteConversation,
  useConversationMessage,
  useConversations,
  useStartConversation,
  useStopConversation,
  useUpdateConversation,
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

const COMMAND_ROOM_TABS = new Set(['chat', 'quests', 'automation', 'identity'])
type SessionGroup = 'workers' | 'automation'
const GLOBAL_COMMANDER_ROW: Commander = {
  id: GLOBAL_COMMANDER_ID,
  name: 'Global',
  status: 'idle',
  description: 'unattached automations',
  iconName: 'globe',
  isVirtual: true,
}

function resolvePanelTab(panel: string | null): string {
  if (panel === 'cron' || panel === 'sentinels' || panel === 'automation') {
    return 'automation'
  }

  return panel && COMMAND_ROOM_TABS.has(panel) ? panel : 'chat'
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
  if (session.sessionType === 'sentinel' || session.sessionType === 'cron') {
    return 'automation'
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

function isConversationScopedSession(
  session: HervaldAgentSession | null | undefined,
  conversationId: string,
): session is HervaldAgentSession {
  const sessionName = typeof session?.name === 'string'
    ? session.name
    : typeof session?.id === 'string'
      ? session.id
      : ''
  return sessionName.includes(`-conversation-${conversationId}`)
}

export function CommandRoom() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const commanderState = useCommander()
  const queryClient = useQueryClient()
  const { theme, setTheme } = useTheme()
  const { data: rawAgentSessions = [], refetch: refetchAgentSessions } = useAgentSessions()
  const { data: pendingApprovals = [] } = usePendingApprovals()
  const { data: machines } = useMachines()
  const panelParam = searchParams.get('panel')
  const commanderParam = searchParams.get('commander')
  const normalizedCommanderParam = commanderParam === 'global' ? GLOBAL_COMMANDER_ID : commanderParam
  const normalizedConversationParam = searchParams.get('conversation')?.trim() || null
  const searchParamsString = searchParams.toString()

  /* ---- Live data ---- */
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [requestedNewChatCommanderId, setRequestedNewChatCommanderId] = useState<string | null>(null)
  const [queueSnapshot, setQueueSnapshot] = useState<SessionQueueSnapshot>(EMPTY_QUEUE_SNAPSHOT)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [isQueueMutating, setIsQueueMutating] = useState(false)

  /* ---- Shared state ---- */
  const activeTab = resolvePanelTab(panelParam)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | undefined>()
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [contextFilePaths, setContextFilePaths] = useState<string[]>([])
  const [showCreateCommanderForm, setShowCreateCommanderForm] = useState(false)
  const [showCreateSessionForm, setShowCreateSessionForm] = useState(false)
  const [showAddWorkerForm, setShowAddWorkerForm] = useState(false)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState('')
  const [sessionCwd, setSessionCwd] = useState('')
  const [sessionTask, setSessionTask] = useState('')
  const [sessionEffort, setSessionEffort] = useState<ClaudeEffortLevel>(DEFAULT_CLAUDE_EFFORT_LEVEL)
  const [sessionAdaptiveThinking, setSessionAdaptiveThinking] = useState<ClaudeAdaptiveThinkingMode>(
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const [sessionAgentType, setSessionAgentType] = useState<AgentType>('claude')
  const [sessionTransportType, setSessionTransportType] =
    useState<Exclude<SessionTransportType, 'external'>>('stream')
  const [sessionSelectedHost, setSessionSelectedHost] = useState('')
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [createSessionError, setCreateSessionError] = useState<string | null>(null)

  /* ---- Derived ---- */
  const machineList = machines ?? []
  const selectedCommanderId = commanderState.selectedCommanderId ?? ''
  const selectedCommander = commanderState.selectedCommander as HervaldCommanderSession | null
  const setCommanderSelection = commanderState.setSelectedCommanderId
  const isGlobalScope = !selectedChatSessionId && isGlobalCommanderId(selectedCommanderId)
  const agentSessions = rawAgentSessions as HervaldAgentSession[]
  const urlCommanderIsKnown = Boolean(
    normalizedCommanderParam === GLOBAL_COMMANDER_ID
      || (
        normalizedCommanderParam
        && commanderState.commanders.some((commander) => commander.id === normalizedCommanderParam)
      ),
  )
  const urlCommanderSelectionPending = Boolean(
    normalizedCommanderParam
      && (
        commanderState.commandersLoading
        || (urlCommanderIsKnown && normalizedCommanderParam !== selectedCommanderId)
      ),
  )
  const urlConversationSelectionPending = Boolean(
    normalizedConversationParam
      && normalizedCommanderParam === selectedCommanderId
      && normalizedConversationParam !== selectedConversationId,
  )
  const urlSelectionPending = urlCommanderSelectionPending || urlConversationSelectionPending
  const selectedCommanderConversationScope = !urlSelectionPending
    && selectedCommanderId
    && !isGlobalCommanderId(selectedCommanderId)
    ? selectedCommanderId
    : null
  const {
    conversations,
    selectedConversation: selectedConversationRecord,
    isLoading: conversationsLoading,
  } = useConversations(
    selectedCommanderConversationScope,
    urlSelectionPending ? null : selectedConversationId,
  )
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => conversation.isDefaultConversation !== true),
    [conversations],
  )
  // Per #1362 contract: selection is driven by explicit user actions (clicks)
  // and one-shot deep-link hydration. Never by a passive polling hook. The
  // synthetic-default conversation is filtered here so a stale URL pointing
  // at one renders the Create panel instead of a fake selected chat shell.
  const selectedConversation = selectedConversationRecord?.isDefaultConversation === true
    ? null
    : selectedConversationRecord
  const createConversation = useCreateConversation()
  const startConversation = useStartConversation()
  const stopConversation = useStopConversation()
  const updateConversation = useUpdateConversation()
  const deleteConversation = useDeleteConversation()
  const conversationMessageMutation = useConversationMessage()
  const {
    workers,
    workerSessions,
    automationSessions,
  } = useMemo(() => {
    const nextWorkers: Worker[] = []
    const nextWorkerSessions: ChatSession[] = []
    const nextAutomationSessions: ChatSession[] = []

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
      const isLegacyCommanderSession = sessionName.startsWith('commander-')
        && !sessionName.includes('-conversation-')
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

      if (semanticSessionType === 'commander' || isLegacyCommanderSession) {
        continue
      }

      const group = resolveSessionGroup(session)
      if (group === 'automation') {
        nextAutomationSessions.push(nextSession)
      } else {
        nextWorkerSessions.push(nextSession)
      }
    }

    return {
      workers: nextWorkers,
      workerSessions: nextWorkerSessions,
      automationSessions: nextAutomationSessions,
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
    () => [...workerSessions, ...automationSessions],
    [automationSessions, workerSessions],
  )
  const selectedStandaloneSession = availableSessions.find((session) => session.id === selectedChatSessionId) ?? null
  const selectedConversationSession = selectedConversation?.liveSession
    && isConversationScopedSession(
      selectedConversation.liveSession as HervaldAgentSession,
      selectedConversation.id,
    )
    ? mapAgentSessionToChatSession(selectedConversation.liveSession as HervaldAgentSession)
    : null
  const conversationSelectionSettling = urlSelectionPending
    || conversationsLoading
    || Boolean(selectedConversationId && !selectedConversationRecord)
  const activeStandaloneSession = activeTab === 'chat' ? selectedStandaloneSession : null
  const activeConversationSession = activeTab === 'chat' ? selectedConversationSession : null
  const activeChatSession = activeStandaloneSession ?? activeConversationSession
  const streamSessionName = activeStandaloneSession?.id
    ?? (!conversationSelectionSettling && activeTab === 'chat' ? selectedConversationSession?.name : undefined)
  const composerSessionName = selectedConversation
    ? `conversation-${selectedConversation.id}`
    : (activeStandaloneSession?.id ?? streamSessionName ?? 'hervald-command-room')
  const workspaceSource = resolveWorkspaceSource({
    activeSessionName: activeStandaloneSession?.id,
    selectedCommanderId: isGlobalScope ? null : selectedCommanderId,
  })
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${composerSessionName}`,
    [composerSessionName, workspaceSource],
  )
  const activeChatIsStream = activeChatSession ? activeChatSession.transportType !== 'pty' : true
  const selectedConversationRunning = activeStandaloneSession
    ? activeChatIsStream && activeStandaloneSession.processAlive !== false
    : conversationSelectionSettling
    ? false
    : selectedConversationSession
      ? selectedConversationSession.transportType !== 'pty' && selectedConversationSession.processAlive !== false
    : false
  const selectedConversationAgentType = activeStandaloneSession?.agentType
    ?? selectedConversationSession?.agentType
    ?? selectedCommander?.agentType
  const canQueueDraft = activeStandaloneSession
    ? activeChatIsStream && supportsQueuedDrafts(selectedConversationAgentType)
    : selectedConversation
      ? Boolean(selectedConversationSession?.transportType !== 'pty')
          && supportsQueuedDrafts(selectedConversationAgentType)
      : false
  const showCommanderRuntimeControls = !activeStandaloneSession && !selectedConversation
  const {
    messages: sessionMessages,
    sendDispatcher: streamSendDispatcher,
    pushOptimisticUserMessage,
    answerQuestion,
    isStreaming,
    status: streamStatus,
  } = useAgentSessionStream(streamSessionName, {
    enabled: selectedConversationRunning,
    onQueueUpdate: setQueueSnapshot,
  })
  // Per #1362 contract: an idle selected conversation (no live session) must
  // NOT enable normal send/queue. The only valid send target on the
  // conversation branch is an active conversation backed by a real
  // conversation-scoped live session — anything else means the message would
  // 409 at deliverConversationMessage and the user would see send failures.
  const conversationHasLiveSession = Boolean(selectedConversationSession)
  const composerEnabled = isGlobalScope
    ? false
    : activeStandaloneSession
      ? streamStatus === 'connected' && activeChatIsStream && activeStandaloneSession.processAlive !== false
      : selectedConversation
        ? selectedConversation.status === 'active' && conversationHasLiveSession
        : false
  const composerSendReady = selectedConversation
    ? selectedConversation.status === 'active' && conversationHasLiveSession
    : activeStandaloneSession
      ? streamStatus === 'connected'
      : false
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

    const nextParams = new URLSearchParams(searchParamsString)
    if (desiredPanel) {
      nextParams.set('panel', desiredPanel)
    } else {
      nextParams.delete('panel')
    }
    setSearchParams(nextParams, { replace: true })
  }, [panelParam, searchParamsString, setSearchParams])

  const handleSelectCommanderId = useCallback(async (commanderId: string) => {
    // Per #1362 contract: a single user click → a single backend lookup →
    // an atomic URL+state write. No effect-driven re-selection loop. The
    // previous polling-based design caused image-6/image-7 oscillation
    // because state and URL settled on different ticks.
    setRequestedNewChatCommanderId(null)
    setSelectedChatSessionId(null)

    const isGlobal = commanderId === GLOBAL_COMMANDER_ID
    let activeChatId: string | null = null
    if (!isGlobal) {
      try {
        const active = await queryClient.fetchQuery({
          queryKey: commanderActiveConversationQueryKey(commanderId),
          queryFn: () => fetchCommanderActiveConversation(commanderId),
          staleTime: ACTIVE_CONVERSATION_FETCH_STALE_MS,
        })
        activeChatId = active?.id ?? null
      } catch {
        activeChatId = null
      }
    }

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.set('commander', isGlobal ? 'global' : commanderId)
    if (isGlobal) {
      nextParams.set('panel', 'automation')
    } else {
      nextParams.delete('panel')
    }
    if (activeChatId) {
      nextParams.set('conversation', activeChatId)
    } else {
      nextParams.delete('conversation')
    }
    setSearchParams(nextParams, { replace: true })

    setSelectedConversationId(activeChatId)
    setCommanderSelection(commanderId)
  }, [
    queryClient,
    searchParamsString,
    setCommanderSelection,
    setSearchParams,
  ])

  const handleSelectConversationId = useCallback((
    conversationId: string,
    commanderId = selectedCommanderId,
  ) => {
    setRequestedNewChatCommanderId(null)
    setSelectedConversationId(conversationId)
    setSelectedChatSessionId(null)

    if (isMobile) {
      return
    }

    const nextParams = new URLSearchParams(searchParamsString)
    if (commanderId && !isGlobalCommanderId(commanderId)) {
      nextParams.set('commander', commanderId)
    }
    nextParams.set('conversation', conversationId)
    nextParams.delete('panel')
    setSearchParams(nextParams, { replace: true })
  }, [isMobile, searchParamsString, selectedCommanderId, setSearchParams])

  const handleSelectStandaloneChat = useCallback((chatSessionId: string) => {
    setRequestedNewChatCommanderId(null)
    setSelectedChatSessionId(chatSessionId)
    setSelectedConversationId(null)

    if (isMobile) {
      return
    }

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.delete('conversation')
    nextParams.delete('panel')
    setSearchParams(nextParams, { replace: true })
  }, [isMobile, searchParamsString, setSearchParams])

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
    if (!commanderParam) {
      return
    }
    if (normalizedCommanderParam !== GLOBAL_COMMANDER_ID) {
      return
    }
    if (isGlobalScope && activeTab !== 'automation') {
      handleActiveTabChange('automation')
    }
  }, [activeTab, commanderParam, handleActiveTabChange, isGlobalScope, normalizedCommanderParam])

  useEffect(() => {
    if (!normalizedCommanderParam) {
      return
    }

    if (!urlCommanderIsKnown) {
      return
    }

    if (normalizedCommanderParam === selectedCommanderId) {
      if (normalizedConversationParam !== selectedConversationId) {
        setSelectedChatSessionId(null)
        setSelectedConversationId(
          isGlobalCommanderId(normalizedCommanderParam)
            ? null
            : normalizedConversationParam,
        )
      }
      return
    }

    setSelectedChatSessionId(null)
    setSelectedConversationId(
      isGlobalCommanderId(normalizedCommanderParam)
        ? null
        : normalizedConversationParam,
    )
    setCommanderSelection(normalizedCommanderParam)
  }, [
    normalizedCommanderParam,
    normalizedConversationParam,
    selectedCommanderId,
    selectedConversationId,
    setCommanderSelection,
    urlCommanderIsKnown,
  ])

  useEffect(() => {
    setContextFilePaths([])
  }, [workspaceSelectionKey])

  useEffect(() => {
    if (selectedChatSessionId && !availableSessions.some((session) => session.id === selectedChatSessionId)) {
      setSelectedChatSessionId(null)
    }
  }, [availableSessions, selectedChatSessionId])

  useLayoutEffect(() => {
    if (commanderParam) {
      return
    }

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.set('commander', 'global')
    nextParams.set('panel', 'automation')
    nextParams.delete('conversation')
    setSearchParams(nextParams, { replace: true })
    setSelectedChatSessionId(null)
    setSelectedConversationId(null)
    setCommanderSelection(GLOBAL_COMMANDER_ID)
  }, [
    commanderParam,
    searchParamsString,
    setCommanderSelection,
    setSearchParams,
  ])

  // Deep-link hydration: when the URL arrives with a commander param but no
  // conversation param (e.g. /command-room?commander=arnold), do exactly one
  // backend lookup per commander id transition and then write ?conversation=
  // atomically. This is the ONLY autonomous selection write — clicks go
  // through handleSelectCommanderId. Guarded by a ref so dep churn (poll
  // refresh of conversations list, commander list, etc.) cannot re-fire it.
  const deepLinkFetchedForCommanderRef = useRef<string | null>(null)
  useEffect(() => {
    if (!normalizedCommanderParam) {
      return
    }
    if (isGlobalCommanderId(normalizedCommanderParam)) {
      return
    }
    if (normalizedConversationParam) {
      return
    }
    if (requestedNewChatCommanderId === normalizedCommanderParam) {
      return
    }
    if (!urlCommanderIsKnown) {
      return
    }
    if (deepLinkFetchedForCommanderRef.current === normalizedCommanderParam) {
      return
    }

    deepLinkFetchedForCommanderRef.current = normalizedCommanderParam
    const targetCommander = normalizedCommanderParam
    void (async () => {
      let activeChatId: string | null = null
      try {
        const active = await queryClient.fetchQuery({
          queryKey: commanderActiveConversationQueryKey(targetCommander),
          queryFn: () => fetchCommanderActiveConversation(targetCommander),
          staleTime: ACTIVE_CONVERSATION_FETCH_STALE_MS,
        })
        activeChatId = active?.id ?? null
      } catch {
        activeChatId = null
      }

      if (!activeChatId) {
        return
      }

      // Bail if the user navigated again while we were fetching.
      const liveSearch = new URLSearchParams(window.location.search)
      if (liveSearch.get('commander') !== targetCommander) {
        return
      }
      if (liveSearch.get('conversation')) {
        return
      }

      liveSearch.set('conversation', activeChatId)
      setSearchParams(liveSearch, { replace: true })
      setSelectedConversationId(activeChatId)
    })()
  }, [
    normalizedCommanderParam,
    normalizedConversationParam,
    queryClient,
    requestedNewChatCommanderId,
    setSearchParams,
    urlCommanderIsKnown,
  ])

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
      handleSelectStandaloneChat(resumed.name)
      await refreshSessions()
    } catch (caughtError) {
      const message = formatError(caughtError, 'Failed to resume session')
      setSessionActionError(message)
      throw caughtError
    }
  }, [handleSelectStandaloneChat, refreshSessions])

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
          status: selectedConversation
            ? selectedConversation.status
            : 'idle',
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
  const conversationSendDispatcher = useMemo(
    () => createHttpConversationDispatcher({ submitConversationMessage }),
    [submitConversationMessage],
  )

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
    const sendDispatcher = selectedConversation && !attachedImages?.length
      ? conversationSendDispatcher
      : streamSendDispatcher

    if (selectedConversation && attachedImages?.length) {
      if (!streamSessionName) {
        setSessionActionError('Start or resume the conversation before sending images.')
        return false
      }
      return sendDispatcher.send({ text: trimmed, images: attachedImages }, pushOptimisticUserMessage)
    }

    if (!selectedConversation) {
      if (!streamSessionName) {
        return false
      }
    }

    return sendDispatcher.send({ text: trimmed, images: attachedImages }, pushOptimisticUserMessage)
  }, [
    conversationSendDispatcher,
    selectedConversation,
    streamSessionName,
    streamSendDispatcher,
    pushOptimisticUserMessage,
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
    selectedConversation,
    streamSessionName,
    submitConversationMessage,
  ])

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

  const handleOpenCreateSession = useCallback(() => {
    setCreateSessionError(null)
    setShowCreateSessionForm(true)
  }, [])

  const handleCreateChatForCommander = useCallback(async (
    commanderId: string,
    agentType?: AgentType,
  ) => {
    setSessionActionError(null)

    try {
      const created = await createConversation.mutateAsync({
        commanderId,
        surface: 'ui',
        ...(agentType ? { agentType } : {}),
      })
      // Per #1362 contract: creation is the explicit user action and never
      // auto-starts. We select the new (idle) conversation so the user sees
      // the dedicated chat surface, where the explicit Start affordance lives.
      handleSelectConversationId(created.id, created.commanderId)
      setRequestedNewChatCommanderId(null)
      return created
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to create chat'))
      return null
    }
  }, [createConversation, handleSelectConversationId])

  const handleRequestNewChatForCommander = useCallback((commanderId: string) => {
    // Per #1362 contract: + click does NOT auto-create. We keep the target
    // commander selected, clear the current chat selection, and let the shared
    // CreateConversationPanel collect the provider before any POST happens.
    setRequestedNewChatCommanderId(commanderId)
    setCommanderSelection(commanderId)
    setSelectedConversationId(null)
    setSelectedChatSessionId(null)

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.set('commander', commanderId)
    nextParams.delete('conversation')
    nextParams.delete('panel')
    setSearchParams(nextParams, { replace: true })
  }, [
    searchParamsString,
    setCommanderSelection,
    setSearchParams,
  ])

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
      handleSelectConversationId(started.id, started.commanderId)
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to start conversation'))
    }
  }, [conversations, handleSelectConversationId, selectedCommander?.agentType, startConversation])

  const handleStopConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    try {
      await stopConversation.mutateAsync({ conversationId })
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to stop conversation'))
      throw error
    }
  }, [stopConversation])

  const handleRenameConversation = useCallback(async (conversationId: string, name: string) => {
    setSessionActionError(null)

    try {
      await updateConversation.mutateAsync({
        conversationId,
        name,
      })
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to rename conversation'))
      throw error
    }
  }, [updateConversation])

  const handleSwapConversationProvider = useCallback(async (
    conversationId: string,
    agentType: AgentType,
  ) => {
    setSessionActionError(null)

    try {
      const updated = await updateConversation.mutateAsync({
        conversationId,
        agentType,
      })
      handleSelectConversationId(updated.id, updated.commanderId)
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to swap conversation provider'))
      throw error
    }
  }, [handleSelectConversationId, updateConversation])

  const handleArchiveConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    try {
      await updateConversation.mutateAsync({
        conversationId,
        status: 'archived',
      })
      // Per #1362 contract: archive clears selection. The next render lets the
      // backend active-chat query pick the next active/idle chat (or return
      // null, which surfaces the Create Conversation panel). Re-selecting the
      // archived id here would render an archived chat shell.
      if (selectedConversationId === conversationId || normalizedConversationParam === conversationId) {
        setSelectedConversationId(null)
        if (!isMobile) {
          const nextParams = new URLSearchParams(searchParamsString)
          nextParams.delete('conversation')
          setSearchParams(nextParams, { replace: true })
        }
      }
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to close conversation'))
      throw error
    }
  }, [
    isMobile,
    normalizedConversationParam,
    searchParamsString,
    selectedConversationId,
    setSearchParams,
    updateConversation,
  ])

  const handleRemoveConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    try {
      await deleteConversation.mutateAsync({
        conversationId,
        hard: true,
      })
      setSelectedChatSessionId((current) => current === conversationId ? null : current)
      if (selectedConversationId === conversationId || normalizedConversationParam === conversationId) {
        setSelectedConversationId(null)
        if (!isMobile) {
          const nextParams = new URLSearchParams(searchParamsString)
          nextParams.delete('conversation')
          setSearchParams(nextParams, { replace: true })
        }
      } else {
        setSelectedConversationId((current) => current === conversationId ? null : current)
      }
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to remove conversation'))
      throw error
    }
  }, [
    deleteConversation,
    isMobile,
    normalizedConversationParam,
    searchParamsString,
    selectedConversationId,
    setSearchParams,
  ])

  const handleOpenCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(true)
  }, [])

  const handleCloseAddWorker = useCallback(() => {
    setShowAddWorkerForm(false)
  }, [])

  const handleCloseCreateSession = useCallback(() => {
    setShowCreateSessionForm(false)
    setCreateSessionError(null)
  }, [])

  const handleCloseCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(false)
  }, [])

  const handleCreateSession = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsCreatingSession(true)
    setCreateSessionError(null)

    try {
      const created = await createSession({
        name: sessionName.trim(),
        cwd: sessionCwd.trim(),
        task: sessionTask.trim(),
        effort: sessionEffort,
        adaptiveThinking: sessionAdaptiveThinking,
        agentType: sessionAgentType,
        transportType: sessionTransportType,
        host: sessionSelectedHost.trim() || undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['agents', 'sessions'] })
      handleSelectStandaloneChat(created.sessionName)
      setSessionName('')
      setSessionCwd('')
      setSessionTask('')
      setSessionEffort(DEFAULT_CLAUDE_EFFORT_LEVEL)
      setSessionAdaptiveThinking(DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE)
      setSessionAgentType('claude')
      setSessionTransportType('stream')
      setSessionSelectedHost('')
      setShowCreateSessionForm(false)
    } catch (error) {
      setCreateSessionError(error instanceof Error ? error.message : 'Failed to create session.')
    } finally {
      setIsCreatingSession(false)
    }
  }, [
    handleSelectStandaloneChat,
    queryClient,
    sessionAdaptiveThinking,
    sessionAgentType,
    sessionCwd,
    sessionEffort,
    sessionName,
    sessionSelectedHost,
    sessionTask,
    sessionTransportType,
  ])

  const handleCreateCommander = useCallback(async (
    input: Parameters<typeof commanderState.createCommander>[0],
  ) => {
    const createdCommander = await commanderState.createCommander(input)
    await handleSelectCommanderId(createdCommander.id)
  }, [commanderState, handleSelectCommanderId])

  if (isMobile) {
    return (
      <MobileCommandRoom
        commanders={mobileCommanders}
        commanderSessions={commanderState.commanders}
        workers={workers}
        pendingApprovals={pendingApprovals}
        selectedCommanderId={selectedCommanderId || null}
        onSelectCommanderId={handleSelectCommanderId}
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
        theme={theme}
        onSetTheme={setTheme}
        isStreaming={isStreaming}
        streamStatus={streamStatus}
        conversations={visibleConversations}
        selectedConversationId={selectedConversation?.id ?? null}
        onSelectConversationId={(conversationId) => {
          if (conversationId) {
            handleSelectConversationId(conversationId)
            return
          }
          setRequestedNewChatCommanderId(null)
          setSelectedConversationId(null)
          setSelectedChatSessionId(null)
        }}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        onClearQueue={() => { void handleClearQueue() }}
        onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
        onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
        onQueue={handleQueue}
        onSend={handleSend}
        workspaceSource={workspaceSource}
        onCreateChatForCommander={handleRequestNewChatForCommander}
        onCreateConversation={handleCreateChatForCommander}
        requestedNewChatCommanderId={requestedNewChatCommanderId}
        onStartConversation={(conversationId) => { void handleStartConversation(conversationId) }}
        onStopConversation={(conversationId) => { void handleStopConversation(conversationId) }}
        onRenameConversation={(conversationId, name) => { void handleRenameConversation(conversationId, name) }}
        onSwapConversationProvider={(conversationId, agentType) => {
          void handleSwapConversationProvider(conversationId, agentType)
        }}
        onArchiveConversation={(conversationId) => { void handleArchiveConversation(conversationId) }}
        onRemoveConversation={(conversationId) => { void handleRemoveConversation(conversationId) }}
        onStopCommander={showCommanderRuntimeControls ? () => { void handleStopCommander() } : undefined}
      />
    )
  }

  return (
    <div
      data-testid="command-room-shell"
      style={shellStyle}
    >
      <div style={gridStyle}>
        <SessionsColumn
          selectedCommanderId={selectedCommanderId}
          onSelectCommander={(id) => {
            void handleSelectCommanderId(id)
            if (id === GLOBAL_COMMANDER_ID) {
              handleActiveTabChange('automation')
            }
          }}
          onCreateCommander={handleOpenCreateCommander}
          onCreateWorker={handleOpenAddWorker}
          onCreateSession={handleOpenCreateSession}
          onCreateChatForCommander={handleRequestNewChatForCommander}
          selectedChatId={selectedStandaloneSession?.id ?? selectedConversation?.id ?? null}
          onSelectChat={handleSelectStandaloneChat}
          onSelectConversation={handleSelectConversationId}
          onStartConversation={handleStartConversation}
          onStopConversation={handleStopConversation}
          onRenameConversation={handleRenameConversation}
          onSwapConversationProvider={handleSwapConversationProvider}
          onArchiveConversation={handleArchiveConversation}
          onRemoveConversation={handleRemoveConversation}
          commanders={sessionCommanders}
          conversations={visibleConversations}
          workers={workers}
          approvals={approvals}
          workerSessions={workerSessions}
          automationSessions={automationSessions}
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
          onCloseActiveChat={() => setSelectedChatSessionId(null)}
          onKillSession={(sessionName, agentType) =>
            handleKillSession(sessionName, agentType, activeChatSession?.transportType)
          }
          onOpenWorkspace={workspaceSource ? () => setWorkspaceOpen(true) : undefined}
          onCreateChat={!isGlobalScope && selectedCommanderId
            ? (agentType: AgentType) => {
                void handleCreateChatForCommander(selectedCommanderId, agentType)
              }
            : undefined}
          createChatPending={createConversation.isPending}
          defaultCreateAgentType={selectedCommander?.agentType}
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
        open={showCreateSessionForm}
        title="New Session"
        onClose={handleCloseCreateSession}
      >
        <NewSessionForm
          name={sessionName}
          setName={setSessionName}
          cwd={sessionCwd}
          setCwd={setSessionCwd}
          task={sessionTask}
          setTask={setSessionTask}
          effort={sessionEffort}
          setEffort={setSessionEffort}
          adaptiveThinking={sessionAdaptiveThinking}
          setAdaptiveThinking={setSessionAdaptiveThinking}
          agentType={sessionAgentType}
          setAgentType={setSessionAgentType}
          transportType={sessionTransportType}
          setTransportType={setSessionTransportType}
          machines={machineList}
          selectedHost={sessionSelectedHost}
          setSelectedHost={setSessionSelectedHost}
          isCreating={isCreatingSession}
          createError={createSessionError}
          onSubmit={handleCreateSession}
        />
      </ModalFormContainer>
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
