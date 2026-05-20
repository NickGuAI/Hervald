/**
 * Hervald — Command Room Assembly.
 *
 * Three-column layout: SessionsColumn (232px) | CenterColumn | right panel.
 * Manages shared state: selected commander, active right panel, selected worker, and workspace column.
 *
 * ┌──────────┬────────────────────────────┬──────────────┐
 * │ Sessions │       Center Column        │ Right Panel  │
 * │  (232px) │                            │ 232px / wide │
 * │          │                            │              │
 * │ Cmdrs    │  ┌──────────────────────┐  │ Quests/Auto  │
 * │ Chats    │  │  Chat / Placeholder  │  │ Identity     │
 * │ Teams    │  │  Chat / Placeholder  │  │              │
 * │ nested   │  └──────────────────────┘  │  Optional    │
 * │          │  [Composer]                │              │
 * └──────────┴────────────────────────────┴──────────────┘
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { fetchJson } from '@/lib/api'
import { findModuleGraphUiRouteMetadata } from '@/module-graph-bindings'
import { useModuleGraphContext } from '@/module-graph-context'
import {
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
  DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
  type ClaudeMaxThinkingTokens,
} from '@modules/claude-max-thinking-tokens.js'
import {
  formatError,
  isNotFoundRequestFailure,
  shouldAttemptDebriefOnKill,
} from '@modules/agents/page-shell/session-helpers'
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
  normalizeCommandRoomGlobalSearchParams,
  normalizeCommandRoomRouteMetadata,
} from '@modules/command-room/route-metadata'
import {
  ACTIVE_CONVERSATION_FETCH_STALE_MS,
  commanderActiveConversationQueryKey,
  fetchCommanderActiveConversation,
  useCreateConversation,
  useDeleteConversation,
  useConversationMessages,
  useConversationMessage,
  useConversations,
  useStartConversation,
  useStopConversation,
  useUpdateConversation,
  type ConversationAction,
  type ConversationRecord,
} from '@modules/conversation/hooks/use-conversations'
import { CreateCommanderWizard } from '@modules/commanders/components/CreateCommanderWizard'
import { SessionsColumn } from './desktop/SessionsColumn'
import type { ChatSession } from './desktop/SessionsColumn'
import type { Commander, Worker, Approval } from './desktop/SessionRow'
import { CenterColumn } from './desktop/CenterColumn'
import type { HervaldCommander } from './desktop/CenterColumn'
import { AutomationPanel } from '@modules/commanders/components/AutomationPanel'
import { CommanderIdentityTab } from '@modules/commanders/components/CommanderIdentityTab'
import { QuestBoard } from '@modules/commanders/components/QuestBoard'
import { WorkspacePanel } from '@modules/workspace/components/WorkspacePanel'
import {
  getWorkspaceSourceKey,
  openWorkspaceTarget,
  type WorkspacePendingFileAnnotation,
  type WorkspaceSource,
} from '@modules/workspace/use-workspace'
import type { WorkspaceContextPayload, WorkspaceTreeNode } from '@modules/workspace/types'
import type { SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import {
  appendQueuedMessagesToTranscript,
  mapSessionMessagesToTranscript,
  mergeHistoricalAndLiveTranscript,
} from './transcript'
import { MobileCommandRoom } from './mobile/MobileCommandRoom'

const SIDE_COLUMN_WIDTH = 232
const WORKSPACE_EXPANDED_WIDTH = 520
const CENTER_COLUMN_MIN_WIDTH = 340

const gridStyleBase: CSSProperties = {
  display: 'grid',
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
const RIGHT_PANEL_TABS = [
  { id: 'chat', label: 'Workspace' },
  { id: 'quests', label: 'Quests' },
  { id: 'automation', label: 'Automations' },
  { id: 'identity', label: 'Identity' },
] as const
const SUMI_BUTTON_RADIUS = '2px 12px 2px 12px'
const WORKSPACE_OPEN_STORAGE_KEY = 'hervald.command-room.workspace-open'
type WorkspacePanelDefault = 'open' | 'closed' | 'last-used'
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

function rightPanelActionsStyle(expanded: boolean): CSSProperties {
  return {
    display: expanded ? 'flex' : 'grid',
    gridTemplateColumns: expanded ? undefined : 'repeat(2, minmax(0, 1fr))',
    gap: expanded ? 10 : '10px 8px',
    padding: expanded ? '16px 18px 14px' : '14px 14px 12px',
    borderBottom: '1px solid var(--hv-border-hair)',
    overflowX: expanded ? 'auto' : 'visible',
    alignItems: 'stretch',
  }
}

function rightPanelButtonStyle(active: boolean, compact: boolean): CSSProperties {
  return {
    flex: compact ? '1 1 auto' : '0 0 auto',
    minWidth: 0,
    width: compact ? '100%' : undefined,
    minHeight: compact ? 38 : 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: active ? 'var(--hv-fg)' : 'var(--hv-border-firm)',
    borderRadius: SUMI_BUTTON_RADIUS,
    background: active ? 'var(--hv-fg)' : 'var(--hv-bg)',
    color: active ? 'var(--hv-fg-inverse)' : 'var(--hv-fg)',
    boxShadow: active ? 'var(--hv-shadow-block)' : '2px 2px 0 var(--hv-ink-wash-03)',
    padding: compact ? '9px 4px' : '10px 14px',
    fontSize: compact ? 10 : 11,
    letterSpacing: compact ? '0.06em' : '0.1em',
    lineHeight: 1.1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'background 160ms var(--hv-ease-gentle), color 160ms var(--hv-ease-gentle), box-shadow 160ms var(--hv-ease-gentle)',
  }
}

function workspaceHiddenOpenButtonStyle(): CSSProperties {
  return {
    marginTop: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--hv-border-firm)',
    borderRadius: SUMI_BUTTON_RADIUS,
    background: 'var(--hv-bg)',
    color: 'var(--hv-fg)',
    boxShadow: '2px 2px 0 var(--hv-ink-wash-03)',
  }
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
  targetId,
  label,
  readOnly,
}: {
  targetId?: string | null
  label?: string | null
  readOnly?: boolean
}): WorkspaceSource | null {
  if (targetId) {
    return {
      kind: 'target',
      targetId,
      label: label ?? undefined,
      readOnly,
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
    maxThinkingTokens: session.maxThinkingTokens,
  }
}

function conversationActionAllowed(
  conversation: ConversationRecord | null | undefined,
  action: ConversationAction,
): boolean {
  return conversation?.allowedActions?.[action] === true
}

function conversationDisabledReason(
  conversation: ConversationRecord | null | undefined,
  action: ConversationAction,
  fallback: string,
): string {
  return conversation?.displayState?.disabledReasons[action] ?? fallback
}

function mapConversationLiveSession(conversation: ConversationRecord | null): ChatSession | null {
  if (!conversation?.liveSession || !conversation.sendTarget) {
    return null
  }

  return mapAgentSessionToChatSession({
    ...(conversation.liveSession as HervaldAgentSession),
    name: conversation.sendTarget.sessionName,
    id: conversation.sendTarget.sessionName,
  })
}

export function CommandRoom() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const commanderState = useCommander()
  const queryClient = useQueryClient()
  const moduleGraph = useModuleGraphContext()
  const commandRoomRouteMetadata = useMemo(
    () => normalizeCommandRoomRouteMetadata(
      findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui'),
    ),
    [moduleGraph],
  )
  const { theme, setTheme } = useTheme()
  const { data: rawAgentSessions = [], refetch: refetchAgentSessions } = useAgentSessions()
  const { data: pendingApprovals = [] } = usePendingApprovals()
  const { data: machines } = useMachines()
  const { launch: commandRoomLaunch, globalCommander: globalCommanderRoute } = commandRoomRouteMetadata
  const panelParam = searchParams.get(globalCommanderRoute.panelParam)
  const commanderParam = searchParams.get(commandRoomLaunch.commanderParam)
  const normalizedCommanderParam = commanderParam === globalCommanderRoute.commanderValue
    ? GLOBAL_COMMANDER_ID
    : commanderParam
  const normalizedConversationParam = searchParams.get(commandRoomLaunch.conversationParam)?.trim() || null
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
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const appliedWorkspaceDefaultRef = useRef<string | null>(null)
  const [workspaceTarget, setWorkspaceTarget] = useState<{
    targetId: string
    label: string
    readOnly: boolean
  } | null>(null)
  const [workspaceRequestedPath, setWorkspaceRequestedPath] = useState<{
    path: string
    token: number
  } | null>(null)
  const [contextFilePaths, setContextFilePaths] = useState<string[]>([])
  const [contextDirectoryPaths, setContextDirectoryPaths] = useState<string[]>([])
  const [contextFileAnnotations, setContextFileAnnotations] = useState<WorkspacePendingFileAnnotation[]>([])
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
  const [sessionMaxThinkingTokens, setSessionMaxThinkingTokens] = useState<ClaudeMaxThinkingTokens>(
    DEFAULT_CLAUDE_MAX_THINKING_TOKENS,
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
  // Per issue 1362 contract: selection is driven by explicit user actions (clicks)
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
  const selectedConversationSession = mapConversationLiveSession(selectedConversation)
  const conversationSelectionSettling = urlSelectionPending
    || conversationsLoading
    || Boolean(selectedConversationId && !selectedConversationRecord)
  const activeStandaloneSession = selectedStandaloneSession
  const activeConversationSession = selectedConversationSession
  const activeChatSession = activeStandaloneSession ?? activeConversationSession
  const streamSessionName = activeStandaloneSession?.id
    ?? (!conversationSelectionSettling ? selectedConversationSession?.name : undefined)
  const streamWebSocketPath = activeStandaloneSession || !selectedConversation
    ? undefined
    : `/api/conversations/${encodeURIComponent(selectedConversation.id)}/ws`
  const composerSessionName = selectedConversation
    ? (selectedConversation.sendTarget?.sessionName ?? activeStandaloneSession?.id ?? streamSessionName ?? 'hervald-command-room')
    : (activeStandaloneSession?.id ?? streamSessionName ?? 'hervald-command-room')
  const workspaceSource = resolveWorkspaceSource({
    targetId: workspaceTarget?.targetId,
    label: workspaceTarget?.label,
    readOnly: workspaceTarget?.readOnly,
  })
  const workspacePreferencesQuery = useQuery({
    queryKey: ['workspace', 'preferences'],
    queryFn: () => fetchJson<{ panelDefault: WorkspacePanelDefault }>('/api/workspace/preferences'),
    enabled: Boolean(workspaceTarget?.targetId),
  })
  const workspacePanelDefault = workspacePreferencesQuery.data?.panelDefault ?? 'last-used'
  const workspaceSelectionKey = useMemo(
    () => workspaceSource ? getWorkspaceSourceKey(workspaceSource) : `none:${composerSessionName}`,
    [composerSessionName, workspaceSource],
  )
  const rightColumnWidth = workspaceOpen ? WORKSPACE_EXPANDED_WIDTH : SIDE_COLUMN_WIDTH
  const gridStyle = useMemo<CSSProperties>(() => ({
    ...gridStyleBase,
    gridTemplateColumns: isGlobalScope
      ? `${SIDE_COLUMN_WIDTH}px minmax(${CENTER_COLUMN_MIN_WIDTH}px, 1fr)`
      : `${SIDE_COLUMN_WIDTH}px minmax(${CENTER_COLUMN_MIN_WIDTH}px, 1fr) ${rightColumnWidth}px`,
    minWidth: isGlobalScope
      ? SIDE_COLUMN_WIDTH + CENTER_COLUMN_MIN_WIDTH
      : SIDE_COLUMN_WIDTH + CENTER_COLUMN_MIN_WIDTH + rightColumnWidth,
  }), [isGlobalScope, rightColumnWidth])
  const activeChatIsStream = activeChatSession ? activeChatSession.transportType !== 'pty' : true
  const selectedConversationRunning = activeStandaloneSession
    ? activeChatIsStream && activeStandaloneSession.processAlive !== false
    : conversationSelectionSettling
    ? false
    : Boolean(
        selectedConversation
        && selectedConversationSession
        && selectedConversation.displayState?.hasLiveSession === true
        && selectedConversation.sendTarget?.transportType !== 'pty',
      )
  const canQueueDraft = activeStandaloneSession
    ? activeChatIsStream
    : selectedConversation
      ? conversationActionAllowed(selectedConversation, 'queue')
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
    websocketPath: streamWebSocketPath,
    onQueueUpdate: setQueueSnapshot,
  })
  const conversationMessagesQuery = useConversationMessages(
    selectedConversation?.id ?? null,
    Boolean(selectedConversation),
  )
  // Per issue 1362 contract: an idle selected conversation (no live session) must
  // NOT enable normal send/queue. The backend read model owns that policy now,
  // so Command Room only consumes the projected action flags.
  const conversationCanSend = conversationActionAllowed(selectedConversation, 'send')
  const conversationCanSendMedia = conversationActionAllowed(selectedConversation, 'media')
  const composerEnabled = isGlobalScope
    ? false
    : activeStandaloneSession
      ? streamStatus === 'connected' && activeChatIsStream && activeStandaloneSession.processAlive !== false
      : selectedConversation
        ? conversationCanSend || conversationCanSendMedia
        : false
  const composerSendReady = selectedConversation
    ? conversationCanSend || conversationCanSendMedia
    : activeStandaloneSession
      ? streamStatus === 'connected'
      : false
  const liveTranscript = mapSessionMessagesToTranscript(sessionMessages)
  const historicalConversationMessages = useMemo(() => {
    const pages = conversationMessagesQuery.data?.pages ?? []
    return [...pages]
      .reverse()
      .flatMap((page) => page.messages)
  }, [conversationMessagesQuery.data?.pages])
  const transcript = selectedConversation
    ? mergeHistoricalAndLiveTranscript(historicalConversationMessages, liveTranscript)
    : liveTranscript
  const chatTranscript = appendQueuedMessagesToTranscript(transcript, queueSnapshot)
  const hasOlderConversationMessages = Boolean(
    selectedConversation && conversationMessagesQuery.hasNextPage,
  )
  const loadingOlderConversationMessages = conversationMessagesQuery.isFetchingNextPage
  const handleLoadOlderConversationMessages = useCallback(() => {
    if (!hasOlderConversationMessages || loadingOlderConversationMessages) {
      return
    }
    void conversationMessagesQuery.fetchNextPage()
  }, [
    conversationMessagesQuery,
    hasOlderConversationMessages,
    loadingOlderConversationMessages,
  ])
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
      description: commander.currentTask?.title,
      // Wire the backend-supplied avatar route so every Commander surface
      // renders the same profile image without per-commander color identity.
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
      nextParams.set(globalCommanderRoute.panelParam, desiredPanel)
    } else {
      nextParams.delete(globalCommanderRoute.panelParam)
    }
    setSearchParams(nextParams, { replace: true })
  }, [globalCommanderRoute.panelParam, panelParam, searchParamsString, setSearchParams])

  const handleSelectCommanderId = useCallback(async (commanderId: string) => {
    // Per issue 1362 contract: a single user click → a single backend lookup →
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
    nextParams.set(
      commandRoomLaunch.commanderParam,
      isGlobal ? globalCommanderRoute.commanderValue : commanderId,
    )
    if (isGlobal) {
      nextParams.set(globalCommanderRoute.panelParam, globalCommanderRoute.defaultPanel)
    } else {
      nextParams.delete(globalCommanderRoute.panelParam)
    }
    if (activeChatId) {
      nextParams.set(commandRoomLaunch.conversationParam, activeChatId)
    } else {
      nextParams.delete(commandRoomLaunch.conversationParam)
    }
    setSearchParams(nextParams, { replace: true })

    setSelectedConversationId(activeChatId)
    setCommanderSelection(commanderId)
  }, [
    commandRoomLaunch.commanderParam,
    commandRoomLaunch.conversationParam,
    globalCommanderRoute.commanderValue,
    globalCommanderRoute.defaultPanel,
    globalCommanderRoute.panelParam,
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

    const nextParams = new URLSearchParams(searchParamsString)
    if (commanderId && !isGlobalCommanderId(commanderId)) {
      nextParams.set(commandRoomLaunch.commanderParam, commanderId)
    }
    nextParams.set(commandRoomLaunch.conversationParam, conversationId)
    nextParams.delete(globalCommanderRoute.panelParam)
    setSearchParams(nextParams, { replace: true })
  }, [
    commandRoomLaunch.commanderParam,
    commandRoomLaunch.conversationParam,
    globalCommanderRoute.panelParam,
    searchParamsString,
    selectedCommanderId,
    setSearchParams,
  ])

  const handleClearConversationSelection = useCallback((
    commanderId = selectedCommanderId,
  ) => {
    setRequestedNewChatCommanderId(null)
    setSelectedConversationId(null)
    setSelectedChatSessionId(null)

    const nextParams = new URLSearchParams(searchParamsString)
    if (commanderId && !isGlobalCommanderId(commanderId)) {
      nextParams.set(commandRoomLaunch.commanderParam, commanderId)
    }
    nextParams.delete(commandRoomLaunch.conversationParam)
    nextParams.delete(globalCommanderRoute.panelParam)
    setSearchParams(nextParams, { replace: true })
  }, [
    commandRoomLaunch.commanderParam,
    commandRoomLaunch.conversationParam,
    globalCommanderRoute.panelParam,
    searchParamsString,
    selectedCommanderId,
    setSearchParams,
  ])

  const handleSelectStandaloneChat = useCallback((chatSessionId: string) => {
    setRequestedNewChatCommanderId(null)
    setSelectedChatSessionId(chatSessionId)
    setSelectedConversationId(null)

    if (isMobile) {
      return
    }

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.delete(commandRoomLaunch.conversationParam)
    nextParams.delete(globalCommanderRoute.panelParam)
    setSearchParams(nextParams, { replace: true })
  }, [
    commandRoomLaunch.conversationParam,
    globalCommanderRoute.panelParam,
    isMobile,
    searchParamsString,
    setSearchParams,
  ])

  const refreshSessions = useCallback(async () => {
    await refetchAgentSessions()
  }, [refetchAgentSessions])

  const setWorkspaceOpenPreference = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setWorkspaceOpen((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      try {
        window.localStorage.setItem(WORKSPACE_OPEN_STORAGE_KEY, resolved ? 'open' : 'closed')
      } catch {
        // Storage can be unavailable in embedded/webview contexts.
      }
      return resolved
    })
  }, [])

  const handleAddWorkspaceContextPath = useCallback((contextPath: string, type: WorkspaceTreeNode['type'] = 'file') => {
    const normalizedPath = contextPath.trim().replace(/\/+$/u, '')
    if (!normalizedPath) {
      return
    }
    if (type === 'directory') {
      setContextDirectoryPaths((current) => (
        current.includes(normalizedPath) ? current : [...current, normalizedPath]
      ))
      return
    }
    setContextFilePaths((current) => (
      current.includes(normalizedPath) ? current : [...current, normalizedPath]
    ))
  }, [])

  const handleAddContextFileAnnotation = useCallback((annotation: WorkspacePendingFileAnnotation) => {
    setContextFileAnnotations((current) => (
      current.some((entry) => entry.id === annotation.id) ? current : [...current, annotation]
    ))
  }, [])

  const handleOpenWorkspaceFilePath = useCallback(async (filePath: string) => {
    const trimmedPath = filePath.trim()
    if (!trimmedPath) {
      return
    }

    handleActiveTabChange('chat')
    setWorkspaceOpenPreference(true)
    setWorkspaceRequestedPath({
      path: trimmedPath,
      token: Date.now(),
    })

    if (workspaceTarget?.targetId) {
      return
    }

    const standaloneSessionName = activeStandaloneSession?.id ?? null
    const fallbackCommanderId = !isGlobalScope && selectedCommanderId ? selectedCommanderId : null
    if (!selectedConversationId && !standaloneSessionName && !fallbackCommanderId) {
      return
    }

    try {
      const target = await openWorkspaceTarget(
        selectedConversationId
          ? { conversationId: selectedConversationId }
          : standaloneSessionName
            ? { sessionName: standaloneSessionName }
            : { commanderId: fallbackCommanderId! },
      )
      setWorkspaceTarget({
        targetId: target.targetId,
        label: target.label,
        readOnly: target.isReadOnly,
      })
    } catch {
      setWorkspaceTarget(null)
    }
  }, [
    activeStandaloneSession?.id,
    handleActiveTabChange,
    isGlobalScope,
    selectedCommanderId,
    selectedConversationId,
    setWorkspaceOpenPreference,
    workspaceTarget?.targetId,
  ])

  const handleRemoveContextFilePath = useCallback((filePath: string) => {
    setContextFilePaths((current) => current.filter((entry) => entry !== filePath))
  }, [])

  const handleRemoveContextDirectoryPath = useCallback((directoryPath: string) => {
    setContextDirectoryPaths((current) => current.filter((entry) => entry !== directoryPath))
  }, [])

  const handleRemoveContextFileAnnotation = useCallback((annotationId: string) => {
    setContextFileAnnotations((current) => current.filter((entry) => entry.id !== annotationId))
  }, [])

  const handleClearContextFilePaths = useCallback(() => {
    setContextFilePaths([])
    setContextDirectoryPaths([])
    setContextFileAnnotations([])
  }, [])

  useEffect(() => {
    if (!commanderParam) {
      return
    }
    if (normalizedCommanderParam !== GLOBAL_COMMANDER_ID) {
      return
    }
    if (isGlobalScope && activeTab !== globalCommanderRoute.defaultPanel) {
      handleActiveTabChange(globalCommanderRoute.defaultPanel)
    }
  }, [
    activeTab,
    commanderParam,
    globalCommanderRoute.defaultPanel,
    handleActiveTabChange,
    isGlobalScope,
    normalizedCommanderParam,
  ])

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
    setContextDirectoryPaths([])
    setContextFileAnnotations([])
  }, [workspaceSelectionKey])

  useEffect(() => {
    let cancelled = false
    const standaloneSessionName = activeStandaloneSession?.id ?? null
    const fallbackCommanderId = !isGlobalScope && selectedCommanderId ? selectedCommanderId : null
    if (!selectedConversationId && !standaloneSessionName && !fallbackCommanderId) {
      setWorkspaceTarget(null)
      return
    }

    void (async () => {
      try {
        const target = await openWorkspaceTarget(
          selectedConversationId
            ? { conversationId: selectedConversationId }
            : standaloneSessionName
              ? { sessionName: standaloneSessionName }
              : { commanderId: fallbackCommanderId! },
        )
        if (!cancelled) {
          setWorkspaceTarget({
            targetId: target.targetId,
            label: target.label,
            readOnly: target.isReadOnly,
          })
        }
      } catch {
        if (!cancelled) {
          setWorkspaceTarget(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeStandaloneSession?.id, isGlobalScope, selectedCommanderId, selectedConversationId])

  useEffect(() => {
    if (!workspaceSource) {
      appliedWorkspaceDefaultRef.current = null
      setWorkspaceOpen(false)
      return
    }

    const defaultKey = `${workspaceSelectionKey}:${workspacePanelDefault}`
    if (appliedWorkspaceDefaultRef.current === defaultKey) {
      return
    }
    appliedWorkspaceDefaultRef.current = defaultKey

    if (workspacePanelDefault === 'open') {
      setWorkspaceOpen(true)
      return
    }
    if (workspacePanelDefault === 'closed') {
      setWorkspaceOpen(false)
      return
    }

    try {
      setWorkspaceOpen(window.localStorage.getItem(WORKSPACE_OPEN_STORAGE_KEY) === 'open')
    } catch {
      setWorkspaceOpen(false)
    }
  }, [workspacePanelDefault, workspaceSelectionKey, workspaceSource])

  useEffect(() => {
    if (selectedChatSessionId && !availableSessions.some((session) => session.id === selectedChatSessionId)) {
      setSelectedChatSessionId(null)
    }
  }, [availableSessions, selectedChatSessionId])

  useLayoutEffect(() => {
    if (location.pathname !== commandRoomLaunch.path) {
      return
    }

    if (commanderParam) {
      return
    }

    const nextParams = normalizeCommandRoomGlobalSearchParams(
      new URLSearchParams(searchParamsString),
      commandRoomRouteMetadata,
    )
    setSearchParams(nextParams, { replace: true })
    setSelectedChatSessionId(null)
    setSelectedConversationId(null)
    setCommanderSelection(GLOBAL_COMMANDER_ID)
  }, [
    commanderParam,
    commandRoomLaunch.path,
    commandRoomRouteMetadata,
    location.pathname,
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
      if (liveSearch.get(commandRoomLaunch.commanderParam) !== targetCommander) {
        return
      }
      if (liveSearch.get(commandRoomLaunch.conversationParam)) {
        return
      }

      liveSearch.set(commandRoomLaunch.conversationParam, activeChatId)
      setSearchParams(liveSearch, { replace: true })
      setSelectedConversationId(activeChatId)
    })()
  }, [
    normalizedCommanderParam,
    normalizedConversationParam,
    commandRoomLaunch.commanderParam,
    commandRoomLaunch.conversationParam,
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
        handleActiveTabChange('chat')
        setWorkspaceOpenPreference((prev) => activeTab === 'chat' ? !prev : true)
      }
    },
    [activeTab, handleActiveTabChange, setWorkspaceOpenPreference, workspaceSource],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleWorkspaceKey)
    return () => document.removeEventListener('keydown', handleWorkspaceKey)
  }, [handleWorkspaceKey])

  const handleKillSession = useCallback(async (
    sessionName: string,
    agentType?: AgentType,
    selectedSessionType?: SessionTransportType,
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
            ?? selectedCommander.currentTask?.title,
          cost: selectedConversation?.totalCostUsd ?? selectedCommander.totalCostUsd,
          agentType: selectedConversationSession?.agentType ?? selectedCommander.agentType,
        }
      : { id: '', name: 'No commander', status: 'offline' }

  /* ---- Workers for the selected commander ---- */
  const commanderWorkers = workers.filter(
    (worker) => (
      worker.creator?.kind === 'commander'
      && worker.creator.id?.trim() === selectedCommanderId.trim()
    ),
  )
  const commanderApprovals = approvals.filter(
    (a) => a.commanderId === selectedCommanderId,
  )
  const submitConversationMessage = useCallback(async ({
    message,
    images,
    workspaceContext,
    queue = false,
  }: {
    message: string
    images?: Array<{ mediaType: string; data: string }>
    workspaceContext?: WorkspaceContextPayload
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
        images,
        workspaceContext,
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

  const buildWorkspaceContextPayload = useCallback((
    payload: SessionComposerSubmitPayload,
  ): WorkspaceContextPayload | undefined => {
    const context = payload.context
    const hasContext = Boolean(
      context?.filePaths?.length
      || context?.directoryPaths?.length
      || context?.fileAnnotations?.length,
    )
    if (!hasContext) {
      return undefined
    }
    return {
      ...(workspaceSource?.targetId ? { targetId: workspaceSource.targetId } : {}),
      ...(selectedConversationId ? { conversationId: selectedConversationId } : {}),
      ...(context?.filePaths?.length ? { filePaths: context.filePaths } : {}),
      ...(context?.directoryPaths?.length ? { directoryPaths: context.directoryPaths } : {}),
      ...(context?.fileAnnotations?.length ? { fileAnnotations: context.fileAnnotations } : {}),
    }
  }, [selectedConversationId, workspaceSource?.targetId])

  const handleSend = useCallback((payload: SessionComposerSubmitPayload): boolean | Promise<boolean> => {
    const trimmed = payload.text.trim()
    const workspaceContext = buildWorkspaceContextPayload(payload)
    const { images } = payload
    const attachedImages = images && images.length > 0 ? images : undefined
    if (!trimmed && !attachedImages && !workspaceContext) {
      return false
    }
    if (selectedConversation && attachedImages?.length && !conversationActionAllowed(selectedConversation, 'media')) {
      setSessionActionError(
        conversationDisabledReason(
          selectedConversation,
          'media',
          'Start or resume the conversation before sending images.',
        ),
      )
      return false
    }
    if (selectedConversation && !attachedImages?.length && !conversationActionAllowed(selectedConversation, 'send')) {
      setSessionActionError(
        conversationDisabledReason(
          selectedConversation,
          'send',
          'Start or resume the conversation before sending messages.',
        ),
      )
      return false
    }
    const sendDispatcher = selectedConversation
      ? conversationSendDispatcher
      : streamSendDispatcher

    if (!selectedConversation) {
      if (!streamSessionName) {
        return false
      }
    }

    return sendDispatcher.send({
      text: trimmed,
      images: attachedImages,
      workspaceContext,
    }, pushOptimisticUserMessage)
  }, [
    buildWorkspaceContextPayload,
    conversationSendDispatcher,
    selectedConversation,
    streamSessionName,
    streamSendDispatcher,
    pushOptimisticUserMessage,
  ])

  const handleQueue = useCallback(async (payload: SessionComposerSubmitPayload) => {
    const trimmed = payload.text.trim()
    const workspaceContext = buildWorkspaceContextPayload(payload)
    const { images } = payload
    const queuedImages = images && images.length > 0 ? images : undefined
    if (!trimmed && !queuedImages && !workspaceContext) {
      return
    }

    if (selectedConversation) {
      if (queuedImages?.length) {
        if (
          !conversationActionAllowed(selectedConversation, 'queue')
          || !conversationActionAllowed(selectedConversation, 'media')
        ) {
          setSessionActionError(
            conversationDisabledReason(
              selectedConversation,
              !conversationActionAllowed(selectedConversation, 'media') ? 'media' : 'queue',
              'Start or resume the conversation before queueing images.',
            ),
          )
          return
        }
      } else if (!trimmed && !workspaceContext) {
        return
      } else if (!conversationActionAllowed(selectedConversation, 'queue')) {
        setSessionActionError(
          conversationDisabledReason(
            selectedConversation,
            'queue',
            'Start or resume the conversation before queueing messages.',
          ),
        )
        return
      }
      if (await submitConversationMessage({
        message: trimmed,
        images: queuedImages,
        workspaceContext,
        queue: true,
      })) {
        await refreshQueueSnapshot()
      }
      return
    }

    if (!streamSessionName) {
      return
    }

    await applyQueueMutation(
      () => queueSessionMessage(streamSessionName, {
        text: trimmed,
        images: queuedImages,
        workspaceContext,
      }),
      'Failed to queue message',
      'Queue updated, but failed to refresh queue',
    )
  }, [
    applyQueueMutation,
    buildWorkspaceContextPayload,
    refreshQueueSnapshot,
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
    model?: string | null,
  ) => {
    setSessionActionError(null)

    try {
      const created = await createConversation.mutateAsync({
        commanderId,
        surface: 'ui',
        ...(agentType ? { agentType } : {}),
        ...(model !== undefined ? { model } : {}),
      })
      // Per issue 1362 contract: creation is the explicit user action and never
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
    // Per issue 1362 contract: + click does NOT auto-create. We keep the target
    // commander selected, clear the current chat selection, and let the shared
    // CreateConversationPanel collect the provider before any POST happens.
    setRequestedNewChatCommanderId(commanderId)
    setCommanderSelection(commanderId)
    setSelectedConversationId(null)
    setSelectedChatSessionId(null)

    const nextParams = new URLSearchParams(searchParamsString)
    nextParams.set(commandRoomLaunch.commanderParam, commanderId)
    nextParams.delete(commandRoomLaunch.conversationParam)
    nextParams.delete(globalCommanderRoute.panelParam)
    setSearchParams(nextParams, { replace: true })
  }, [
    commandRoomLaunch.commanderParam,
    commandRoomLaunch.conversationParam,
    globalCommanderRoute.panelParam,
    searchParamsString,
    setCommanderSelection,
    setSearchParams,
  ])

  const handleStartConversation = useCallback(async (conversationId: string) => {
    setSessionActionError(null)

    const conversation = conversations.find((entry) => entry.id === conversationId)
    const persistedAgentType = conversation?.agentType
    const targetAgentType = persistedAgentType ?? selectedCommander?.agentType

    try {
      const started = await startConversation.mutateAsync({
        conversationId,
        ...(targetAgentType ? { agentType: targetAgentType as AgentType } : {}),
        ...(typeof conversation?.model === 'string' ? { model: conversation.model } : {}),
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
    model: string | null,
  ) => {
    setSessionActionError(null)

    try {
      const updated = await updateConversation.mutateAsync({
        conversationId,
        agentType,
        model,
      })
      handleSelectConversationId(updated.id, updated.commanderId)
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to update conversation provider/model'))
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
      // Per issue 1362 contract: archive clears selection. The next render lets the
      // backend active-chat query pick the next active/idle chat (or return
      // null, which surfaces the Create Conversation panel). Re-selecting the
      // archived id here would render an archived chat shell.
      if (selectedConversationId === conversationId || normalizedConversationParam === conversationId) {
        handleClearConversationSelection()
      }
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to close conversation'))
      throw error
    }
  }, [
    handleClearConversationSelection,
    normalizedConversationParam,
    selectedConversationId,
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
        handleClearConversationSelection()
      } else {
        setSelectedConversationId((current) => current === conversationId ? null : current)
      }
    } catch (error) {
      setSessionActionError(formatError(error, 'Failed to remove conversation'))
      throw error
    }
  }, [
    deleteConversation,
    handleClearConversationSelection,
    normalizedConversationParam,
    selectedConversationId,
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
        maxThinkingTokens: sessionMaxThinkingTokens,
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
      setSessionMaxThinkingTokens(DEFAULT_CLAUDE_MAX_THINKING_TOKENS)
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
    sessionMaxThinkingTokens,
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

  const renderRightColumnContent = () => {
    if (activeTab === 'quests') {
      if (!selectedCommander || isGlobalScope) {
        return (
          <div
            data-testid="right-panel-empty-quests"
            data-test-id="right-panel-empty-quests"
            style={{ padding: 20, color: 'var(--hv-fg-subtle)', fontSize: 12, lineHeight: 1.5 }}
          >
            Select a commander to view quests.
          </div>
        )
      }

      return (
        <QuestBoard
          commanders={[{
            id: selectedCommander.id,
            host: selectedCommander.host,
          }]}
          selectedCommanderId={selectedCommander.id}
        />
      )
    }

    if (activeTab === 'automation') {
      return (
        <AutomationPanel
          scope={
            !isGlobalScope && selectedCommander
              ? { kind: 'commander', commander: { id: selectedCommander.id } }
              : { kind: 'global' }
          }
        />
      )
    }

    if (activeTab === 'identity') {
      if (!selectedCommander || isGlobalScope) {
        return (
          <div
            data-testid="right-panel-empty-identity"
            data-test-id="right-panel-empty-identity"
            style={{ padding: 20, color: 'var(--hv-fg-subtle)', fontSize: 12, lineHeight: 1.5 }}
          >
            Select a commander to inspect identity.
          </div>
        )
      }

      return <CommanderIdentityTab commander={selectedCommander} />
    }

    if (workspaceOpen && workspaceSource) {
      return (
        <WorkspacePanel
          source={workspaceSource}
          position="side"
          variant="light"
          onClose={() => setWorkspaceOpenPreference(false)}
          onInsertPath={handleAddWorkspaceContextPath}
          onAddAnnotationContext={handleAddContextFileAnnotation}
          requestedPath={workspaceRequestedPath?.path ?? null}
          requestedPathToken={workspaceRequestedPath?.token ?? 0}
        />
      )
    }

    if (workspaceSource) {
      return (
        <div
          data-testid="workspace-hidden-panel"
          data-test-id="workspace-hidden-panel"
          style={{
            padding: 20,
            color: 'var(--hv-fg-subtle)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <p style={{ margin: 0 }}>Workspace is hidden.</p>
          <button
            type="button"
            data-testid="workspace-hidden-open-button"
            data-test-id="workspace-hidden-open-button"
            className="btn-ghost"
            style={workspaceHiddenOpenButtonStyle()}
            onClick={() => setWorkspaceOpenPreference(true)}
          >
            Open workspace
          </button>
        </div>
      )
    }

    return (
      <div
        data-testid="workspace-empty-panel"
        data-test-id="workspace-empty-panel"
        style={{
          padding: 20,
          color: 'var(--hv-fg-subtle)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        Select or start a conversation to inspect its workspace.
      </div>
    )
  }

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
        transcript={chatTranscript}
        hasOlderMessages={hasOlderConversationMessages}
        loadingOlderMessages={loadingOlderConversationMessages}
        onLoadOlderMessages={handleLoadOlderConversationMessages}
        onAnswer={(toolId, answers) => {
          answerQuestion(toolId, answers)
        }}
        composerSessionName={composerSessionName}
        composerEnabled={composerEnabled}
        composerSendReady={composerSendReady}
        canQueueDraft={canQueueDraft}
        theme={theme}
        onSetTheme={setTheme}
        commandRoomRouteMetadata={commandRoomRouteMetadata}
        isStreaming={isStreaming}
        streamStatus={streamStatus}
        conversations={visibleConversations}
        selectedConversationId={selectedConversationId}
        onSelectConversationId={(conversationId) => {
          if (conversationId) {
            handleSelectConversationId(conversationId)
            return
          }
          handleClearConversationSelection()
        }}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        onClearQueue={() => { void handleClearQueue() }}
        onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
        onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
        onQueue={handleQueue}
        onSend={handleSend}
        contextFileAnnotations={contextFileAnnotations}
        onRemoveContextFileAnnotation={handleRemoveContextFileAnnotation}
        onClearContextFileAnnotations={handleClearContextFilePaths}
        onOpenWorkspaceFile={handleOpenWorkspaceFilePath}
        workspaceRequestedPath={workspaceRequestedPath?.path ?? null}
        workspaceRequestedPathToken={workspaceRequestedPath?.token ?? 0}
        workspaceSource={workspaceSource}
        onCreateChatForCommander={handleRequestNewChatForCommander}
        onCreateConversation={handleCreateChatForCommander}
        requestedNewChatCommanderId={requestedNewChatCommanderId}
        onStartConversation={(conversationId) => { void handleStartConversation(conversationId) }}
        onStopConversation={(conversationId) => { void handleStopConversation(conversationId) }}
        onRenameConversation={(conversationId, name) => { void handleRenameConversation(conversationId, name) }}
        onSwapConversationProvider={(conversationId, agentType, model) => {
          void handleSwapConversationProvider(conversationId, agentType, model)
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
      data-test-id="command-room-shell"
      style={shellStyle}
    >
      <div
        data-testid="command-room-grid"
        data-test-id="command-room-grid"
        style={gridStyle}
      >
        <SessionsColumn
          selectedCommanderId={selectedCommanderId}
          onSelectCommander={(id) => {
            void handleSelectCommanderId(id)
            if (id === GLOBAL_COMMANDER_ID) {
              handleActiveTabChange(globalCommanderRoute.defaultPanel)
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
          transcript={chatTranscript}
          hasOlderMessages={hasOlderConversationMessages}
          loadingOlderMessages={loadingOlderConversationMessages}
          onLoadOlderMessages={handleLoadOlderConversationMessages}
          workers={commanderWorkers.map((w) => ({
            id: w.id,
            name: w.name,
            kind: w.kind ?? 'worker',
            state: w.state || 'idle',
          }))}
          activeTab={activeTab}
          setActiveTab={handleActiveTabChange}
          onCloseActiveChat={() => setSelectedChatSessionId(null)}
          onKillSession={(sessionName, agentType) =>
            handleKillSession(sessionName, agentType, activeChatSession?.transportType)
          }
          onOpenWorkspace={selectedConversationId || activeStandaloneSession || (!isGlobalScope && selectedCommanderId)
            ? () => {
                handleActiveTabChange('chat')
                setWorkspaceOpenPreference(true)
              }
            : undefined}
          globalAutomationPanel={isGlobalScope && activeTab === 'automation'
            ? (
                <AutomationPanel
                  scope={{ kind: 'global' }}
                />
              )
            : undefined}
          onCreateChat={!isGlobalScope && selectedCommanderId
            ? (agentType: AgentType, model: string | null) => {
                void handleCreateChatForCommander(selectedCommanderId, agentType, model)
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
          contextDirectoryPaths={contextDirectoryPaths}
          contextFileAnnotations={contextFileAnnotations}
          onRemoveContextFilePath={handleRemoveContextFilePath}
          onRemoveContextDirectoryPath={handleRemoveContextDirectoryPath}
          onRemoveContextFileAnnotation={handleRemoveContextFileAnnotation}
          onClearContextFilePaths={handleClearContextFilePaths}
          onQueue={(payload) => { void handleQueue(payload) }}
          onSend={(payload) => { void handleSend(payload) }}
          onOpenWorkspaceFile={handleOpenWorkspaceFilePath}
          queueSnapshot={queueSnapshot}
          queueError={queueError}
          isQueueMutating={isQueueMutating}
          onClearQueue={() => { void handleClearQueue() }}
          onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
          onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
          theme={theme}
          onSetTheme={setTheme}
        />

        {!isGlobalScope && (
          <aside
            data-testid="workspace-right-column"
            data-test-id="workspace-right-column"
            style={{
              background: 'var(--hv-bg-raised)',
              borderLeft: '1px solid var(--hv-border-hair)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
              width: rightColumnWidth,
              transition: 'width 180ms var(--hv-ease-gentle)',
            }}
          >
            <div
              data-testid="right-panel-actions"
              data-test-id="right-panel-actions"
              style={rightPanelActionsStyle(workspaceOpen)}
            >
              {RIGHT_PANEL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`right-panel-tab-${tab.id}`}
                  data-test-id={`right-panel-tab-${tab.id}`}
                  aria-pressed={activeTab === tab.id}
                  className="font-mono"
                  style={rightPanelButtonStyle(activeTab === tab.id, !workspaceOpen)}
                  onClick={() => {
                    handleActiveTabChange(tab.id)
                    if (tab.id === 'chat') {
                      setWorkspaceOpenPreference(true)
                    }
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
                padding: '18px',
              }}
            >
              <div
                data-testid="right-panel-content"
                data-test-id="right-panel-content"
                style={{
                  height: '100%',
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {renderRightColumnContent()}
              </div>
            </div>
          </aside>
        )}
      </div>

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
          maxThinkingTokens={sessionMaxThinkingTokens}
          setMaxThinkingTokens={setSessionMaxThinkingTokens}
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
