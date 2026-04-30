import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { fetchJson, fetchVoid, getAccessToken } from '../../../src/lib/api'
import { getWsBase } from '../../../src/lib/api-base'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../../agents/ws-reconnect'

const MAX_WIZARD_LINES = 400

type WizardLineRole = 'assistant' | 'user' | 'system'

interface WizardLine {
  id: number
  role: WizardLineRole
  text: string
}

interface WizardStartResponse {
  sessionName: string
  created: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function splitLines(raw: string): string[] {
  return raw
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function assistantLinesFromPayload(payload: Record<string, unknown>): string[] {
  const message = payload.message
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return []
  }

  const lines: string[] = []
  for (const block of message.content) {
    if (!isRecord(block)) {
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      lines.push(...splitLines(block.text))
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      lines.push(...splitLines(block.thinking))
      continue
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      lines.push(`[tool] ${block.name}`)
    }
  }
  return lines
}

function userToolLinesFromPayload(payload: Record<string, unknown>): string[] {
  const toolUseResult = payload.tool_use_result
  if (!isRecord(toolUseResult)) {
    return []
  }
  const lines: string[] = []
  if (typeof toolUseResult.stdout === 'string') {
    lines.push(...splitLines(toolUseResult.stdout))
  }
  if (typeof toolUseResult.stderr === 'string') {
    lines.push(...splitLines(toolUseResult.stderr))
  }
  return lines
}

function eventToLines(event: Record<string, unknown>): WizardLine[] {
  const eventType = typeof event.type === 'string' ? event.type : ''
  if (eventType === 'assistant') {
    return assistantLinesFromPayload(event).map((text) => ({ id: 0, role: 'assistant', text }))
  }
  if (eventType === 'system' && typeof event.text === 'string') {
    return splitLines(event.text).map((text) => ({ id: 0, role: 'system', text }))
  }
  if (eventType === 'result' && typeof event.result === 'string') {
    return splitLines(event.result).map((text) => ({ id: 0, role: 'system', text }))
  }
  if (eventType === 'user') {
    return userToolLinesFromPayload(event).map((text) => ({ id: 0, role: 'system', text }))
  }
  return []
}

function parseIncomingLines(data: unknown): WizardLine[] {
  let parsed: unknown = data
  if (data instanceof ArrayBuffer) {
    parsed = new TextDecoder().decode(data)
  }

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch {
      return splitLines(parsed).map((text) => ({ id: 0, role: 'system', text }))
    }
  }

  if (!isRecord(parsed)) {
    return []
  }

  if (parsed.type === 'replay' && Array.isArray(parsed.events)) {
    const lines: WizardLine[] = []
    for (const event of parsed.events) {
      if (isRecord(event)) {
        lines.push(...eventToLines(event))
      }
    }
    return lines
  }

  return eventToLines(parsed)
}

function wizardWsUrl(sessionName: string, token: string | null): string {
  const query = new URLSearchParams()
  if (token) {
    query.set('access_token', token)
  }

  const wsBase = getWsBase()
  const sessionPath = `/api/agents/sessions/${encodeURIComponent(sessionName)}/ws`
  const queryString = query.toString()
  if (wsBase) {
    return `${wsBase}${sessionPath}?${queryString}`
  }

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${sessionPath}?${queryString}`
}

async function startWizardSession(): Promise<WizardStartResponse> {
  return fetchJson<WizardStartResponse>('/api/commanders/wizard/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentType: 'claude',
      effort: 'low',
    }),
  })
}

async function sendWizardMessage(sessionName: string, text: string): Promise<void> {
  await fetchJson<{ sent: boolean }>(
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/send`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  )
}

async function cleanupWizardSession(sessionName: string): Promise<void> {
  await fetchVoid(`/api/commanders/wizard/${encodeURIComponent(sessionName)}`, { method: 'DELETE' })
}

function keepLatestLines(lines: WizardLine[]): WizardLine[] {
  if (lines.length <= MAX_WIZARD_LINES) {
    return lines
  }
  return lines.slice(-MAX_WIZARD_LINES)
}

