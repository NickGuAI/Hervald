import type { AgentType, SessionQueueSnapshot } from '@/types'
import type { PendingApproval } from '@/hooks/use-approvals'
import { MobileSessionShell } from '@modules/agents/page-shell/MobileSessionShell'
import type { SessionComposerSubmitPayload } from '@modules/agents/components/SessionComposer'
import type { MsgItem } from '@modules/agents/messages/model'
import type { Commander, Worker } from '@/surfaces/hervald/SessionRow'
import type { CommanderAgentType } from '@modules/commanders/hooks/useCommander'
import { CommanderStartControl } from '@modules/commanders/components/CommanderStartControl'

interface MobileChatViewProps {
  commander: Commander | null
  workers: Worker[]
  transcript: MsgItem[]
  approvals: PendingApproval[]
  sessionName: string
  composerEnabled: boolean
  composerSendReady: boolean
  canQueueDraft: boolean
  isStreaming?: boolean
  agentType?: AgentType
  startAgentType?: CommanderAgentType
  wsStatus?: 'connecting' | 'connected' | 'disconnected' | 'closed' | null
  costUsd?: number
  durationSec?: number
  queueSnapshot: SessionQueueSnapshot
  queueError?: string | null
  isQueueMutating: boolean
  onBack: () => void
  onOpenTeam: () => void
  onOpenWorkspace: () => void
  onStartCommander?: (agentType: CommanderAgentType) => void
  onStopCommander?: () => void
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  onApproveApproval: (approval: PendingApproval) => void | Promise<void>
  onDenyApproval: (approval: PendingApproval) => void | Promise<void>
  onClearQueue: () => void
  onMoveQueuedMessage: (id: string, offset: number) => void
  onRemoveQueuedMessage: (id: string) => void
  contextFilePaths?: string[]
  onRemoveContextFilePath?: (filePath: string) => void
  onClearContextFilePaths?: () => void
  onSend?: (payload: SessionComposerSubmitPayload) => boolean | void | Promise<boolean | void>
  onQueue?: (
    payload: SessionComposerSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
}

export function MobileChatView({
  commander,
  workers,
  transcript,
  approvals,
  sessionName,
  composerEnabled,
  composerSendReady,
  canQueueDraft,
  isStreaming = false,
  agentType,
  startAgentType,
  wsStatus,
  costUsd,
  durationSec,
  queueSnapshot,
  queueError,
  isQueueMutating,
  onBack,
  onOpenTeam,
  onOpenWorkspace,
  onStartCommander,
  onStopCommander,
  onAnswer,
  onApproveApproval,
  onDenyApproval,
  onClearQueue,
  onMoveQueuedMessage,
  onRemoveQueuedMessage,
  contextFilePaths = [],
  onRemoveContextFilePath,
  onClearContextFilePaths,
  onSend,
  onQueue,
}: MobileChatViewProps) {
  if (!commander) {
    return null
  }

  const emptyState = !composerEnabled && onStartCommander
    ? (
      <div
        className="flex flex-1 items-center justify-center px-6 py-10"
        data-testid="mobile-chat-empty-state"
      >
        <div className="space-y-4 text-center">
          <p className="text-sm uppercase tracking-[0.18em] text-white/45">idle</p>
          <h2 className="font-display text-3xl text-washi-white">{commander.name}</h2>
          <p className="text-sm text-white/60">
            Start this commander to restore the live transcript and composer.
          </p>
          <CommanderStartControl
            commanderName={commander.name}
            initialAgentType={startAgentType}
            onStart={onStartCommander}
            variant="mobile"
          />
        </div>
      </div>
    )
    : undefined

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
      onAnswer={onAnswer}
      approvals={approvals}
      onApprovalDecision={(approval, decision) =>
        decision === 'approve'
          ? onApproveApproval(approval)
          : onDenyApproval(approval)
      }
      agentAvatarUrl={commander.avatarUrl ?? undefined}
      agentAccentColor={commander.ui?.accentColor ?? undefined}
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
      onRemoveContextFilePath={onRemoveContextFilePath}
      onClearContextFilePaths={onClearContextFilePaths}
      theme="dark"
      onBack={onBack}
      onKill={onStopCommander}
      onOpenWorkspace={onOpenWorkspace}
      workers={workers.map((worker) => ({
        id: worker.id,
        label: worker.name,
        status: worker.state,
      }))}
      onOpenWorkers={onOpenTeam}
      rootClassName="mobile-session-shell session-view-overlay hv-dark"
      composerDisabledMessage={`Start ${commander.name} to begin chatting.`}
      dataTestId="mobile-chat-view"
      emptyState={emptyState}
    />
  )
}
