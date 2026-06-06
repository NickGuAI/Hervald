import type { MsgItem } from '../messages/model'
import {
  AgentActivityGroup,
  AgentMessage,
  AskUserQuestionBlock,
  PlanningBlock,
  ProviderActivityBlock,
  RunningAgentsPanel,
  SystemDivider,
  ThinkingBlock,
  ToolBlock,
  UserMessage,
} from './session-message-list/blocks'
import { groupMessages } from './session-message-list/render-items'

export interface SessionMessageListProps {
  messages: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  emptyLabel?: string
  agentAvatarUrl?: string | null
  agentAccentColor?: string | null
  onOpenWorkspaceFile?: (path: string) => void
}

export function SessionMessageList({
  messages,
  onAnswer,
  emptyLabel = 'No messages yet.',
  agentAvatarUrl,
  agentAccentColor,
  onOpenWorkspaceFile,
}: SessionMessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="session-message-empty rounded border border-[color:var(--hv-border-soft)] bg-[var(--hv-bg-sunken)] px-2 py-1.5 font-mono text-[11px] text-[color:var(--hv-fg)]">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="session-message-list space-y-2">
      <RunningAgentsPanel messages={messages} />
      {groupMessages(messages).map((item) => {
        if (item.type === 'activity-group') {
          return <AgentActivityGroup key={item.id} messages={item.messages} onAnswer={onAnswer} />
        }

        const message = item.msg
        switch (message.kind) {
          case 'system':
            return <SystemDivider key={message.id} text={message.text} />
          case 'user':
            return (
              <UserMessage
                key={message.id}
                text={message.text}
                images={message.images}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            )
          case 'thinking':
            return <ThinkingBlock key={message.id} text={message.text} />
          case 'planning':
            return <PlanningBlock key={message.id} msg={message} onOpenWorkspaceFile={onOpenWorkspaceFile} />
          case 'agent':
            return (
              <AgentMessage
                key={message.id}
                text={message.text}
                images={message.images}
                avatarUrl={agentAvatarUrl}
                accentColor={agentAccentColor}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
              />
            )
          case 'tool':
            return <ToolBlock key={message.id} msg={message} onAnswer={onAnswer} />
          case 'ask':
            return <AskUserQuestionBlock key={message.id} msg={message} onAnswer={onAnswer} />
          case 'provider':
            return <ProviderActivityBlock key={message.id} msg={message} />
          default:
            return null
        }
      })}
    </div>
  )
}
