import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket, type RawData } from 'ws'
import {
  buildGeminiAcpInvocation,
  buildLoginShellCommand,
  prepareMachineLaunchEnvironment,
  buildSshArgs,
  isRemoteMachine,
} from '../machines.js'
import {
  CODEX_RUNTIME_FORCE_KILL_WAIT_MS,
  CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS,
  GEMINI_ACP_ARGS,
  GEMINI_ACP_COMMAND,
} from '../constants.js'
import {
  appendCodexSidecarTail,
  childProcessHasExited,
  rawDataToText,
  truncateLogText,
} from '../session/helpers.js'
import { asObject } from '../session/state.js'
import type {
  GeminiAcpRuntimeHandle,
  GeminiProtocolMessage,
  MachineConfig,
} from '../types.js'

export { CodexSessionRuntime } from '../adapters/codex/index.js'

type GeminiNotificationCallback = (message: GeminiProtocolMessage) => void

export class GeminiAcpRuntime implements GeminiAcpRuntimeHandle {
  readonly sessionName: string
  readonly machine: (MachineConfig & { host: string }) | null
  process: ChildProcess | null = null
  requestId = 0
  pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  notificationListeners = new Map<string, Set<GeminiNotificationCallback>>()
  stdoutTail: string[] = []
  stderrTail: string[] = []
  teardownPromise: Promise<void> | null = null
  transportInitialized = false
  stdioBuffer = ''

  constructor(sessionName: string, machine?: MachineConfig) {
    this.sessionName = sessionName
    this.machine = isRemoteMachine(machine) ? machine : null
  }

