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
  SessionTransportType,
} from '@/types'
import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  type ClaudeAdaptiveThinkingMode,
} from '@modules/claude-adaptive-thinking.js'
import {
  DEFAULT_CLAUDE_EFFORT_LEVEL,
  type ClaudeEffortLevel,
} from '@modules/claude-effort.js'
import { NewSessionForm } from '@modules/agents/components/NewSessionForm'
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
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [effort, setEffort] = useState<ClaudeEffortLevel>(DEFAULT_CLAUDE_EFFORT_LEVEL)
  const [adaptiveThinking, setAdaptiveThinking] = useState<ClaudeAdaptiveThinkingMode>(
    DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  )
  const [cwd, setCwd] = useState('')
  const [resumeFromSession, setResumeFromSession] = useState('')
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [transportType, setTransportType] = useState<Exclude<SessionTransportType, 'external'>>('stream')
  const [selectedHost, setSelectedHost] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)

  /* ---- Derived ---- */
  const machineList = machines ?? []
  const selectedCommanderId = commanderState.selectedCommanderId ?? ''
  const selectedCommander = commanderState.selectedCommander as HervaldCommanderSession | null
  const isGlobalScope = !selectedChatSessionId && isGlobalCommanderId(selectedCommanderId)
  const agentSessions = rawAgentSessions as HervaldAgentSession[]
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
      const nextSession: ChatSession = {
        id: sessionName,
        name: sessionName,
        label: typeof session.label === 'string' ? session.label : undefined,
        created: typeof session.created === 'string' ? session.created : new Date(0).toISOString(),
        pid: typeof session.pid === 'number' ? session.pid : 0,
        age: formatSessionAge(session.lastActivityAt),
        status: typeof session.status === 'string' ? session.status : undefined,
        agentType: typeof session.agentType === 'string' ? session.agentType : undefined,
        sessionType: semanticSessionType ?? undefined,
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
  const selectedChatSession = availableSessions.find((session) => session.id === selectedChatSessionId) ?? null
  const activeChatSession = activeTab === 'chat' ? selectedChatSession : null
  const selectedSessionName = activeChatSession?.id
    ?? (!isGlobalScope && selectedCommanderId
      ? buildCommanderSessionName(selectedCommanderId)
      : undefined)
  const workspaceSource = resolveWorkspaceSource({
    activeSessionName: activeChatSession?.id,
    selectedCommanderId: isGlobalScope ? null : selectedCommanderId,
  })
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${selectedSessionName ?? 'hervald-command-room'}`,
    [selectedSessionName, workspaceSource],
  )
  const commanderSessionRunning = selectedCommander?.state === 'running'
  const activeChatIsStream = activeChatSession ? activeChatSession.transportType !== 'pty' : true
  const selectedConversationRunning = activeChatSession
    ? activeChatIsStream && activeChatSession.processAlive !== false
    : commanderSessionRunning
  const selectedConversationAgentType = activeChatSession?.agentType ?? selectedCommander?.agentType
  const canQueueDraft = activeChatIsStream && supportsQueuedDrafts(selectedConversationAgentType)
  const resumableSessions = agentSessions
    .filter((session) => session.resumeAvailable)
    .sort((left, right) => Date.parse(right.created) - Date.parse(left.created))
  const resumeSource = resumableSessions.find((session) => session.name === resumeFromSession) ?? null
  const {
    messages: sessionMessages,
    sendInput,
    answerQuestion,
    isStreaming,
    status: streamStatus,
  } = useAgentSessionStream(selectedSessionName, {
    enabled: selectedConversationRunning,
    onQueueUpdate: setQueueSnapshot,
  })
  // Composer is only enabled when the live WebSocket is connected AND the
  // underlying session is running. Gating on streamStatus (not just session
  // list `processAlive`) matches the /agents MobileSessionView pattern and
  // prevents the composer from accepting a submit while the WS is
  // reconnecting — which previously caused follow-up sends to silently drop.
  const composerEnabled = streamStatus === 'connected' && (
    activeChatSession
      ? activeChatIsStream && activeChatSession.processAlive !== false
      : commanderSessionRunning
  )
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
    if (!resumeFromSession) {
      return
    }
    if (resumableSessions.some((session) => session.name === resumeFromSession)) {
      return
    }
    setResumeFromSession('')
  }, [resumeFromSession, resumableSessions])

  useEffect(() => {
    if (!resumeSource) {
      return
    }

    if (resumeSource.agentType && resumeSource.agentType !== agentType) {
      setAgentType(resumeSource.agentType)
    }
    if (transportType !== 'stream') {
      setTransportType('stream')
    }

    const nextCwd = resumeSource.cwd ?? ''
    if (cwd !== nextCwd) {
      setCwd(nextCwd)
    }

    if (resumeSource.agentType === 'claude') {
      const nextEffort = resumeSource.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL
      if (effort !== nextEffort) {
        setEffort(nextEffort)
      }
      const nextAdaptiveThinking = resumeSource.adaptiveThinking ?? DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE
      if (adaptiveThinking !== nextAdaptiveThinking) {
        setAdaptiveThinking(nextAdaptiveThinking)
      }
    }

    const nextHost = resumeSource.host ?? ''
    if (selectedHost !== nextHost) {
      setSelectedHost(nextHost)
    }
  }, [adaptiveThinking, agentType, cwd, effort, resumeSource, selectedHost, transportType])

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
    if (!selectedSessionName) {
      return EMPTY_QUEUE_SNAPSHOT
    }

    const nextQueue = await fetchSessionQueueSnapshot(selectedSessionName)
    return normalizeQueueSnapshot(nextQueue)
  }, [selectedSessionName])

  const refreshQueueSnapshot = useCallback(async (): Promise<void> => {
    if (!selectedSessionName || !canQueueDraft || !selectedConversationRunning) {
      setQueueSnapshot(EMPTY_QUEUE_SNAPSHOT)
      return
    }

    setQueueSnapshot(await fetchQueueSnapshot())
  }, [canQueueDraft, fetchQueueSnapshot, selectedConversationRunning, selectedSessionName])

  useEffect(() => {
    let cancelled = false
    setQueueError(null)

    if (!selectedSessionName || !canQueueDraft || !selectedConversationRunning) {
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
  }, [canQueueDraft, fetchQueueSnapshot, selectedConversationRunning, selectedSessionName])

  /* ---- Build CenterColumn commander shape ---- */
  const centerCommander: HervaldCommander = activeChatSession
    ? {
        id: '',
        name: activeChatSession.label ?? activeChatSession.name,
        status: activeChatSession.status ?? 'active',
        description: activeChatSession.transportType === 'pty'
          ? 'interactive terminal session'
          : 'standalone chat session',
        agentType: activeChatSession.agentType,
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
          status: selectedCommander.state,
          description: selectedCommander.persona?.trim() || selectedCommander.currentTask?.title,
          cost: selectedCommander.totalCostUsd,
        }
      : { id: '', name: 'No commander', status: 'offline' }

  /* ---- Workers for the selected commander ---- */
  const commanderWorkers = workers.filter(
    (worker) => isOwnedByCommander(worker, selectedCommanderId),
  )
  const commanderApprovals = approvals.filter(
    (a) => a.commanderId === selectedCommanderId,
  )
  const teamCommander = activeChatSession
    ? {
        id: '',
        name: activeChatSession.name,
        status: activeChatSession.status ?? 'active',
      }
    : {
        id: centerCommander.id,
        name: centerCommander.name,
        status: centerCommander.status,
      }
  const teamWorkers = activeChatSession ? [] : commanderWorkers
  const teamApprovals = activeChatSession ? [] : commanderApprovals

  const applyQueueMutation = useCallback(async (
    request: () => Promise<unknown>,
    mutationErrorFallback: string,
    refreshErrorFallback: string,
  ): Promise<boolean> => {
    if (!selectedSessionName || !canQueueDraft) {
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
  }, [canQueueDraft, refreshQueueSnapshot, selectedSessionName])

  const handleSend = useCallback(async ({ text, images }: { text: string; images?: { mediaType: string; data: string }[] }) => {
    if (!selectedSessionName) {
      return false
    }

    if (!activeChatSession && !selectedCommanderId) {
      return false
    }

    if (!activeChatSession && !commanderSessionRunning) {
      return false
    }

    return sendInput({ text, images })
  }, [
    commanderSessionRunning,
    activeChatSession,
    selectedCommanderId,
    selectedSessionName,
    sendInput,
  ])

  const handleQueue = useCallback(async ({ text, images }: { text: string; images?: { mediaType: string; data: string }[] }) => {
    const trimmed = text.trim()
    const queuedImages = images && images.length > 0 ? images : undefined
    if ((!trimmed && !queuedImages) || !selectedSessionName) {
      return
    }

    if (!activeChatSession && !selectedCommanderId) {
      return
    }

    if (!activeChatSession && !commanderSessionRunning) {
      return
    }

    await applyQueueMutation(
      () => queueSessionMessage(selectedSessionName, {
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
    selectedCommanderId,
    selectedSessionName,
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
    if (!selectedSessionName || !canQueueDraft) {
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
      () => reorderSessionQueue(selectedSessionName, reordered.map((message) => message.id)),
      'Failed to reorder queued messages',
      'Queue reordered, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, queueSnapshot.items, selectedSessionName])

  const handleRemoveQueuedMessage = useCallback(async (messageId: string) => {
    if (!selectedSessionName || !canQueueDraft) {
      return
    }

    await applyQueueMutation(
      () => removeQueuedSessionMessage(selectedSessionName, messageId),
      'Failed to remove queued message',
      'Queue updated, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, selectedSessionName])

  const handleClearQueue = useCallback(async () => {
    if (!selectedSessionName || !canQueueDraft) {
      return
    }

    await applyQueueMutation(
      () => clearSessionQueue(selectedSessionName),
      'Failed to clear queued messages',
      'Queue cleared, but failed to refresh queue',
    )
  }, [applyQueueMutation, canQueueDraft, selectedSessionName])

  const handleOpenNewSession = useCallback(() => {
    setCreateError(null)
    setShowNewSessionForm(true)
  }, [])

  const handleOpenAddWorker = useCallback(() => {
    setShowAddWorkerForm(true)
  }, [])

  const handleOpenCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(true)
  }, [])

  const handleCloseAddWorker = useCallback(() => {
    setShowAddWorkerForm(false)
  }, [])

  const handleCloseCreateCommander = useCallback(() => {
    setShowCreateCommanderForm(false)
  }, [])

  const handleCloseNewSession = useCallback(() => {
    setCreateError(null)
    setShowNewSessionForm(false)
  }, [])

  const handleCreateCommander = useCallback(async (
    input: Parameters<typeof commanderState.createCommander>[0],
  ) => {
    const createdCommander = await commanderState.createCommander(input)
    setSelectedChatSessionId(null)
    commanderState.setSelectedCommanderId(createdCommander.id)
  }, [commanderState])

  const handleCreateSession = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating) {
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const result = await createSession({
        name: name.trim(),
        task: task.trim() || undefined,
        effort,
        adaptiveThinking,
        cwd: cwd.trim() || undefined,
        resumeFromSession: resumeFromSession || undefined,
        transportType,
        agentType,
        host: selectedHost || undefined,
      })

      setName('')
      setTask('')
      setEffort(DEFAULT_CLAUDE_EFFORT_LEVEL)
      setAdaptiveThinking(DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE)
      setCwd('')
      setResumeFromSession('')
      setAgentType('claude')
      setTransportType('stream')
      setSelectedHost('')
      setShowNewSessionForm(false)

      await refetchAgentSessions()
      setSelectedChatSessionId(result.sessionName)
      handleActiveTabChange('chat')
    } catch (caughtError) {
      setCreateError(caughtError instanceof Error ? caughtError.message : 'Failed to create session')
    } finally {
      setIsCreating(false)
    }
  }, [
    adaptiveThinking,
    agentType,
    cwd,
    effort,
    handleActiveTabChange,
    isCreating,
    name,
    refetchAgentSessions,
    resumeFromSession,
    selectedHost,
    transportType,
    task,
  ])

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
          commanderState.setSelectedCommanderId(id)
        }}
        selectedCommanderRunning={selectedCommanderRunning}
        selectedCommanderAgentType={selectedCommander?.agentType}
        transcript={transcript}
        onAnswer={(toolId, answers) => {
          answerQuestion(toolId, answers)
        }}
        composerSessionName={selectedSessionName ?? 'hervald-command-room'}
        composerEnabled={composerEnabled}
        composerSendReady={streamStatus === 'connected'}
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
        onStartCommander={!activeChatSession ? (agentType) => { void handleStartCommander(agentType) } : undefined}
        onStopCommander={!activeChatSession ? () => { void handleStopCommander() } : undefined}
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
          selectedCommanderId={activeChatSession ? '' : selectedCommanderId}
          onSelectCommander={(id) => {
            setSelectedChatSessionId(null)
            commanderState.setSelectedCommanderId(id)
            if (id === GLOBAL_COMMANDER_ID) {
              handleActiveTabChange('cron')
            }
          }}
          onCreateCommander={handleOpenCreateCommander}
          onCreateWorker={handleOpenAddWorker}
          onCreateSession={handleOpenNewSession}
          selectedChatId={activeChatSession?.id ?? null}
          onSelectChat={(id) => {
            setSelectedChatSessionId(id)
            handleActiveTabChange('chat')
          }}
          commanders={sessionCommanders}
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
          onStartCommander={!activeChatSession ? (agentType) => { void handleStartCommander(agentType) } : undefined}
          onStopCommander={!activeChatSession ? () => { void handleStopCommander() } : undefined}
          onAnswer={(toolId, answers) => {
            answerQuestion(toolId, answers)
          }}
          composerSessionName={selectedSessionName ?? 'hervald-command-room'}
          composerEnabled={composerEnabled}
          composerSendReady={streamStatus === 'connected'}
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
          selectedWorkerId={activeChatSession ? undefined : selectedWorkerId}
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
      <ModalFormContainer
        open={showNewSessionForm}
        title="New Session"
        onClose={handleCloseNewSession}
      >
        <NewSessionForm
          name={name}
          setName={setName}
          cwd={cwd}
          setCwd={setCwd}
          resumeOptions={resumableSessions}
          resumeSource={resumeSource}
          resumeSourceName={resumeFromSession}
          setResumeSourceName={setResumeFromSession}
          task={task}
          setTask={setTask}
          effort={effort}
          setEffort={setEffort}
          adaptiveThinking={adaptiveThinking}
          setAdaptiveThinking={setAdaptiveThinking}
          agentType={agentType}
          setAgentType={setAgentType}
          transportType={transportType}
          setTransportType={setTransportType}
          machines={machineList}
          selectedHost={selectedHost}
          setSelectedHost={setSelectedHost}
          isCreating={isCreating}
          createError={createError}
          onSubmit={handleCreateSession}
        />
      </ModalFormContainer>
    </div>
  )
}
