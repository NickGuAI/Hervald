import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson, getAccessToken } from '@/lib/api'
import { getWsBase } from '@/lib/api-base'
import { useIsMobile } from '@/hooks/use-is-mobile'
import type {
  AgentType,
  SessionQueueSnapshot,
  SessionType,
  StreamEvent,
} from '@/types'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../ws-reconnect'
import { WorkspaceOverlay } from '../components/WorkspaceOverlay'
import { capMessages, createUserMessage } from '../components/session-messages'
import { useStreamEventProcessor } from '../components/use-stream-event-processor'
import type { SessionComposerSubmitPayload } from '../components/SessionComposer'
import { supportsQueuedDrafts } from '../queue-capability'
import { runQueueMutationRequest } from '../queue-mutation'
import {
  EMPTY_QUEUE_SNAPSHOT,
  normalizeQueueSnapshot,
} from '../queue-state'
import type { WorkspaceSource } from '../../workspace/use-workspace'
import { MobileSessionShell } from './MobileSessionShell'
import {
  fallbackWorkerSummary,
  formatError,
  isNotFoundRequestFailure,
  summarizeWorkers,
  workerStatusClass,
  workerStatusSymbol,
  type WorkerInfo,
} from './session-helpers'

export interface MobileSessionViewProps {
  sessionName: string
  sessionLabel?: string
  agentType?: AgentType
  sessionType?: SessionType
  commanderId?: string | null
  sessionCwd?: string
  initialSpawnedWorkers?: string[]
  onClose: () => void
  onKill: (sessionName: string, agentType?: AgentType) => Promise<void>
  onNavigateToSession?: (sessionName: string) => void
  onRefreshSessions?: () => Promise<void>
}

