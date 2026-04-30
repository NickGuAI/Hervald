import type { MsgItem } from '../messages/model'
import {
  AgentMessage,
  AskUserQuestionBlock,
  PlanningBlock,
  RunningAgentsPanel,
  SystemDivider,
  ThinkingBlock,
  ToolBlock,
  ToolCallGroup,
  UserMessage,
} from './session-message-list/blocks'
import { groupMessages } from './session-message-list/render-items'

export interface SessionMessageListProps {
  messages: MsgItem[]
  onAnswer: (toolId: string, answers: Record<string, string[]>) => void
  emptyLabel?: string
  agentAvatarUrl?: string | null
  agentAccentColor?: string | null
}

export function SessionMessageList({
  messages,
  onAnswer,
  emptyLabel = 'No messages yet.',
  agentAvatarUrl,
  agentAccentColor,
}: SessionMessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="session-message-empty rounded border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white/60">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="session-message-list space-y-2">
      <RunningAgentsPanel messages={messages} />
      {groupMessages(messages).map((item) => {
        if (item.type === 'tool-group') {
          return <ToolCallGroup key={item.id} tools={item.tools} onAnswer={onAnswer} />
        }

        const message = item.msg
        switch (message.kind) {
          case 'system':
            return <SystemDivider key={message.id} text={message.text} />
          case 'user':
            return <UserMessage key={message.id} text={message.text} images={message.images} />
          case 'thinking':
            return <ThinkingBlock key={message.id} text={message.text} />
          case 'planning':
            return <PlanningBlock key={message.id} msg={message} />
          case 'agent':
            return (
              <AgentMessage
                key={message.id}
                text={message.text}
                avatarUrl={agentAvatarUrl}
                accentColor={agentAccentColor}
              />
            )
          case 'tool':
            return <ToolBlock key={message.id} msg={message} onAnswer={onAnswer} />
          case 'ask':
            return <AskUserQuestionBlock key={message.id} msg={message} onAnswer={onAnswer} />
          default:
            return null
        }
      })}
    </div>
  )
}
