/**
 * Hervald — CenterColumn
 *
 * Fluid main content area for the Command Room:
 *   - Tab bar: Chat · Quests · Sentinels · Automation · Identity
 *   - Tab-bar status controls with commander label + Stop + theme toggle
 *   - Delegated sub-agent strip
 *   - ChatPane (tab=chat) or placeholder for other tabs
 *   - Composer at bottom
 *
 * Approval integration uses usePendingApprovals + useApprovalDecision
 * from the existing hooks — no new endpoints created.
 */
import { usePendingApprovals, useApprovalDecision, type PendingApproval } from '@/hooks/use-approvals'
import { StatusDot } from '@/surfaces/hervald'
import type { SessionQueueSnapshot } from '@/types'
import { Moon, Square, Sun } from 'lucide-react'
import type { CSSProperties } from 'react'
import { SessionComposer, type SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import { TerminalView } from '@modules/agents/page-shell/TerminalView'
import type { MsgItem } from '@modules/agents/messages/model'
import type {
  CommanderAgentType,
  CommanderCronCreateInput,
  CommanderCronTask,
  CommanderSession,
} from '@modules/commanders/hooks/useCommander'
import { QuestBoard } from '@modules/commanders/components/QuestBoard'
import { CommanderSentinelsTab } from '@modules/commanders/components/CommanderSentinelsTab'
import { CommanderCronTab } from '@modules/commanders/components/CommanderCronTab'
import { CommanderIdentityTab } from '@modules/commanders/components/CommanderIdentityTab'
import { CommanderStartControl } from '@modules/commanders/components/CommanderStartControl'
import { ChatPane } from './ChatPane'
import { QueueDock } from './QueueDock'
import type { ChatSession } from './SessionsColumn'
import { SubAgentChip, type Worker } from './SubAgentChip'

/* ---- local types ---- */

export interface HervaldCommander extends Partial<CommanderSession> {
  id: string
  name: string
  status: string
  description?: string
  cost?: number
  uptime?: string
  contextConfig?: {
    fatPinInterval: number
  }
  runtime?: {
    heartbeatCount: number
  }
}

export interface CenterColumnProps {
  commander: HervaldCommander
  isGlobalScope?: boolean
  activeChatSession?: ChatSession | null
  transcript?: MsgItem[]
  workers?: Worker[]
  activeTab: string
  setActiveTab: (tab: string) => void
  crons?: CommanderCronTask[]
  cronsLoading?: boolean
  cronsError?: string | null
  addCron?: (input: CommanderCronCreateInput) => Promise<void>
  addCronPending?: boolean
  toggleCron?: (input: { commanderId?: string; cronId: string; enabled: boolean }) => Promise<void>
  toggleCronPending?: boolean
  toggleCronId?: string | null
  updateCron?: (input: {
    commanderId?: string
    cronId: string
    name?: string
    description?: string
    schedule?: string
    timezone?: string
    machine?: string
    workDir?: string
    agentType?: 'claude' | 'codex' | 'gemini'
    instruction?: string
    model?: string
    enabled?: boolean
    permissionMode?: string
    sessionType?: 'stream' | 'pty'
  }) => Promise<void>
  updateCronPending?: boolean
  updateCronId?: string | null
  triggerCron?: (cronId: string) => Promise<void>
  triggerCronPending?: boolean
  triggerCronId?: string | null
  deleteCron?: (input: { commanderId?: string; cronId: string }) => Promise<void>
  deleteCronPending?: boolean
  deleteCronId?: string | null
  onOpenWorkspace?: () => void
  onStartCommander?: (agentType: CommanderAgentType) => void
  onStopCommander?: () => void
  onCloseActiveChat?: () => void
  onKillSession?: (sessionName: string, agentType?: ChatSession['agentType']) => Promise<void>
  onSend?: (payload: SessionComposerSubmitPayload) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
  contextFilePaths?: string[]
  onRemoveContextFilePath?: (filePath: string) => void
  onClearContextFilePaths?: () => void
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  composerSessionName: string
  composerEnabled: boolean
  composerSendReady: boolean
  canQueueDraft: boolean
  queueSnapshot: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating?: boolean
  onClearQueue: () => void
  onMoveQueuedMessage: (messageId: string, offset: number) => void
  onRemoveQueuedMessage: (messageId: string) => void
  theme: 'light' | 'dark'
  onSetTheme: (theme: 'light' | 'dark') => void
}

/* ---- tab config ---- */

const TABS = [
  { id: 'chat',      label: 'Chat' },
  { id: 'quests',    label: 'Quests' },
  { id: 'sentinels', label: 'Sentinels' },
  { id: 'cron',      label: 'Automation' },
  { id: 'identity',  label: 'Identity' },
]

/* ---- helpers ---- */

function normalizeCommanderStatus(status: string): string {
  if (status === 'running') {
    return 'connected'
  }
  return status || 'idle'
}

function commanderStatusLabel(status: string): string {
  const normalizedStatus = normalizeCommanderStatus(status)
  if (normalizedStatus === 'connected') {
    return 'Connected'
  }
  if (normalizedStatus === 'active') {
    return 'Active'
  }
  if (normalizedStatus === 'idle') {
    return 'Idle'
  }
  if (normalizedStatus === 'offline') {
    return 'Offline'
  }
  if (normalizedStatus === 'paused') {
    return 'Paused'
  }
  if (normalizedStatus === 'blocked') {
    return 'Blocked'
  }
  return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)
}

