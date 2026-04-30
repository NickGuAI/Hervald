import type { ChildProcess } from 'node:child_process'
import { WebSocket, type RawData } from 'ws'
import { CODEX_RUNTIME_FORCE_KILL_WAIT_MS, CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS } from '../../constants.js'
import { isRemoteMachine } from '../../machines.js'
import {
  appendCodexSidecarTail,
  attachWebSocketKeepAlive,
  childProcessHasExited,
  rawDataToText,
  truncateLogText,
} from '../../session/helpers.js'
import type {
  CodexRuntimeFailure,
  CodexRuntimeTerminalFailure,
  CodexProtocolMessage,
  CodexSessionRuntimeHandle,
  MachineConfig,
} from '../../types.js'
import {
  parseCodexProtocolPayload,
  toCodexProtocolMessage,
} from './protocol.js'
import {
  spawnLocalCodexRuntime,
  spawnRemoteCodexRuntime,
} from './process.js'

type CodexNotificationCallback = (message: CodexProtocolMessage) => void

const CODEX_INITIALIZE_CAPABILITIES = {
  experimentalApi: true,
} as const

export class CodexSessionRuntime implements CodexSessionRuntimeHandle {
  readonly sessionName: string
  readonly machine: (MachineConfig & { host: string }) | null
  readonly transportMode: 'ws' | 'stdio'
  readonly listActiveSessionNames: () => string[]
  readonly handleOwningSessionFailure: (failure: CodexRuntimeFailure) => void
  readonly wsKeepAliveIntervalMs: number
  process: ChildProcess | null = null
  port = 0
  ws: WebSocket | null = null
  stopKeepAlive: (() => void) | null = null
  requestId = 0
  pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  notificationListeners = new Map<string, Set<CodexNotificationCallback>>()
  stdoutTail: string[] = []
  stderrTail: string[] = []
  teardownPromise: Promise<void> | null = null
  teardownInProgress = false
  transportInitialized = false
  stdioBuffer = ''
  lastTerminalFailure: CodexRuntimeTerminalFailure | null = null
  terminalFailureWaiters = new Set<(failure: CodexRuntimeTerminalFailure | null) => void>()

  constructor(
    sessionName: string,
    machine: MachineConfig | undefined,
    listActiveSessionNames: () => string[],
    wsKeepAliveIntervalMs: number,
    handleOwningSessionFailure: (failure: CodexRuntimeFailure) => void,
  ) {
    this.sessionName = sessionName
    this.machine = isRemoteMachine(machine) ? machine : null
    this.transportMode = this.machine ? 'stdio' : 'ws'
    this.listActiveSessionNames = listActiveSessionNames
    this.wsKeepAliveIntervalMs = wsKeepAliveIntervalMs
    this.handleOwningSessionFailure = handleOwningSessionFailure
  }