function isWizardCreateSuccessLine(text: string): boolean {
  return /^WIZARD_CREATE_SUCCESS\s+\S+\s+\S+$/.test(text.trim())
}

export function WizardChatPanel({
  onCancel,
  onCreated,
}: {
  onCancel?: () => void
  onCreated?: () => void
}) {
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting')
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'disconnected',
  )
  const [lines, setLines] = useState<WizardLine[]>([])
  const [composerValue, setComposerValue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const nextLineId = useRef(1)
  const completedRef = useRef(false)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const sessionNameRef = useRef<string | null>(null)

  useEffect(() => {
    sessionNameRef.current = sessionName
  }, [sessionName])

  useEffect(() => {
    setStatus('starting')
    setActionError(null)
    setLines([])
    completedRef.current = false

    let disposed = false
    let startedSessionName: string | null = null

    void startWizardSession()
      .then((started) => {
        if (disposed) {
          void cleanupWizardSession(started.sessionName).catch(() => {})
          return
        }
        startedSessionName = started.sessionName
        setSessionName(started.sessionName)
        setStatus('ready')
      })
      .catch((error) => {
        if (disposed) {
          return
        }
        setStatus('failed')
        setActionError(error instanceof Error ? error.message : 'Failed to start wizard session.')
      })

    return () => {
      disposed = true
      if (startedSessionName) {
        void cleanupWizardSession(startedSessionName).catch(() => {})
      }
    }
  }, [retryCount])

  useEffect(() => {
    if (!sessionName) {
      setConnectionStatus('disconnected')
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let disposed = false
    const reconnectBackoff = createReconnectBackoff()

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const appendParsedLines = (incoming: WizardLine[]) => {
      if (incoming.length === 0) {
        return
      }

      const withIds = incoming.map((line) => ({
        ...line,
        id: nextLineId.current++,
      }))

      const hasCreateSuccess = withIds.some((line) => isWizardCreateSuccessLine(line.text))
      setLines((current) => keepLatestLines([...current, ...withIds]))

      if (!hasCreateSuccess || completedRef.current) {
        return
      }
      completedRef.current = true
      setActionError(null)

      const activeSessionName = sessionNameRef.current
      if (!activeSessionName) {
        return
      }

      setIsClosing(true)
      void cleanupWizardSession(activeSessionName)
        .catch(() => {})
        .finally(() => {
          setSessionName(null)
          setConnectionStatus('disconnected')
          setIsClosing(false)
          onCreated?.()
        })
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return
      }
      setConnectionStatus('connecting')
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, reconnectBackoff.nextDelayMs())
    }

    const connect = async () => {
      clearReconnectTimer()
      setConnectionStatus('connecting')
      const token = await getAccessToken()
      if (disposed) {
        return
      }

      const nextSocket = new WebSocket(wizardWsUrl(sessionName, token))
      nextSocket.binaryType = 'arraybuffer'
      socket = nextSocket

      nextSocket.onopen = () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        reconnectBackoff.reset()
        setConnectionStatus('connected')
      }

      nextSocket.onmessage = (event) => {
        if (disposed || socket !== nextSocket) {
          return
        }
        appendParsedLines(parseIncomingLines(event.data))
      }

      nextSocket.onerror = () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        if (
          nextSocket.readyState === WebSocket.CONNECTING ||
          nextSocket.readyState === WebSocket.OPEN
        ) {
          nextSocket.close()
        }
      }

      nextSocket.onclose = (event) => {
        if (disposed || socket !== nextSocket) {
          return
        }
        socket = null
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect()
          return
        }
        setConnectionStatus('disconnected')
      }
    }

    void connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      setConnectionStatus('disconnected')
      const activeSocket = socket
      socket = null
      if (
        activeSocket &&
        (activeSocket.readyState === WebSocket.CONNECTING || activeSocket.readyState === WebSocket.OPEN)
      ) {
        activeSocket.close()
      }
    }
  }, [onCreated, sessionName])

  useEffect(() => {
    if (!feedRef.current) {
      return
    }
    feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [lines])

  const handleSend = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const activeSessionName = sessionNameRef.current
    const text = composerValue.trim()
    if (!activeSessionName || !text) {
      return
    }

    setActionError(null)
    setIsSending(true)
    setComposerValue('')
    setLines((current) => keepLatestLines([
      ...current,
      { id: nextLineId.current++, role: 'user', text },
    ]))

    try {
      await sendWizardMessage(activeSessionName, text)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to send message.')
    } finally {
      setIsSending(false)
    }
  }, [composerValue])

  const handleCancel = useCallback(async () => {
    const activeSessionName = sessionNameRef.current
    setIsClosing(true)
    setActionError(null)

    try {
      if (activeSessionName) {
        await cleanupWizardSession(activeSessionName)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to close wizard session.')
      setIsClosing(false)
      return
    }

    setSessionName(null)
    setConnectionStatus('disconnected')
    setIsClosing(false)
    onCancel?.()
  }, [onCancel])

  return (
    <div className="rounded-lg border border-dashed border-ink-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-sumi-gray">Talk to Me</p>
          <p className="text-whisper text-sumi-diluted">
            Ask for a commander setup and confirm when the preview looks right.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={isClosing}
          className="rounded-lg border border-ink-border px-3 py-1.5 text-xs min-h-[44px] min-w-[44px] hover:bg-ink-wash disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isClosing ? 'Closing...' : 'Cancel'}
        </button>
      </div>

      <div className="text-whisper text-sumi-diluted">
        <span className="mr-3">session: {sessionName ?? 'starting...'}</span>
        <span>socket: {connectionStatus}</span>
      </div>

      {status === 'failed' ? (
        <div className="rounded-lg border border-accent-vermillion/40 bg-accent-vermillion/5 p-3 space-y-2">
          <p className="text-sm text-accent-vermillion">
            {actionError ?? 'Failed to start wizard session.'}
          </p>
          <button
            type="button"
            onClick={() => setRetryCount((current) => current + 1)}
            className="rounded-lg border border-ink-border px-3 py-1.5 text-xs min-h-[44px] min-w-[44px] hover:bg-ink-wash transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div
            ref={feedRef}
            className="h-72 overflow-y-auto rounded-lg border border-ink-border bg-washi-white p-3 space-y-2"
          >
            {status === 'starting' && lines.length === 0 && (
              <p className="text-sm text-sumi-diluted">Starting wizard session...</p>
            )}
            {status === 'ready' && lines.length === 0 && (
              <p className="text-sm text-sumi-diluted">Waiting for the wizard to respond...</p>
            )}
            {lines.map((line) => (
              <div
                key={line.id}
                className={
                  line.role === 'user'
                    ? 'text-sm text-sumi-black'
                    : line.role === 'assistant'
                      ? 'text-sm text-sumi-gray'
                      : 'text-whisper text-sumi-diluted'
                }
              >
                {line.role === 'user' ? 'You: ' : line.role === 'assistant' ? 'Agent: ' : ''}
                {line.text}
              </div>
            ))}
          </div>

          <form onSubmit={(event) => void handleSend(event)} className="flex gap-2">
            <input
              value={composerValue}
              onChange={(event) => setComposerValue(event.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg border border-ink-border px-3 py-2 text-[16px] md:text-sm bg-washi-white focus:outline-none focus:ring-1 focus:ring-sumi-black/20 placeholder:text-sumi-mist"
              disabled={!sessionName || isSending || isClosing}
            />
            <button
              type="submit"
              disabled={!sessionName || !composerValue.trim() || isSending || isClosing}
              className="rounded-lg border border-ink-border px-3 py-1.5 text-sm min-h-[44px] min-w-[44px] hover:bg-ink-wash disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </>
      )}

      {actionError && status !== 'failed' && (
        <p className="text-sm text-accent-vermillion">{actionError}</p>
      )}
    </div>
  )
}