function shouldPulseCommanderStatus(status: string): boolean {
  const normalizedStatus = normalizeCommanderStatus(status)
  return normalizedStatus === 'connected' || normalizedStatus === 'active'
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '60px 40px',
        textAlign: 'center',
        color: 'var(--hv-fg-faint)',
        fontSize: 13,
        fontStyle: 'italic',
      }}
    >
      {message}
    </div>
  )
}

function IdleStartState({
  commanderName,
  agentType,
  onStart,
}: {
  commanderName: string
  agentType?: CommanderAgentType
  onStart?: (agentType: CommanderAgentType) => void
}) {
  return (
    <div
      style={{
        minHeight: 360,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 32px 56px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        {onStart && (
          <CommanderStartControl
            commanderName={commanderName}
            initialAgentType={agentType}
            onStart={onStart}
            variant="desktop"
          />
        )}
        <p
          style={{
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--hv-fg-faint)',
          }}
        >
          Idle
        </p>
      </div>
    </div>
  )
}

/* ---- main export ---- */

export function CenterColumn({
  commander,
  isGlobalScope = false,
  activeChatSession = null,
  transcript = [],
  workers = [],
  activeTab,
  setActiveTab,
  crons = [],
  cronsLoading = false,
  cronsError = null,
  addCron,
  addCronPending = false,
  toggleCron,
  toggleCronPending = false,
  toggleCronId = null,
  updateCron,
  updateCronPending = false,
  updateCronId = null,
  triggerCron,
  triggerCronPending = false,
  triggerCronId = null,
  deleteCron,
  deleteCronPending = false,
  deleteCronId = null,
  onOpenWorkspace,
  onStartCommander,
  onStopCommander,
  onCloseActiveChat,
  onKillSession,
  onSend,
  onQueue,
  contextFilePaths,
  onRemoveContextFilePath,
  onClearContextFilePaths,
  onAnswer,
  composerSessionName,
  composerEnabled,
  composerSendReady,
  canQueueDraft,
  queueSnapshot,
  queueError = null,
  isQueueMutating = false,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  theme,
  onSetTheme,
}: CenterColumnProps) {
  const currentTab = activeTab
  const visibleTabs = isGlobalScope ? TABS.filter((tab) => tab.id === 'cron') : TABS
  const commanderState = normalizeCommanderStatus(commander.status)
  const commanderStateLabel = commanderStatusLabel(commander.status)
  const commanderStatePulse = shouldPulseCommanderStatus(commander.status)

  const pendingQuery = usePendingApprovals()
  const decisionMutation = useApprovalDecision()

  // Filter approvals to this commander only
  const allApprovals: PendingApproval[] = pendingQuery.data ?? []
  const commanderApprovals = allApprovals.filter(
    (a) => !commander.id || a.commanderId === commander.id || a.commanderName === commander.name,
  )

  const subAgents = workers.filter((w) => w.kind === 'worker' || w.kind === 'tool')
  const hasCommander = !isGlobalScope && commander.id.trim().length > 0
  const hasConversation = isGlobalScope ? false : hasCommander || commander.name !== 'No commander'
  const idleCommanderChat = !isGlobalScope && currentTab === 'chat' && hasCommander && commander.status !== 'running'
  const activeChatIsPty = activeChatSession?.sessionType === 'pty'
  const showTerminalSession = currentTab === 'chat' && activeChatIsPty

  function handleTabChange(id: string): void {
    setActiveTab(id)
  }

  async function handleApprove(approval: PendingApproval): Promise<void> {
    try {
      await decisionMutation.mutateAsync({ approval, decision: 'approve' })
    } catch {
      // error is surfaced via decisionMutation.error if needed
    }
  }

  async function handleDeny(approval: PendingApproval): Promise<void> {
    try {
      await decisionMutation.mutateAsync({ approval, decision: 'reject' })
    } catch {
      // error is surfaced via decisionMutation.error if needed
    }
  }

  function renderTabContent() {
    if (isGlobalScope && currentTab !== 'cron') {
      return <EmptyPanel message="Not applicable for Global scope." />
    }

    if (currentTab === 'chat') {
      if (idleCommanderChat) {
        return (
          <IdleStartState
            commanderName={commander.name}
            agentType={commander.agentType}
            onStart={onStartCommander}
          />
        )
      }

      if (showTerminalSession && activeChatSession && onKillSession) {
        return (
          <TerminalView
            sessionName={activeChatSession.id}
            sessionLabel={activeChatSession.label ?? activeChatSession.name}
            agentType={activeChatSession.agentType}
            onClose={onCloseActiveChat ?? (() => undefined)}
            onKill={onKillSession}
            isMobileOverlay={false}
          />
        )
      }

      return (
        <ChatPane
          messages={transcript}
          approvals={commanderApprovals}
          onApprove={(approval) => { void handleApprove(approval) }}
          onDeny={(approval) => { void handleDeny(approval) }}
          onAnswer={onAnswer}
          agentAvatarUrl={commander.avatarUrl}
          agentAccentColor={commander.ui?.accentColor ?? null}
          sessionId={composerSessionName}
        />
      )
    }

    if (!hasCommander && !isGlobalScope) {
      return <EmptyPanel message="Select a commander to view panel details." />
    }

    const detailedCommander = commander as CommanderSession

    if (currentTab === 'quests') {
      return (
        <QuestBoard
          commanders={[{ id: commander.id, host: detailedCommander.host }]}
          selectedCommanderId={commander.id}
        />
      )
    }

    if (currentTab === 'sentinels') {
      return <CommanderSentinelsTab commander={detailedCommander} />
    }

    if (currentTab === 'cron') {
      if (!addCron || !toggleCron || !updateCron || !triggerCron || !deleteCron) {
        return <EmptyPanel message="Automation controls are not available right now." />
      }

      return (
        <CommanderCronTab
          scope={
            isGlobalScope
              ? { kind: 'global' }
              : { kind: 'commander', commander: detailedCommander }
          }
          crons={crons}
          cronsLoading={cronsLoading}
          cronsError={cronsError}
          addCron={addCron}
          addCronPending={addCronPending}
          toggleCron={toggleCron}
          toggleCronPending={toggleCronPending}
          toggleCronId={toggleCronId}
          updateCron={updateCron}
          updateCronPending={updateCronPending}
          updateCronId={updateCronId}
          triggerCron={triggerCron}
          triggerCronPending={triggerCronPending}
          triggerCronId={triggerCronId}
          deleteCron={deleteCron}
          deleteCronPending={deleteCronPending}
          deleteCronId={deleteCronId}
        />
      )
    }

    if (currentTab === 'identity') {
      return <CommanderIdentityTab commander={detailedCommander} />
    }

    return <EmptyPanel message="Unknown panel." />
  }

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--hv-bg)',
        borderRight: '1px solid var(--hv-border-hair)',
        overflow: 'hidden',
      }}
    >
      {/* ---- tab bar ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: '1px solid var(--hv-border-hair)',
          paddingRight: 20,
          flexShrink: 0,
        }}
      >
        {visibleTabs.map((tab) => {
          const isActive = currentTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              style={{
                padding: '14px 18px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--hv-font-body)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--hv-fg)' : 'var(--hv-fg-subtle)',
                borderBottom: isActive
                  ? '2px solid var(--hv-fg)'
                  : '2px solid transparent',
                marginBottom: -1,
                fontWeight: 500,
              }}
            >
              {tab.label}
            </button>
          )
        })}

        {/* right label */}
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '0 0 0 16px',
          }}
        >
          <div
            data-testid="conversation-status-indicator"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-faint)',
              fontFamily: 'var(--hv-font-body)',
            }}
          >
            <StatusDot state={commanderState} pulse={commanderStatePulse} size={7} />
            <span>{commanderStateLabel}</span>
          </div>
          <span
            style={{
              alignSelf: 'center',
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--hv-fg-faint)',
            }}
          >
            {isGlobalScope ? `${commander.name} · automation scope` : `${commander.name} · live conversation`}
          </span>
          {hasCommander && commander.status === 'running' && onStopCommander && (
            <button
              type="button"
              onClick={onStopCommander}
              data-testid="commander-stop-button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                border: '1px solid var(--hv-border-firm)',
                borderRadius: '2px 8px 2px 8px',
                background: 'transparent',
                color: 'var(--hv-fg-subtle)',
                cursor: 'pointer',
                fontFamily: 'var(--hv-font-body)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              <Square size={11} />
              Stop
            </button>
          )}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: 3,
              borderRadius: '2px 10px 2px 10px',
              border: '1px solid var(--hv-border-hair)',
              background: 'var(--hv-bg-raised)',
            }}
          >
            <button
              type="button"
              onClick={() => onSetTheme('light')}
              aria-pressed={theme === 'light'}
              aria-label="Use light theme"
              style={themeToggleButtonStyle(theme === 'light')}
            >
              <Sun size={13} />
              Light
            </button>
            <button
              type="button"
              onClick={() => onSetTheme('dark')}
              aria-pressed={theme === 'dark'}
              aria-label="Use dark theme"
              style={themeToggleButtonStyle(theme === 'dark')}
            >
              <Moon size={13} />
              Dark
            </button>
          </div>
        </div>
      </div>

      {/* ---- scrollable content ---- */}
      <div
        className="hv-scroll"
        style={{ flex: 1, overflowY: 'auto' }}
      >
        {/* delegated sub-agents strip */}
        {subAgents.length > 0 && (
          <div
            style={{
              padding: '22px 32px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--hv-fg-faint)',
              }}
            >
              Delegated · {subAgents.length} sub-agents
            </span>
            {subAgents.slice(0, 5).map((w) => (
              <SubAgentChip key={w.id} worker={w} />
            ))}
          </div>
        )}

        {/* tab content */}
        {renderTabContent()}
      </div>

      {!showTerminalSession && (
        <>
          <QueueDock
            conversationName={commander.name}
            hasConversation={hasConversation}
            canQueue={composerEnabled && canQueueDraft}
            queueSnapshot={queueSnapshot}
            queueError={queueError}
            isQueueMutating={isQueueMutating}
            onClearQueue={onClearQueue}
            onMoveQueuedMessage={onMoveQueuedMessage}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
          />

          <SessionComposer
            sessionName={composerSessionName}
            agentType={commander.agentType}
            theme={theme}
            disabled={!composerEnabled}
            disabledMessage={isGlobalScope
              ? 'Chat is not available for Global scope.'
              : idleCommanderChat
                ? `Start ${commander.name} to begin chatting.`
                : !hasConversation
                  ? 'Select a commander or worker to start chatting.'
                  : undefined}
            sendReady={composerSendReady}
            contextFilePaths={contextFilePaths}
            onRemoveContextFilePath={onRemoveContextFilePath}
            onClearContextFilePaths={onClearContextFilePaths}
            onQueue={onQueue}
            onSend={onSend ?? (() => undefined)}
            onOpenWorkspace={onOpenWorkspace}
            showWorkspaceShortcut={Boolean(onOpenWorkspace)}
            placeholder={isGlobalScope
              ? 'Global scope does not support chat.'
              : `Send a message to ${commander.name}…`}
          />
        </>
      )}
    </section>
  )
}

function themeToggleButtonStyle(active: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: '2px 8px 2px 8px',
    border: '1px solid transparent',
    background: active ? 'var(--hv-bg)' : 'transparent',
    color: active ? 'var(--hv-fg)' : 'var(--hv-fg-subtle)',
    cursor: 'pointer',
    fontFamily: 'var(--hv-font-body)',
    fontSize: 11,
    letterSpacing: '0.04em',
  } satisfies CSSProperties
}