export function MobileSessionView({
  sessionName,
  sessionLabel,
  agentType,
  sessionType,
  commanderId,
  sessionCwd,
  initialSpawnedWorkers,
  onClose,
  onKill,
  onNavigateToSession,
  onRefreshSessions,
}: MobileSessionViewProps) {
  const isMobile = useIsMobile()
  const {
    messages,
    setMessages,
    processEvent,
    resetMessages,
    isStreaming,
    markAskAnswered,
  } = useStreamEventProcessor({})

  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [isKilling, setIsKilling] = useState(false)
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  const [startedAt] = useState(() => Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)
  const [queueSnapshot, setQueueSnapshot] = useState<SessionQueueSnapshot>(EMPTY_QUEUE_SNAPSHOT)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [isQueueMutating, setIsQueueMutating] = useState(false)
  const queueDraftsSupported = supportsQueuedDrafts(agentType)
  const [workers, setWorkers] = useState<WorkerInfo[]>([])
  const [knownWorkerNames, setKnownWorkerNames] = useState<string[]>(initialSpawnedWorkers ?? [])
  const [workersOpen, setWorkersOpen] = useState(false)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [dispatchTask, setDispatchTask] = useState('')
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [isDispatching, setIsDispatching] = useState(false)
  const [dismissedWorkers, setDismissedWorkers] = useState<Set<string>>(new Set())
  const [fileChips, setFileChips] = useState<string[]>([])
  const [showWorkspaceOverlay, setShowWorkspaceOverlay] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const sessionNameRef = useRef(sessionName)
  const workersMenuRef = useRef<HTMLDivElement>(null)
  const initialWorkersRef = useRef<string[]>(initialSpawnedWorkers ?? [])

  useEffect(() => {
    sessionNameRef.current = sessionName
  }, [sessionName])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  useEffect(() => {
    setDismissedWorkers(new Set())
  }, [sessionName])

  const refreshQueueSnapshot = useCallback(async () => {
    const nextQueue = await fetchJson<SessionQueueSnapshot>(
      `/api/agents/sessions/${encodeURIComponent(sessionName)}/queue`,
    )
    if (sessionNameRef.current !== sessionName) {
      return nextQueue
    }
    setQueueSnapshot(normalizeQueueSnapshot(nextQueue))
    return nextQueue
  }, [sessionName])

  const clearContextFileChips = useCallback(() => {
    setFileChips([])
  }, [])

  const runQueueMutation = useCallback(async (
    request: () => Promise<unknown>,
    errorLabel: string,
  ) => {
    if (isQueueMutating) {
      return false
    }

    setQueueError(null)
    setIsQueueMutating(true)
    try {
      return await runQueueMutationRequest(request, refreshQueueSnapshot, {
        onMutationError: (caughtError) => {
          setQueueError(formatError(caughtError, errorLabel))
        },
        onRefreshError: (caughtError) => {
          setQueueError(formatError(caughtError, 'Queue updated, but failed to refresh queue'))
        },
      })
    } finally {
      setIsQueueMutating(false)
    }
  }, [isQueueMutating, refreshQueueSnapshot])

  useEffect(() => {
    let cancelled = false

    setQueueSnapshot(EMPTY_QUEUE_SNAPSHOT)
    setQueueError(null)
    if (!queueDraftsSupported) {
      return () => {
        cancelled = true
      }
    }

    void refreshQueueSnapshot().catch((caughtError) => {
      if (!cancelled && !isNotFoundRequestFailure(caughtError)) {
        setQueueError(formatError(caughtError, 'Failed to load message queue'))
      }
    })

    return () => {
      cancelled = true
    }
  }, [queueDraftsSupported, refreshQueueSnapshot, sessionName])

  useEffect(() => {
    initialWorkersRef.current = initialSpawnedWorkers ?? []
  }, [initialSpawnedWorkers])

  useEffect(() => {
    setWorkers([])
    setKnownWorkerNames(initialWorkersRef.current)
    setWorkersOpen(false)
    setDispatchOpen(false)
    setDispatchError(null)
    setDispatchTask('')
  }, [sessionName])

  const commanderIdForUi = useMemo(() => {
    if (sessionType !== 'commander') {
      return null
    }
    const normalizedId = commanderId?.trim()
    return normalizedId && normalizedId.length > 0 ? normalizedId : null
  }, [commanderId, sessionType])

  const { data: commanderUiPayload } = useQuery({
    queryKey: ['commanders', 'detail-ui', commanderIdForUi],
    queryFn: () =>
      fetchJson<{
        avatarUrl?: string | null
        ui?: { accentColor?: string; borderColor?: string; speakingTone?: string } | null
      }>(`/api/commanders/${encodeURIComponent(commanderIdForUi!)}`),
    enabled: Boolean(commanderIdForUi),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!initialSpawnedWorkers || initialSpawnedWorkers.length === 0) {
      return
    }
    setKnownWorkerNames((prev) => {
      const merged = new Set([...prev, ...initialSpawnedWorkers])
      if (merged.size === prev.length) {
        return prev
      }
      return [...merged]
    })
  }, [initialSpawnedWorkers])

  const refreshWorkers = useCallback(async () => {
    const nextWorkers = await fetchJson<WorkerInfo[]>(
      `/api/agents/sessions/${encodeURIComponent(sessionName)}/workers`,
    )
    setWorkers(nextWorkers)
    setKnownWorkerNames((prev) => {
      const merged = new Set(prev)
      for (const worker of nextWorkers) {
        merged.add(worker.name)
      }
      if (merged.size === prev.length) {
        return prev
      }
      return [...merged]
    })
    return nextWorkers
  }, [sessionName])

  useEffect(() => {
    if (knownWorkerNames.length === 0) {
      return
    }

    let cancelled = false
    const fetchAndStore = async () => {
      try {
        if (cancelled) {
          return
        }
        await refreshWorkers()
      } catch {
        // Keep stale worker state until the next poll succeeds.
      }
    }

    void fetchAndStore()
    const interval = window.setInterval(() => {
      void fetchAndStore()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [knownWorkerNames.length, refreshWorkers])

  useEffect(() => {
    if (isMobile || !workersOpen) {
      return
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (!workersMenuRef.current?.contains(target)) {
        setWorkersOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [isMobile, workersOpen])

  useEffect(() => {
    resetMessages()
    setMessages([{ id: `system-${Date.now()}`, kind: 'system', text: 'Session started' }])
    setWsStatus('connecting')
    let disposed = false
    let reconnectTimer: number | null = null

    const reconnectBackoff = createReconnectBackoff()

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return
      }

      setWsStatus('connecting')
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, reconnectBackoff.nextDelayMs())
    }

    const connect = async () => {
      clearReconnectTimer()
      setWsStatus('connecting')

      const token = await getAccessToken()
      if (disposed) {
        return
      }

      const params = new URLSearchParams()
      if (token) {
        params.set('access_token', token)
      }
      const wsBase = getWsBase()
      const url = wsBase
        ? `${wsBase}/api/agents/sessions/${encodeURIComponent(sessionName)}/ws?${params}`
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/agents/sessions/${encodeURIComponent(sessionName)}/ws?${params}`

      const nextSocket = new WebSocket(url)
      wsRef.current = nextSocket

      nextSocket.onopen = () => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }
        reconnectBackoff.reset()
        setWsStatus('connected')
        if (queueDraftsSupported) {
          void refreshQueueSnapshot().catch(() => {
            // Keep the last known queue state until the next refresh succeeds.
          })
        }
      }

      nextSocket.onclose = (event) => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }

        wsRef.current = null
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect()
          return
        }

        setWsStatus('disconnected')
      }

      nextSocket.onerror = () => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }

        if (
          nextSocket.readyState === WebSocket.CONNECTING
          || nextSocket.readyState === WebSocket.OPEN
        ) {
          nextSocket.close()
        }
      }

      nextSocket.onmessage = (evt) => {
        if (disposed || wsRef.current !== nextSocket) {
          return
        }
        try {
          const raw = JSON.parse(evt.data as string) as {
            type: string
            events?: StreamEvent[]
            usage?: { inputTokens: number; outputTokens: number; costUsd: number }
            toolId?: string
            queue?: SessionQueueSnapshot
          }
          if (raw.type === 'replay' && Array.isArray(raw.events)) {
            resetMessages()
            if (raw.events.length === 0) {
              setMessages([{ id: `system-${Date.now()}`, kind: 'system', text: 'Session started' }])
            }
            if (raw.queue) {
              setQueueSnapshot(normalizeQueueSnapshot(raw.queue))
            }

            for (const event of raw.events) {
              processEvent(event, true)
            }

            setUsage(raw.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 })
          } else if (raw.type === 'queue_update' && raw.queue) {
            setQueueSnapshot(normalizeQueueSnapshot(raw.queue))
            setQueueError(null)
          } else if (raw.type === 'tool_answer_ack' && raw.toolId) {
            markAskAnswered(raw.toolId)
            setMessages((prev) =>
              prev.map((message) =>
                message.toolId === raw.toolId ? { ...message, askSubmitting: false } : message,
              ),
            )
          } else if (raw.type === 'tool_answer_error' && raw.toolId) {
            setMessages((prev) =>
              prev.map((message) =>
                message.toolId === raw.toolId ? { ...message, askSubmitting: false } : message,
              ),
            )
          } else {
            const streamEvent = raw as StreamEvent
            if (streamEvent.type === 'assistant' && streamEvent.message.usage) {
              setUsage((prev) => ({
                inputTokens: prev.inputTokens + (streamEvent.message.usage?.input_tokens ?? 0),
                outputTokens: prev.outputTokens + (streamEvent.message.usage?.output_tokens ?? 0),
                costUsd: prev.costUsd,
              }))
            }
            if (streamEvent.type === 'message_delta' && streamEvent.usage) {
              const usageIsTotal = (streamEvent as StreamEvent & { usage_is_total?: boolean }).usage_is_total === true
              setUsage((prev) => ({
                inputTokens: usageIsTotal
                  ? (streamEvent.usage?.input_tokens ?? prev.inputTokens)
                  : prev.inputTokens + (streamEvent.usage?.input_tokens ?? 0),
                outputTokens: usageIsTotal
                  ? (streamEvent.usage?.output_tokens ?? prev.outputTokens)
                  : prev.outputTokens + (streamEvent.usage?.output_tokens ?? 0),
                costUsd: prev.costUsd,
              }))
            }
            if (
              streamEvent.type === 'result'
              && (streamEvent.cost_usd !== undefined
                || streamEvent.total_cost_usd !== undefined
                || streamEvent.usage)
            ) {
              setUsage((prev) => ({
                inputTokens: streamEvent.usage?.input_tokens ?? prev.inputTokens,
                outputTokens: streamEvent.usage?.output_tokens ?? prev.outputTokens,
                costUsd: streamEvent.total_cost_usd ?? streamEvent.cost_usd ?? prev.costUsd,
              }))
            }
            processEvent(streamEvent)
          }
        } catch {
          // Ignore non-JSON messages.
        }
      }
    }

    void connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [markAskAnswered, processEvent, queueDraftsSupported, refreshQueueSnapshot, resetMessages, sessionName, setMessages])

  const handleSend = useCallback((payload: SessionComposerSubmitPayload) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return false
    }

    const text = payload.text.trim()
    const images = payload.images?.length ? payload.images.slice() : []
    if (!text && images.length === 0) {
      return false
    }

    setMessages((prev) =>
      capMessages([
        ...prev,
        createUserMessage(
          `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text || '[image]',
          images,
        ),
      ]),
    )

    wsRef.current.send(JSON.stringify({
      type: 'input',
      text,
      images: images.length > 0 ? images : undefined,
    }))
    return true
  }, [setMessages])

  const handleQueueDraft = useCallback(async (payload: SessionComposerSubmitPayload) => {
    if (!queueDraftsSupported) {
      return false
    }

    const text = payload.text.trim()
    const images = payload.images?.length ? payload.images : undefined
    if (!text && !images) {
      return false
    }

    return runQueueMutation(
      () =>
        fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}/message?queue=true`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text, images }),
        }),
      'Failed to queue message',
    )
  }, [queueDraftsSupported, runQueueMutation, sessionName])

  const handleMoveQueuedMessage = useCallback(async (messageId: string, offset: number) => {
    const currentIndex = queueSnapshot.items.findIndex((message) => message.id === messageId)
    const nextIndex = currentIndex + offset
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= queueSnapshot.items.length) {
      return
    }

    const reordered = [...queueSnapshot.items]
    const [movedMessage] = reordered.splice(currentIndex, 1)
    if (!movedMessage) {
      return
    }
    reordered.splice(nextIndex, 0, movedMessage)

    await runQueueMutation(
      () =>
        fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}/queue/reorder`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ order: reordered.map((message) => message.id) }),
        }),
      'Failed to reorder queued messages',
    )
  }, [queueSnapshot.items, runQueueMutation, sessionName])

  const handleRemoveQueuedMessage = useCallback(async (messageId: string) => {
    await runQueueMutation(
      () =>
        fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}/queue/${encodeURIComponent(messageId)}`, {
          method: 'DELETE',
        }),
      'Failed to remove queued message',
    )
  }, [runQueueMutation, sessionName])

  const handleClearQueue = useCallback(async () => {
    await runQueueMutation(
      () =>
        fetchJson(`/api/agents/sessions/${encodeURIComponent(sessionName)}/queue`, {
          method: 'DELETE',
        }),
      'Failed to clear queued messages',
    )
  }, [runQueueMutation, sessionName])

  const handleAnswer = useCallback((toolId: string, answers: Record<string, string[]>) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return
    }

    setMessages((prev) => prev.map((message) => (
      message.toolId === toolId ? { ...message, askSubmitting: true } : message
    )))
    wsRef.current.send(JSON.stringify({ type: 'tool_answer', toolId, answers }))
  }, [setMessages])

  const handleKillConfirmed = useCallback(async () => {
    if (isKilling) {
      return
    }

    setIsKilling(true)
    try {
      await onKill(sessionName, agentType)
    } catch {
      // Error surfaced through parent.
    } finally {
      setIsKilling(false)
    }
  }, [agentType, isKilling, onKill, sessionName])

  const handleDispatch = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isDispatching) {
      return
    }

    const task = dispatchTask.trim()

    setIsDispatching(true)
    setDispatchError(null)

    try {
      const created = await fetchJson<{ name: string }>(
        '/api/agents/sessions/dispatch-worker',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            spawnedBy: sessionName,
            cwd: sessionCwd,
            task: task || undefined,
          }),
        },
      )

      setKnownWorkerNames((prev) => (prev.includes(created.name) ? prev : [...prev, created.name]))
      setWorkers((prev) => (
        prev.some((worker) => worker.name === created.name)
          ? prev
          : [{ name: created.name, status: 'starting', phase: 'starting' }, ...prev]
      ))
      setDispatchTask('')
      setDispatchOpen(false)
      setWorkersOpen(true)

      if (onRefreshSessions) {
        await onRefreshSessions()
      }
      void refreshWorkers()
    } catch (caughtError) {
      setDispatchError(formatError(caughtError, 'Failed to dispatch worker'))
    } finally {
      setIsDispatching(false)
    }
  }, [dispatchTask, isDispatching, onRefreshSessions, refreshWorkers, sessionCwd, sessionName])

  const handleOpenWorker = useCallback((workerSessionName: string) => {
    setWorkersOpen(false)
    setDispatchOpen(false)
    onNavigateToSession?.(workerSessionName)
  }, [onNavigateToSession])

  const allWorkerRows = workers.length > 0
    ? workers
    : knownWorkerNames.map((name) => ({
      name,
      status: 'starting' as const,
      phase: 'starting' as const,
    }))
  const workerRows = allWorkerRows.filter((worker) => !dismissedWorkers.has(worker.name))

  const handleClearDone = useCallback(() => {
    const doneNames = allWorkerRows
      .filter((worker) => worker.status === 'done')
      .map((worker) => worker.name)
    setDismissedWorkers((prev) => {
      const next = new Set(prev)
      for (const name of doneNames) {
        next.add(name)
      }
      return next
    })
  }, [allWorkerRows])

  const workerSummary = workerRows.length > 0
    ? summarizeWorkers(workerRows)
    : workers.length > 0
      ? { total: 0, running: 0, starting: 0, done: 0, down: 0 }
      : fallbackWorkerSummary(knownWorkerNames.length)
  const hasDoneWorkers = workerSummary.done > 0
  const showWorkersPill = true
  const workerPillText = (() => {
    if (workerSummary.total === 0) {
      return '+'
    }
    const parts: string[] = []
    if (workerSummary.running > 0) parts.push(`●${workerSummary.running}`)
    if (workerSummary.starting > 0) parts.push(`○${workerSummary.starting}`)
    if (workerSummary.down > 0) parts.push(`⊘${workerSummary.down}`)
    if (parts.length === 0 && workerSummary.done > 0) parts.push(`✓${workerSummary.done}`)
    return parts.join(' ') || '+'
  })()

  const workspaceSource: WorkspaceSource | null = sessionCwd
    ? { kind: 'agent-session', sessionName }
    : null

  const handleAddFileChip = useCallback((filePath: string) => {
    setFileChips((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]))
  }, [])

  const removeFileChip = useCallback((filePath: string) => {
    setFileChips((prev) => prev.filter((entry) => entry !== filePath))
  }, [])

  return (
    <>
      <MobileSessionShell
        sessionName={sessionName}
        sessionLabel={sessionLabel ?? sessionName}
        agentType={agentType}
        sessionType="stream"
        commanderId={commanderIdForUi}
        wsStatus={wsStatus}
        costUsd={usage.costUsd}
        durationSec={elapsedSec}
        messages={messages}
        onAnswer={handleAnswer}
        agentAvatarUrl={isCommanderSession ? commanderUiPayload?.avatarUrl ?? undefined : undefined}
        agentAccentColor={isCommanderSession ? commanderUiPayload?.ui?.accentColor ?? undefined : undefined}
        onSend={handleSend}
        onQueue={queueDraftsSupported ? handleQueueDraft : undefined}
        canQueueDraft={queueDraftsSupported}
        queueSnapshot={queueSnapshot}
        queueError={queueError}
        isQueueMutating={isQueueMutating}
        onClearQueue={() => { void handleClearQueue() }}
        onMoveQueuedMessage={(messageId, offset) => { void handleMoveQueuedMessage(messageId, offset) }}
        onRemoveQueuedMessage={(messageId) => { void handleRemoveQueuedMessage(messageId) }}
        composerEnabled={wsStatus === 'connected'}
        composerSendReady={wsStatus === 'connected'}
        composerPlaceholder="Send a message..."
        theme="dark"
        onBack={onClose}
        onKill={handleKillConfirmed}
        onOpenWorkspace={workspaceSource ? () => setShowWorkspaceOverlay(true) : undefined}
        onNewQuest={isCommanderSession ? () => undefined : undefined}
        workers={workerRows.map((worker) => ({
          id: worker.name,
          label: worker.name,
          status: worker.status,
        }))}
        workersLabel={workerPillText !== '+' ? workerPillText : undefined}
        onOpenWorkers={showWorkersPill
          ? () => {
            setDispatchError(null)
            if (isMobile) {
              setWorkersOpen(true)
              return
            }
            setWorkersOpen((prev) => !prev)
          }
          : undefined}
        rootClassName="session-view-overlay hv-dark"
        contextFilePaths={fileChips}
        onRemoveContextFilePath={removeFileChip}
        onClearContextFilePaths={clearContextFileChips}
        showComposerWorkspaceShortcut={Boolean(workspaceSource)}
        isStreaming={isStreaming}
      />

      {!isMobile && dispatchOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sumi-black/50 px-4">
          <div className="w-full max-w-md rounded-xl border border-ink-border bg-washi-white p-4 shadow-ink-md">
            <div className="mb-3 text-sm font-mono text-sumi-black">Dispatch Worker</div>
            <form onSubmit={handleDispatch} className="space-y-3">
              <div>
                <label className="mb-1 block text-whisper text-sumi-diluted">Initial task</label>
                <textarea
                  value={dispatchTask}
                  onChange={(event) => setDispatchTask(event.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-black"
                  placeholder="Optional. Leave blank to create the worker first, then send a command."
                />
              </div>
              {dispatchError && (
                <div className="text-whisper text-accent-vermillion">{dispatchError}</div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-ink-border px-3 py-1.5 text-sm text-sumi-diluted"
                  onClick={() => setDispatchOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sumi-black px-3 py-1.5 text-sm text-white disabled:opacity-60"
                  disabled={isDispatching}
                >
                  {isDispatching ? 'Dispatching...' : 'Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isMobile && (
        <>
          <div
            className={cn('sheet-backdrop', (workersOpen || dispatchOpen) && 'visible')}
            onClick={() => {
              setWorkersOpen(false)
              setDispatchOpen(false)
            }}
          />

          <div
            className={cn('sheet', workersOpen && 'visible')}
            style={{ maxHeight: '50vh', height: '50vh' }}
          >
            <div className="sheet-handle">
              <div className="sheet-handle-bar" />
            </div>
            <div className="px-4 pb-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-mono text-sumi-black">Workers</div>
                <button
                  type="button"
                  className="rounded-md p-1 hover:bg-ink-wash"
                  onClick={() => setWorkersOpen(false)}
                >
                  <X size={16} className="text-sumi-diluted" />
                </button>
              </div>
              <div className="max-h-[30vh] space-y-2 overflow-y-auto">
                {workerRows.length === 0 ? (
                  <div className="py-3 text-sm text-sumi-diluted">No workers yet</div>
                ) : (
                  workerRows.map((worker) => (
                    <button
                      key={worker.name}
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-ink-border px-3 py-2 text-left"
                      onClick={() => handleOpenWorker(worker.name)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-mono text-sumi-black">
                          <span className={cn('mr-1', workerStatusClass(worker.status))}>
                            {workerStatusSymbol(worker.status)}
                          </span>
                          {worker.name}
                        </div>
                        <div className="text-whisper text-sumi-diluted">{worker.status}</div>
                      </div>
                      <ChevronRight size={16} className="text-sumi-mist" />
                    </button>
                  ))
                )}
              </div>
              {hasDoneWorkers && (
                <button
                  type="button"
                  className="mt-3 w-full rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-diluted"
                  onClick={handleClearDone}
                >
                  Clear done
                </button>
              )}
              <button
                type="button"
                className={cn(
                  'w-full rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-black',
                  hasDoneWorkers ? 'mt-1.5' : 'mt-3',
                )}
                onClick={() => {
                  setDispatchError(null)
                  setDispatchOpen(true)
                }}
              >
                + Dispatch New
              </button>
            </div>
          </div>

          <div
            className={cn('sheet', dispatchOpen && 'visible')}
            style={{ maxHeight: '42vh', height: '42vh' }}
          >
            <div className="sheet-handle">
              <div className="sheet-handle-bar" />
            </div>
            <div className="px-4 pb-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-mono text-sumi-black">Dispatch Worker</div>
                <button
                  type="button"
                  className="rounded-md p-1 hover:bg-ink-wash"
                  onClick={() => setDispatchOpen(false)}
                >
                  <X size={16} className="text-sumi-diluted" />
                </button>
              </div>
              <form onSubmit={handleDispatch} className="space-y-3">
                <div>
                  <label className="mb-1 block text-whisper text-sumi-diluted">Initial task</label>
                  <textarea
                    value={dispatchTask}
                    onChange={(event) => setDispatchTask(event.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-ink-border px-3 py-2 text-sm text-sumi-black"
                    placeholder="Optional. Leave blank to create the worker first, then send a command."
                  />
                </div>
                <div className="text-whisper text-sumi-diluted">Parent: {sessionName}</div>
                {dispatchError && (
                  <div className="text-whisper text-accent-vermillion">{dispatchError}</div>
                )}
                <button
                  type="submit"
                  className="w-full rounded-lg bg-sumi-black px-3 py-2 text-sm text-white disabled:opacity-60"
                  disabled={isDispatching}
                >
                  {isDispatching ? 'Dispatching...' : 'Dispatch'}
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {!isMobile && workersOpen && (
        <div ref={workersMenuRef}>
          <div className="fixed inset-0 z-40" onClick={() => setWorkersOpen(false)} />
          <div className="fixed right-4 top-16 z-50 w-72 rounded-xl border border-ink-border bg-washi-white shadow-ink-md">
            <div className="border-b border-ink-border px-3 py-2 text-xs font-mono text-sumi-diluted">Workers</div>
            <div className="max-h-64 overflow-y-auto">
              {workerRows.map((worker) => (
                <button
                  key={worker.name}
                  type="button"
                  className="flex w-full items-center justify-between border-b border-ink-border px-3 py-2 text-left last:border-b-0 hover:bg-washi-shadow/60"
                  onClick={() => handleOpenWorker(worker.name)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-mono text-sumi-black">
                      <span className={cn('mr-1', workerStatusClass(worker.status))}>
                        {workerStatusSymbol(worker.status)}
                      </span>
                      {worker.name}
                    </div>
                    <div className="text-[10px] text-sumi-diluted">{worker.status}</div>
                  </div>
                  <ChevronRight size={14} className="text-sumi-mist" />
                </button>
              ))}
            </div>
            <div className="flex gap-2 border-t border-ink-border p-2">
              {hasDoneWorkers && (
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-ink-border px-2 py-1.5 text-xs text-sumi-diluted hover:bg-washi-shadow/60"
                  onClick={handleClearDone}
                >
                  Clear done
                </button>
              )}
              <button
                type="button"
                className="flex-1 rounded-lg border border-ink-border px-2 py-1.5 text-xs text-sumi-black hover:bg-washi-shadow/60"
                onClick={() => {
                  setDispatchError(null)
                  setDispatchOpen(true)
                }}
              >
                + Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {workspaceSource && (
        <WorkspaceOverlay
          open={showWorkspaceOverlay}
          onClose={() => setShowWorkspaceOverlay(false)}
          onSelectFile={handleAddFileChip}
          source={workspaceSource}
        />
      )}
    </>
  )
}
