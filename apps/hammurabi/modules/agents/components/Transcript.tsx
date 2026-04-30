import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { HammurabiEvent } from '@/types'
import { cn } from '@/lib/utils'
import type { MsgItem } from '../messages/model'
import { SessionMessageList } from './SessionMessageList'
import { useStreamEventProcessor } from './use-stream-event-processor'

export interface TranscriptHandle {
  resetAutoScroll: () => void
}

export interface TranscriptProps {
  events?: HammurabiEvent[]
  messages?: MsgItem[]
  sessionId: string
  agentAvatarUrl?: string
  agentAccentColor?: string
  onAnswer?: (toolId: string, answers: Record<string, string[]>) => void
  dark?: boolean
  className?: string
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(function Transcript(
  {
    events,
    messages,
    sessionId,
    agentAvatarUrl,
    agentAccentColor,
    onAnswer,
    dark = false,
    className,
  },
  ref,
) {
  const {
    messages: processedMessages,
    processEvent,
    resetMessages,
  } = useStreamEventProcessor({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const directMessages = messages
  const useDirectMessages = directMessages !== undefined
  const renderedMessages = useDirectMessages ? directMessages : processedMessages

  function scrollToBottom(): void {
    const anchor = messagesEndRef.current
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    if (useDirectMessages) {
      return
    }

    resetMessages()
    for (const event of events ?? []) {
      processEvent(event, true)
    }
  }, [events, processEvent, resetMessages, sessionId, useDirectMessages])

  useEffect(() => {
    autoScrollRef.current = true
    scrollToBottom()
  }, [sessionId])

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom()
    }
  }, [renderedMessages])

  function handleScroll() {
    const area = messagesAreaRef.current
    if (!area) {
      return
    }

    autoScrollRef.current =
      area.scrollHeight - area.scrollTop - area.clientHeight < 60
  }

  useImperativeHandle(ref, () => ({
    resetAutoScroll() {
      autoScrollRef.current = true
      scrollToBottom()
    },
  }), [])

  return (
    <div
      ref={messagesAreaRef}
      className={cn('messages-area', dark && 'hv-dark', className)}
      onScroll={handleScroll}
    >
      <SessionMessageList
        messages={renderedMessages}
        onAnswer={onAnswer ?? (() => {})}
        emptyLabel="Session started"
        agentAvatarUrl={agentAvatarUrl}
        agentAccentColor={agentAccentColor}
      />
      <div ref={messagesEndRef} />
    </div>
  )
})

export default Transcript
