import { useEffect, useRef, useState } from 'react'
import { Power, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/lib/utils'
import { getAccessToken } from '@/lib/api'
import { getWsBase } from '@/lib/api-base'
import type { AgentType } from '@/types'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../ws-reconnect'
import { getKillConfirmationMessage } from './session-helpers'

export interface TerminalViewProps {
  sessionName: string
  sessionLabel?: string
  agentType?: AgentType
  onClose: () => void
  onKill: (sessionName: string, agentType?: AgentType) => Promise<void>
  isMobileOverlay?: boolean
}

export function TerminalView({
  sessionName,
  sessionLabel,
  agentType,
  onClose,
  onKill,
  isMobileOverlay,
}: TerminalViewProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  )
  const [isKilling, setIsKilling] = useState(false)

  useEffect(() => {
    if (!termRef.current) {
      return
    }

    setWsStatus('connecting')

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: !isMobileOverlay,
      fontSize: isMobileOverlay ? 11 : 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0ddd5',
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.loadAddon(new ClipboardAddon())
    terminal.loadAddon(new SearchAddon())
    const unicode11 = new Unicode11Addon()
    terminal.loadAddon(unicode11)
    terminal.unicode.activeVersion = '11'
    terminal.loadAddon(new SerializeAddon())

    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        return false
      }
      return true
    })

    terminal.open(termRef.current)
    fitAddon.fit()

    let ws: WebSocket | null = null
    let resizeObserver: ResizeObserver | null = null
    let disposed = false
    let reconnectTimer: number | null = null
    let hasEstablishedConnection = false

    const reconnectBackoff = createReconnectBackoff()
    const encoder = new TextEncoder()

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
      nextSocket.binaryType = 'arraybuffer'
      ws = nextSocket

      nextSocket.onopen = () => {
        if (disposed || ws !== nextSocket) {
          return
        }

        reconnectBackoff.reset()
        if (hasEstablishedConnection) {
          terminal.reset()
        }
        hasEstablishedConnection = true
        setWsStatus('connected')

        if (nextSocket.readyState === WebSocket.OPEN) {
          nextSocket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
      }

      nextSocket.onclose = (event) => {
        if (disposed || ws !== nextSocket) {
          return
        }

        ws = null
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect()
          return
        }

        setWsStatus('disconnected')
      }

      nextSocket.onerror = () => {
        if (disposed || ws !== nextSocket) {
          return
        }

        if (
          nextSocket.readyState === WebSocket.CONNECTING
          || nextSocket.readyState === WebSocket.OPEN
        ) {
          nextSocket.close()
        }
      }

      nextSocket.onmessage = (event) => {
        if (disposed || ws !== nextSocket) {
          return
        }

        if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data))
        } else {
          try {
            const msg = JSON.parse(event.data as string) as {
              type: string
              exitCode?: number
              signal?: number
            }
            if (msg.type === 'exit') {
              terminal.write(
                `\r\n[Process exited with code ${msg.exitCode ?? 'unknown'}]\r\n`,
              )
            }
          } catch {
            // Ignore invalid control messages
          }
        }
      }
    }

    const dataDisposable = terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data))
      }
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const container = termRef.current
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
      })
      resizeObserver.observe(container)
    }

    void connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      ws?.close()
      resizeObserver?.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      terminal.dispose()
    }
  }, [isMobileOverlay, sessionName])

  async function handleKill() {
    if (isKilling) {
      return
    }

    const confirmed = window.confirm(getKillConfirmationMessage(sessionName, agentType))
    if (!confirmed) {
      return
    }

    setIsKilling(true)
    try {
      await onKill(sessionName, agentType)
    } catch {
      // Error is surfaced through parent state
    } finally {
      setIsKilling(false)
    }
  }

  return (
    <div className={isMobileOverlay ? 'terminal-overlay' : 'flex flex-col h-full'}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-border bg-washi-aged">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-sumi-black">{sessionLabel ?? sessionName}</span>
          <span
            className={cn(
              'badge-sumi',
              wsStatus === 'connected'
                ? 'badge-active'
                : wsStatus === 'connecting'
                  ? 'badge-idle'
                  : 'badge-stale',
            )}
          >
            {wsStatus}
          </span>
          {isMobileOverlay && (
            <span className="badge-sumi text-[10px]">PTY</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleKill}
            disabled={isKilling}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-accent-vermillion hover:bg-accent-vermillion/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            aria-label="Kill session"
          >
            <Power size={14} />
            {isKilling ? 'Killing...' : 'Kill Session'}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-ink-wash transition-colors"
            aria-label="Close terminal"
          >
            <X size={16} className="text-sumi-diluted" />
          </button>
        </div>
      </div>

      <div
        ref={termRef}
        className={cn('flex-1 bg-sumi-black', isMobileOverlay && 'overflow-auto touch-pan-y')}
      />
    </div>
  )
}
