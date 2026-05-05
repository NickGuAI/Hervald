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
  const scrollHostRef = useRef<HTMLElement | null>(null)
  const isColdLoadRef = useRef(true)
  const autoScrollRef = useRef(true)
  const directMessages = messages
  const useDirectMessages = directMessages !== undefined
  const renderedMessages = useDirectMessages ? directMessages : processedMessages

  function scrollToBottom(instant = false): void {
    const host = scrollHostRef.current
    if (!host) {
      return
    }

    if (instant) {
      host.scrollTop = host.scrollHeight
      return
    }

    if (typeof host.scrollTo !== 'function') {
      host.scrollTop = host.scrollHeight
      return
    }

    host.scrollTo({ top: host.scrollHeight, behavior: 'smooth' })
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
    const start = messagesAreaRef.current
    if (!start) {
      return
    }

    let host: HTMLElement | null = start
    while (host && host !== document.body) {
      const overflowY = getComputedStyle(host).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        break
      }
      host = host.parentElement
    }

    const resolvedHost = host && host !== document.body ? host : start
    scrollHostRef.current = resolvedHost

    const onScroll = () => {
      autoScrollRef.current =
        resolvedHost.scrollHeight - resolvedHost.scrollTop - resolvedHost.clientHeight <= 120
    }

    resolvedHost.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resolvedHost.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    autoScrollRef.current = true
    isColdLoadRef.current = true
    requestAnimationFrame(() => {
      scrollToBottom(true)
      isColdLoadRef.current = false
    })
  }, [sessionId])

  useEffect(() => {
    if (isColdLoadRef.current) {
      return
    }

    if (autoScrollRef.current) {
      scrollToBottom()
    }
  }, [renderedMessages])

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
