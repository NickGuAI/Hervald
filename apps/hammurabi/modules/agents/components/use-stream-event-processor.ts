import { useCallback, useRef, useState } from 'react'
import type { StreamEvent } from '@/types'
import { capMessages, type MsgItem } from '../messages/model'
import {
  createStreamProcessorState,
  markAskAnsweredMessages,
  processStreamEvent,
  resetStreamProcessorState,
  type StreamEventProcessorContext,
} from '../messages/stream-event-machine'

export function useStreamEventProcessor(options?: {
  onWorkspaceMutation?: () => void
}) {
  const onWorkspaceMutation = options?.onWorkspaceMutation
  const idCounterRef = useRef(0)
  const processorStateRef = useRef(createStreamProcessorState())

  const [messages, setMessages] = useState<MsgItem[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  const nextId = useCallback(() => `msg-${++idCounterRef.current}`, [])

  const resetMessages = useCallback(() => {
    idCounterRef.current = 0
    resetStreamProcessorState(processorStateRef.current)
    setMessages([])
    setIsStreaming(false)
  }, [])

  const markAskAnswered = useCallback((toolId: string) => {
    setMessages((prev) => markAskAnsweredMessages(prev, toolId))
  }, [])

  const processEventCallback = useCallback(
    (event: StreamEvent, isReplay = false) => {
      const context: StreamEventProcessorContext = {
        state: processorStateRef.current,
        nextId,
        setMessages,
        setIsStreaming,
        onWorkspaceMutation,
      }

      processStreamEvent(context, event, isReplay)
    },
    [nextId, onWorkspaceMutation],
  )

  const pushUserMessage = useCallback(
    (text: string) => {
      setMessages((prev) => capMessages([
        ...prev,
        { id: nextId(), kind: 'user', text },
      ]))
    },
    [nextId],
  )

  return {
    messages,
    setMessages,
    processEvent: processEventCallback,
    resetMessages,
    isStreaming,
    markAskAnswered,
    pushUserMessage,
  }
}