  log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}): void {
    const payload = JSON.stringify({
      sessionName: this.sessionName,
      pid: this.process?.pid ?? null,
      port: this.port || null,
      transportMode: this.transportMode,
      machineId: this.machine?.id ?? null,
      activeSessions: this.listActiveSessionNames(),
      pendingRequests: this.pendingRequests.size,
      listenerThreads: this.notificationListeners.size,
      ...(this.stderrTail.length > 0 ? { stderrTail: this.stderrTail } : {}),
      ...(this.stdoutTail.length > 0 ? { stdoutTail: this.stdoutTail } : {}),
      ...extra,
    })
    const line = `[agents][codex-sidecar] ${message} ${payload}`
    if (level === 'error') {
      console.error(line)
      return
    }
    if (level === 'warn') {
      console.warn(line)
      return
    }
    console.info(line)
  }

  private recordOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const lines = chunk.toString()
      .split(/\r?\n/g)
      .map((line) => truncateLogText(line))
      .filter((line) => line.length > 0)
    if (lines.length === 0) {
      return
    }

    const tail = stream === 'stderr' ? this.stderrTail : this.stdoutTail
    appendCodexSidecarTail(tail, lines)

    if (stream === 'stderr') {
      console.warn(`[agents][codex-sidecar][stderr] ${truncateLogText(lines.join(' | '), 800)}`)
    }
  }

  private handleProtocolMessage(payloadText: string): void {
    try {
      const payload = parseCodexProtocolPayload(payloadText)
      const protocolMessage = toCodexProtocolMessage(payload)
      if (protocolMessage && payload.threadId) {
        const listeners = this.notificationListeners.get(payload.threadId)
        if (!listeners) {
          return
        }

        for (const cb of listeners) {
          cb(protocolMessage)
        }
        return
      }

      if (protocolMessage && !payload.threadId) {
        this.log('info', 'Codex protocol message has method but no threadId; routing without per-thread listener', {
          method: protocolMessage.method,
          requestId: typeof payload.id === 'number' ? payload.id : null,
          payloadSnippet: truncateLogText(payloadText, 400),
        })
        if (typeof payload.id === 'number') {
          try {
            this.sendTransportPayload(JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              error: {
                code: -32601,
                message: `Method "${protocolMessage.method}" is not handled by Hammurabi`,
              },
            }))
          } catch (error) {
            this.log('warn', 'Failed to send JSON-RPC error for unrouted Codex method', {
              method: protocolMessage.method,
              requestId: payload.id,
              error: truncateLogText(error instanceof Error ? error.message : String(error)),
            })
          }
        }
        return
      }

      if (typeof payload.id !== 'number' || !this.pendingRequests.has(payload.id)) {
        return
      }

      const pending = this.pendingRequests.get(payload.id)!
      this.pendingRequests.delete(payload.id)
      if (payload.error) {
        pending.reject(new Error(JSON.stringify(payload.error)))
      } else {
        pending.resolve(payload.result)
      }
    } catch (error) {
      this.log('warn', 'Failed to parse Codex runtime payload', {
        error: truncateLogText(error instanceof Error ? error.message : String(error)),
        payloadSnippet: truncateLogText(payloadText, 800),
      })
    }
  }

  private recordStdioProtocol(chunk: Buffer): void {
    this.stdioBuffer += chunk.toString()
    let newlineIndex = this.stdioBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdioBuffer.slice(0, newlineIndex).trim()
      this.stdioBuffer = this.stdioBuffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        this.handleProtocolMessage(line)
      }
      newlineIndex = this.stdioBuffer.indexOf('\n')
    }
  }

  private attachProcess(cp: ChildProcess): void {
    this.process = cp
    this.stdioBuffer = ''
    cp.stdout?.on('data', (chunk: Buffer) => {
      if (this.transportMode === 'stdio') {
        this.recordStdioProtocol(chunk)
        return
      }
      this.recordOutput('stdout', chunk)
    })
    cp.stderr?.on('data', (chunk: Buffer) => {
      this.recordOutput('stderr', chunk)
    })

    const cpEmitter = cp as unknown as NodeJS.EventEmitter
    cpEmitter.on('exit', (code: number | null, signal: string | null) => {
      const detail = signal
        ? `Codex runtime exited with signal ${signal}`
        : `Codex runtime exited with code ${code ?? -1}`
      const failure: CodexRuntimeTerminalFailure = {
        reason: detail,
        exitCode: typeof code === 'number' ? code : 1,
        signal: signal ?? undefined,
      }
      this.log('error', 'Codex runtime process exited', {
        detail,
        exitCode: code ?? -1,
        signal: signal ?? null,
      })
      this.process = null
      this.transportInitialized = false
      this.detachKeepAlive()
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.terminate()
      }
      this.ws = null
      this.rejectPendingRequests(new Error(detail))
      this.recordTerminalFailure(failure)
      this.handleOwningSessionFailure({ kind: 'terminal', ...failure })
    })
    cpEmitter.on('error', (error: Error) => {
      const failure: CodexRuntimeTerminalFailure = {
        reason: `Codex runtime process error: ${error.message}`,
      }
      this.log('error', 'Codex runtime process error', {
        error: truncateLogText(error.message),
      })
      this.process = null
      this.transportInitialized = false
      this.detachKeepAlive()
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.terminate()
      }
      this.ws = null
      this.rejectPendingRequests(error)
      this.recordTerminalFailure(failure)
      this.handleOwningSessionFailure({ kind: 'terminal', ...failure })
    })
  }

  private sendTransportPayload(payloadText: string): void {
    if (this.transportMode === 'stdio') {
      const stdin = this.process?.stdin
      if (!stdin || stdin.writable === false) {
        throw new Error('Codex runtime not connected')
      }
      stdin.write(payloadText + '\n')
      return
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Codex sidecar not connected')
    }
    this.ws.send(payloadText)
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private detachKeepAlive(): void {
    this.stopKeepAlive?.()
    this.stopKeepAlive = null
  }

  private recordTerminalFailure(failure: CodexRuntimeTerminalFailure): void {
    this.lastTerminalFailure = failure
    for (const notify of this.terminalFailureWaiters) {
      notify(failure)
    }
    this.terminalFailureWaiters.clear()
  }

  private handleDisconnect(ws: WebSocket, detail: string): void {
    if (this.ws !== ws) {
      return
    }
    this.log('warn', 'Codex sidecar disconnected', {
      detail: truncateLogText(detail),
      readyState: ws.readyState,
    })
    this.detachKeepAlive()
    this.transportInitialized = false
    this.ws = null
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.terminate()
      } catch {
        // Best effort to clear the stale socket before reconnecting.
      }
    }
    this.rejectPendingRequests(new Error(detail))
    if (this.teardownInProgress) {
      return
    }
    this.handleOwningSessionFailure({ kind: 'transport_disconnect', reason: detail })
  }

  private async openSocket(port: number, timeoutMs: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)

    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timeout)
        ws.off('open', onOpen)
        ws.off('error', onError)
      }
      const rejectOnce = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        try {
          ws.terminate()
        } catch {
          // Best effort.
        }
        reject(error)
      }
      const onOpen = () => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve(ws)
      }
      const onError = (error: Error) => {
        rejectOnce(error)
      }
      const timeout = setTimeout(() => {
        rejectOnce(new Error('Codex sidecar connection timeout'))
      }, timeoutMs)
      ws.once('open', onOpen)
      ws.once('error', onError)
    })
  }

  private async connectSocket(
    port: number,
    options: { totalTimeoutMs?: number; attemptTimeoutMs?: number; retryDelayMs?: number } = {},
  ): Promise<WebSocket> {
    const totalTimeoutMs = options.totalTimeoutMs ?? 5000
    const attemptTimeoutMs = options.attemptTimeoutMs ?? 500
    const retryDelayMs = options.retryDelayMs ?? 50
    const startedAt = Date.now()
    let lastError: Error | null = null

    while (Date.now() - startedAt < totalTimeoutMs) {
      const remainingMs = totalTimeoutMs - (Date.now() - startedAt)
      const timeoutMs = Math.max(50, Math.min(attemptTimeoutMs, remainingMs))

      try {
        return await this.openSocket(port, timeoutMs)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }

      if (!this.process) {
        break
      }

      const delayMs = Math.min(retryDelayMs, Math.max(0, totalTimeoutMs - (Date.now() - startedAt)))
      if (delayMs <= 0) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    this.log('error', 'Unable to connect to Codex sidecar WebSocket', {
      totalTimeoutMs,
      attemptTimeoutMs,
      retryDelayMs,
      lastError: truncateLogText((lastError ?? new Error('Codex sidecar connection timeout')).message),
    })
    throw lastError ?? new Error('Codex sidecar connection timeout')
  }

  async ensureConnected(): Promise<void> {
    if (this.transportMode === 'ws' && this.ws?.readyState === WebSocket.OPEN && this.transportInitialized) return
    if (this.transportMode === 'stdio' && this.process && this.transportInitialized) return

    if (this.ws) {
      this.detachKeepAlive()
      this.ws = null
    }

    if (!this.process) {
      this.stdoutTail = []
      this.stderrTail = []
      this.lastTerminalFailure = null
      if (this.machine) {
        const process = spawnRemoteCodexRuntime(this.machine)
        this.attachProcess(process)
        this.log('info', 'Spawned remote Codex runtime process')
      } else {
        const { port, process } = await spawnLocalCodexRuntime()
        this.port = port
        this.attachProcess(process)
        this.log('info', 'Spawned Codex sidecar process')
      }
    }

    if (this.transportMode === 'ws') {
      const ws = await this.connectSocket(this.port)
      this.log('info', 'Connected to Codex sidecar WebSocket')

      ws.on('message', (data: RawData) => {
        const payloadText = rawDataToText(data)
        this.handleProtocolMessage(payloadText)
      })
      ws.on('close', (code, reasonBuffer) => {
        const reason = reasonBuffer.toString().trim()
        const detail = reason
          ? `Codex sidecar connection closed (code ${code}): ${reason}`
          : `Codex sidecar connection closed (code ${code})`
        this.handleDisconnect(ws, detail)
      })
      ws.on('error', (error) => {
        const detail = error instanceof Error
          ? `Codex sidecar connection error: ${error.message}`
          : 'Codex sidecar connection error'
        this.handleDisconnect(ws, detail)
      })

      this.ws = ws
      this.stopKeepAlive = attachWebSocketKeepAlive(ws, this.wsKeepAliveIntervalMs, () => {
        const detail = 'Codex sidecar keepalive timeout'
        this.log('warn', 'Codex sidecar keepalive timeout', { readyState: ws.readyState })
        this.handleDisconnect(ws, detail)
      })
    }

    await this.sendRequest('initialize', {
      clientInfo: { name: 'hammurabi', version: '0.1.0' },
      capabilities: CODEX_INITIALIZE_CAPABILITIES,
    })
    this.sendTransportPayload(JSON.stringify({ method: 'initialized', params: {} }))
    this.transportInitialized = true
  }

  getTerminalFailure(): CodexRuntimeTerminalFailure | null {
    return this.lastTerminalFailure
  }

  async waitForTerminalFailure(timeoutMs: number): Promise<CodexRuntimeTerminalFailure | null> {
    if (this.lastTerminalFailure) {
      return this.lastTerminalFailure
    }
    if (timeoutMs <= 0) {
      return null
    }

    return await new Promise<CodexRuntimeTerminalFailure | null>((resolve) => {
      const onFailure = (failure: CodexRuntimeTerminalFailure | null) => {
        clearTimeout(timer)
        this.terminalFailureWaiters.delete(onFailure)
        resolve(failure)
      }
      const timer = setTimeout(() => {
        this.terminalFailureWaiters.delete(onFailure)
        resolve(null)
      }, timeoutMs)
      this.terminalFailureWaiters.add(onFailure)
    })
  }

  sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })
      try {
        this.sendTransportPayload(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          this.log('warn', 'Codex request timed out', { id, method, timeoutMs: 30000 })
          reject(new Error(`Codex request ${method} timed out`))
        }
      }, 30000)
    })
  }

  sendResponse(id: number, result: unknown): void {
    this.sendTransportPayload(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  addNotificationListener(threadId: string, cb: CodexNotificationCallback): () => void {
    if (!this.notificationListeners.has(threadId)) {
      this.notificationListeners.set(threadId, new Set())
    }
    this.notificationListeners.get(threadId)!.add(cb)
    return () => {
      const listeners = this.notificationListeners.get(threadId)
      if (!listeners) {
        return
      }
      listeners.delete(cb)
      if (listeners.size === 0) {
        this.notificationListeners.delete(threadId)
      }
    }
  }

  private async waitForProcessExit(processToWait: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (childProcessHasExited(processToWait)) {
      return true
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (didExit: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        processToWait.off('exit', onExit)
        processToWait.off('error', onError)
        resolve(didExit)
      }

      const onExit = () => finish(true)
      const onError = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      processToWait.once('exit', onExit)
      processToWait.once('error', onError)
    })
  }

  async teardown(options: { threadId?: string; reason?: string; timeoutMs?: number } = {}): Promise<void> {
    if (this.teardownPromise) {
      return this.teardownPromise
    }

    this.teardownPromise = (async () => {
      this.teardownInProgress = true
      const threadId = options.threadId
      const reason = options.reason ?? 'Codex runtime teardown'
      const timeoutMs = options.timeoutMs ?? CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS

      if (threadId) {
        try {
          await this.sendRequest('thread/archive', { threadId })
        } catch (error) {
          this.log('warn', 'Codex thread archive failed during teardown', {
            threadId,
            error: truncateLogText(error instanceof Error ? error.message : String(error)),
          })
        }
      }

      this.detachKeepAlive()
      this.notificationListeners.clear()
      this.transportInitialized = false

      const ws = this.ws
      this.ws = null
      this.rejectPendingRequests(new Error(reason))
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1000, 'Session teardown')
          }
        } catch {
          // Continue with terminate path.
        }
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.terminate()
        }
      }

      const runtimeProcess = this.process
      this.process = null
      this.port = 0
      if (!runtimeProcess || childProcessHasExited(runtimeProcess)) {
        return
      }

      try {
        runtimeProcess.kill('SIGTERM')
      } catch {
        // Best effort.
      }

      const exitedAfterTerm = await this.waitForProcessExit(runtimeProcess, timeoutMs)
      if (exitedAfterTerm) {
        return
      }

      this.log('warn', 'Codex runtime did not exit after SIGTERM; escalating to SIGKILL', { timeoutMs })
      try {
        runtimeProcess.kill('SIGKILL')
      } catch {
        // Process may have exited.
      }
      await this.waitForProcessExit(runtimeProcess, CODEX_RUNTIME_FORCE_KILL_WAIT_MS)
    })()

    try {
      await this.teardownPromise
    } finally {
      this.teardownInProgress = false
      this.teardownPromise = null
    }
  }

  teardownOnProcessExit(threadId?: string): void {
    this.teardownInProgress = true
    if (threadId) {
      void this.sendRequest('thread/archive', { threadId }).catch(() => {})
    }
    this.detachKeepAlive()
    this.ws?.terminate()
    this.ws = null
    this.transportInitialized = false
    this.rejectPendingRequests(new Error('Process exiting'))
    this.notificationListeners.clear()
    if (this.process) {
      try {
        this.process.kill('SIGTERM')
      } catch {
        // Best effort.
      }
    }
    this.process = null
    this.port = 0
  }
}