  private log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}): void {
    const payload = JSON.stringify({
      sessionName: this.sessionName,
      pid: this.process?.pid ?? null,
      machineId: this.machine?.id ?? null,
      pendingRequests: this.pendingRequests.size,
      listenerSessions: this.notificationListeners.size,
      ...(this.stderrTail.length > 0 ? { stderrTail: this.stderrTail } : {}),
      ...(this.stdoutTail.length > 0 ? { stdoutTail: this.stdoutTail } : {}),
      ...extra,
    })
    const line = `[agents][gemini-acp] ${message} ${payload}`
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
      console.warn(`[agents][gemini-acp][stderr] ${truncateLogText(lines.join(' | '), 800)}`)
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private handleProtocolMessage(payloadText: string): void {
    try {
      const msg = JSON.parse(payloadText) as {
        id?: number | string
        method?: string
        params?: unknown
        result?: unknown
        error?: unknown
      }
      const isResponse = msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)
      if (isResponse && typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!
        this.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(JSON.stringify(msg.error)))
        } else {
          pending.resolve(msg.result)
        }
        return
      }
      if (typeof msg.method !== 'string') {
        return
      }

      const params = asObject(msg.params)
      const sessionId = typeof params?.sessionId === 'string' && params.sessionId.trim().length > 0
        ? params.sessionId.trim()
        : undefined
      if (!sessionId) {
        return
      }

      const listeners = this.notificationListeners.get(sessionId)
      if (!listeners) {
        return
      }
      for (const cb of listeners) {
        cb({
          method: msg.method,
          params: msg.params,
          requestId: msg.id,
        })
      }
    } catch (error) {
      this.log('warn', 'Failed to parse Gemini ACP payload', {
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
      this.recordOutput('stdout', chunk)
      this.recordStdioProtocol(chunk)
    })
    cp.stderr?.on('data', (chunk: Buffer) => {
      this.recordOutput('stderr', chunk)
    })

    const cpEmitter = cp as unknown as NodeJS.EventEmitter
    cpEmitter.on('exit', (code: number | null, signal: string | null) => {
      const detail = signal
        ? `Gemini ACP runtime exited with signal ${signal}`
        : `Gemini ACP runtime exited with code ${code ?? -1}`
      this.log('warn', 'Gemini ACP runtime process exited', {
        detail,
        exitCode: code ?? -1,
        signal: signal ?? null,
      })
      this.process = null
      this.transportInitialized = false
      this.rejectPendingRequests(new Error(detail))
      this.notificationListeners.clear()
    })
    cpEmitter.on('error', (error: Error) => {
      this.log('error', 'Gemini ACP runtime process error', {
        error: truncateLogText(error.message),
      })
      this.process = null
      this.transportInitialized = false
      this.rejectPendingRequests(error)
      this.notificationListeners.clear()
    })
  }

  private sendTransportPayload(payloadText: string): void {
    const stdin = this.process?.stdin
    if (!stdin || stdin.writable === false) {
      throw new Error('Gemini ACP runtime not connected')
    }
    stdin.write(payloadText + '\n')
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

  async ensureConnected(): Promise<void> {
    if (this.process && this.transportInitialized) {
      return
    }

    if (!this.process) {
      this.stdoutTail = []
      this.stderrTail = []
      const cp = this.machine
        ? (() => {
            const preparedLaunch = prepareMachineLaunchEnvironment(this.machine, process.env)
            const remoteCommand = buildLoginShellCommand(
              buildGeminiAcpInvocation(),
              undefined,
              preparedLaunch.sourcedEnvFile,
            )
            return spawn(
              'ssh',
              buildSshArgs(
                this.machine,
                remoteCommand,
                false,
                undefined,
                preparedLaunch.sshSendEnvKeys,
              ),
              {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: preparedLaunch.env,
              },
            )
          })()
        : spawn(GEMINI_ACP_COMMAND, GEMINI_ACP_ARGS, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        })
      this.attachProcess(cp)
      this.log('info', this.machine ? 'Spawned remote Gemini ACP runtime' : 'Spawned Gemini ACP runtime')
    }

    await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'hammurabi', version: '0.1.0' },
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    })
    this.transportInitialized = true
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
          this.log('warn', 'Gemini ACP request timed out', { id, method, timeoutMs: 30000 })
          reject(new Error(`Gemini ACP request ${method} timed out`))
        }
      }, 30000)
    })
  }

  sendNotification(method: string, params: unknown): void {
    this.sendTransportPayload(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  sendResponse(id: number | string, result: unknown): void {
    this.sendTransportPayload(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  addNotificationListener(sessionId: string, cb: GeminiNotificationCallback): () => void {
    if (!this.notificationListeners.has(sessionId)) {
      this.notificationListeners.set(sessionId, new Set())
    }
    this.notificationListeners.get(sessionId)!.add(cb)
    return () => {
      const listeners = this.notificationListeners.get(sessionId)
      if (!listeners) {
        return
      }
      listeners.delete(cb)
      if (listeners.size === 0) {
        this.notificationListeners.delete(sessionId)
      }
    }
  }

  async teardown(options: { reason?: string; timeoutMs?: number } = {}): Promise<void> {
    if (this.teardownPromise) {
      return this.teardownPromise
    }

    this.teardownPromise = (async () => {
      const reason = options.reason ?? 'Gemini ACP teardown'
      const timeoutMs = options.timeoutMs ?? CODEX_RUNTIME_TEARDOWN_TIMEOUT_MS
      this.transportInitialized = false
      this.notificationListeners.clear()
      this.rejectPendingRequests(new Error(reason))

      const runtimeProcess = this.process
      this.process = null
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

      this.log('warn', 'Gemini ACP runtime did not exit after SIGTERM; escalating to SIGKILL', { timeoutMs })
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
      this.teardownPromise = null
    }
  }

  teardownOnProcessExit(): void {
    this.transportInitialized = false
    this.notificationListeners.clear()
    this.rejectPendingRequests(new Error('Process exiting'))
    if (this.process) {
      try {
        this.process.kill('SIGTERM')
      } catch {
        // Best effort.
      }
    }
    this.process = null
  }
}
