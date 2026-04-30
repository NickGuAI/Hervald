import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'

// Mock child_process.spawn so stream session tests can control the child process.
// vi.mock is hoisted before imports by Vitest, so routes.ts gets the mock.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  }
})

const { mockedNodePtySpawn } = vi.hoisted(() => ({
  mockedNodePtySpawn: vi.fn(),
}))

vi.mock('@lydell/node-pty', () => ({
  spawn: mockedNodePtySpawn,
}))

import {
  createAgentsRouter,
  type AgentsRouterOptions,
  type PtyHandle,
  type PtySpawner,
} from '../routes'
import { ActionPolicyGate } from '../../policies/action-policy-gate'
import { createPoliciesRouter } from '../../policies/routes'
import { ApprovalCoordinator } from '../../policies/pending-store'
import { PolicyStore } from '../../policies/store'
import {
  appendTranscriptEvent as appendTranscriptEventToStore,
  resetTranscriptStoreRoot as resetTranscriptStoreRootInStore,
  setTranscriptStoreRoot as setTranscriptStoreRootInStore,
  writeSessionMeta as writeSessionMetaToStore,
} from '../transcript-store'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import { spawn as spawnFn } from 'node:child_process'

// Typed reference to the mocked spawn function
const mockedSpawn = vi.mocked(spawnFn)

function appendTranscriptEvent(...args: Parameters<typeof appendTranscriptEventToStore>) {
  return appendTranscriptEventToStore(...args)
}

function resetTranscriptStoreRoot() {
  return resetTranscriptStoreRootInStore()
}

function setTranscriptStoreRoot(rootDir: string) {
  return setTranscriptStoreRootInStore(rootDir)
}

function writeSessionMeta(...args: Parameters<typeof writeSessionMetaToStore>) {
  return writeSessionMetaToStore(...args)
}

interface MockPtyHandle extends PtyHandle {
  dataCallbacks: ((data: string) => void)[]
  exitCallbacks: ((e: { exitCode: number; signal?: number }) => void)[]
  emitData(data: string): void
  emitExit(e: { exitCode: number; signal?: number }): void
}

function createMockPtyHandle(): MockPtyHandle {
  const dataCallbacks: ((data: string) => void)[] = []
  const exitCallbacks: ((e: { exitCode: number; signal?: number }) => void)[] = []

  return {
    pid: 12345,
    dataCallbacks,
    exitCallbacks,
    onData(cb) {
      dataCallbacks.push(cb)
      return {
        dispose: () => {
          const index = dataCallbacks.indexOf(cb)
          if (index >= 0) {
            dataCallbacks.splice(index, 1)
          }
        },
      }
    },
    onExit(cb) {
      exitCallbacks.push(cb)
      return {
        dispose: () => {
          const index = exitCallbacks.indexOf(cb)
          if (index >= 0) {
            exitCallbacks.splice(index, 1)
          }
        },
      }
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData(data: string) {
      for (const cb of dataCallbacks) {
        cb(data)
      }
    },
    emitExit(e: { exitCode: number; signal?: number }) {
      for (const cb of exitCallbacks) {
        cb(e)
      }
    },
  }
}

interface RunningServer {
  baseUrl: string
  close: () => Promise<void>
  httpServer: Server
  agents: ReturnType<typeof createAgentsRouter>
  approvalCoordinator: ApprovalCoordinator
  policyStore: PolicyStore
}

const AUTH_HEADERS = {
  'x-hammurabi-api-key': 'test-key',
}
const INTERNAL_TOKEN = 'test-internal-token'
const INTERNAL_AUTH_HEADERS = {
  ...AUTH_HEADERS,
  'x-hammurabi-internal-token': INTERNAL_TOKEN,
}

const WRITE_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'write-only-key',
}

const ADMIN_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'admin-only-key',
}

const READ_ONLY_AUTH_HEADERS = {
  'x-hammurabi-api-key': 'read-only-key',
}

function createTestApiKeyStore(): ApiKeyStoreLike {
  const recordsByRawKey = {
    'test-key': {
      id: 'test-key-id',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'hmrb_test',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read', 'agents:write', 'agents:admin'],
    },
    'write-only-key': {
      id: 'test-write-key-id',
      name: 'Write-only Key',
      keyHash: 'hash',
      prefix: 'hmrb_test_write',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:write'],
    },
    'admin-only-key': {
      id: 'test-admin-key-id',
      name: 'Admin-only Key',
      keyHash: 'hash',
      prefix: 'hmrb_test_admin',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:admin'],
    },
    'read-only-key': {
      id: 'test-read-key-id',
      name: 'Read-only Key',
      keyHash: 'hash',
      prefix: 'hmrb_test_read',
      createdBy: 'test',
      createdAt: '2026-02-16T00:00:00.000Z',
      lastUsedAt: null,
      scopes: ['agents:read'],
    },
  } satisfies Record<string, import('../../../server/api-keys/store').ApiKeyRecord>

  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      const record = recordsByRawKey[rawKey as keyof typeof recordsByRawKey]
      if (!record) {
        return { ok: false, reason: 'not_found' as const }
      }

      const requiredScopes = options?.requiredScopes ?? []
      const hasAllScopes = requiredScopes.every((scope) => record.scopes.includes(scope))
      if (!hasAllScopes) {
        return { ok: false, reason: 'insufficient_scope' as const }
      }

      return {
        ok: true as const,
        record,
      }
    },
  }
}

function createMockPtySpawner(
  handleOverride?: () => MockPtyHandle,
): { spawner: PtySpawner; lastHandle: () => MockPtyHandle | null } {
  let lastCreated: MockPtyHandle | null = null
  const spawner: PtySpawner = {
    spawn: vi.fn(() => {
      lastCreated = handleOverride ? handleOverride() : createMockPtyHandle()
      return lastCreated
    }),
  }
  return { spawner, lastHandle: () => lastCreated }
}

interface TempMachinesRegistry {
  filePath: string
  cleanup: () => Promise<void>
}

async function createTempMachinesRegistry(contents: unknown): Promise<TempMachinesRegistry> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-machines-'))
  const filePath = join(dir, 'machines.json')
  const payload = typeof contents === 'string' ? contents : JSON.stringify(contents)
  await writeFile(filePath, payload)
  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function createMissingMachinesRegistryPath(): Promise<TempMachinesRegistry> {
  const dir = await mkdtemp(join(tmpdir(), 'hammurabi-machines-missing-'))
  return {
    filePath: join(dir, 'machines.json'),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function startServer(options: Partial<AgentsRouterOptions> = {}): Promise<RunningServer> {
  const app = express()
  app.use(express.json())

  const approvalDir = await mkdtemp(join(tmpdir(), 'hammurabi-agents-approval-'))
  const approvalCoordinator = new ApprovalCoordinator({
    snapshotFilePath: join(approvalDir, 'pending.json'),
    auditFilePath: join(approvalDir, 'audit.jsonl'),
  })
  const policyStore = new PolicyStore({
    filePath: join(approvalDir, 'policies.json'),
  })
  let approvalSessionsInterface: ReturnType<typeof createAgentsRouter>['approvalSessionsInterface'] | null = null
  const actionPolicyGate = new ActionPolicyGate({
    policyStore,
    approvalCoordinator,
    getApprovalSessionsInterface: () => {
      if (!approvalSessionsInterface) {
        throw new Error('Approval sessions interface is not ready')
      }
      return approvalSessionsInterface
    },
  })

  const agents = createAgentsRouter({
    apiKeyStore: createTestApiKeyStore(),
    autoResumeSessions: false,
    commanderSessionStorePath: '/tmp/nonexistent-commander-sessions-test.json',
    internalToken: INTERNAL_TOKEN,
    getActionPolicyGate: options.getActionPolicyGate ?? (() => actionPolicyGate),
    ...options,
  })
  approvalSessionsInterface = agents.approvalSessionsInterface
  const policies = createPoliciesRouter({
    apiKeyStore: createTestApiKeyStore(),
    internalToken: INTERNAL_TOKEN,
    policyStore,
    approvalCoordinator,
    approvalSessionsInterface,
    actionPolicyGate,
  })
  app.use('/api', policies.router)
  app.use('/api/agents', agents.router)

  const httpServer = createServer(app)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/agents/')) {
      agents.handleUpgrade(req, socket, head)
    } else {
      socket.destroy()
    }
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    agents,
    approvalCoordinator,
    httpServer,
    policyStore,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      await rm(approvalDir, { recursive: true, force: true })
    },
  }
}

function connectWs(
  baseUrl: string,
  sessionName: string,
  apiKey = 'test-key',
): Promise<WebSocket> {
  const wsUrl = baseUrl.replace('http://', 'ws://') +
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/terminal?api_key=${apiKey}`
  const ws = new WebSocket(wsUrl)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (handler: () => void) => {
      if (settled) {
        return
      }
      settled = true
      handler()
    }

    ws.on('open', () => finish(() => resolve(ws)))
    ws.on('error', (error) => finish(() => reject(error)))
    ws.on('close', (code, reason) => {
      finish(() => {
        reject(new Error(`WebSocket closed before opening (code ${code}): ${reason.toString()}`))
      })
    })
    ws.on('unexpected-response', (_req, res) => {
      finish(() => reject(new Error(`WebSocket upgrade rejected with status ${res.statusCode}`)))
    })
  })
}

async function connectWsWithReplay(
  baseUrl: string,
  sessionName: string,
  apiKey = 'test-key',
): Promise<{
  ws: WebSocket
  replay: {
    type: 'replay'
    events: Array<Record<string, unknown>>
    usage?: { inputTokens: number; outputTokens: number; costUsd: number }
  }
}> {
  const wsUrl = baseUrl.replace('http://', 'ws://') +
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/terminal?api_key=${apiKey}`
  const ws = new WebSocket(wsUrl)

  const replayPromise = new Promise<{
    type: 'replay'
    events: Array<Record<string, unknown>>
    usage?: { inputTokens: number; outputTokens: number; costUsd: number }
  }>((resolve, reject) => {
    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString()) as {
        type: string
        events?: Array<Record<string, unknown>>
        usage?: { inputTokens: number; outputTokens: number; costUsd: number }
      }
      if (parsed.type === 'replay' && Array.isArray(parsed.events)) {
        resolve({
          type: 'replay',
          events: parsed.events,
          usage: parsed.usage,
        })
      }
    })
    ws.on('error', reject)
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`WebSocket upgrade rejected with status ${res.statusCode}`))
    })
  })

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`WebSocket upgrade rejected with status ${res.statusCode}`))
    })
  })

  return {
    ws,
    replay: await replayPromise,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  mockedNodePtySpawn.mockReset()
  resetTranscriptStoreRoot()
})

beforeEach(() => {
  vi.spyOn(CommanderSessionStore.prototype, 'list').mockResolvedValue([])
  mockedNodePtySpawn.mockImplementation(() => createMockPtyHandle())
})

// ── Stream Session Tests ─────────────────────────────────────────

/**
 * Creates a mock ChildProcess-like object with controllable stdin/stdout
 * for testing stream session behavior without spawning a real process.
 */
function createMockChildProcess(onWrite?: (data: string) => void) {
  const emitter = new EventEmitter()
  const stdoutEmitter = new EventEmitter()
  const stdinChunks: string[] = []
  const stdinEmitter = new EventEmitter()
  let exited = false

  const stdout = Object.assign(stdoutEmitter, {
    // Provide enough of the Readable interface for the routes code
    pipe: vi.fn(),
    on: stdoutEmitter.on.bind(stdoutEmitter),
  })

  const stdin = Object.assign(stdinEmitter, {
    writable: true,
    write: vi.fn((data: string) => {
      stdinChunks.push(data)
      onWrite?.(data)
      return true
    }),
    end: vi.fn((data?: string) => {
      if (typeof data === 'string' && data.length > 0) {
        stdinChunks.push(data)
        onWrite?.(data)
      }
      return true
    }),
    on: stdinEmitter.on.bind(stdinEmitter),
    once: stdinEmitter.once.bind(stdinEmitter),
  })

  const emitExit = (code: number | null, signal: string | null = null) => {
    if (exited) {
      return
    }
    exited = true
    cp.exitCode = code
    cp.signalCode = signal
    emitter.emit('exit', code, signal)
    emitter.emit('close', code, signal)
  }

  // Build a mock ChildProcess with the EventEmitter cast pattern used by routes.ts
  const cp = Object.assign(emitter, {
    pid: 99999,
    stdout,
    stdin,
    stderr: new EventEmitter(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((signal?: string) => {
      emitExit(null, typeof signal === 'string' ? signal : 'SIGTERM')
      return true
    }),
    // For stdinChunks inspection in tests
    _stdinChunks: stdinChunks,
  })

  return {
    cp,
    emitStdout(data: string) {
      stdoutEmitter.emit('data', Buffer.from(data))
    },
    emitExit(code: number, signal: string | null = null) {
      emitExit(code, signal)
    },
    emitError(err: Error) {
      emitter.emit('error', err)
    },
    getStdinWrites(): string[] {
      return stdinChunks
    },
  }
}

interface MockGeminiAcpRuntime {
  requests: Array<{ id?: number; method?: string; params?: unknown }>
  promptTexts: string[]
  deferNextPromptResult(): void
  releaseDeferredPromptResults(): void
}

function installMockGeminiAcpRuntime(): MockGeminiAcpRuntime {
  const requests: Array<{ id?: number; method?: string; params?: unknown }> = []
  const promptTexts: string[] = []
  const deferredPromptResponses: Array<() => void> = []
  let sessionCounter = 0
  let deferredPromptCount = 0

  const buildProcess = () => createMockChildProcess((data) => {
    for (const line of data.split(/\r?\n/g)) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      const parsed = JSON.parse(trimmed) as {
        id?: number
        method?: string
        params?: unknown
      }
      requests.push(parsed)

      if (typeof parsed.id !== 'number' || typeof parsed.method !== 'string') {
        continue
      }

      switch (parsed.method) {
        case 'initialize':
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true },
            },
          })}\n`)
          break
        case 'session/new': {
          sessionCounter += 1
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { sessionId: `gemini-session-${sessionCounter}` },
          })}\n`)
          break
        }
        case 'session/load': {
          const params = (parsed.params && typeof parsed.params === 'object')
            ? parsed.params as { sessionId?: unknown }
            : {}
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'gemini-session-restored'
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'history should be ignored' },
              },
            },
          })}\n`)
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {},
          })}\n`)
          break
        }
        case 'session/set_mode':
          processMock.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} })}\n`)
          break
        case 'session/prompt': {
          const params = (parsed.params && typeof parsed.params === 'object')
            ? parsed.params as { sessionId?: unknown; prompt?: Array<{ text?: unknown }> }
            : {}
          const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'gemini-session-1'
          const text = Array.isArray(params.prompt) && typeof params.prompt[0]?.text === 'string'
            ? params.prompt[0].text
            : ''
          promptTexts.push(text)
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId,
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'pondering...' },
              },
            },
          })}\n`)
          processMock.emitStdout(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: `reply ${promptTexts.length}` },
              },
            },
          })}\n`)
          const resultPayload = `${JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {
              stopReason: 'end_turn',
              usage: {
                inputTokens: 5,
                outputTokens: 7,
                totalTokens: 12,
              },
            },
          })}\n`
          if (deferredPromptCount > 0) {
            deferredPromptCount -= 1
            const deferredProcess = processMock
            deferredPromptResponses.push(() => {
              deferredProcess.emitStdout(resultPayload)
            })
            break
          }
          processMock.emitStdout(resultPayload)
          break
        }
        default:
          processMock.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} })}\n`)
          break
      }
    }
  })

  let processMock = buildProcess()

  mockedSpawn.mockImplementation((command, args) => {
    if (command === 'gemini' && Array.isArray(args) && args[0] === '--acp') {
      processMock = buildProcess()
      return processMock.cp as never
    }

    if (command === 'ssh' && Array.isArray(args)) {
      const remoteCommand = typeof args[args.length - 1] === 'string' ? args[args.length - 1] : ''
      if (remoteCommand.includes('gemini') && remoteCommand.includes('--acp')) {
        processMock = buildProcess()
        return processMock.cp as never
      }
    }

    return createMockChildProcess().cp as never
  })

  return {
    requests,
    promptTexts,
    deferNextPromptResult: () => {
      deferredPromptCount += 1
    },
    releaseDeferredPromptResults: () => {
      const pendingResponses = deferredPromptResponses.splice(0, deferredPromptResponses.length)
      for (const release of pendingResponses) {
        release()
      }
    },
  }
}

type CodexTurnStartBehavior = 'success' | 'error' | 'busy'

interface MockCodexClientMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

interface MockCodexSidecar {
  closeConnection(code?: number, reason?: string): Promise<void>
  closeConnectionForThread(threadId: string, code?: number, reason?: string): Promise<void>
  closeServer(): Promise<void>
  emitProcessError(error: Error): void
  emitProcessErrorForThread(threadId: string, error: Error): void
  emitProcessExit(code?: number, signal?: string | null): void
  emitProcessExitForThread(threadId: string, code?: number, signal?: string | null): void
  emitNotification(method: string, params: Record<string, unknown>): void
  emitServerRequest(id: number, method: string, params: Record<string, unknown>): void
  emitStderr(data: string): void
  getProcessKillCallCount(threadId: string): number
  getRequests(method?: string): MockCodexClientMessage[]
  getResponseById(id: number): MockCodexClientMessage | undefined
  getRuntimeSpawnCount(): number
  getStartedThreadIds(): string[]
  queueTurnStartServerRequest(method: string, params: Record<string, unknown>): void
  setThreadReadResult(result: unknown): void
  setThreadReadError(message: string | null): void
  setTurnStartBehavior(behavior: CodexTurnStartBehavior): void
  suppressPongResponses(): void
}

interface MockCodexRuntime {
  id: number
  transport: 'ws' | 'stdio'
  processMock: ReturnType<typeof createMockChildProcess>
  server: WebSocketServer | null
  socket: WebSocket | null
  turnStartBehavior: CodexTurnStartBehavior
  nextTurnStartServerRequest: { method: string; params: Record<string, unknown> } | null
  threadReadResult: unknown
  threadReadError: string | null
}

function installMockCodexSidecar(): MockCodexSidecar {
  const requests: MockCodexClientMessage[] = []
  const runtimes = new Map<number, MockCodexRuntime>()
  const threadToRuntime = new Map<string, MockCodexRuntime>()
  const startedThreadIds: string[] = []
  let runtimeCounter = 0
  let threadCounter = 0
  let defaultTurnStartBehavior: CodexTurnStartBehavior = 'success'
  let defaultThreadReadResult: unknown = { thread: { id: 'thread-1', turns: [] } }
  let defaultThreadReadError: string | null = null
  let hasCustomThreadReadResult = false

  const firstRuntime = (): MockCodexRuntime | null => {
    for (const runtime of runtimes.values()) {
      return runtime
    }
    return null
  }

  const runtimeForThread = (threadId: string): MockCodexRuntime => {
    const runtime = threadToRuntime.get(threadId)
    if (!runtime) {
      throw new Error(`No Codex runtime registered for thread ${threadId}`)
    }
    return runtime
  }

  const resolveRuntime = (threadId?: string): MockCodexRuntime => {
    if (threadId) {
      return runtimeForThread(threadId)
    }
    const runtime = firstRuntime()
    if (!runtime) {
      throw new Error('No active Codex runtimes')
    }
    return runtime
  }

  const runtimeSocket = (runtime: MockCodexRuntime): WebSocket => {
    if (!runtime.socket) {
      throw new Error(`Codex runtime ${runtime.id} socket not connected`)
    }
    return runtime.socket
  }

  const sendRuntimeMessage = (runtime: MockCodexRuntime, payload: Record<string, unknown>) => {
    const encoded = JSON.stringify(payload)
    if (runtime.transport === 'stdio') {
      runtime.processMock.emitStdout(`${encoded}\n`)
      return
    }
    runtimeSocket(runtime).send(encoded)
  }

  const handleRequest = (
    runtime: MockCodexRuntime,
    parsed: MockCodexClientMessage,
  ) => {
    requests.push(parsed)

    if (typeof parsed.method !== 'string') {
      return
    }

    if (parsed.id === undefined) {
      return
    }

    switch (parsed.method) {
      case 'initialize':
        sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: {} })
        break
      case 'thread/start': {
        threadCounter += 1
        const threadId = `thread-${threadCounter}`
        startedThreadIds.push(threadId)
        threadToRuntime.set(threadId, runtime)
        if (!hasCustomThreadReadResult) {
          runtime.threadReadResult = { thread: { id: threadId, turns: [] } }
        }
        sendRuntimeMessage(runtime, {
          jsonrpc: '2.0',
          id: parsed.id,
          result: { thread: { id: threadId } },
        })
        break
      }
      case 'thread/resume': {
        const params = (parsed.params ?? {}) as { threadId?: unknown }
        if (typeof params.threadId === 'string' && params.threadId.length > 0) {
          if (!startedThreadIds.includes(params.threadId)) {
            startedThreadIds.push(params.threadId)
          }
          threadToRuntime.set(params.threadId, runtime)
        }
        sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: {} })
        break
      }
      case 'thread/archive':
        sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: {} })
        break
      case 'thread/read':
        if (runtime.threadReadError) {
          sendRuntimeMessage(runtime, {
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32001, message: runtime.threadReadError },
          })
        } else {
          sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: runtime.threadReadResult })
        }
        break
      case 'turn/start':
      case 'turn/steer':
        if (runtime.nextTurnStartServerRequest) {
          const pendingRequest = runtime.nextTurnStartServerRequest
          runtime.nextTurnStartServerRequest = null
          sendRuntimeMessage(runtime, {
            jsonrpc: '2.0',
            id: parsed.id,
            method: pendingRequest.method,
            params: pendingRequest.params,
          })
        }
        if (runtime.turnStartBehavior === 'error') {
          sendRuntimeMessage(runtime, {
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32000, message: 'Injected turn/start failure' },
          })
        } else if (runtime.turnStartBehavior === 'busy') {
          sendRuntimeMessage(runtime, {
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32001, message: 'Turn already in progress' },
          })
        } else {
          sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: { accepted: true } })
        }
        break
      default:
        sendRuntimeMessage(runtime, { jsonrpc: '2.0', id: parsed.id, result: {} })
        break
    }
  }

  mockedSpawn.mockImplementation((command, args) => {
    if (command === 'ssh' && Array.isArray(args)) {
      const remoteCommand = typeof args[args.length - 1] === 'string' ? args[args.length - 1] : ''
      if (remoteCommand.includes('codex') && remoteCommand.includes('app-server') && remoteCommand.includes('stdio://')) {
        const processMock = createMockChildProcess((data) => {
          for (const line of data.split(/\r?\n/g)) {
            const trimmed = line.trim()
            if (!trimmed) {
              continue
            }
            const parsed = JSON.parse(trimmed) as { id?: number; method?: string; params?: unknown }
            handleRequest(runtime, parsed)
          }
        })
        const runtimeId = ++runtimeCounter
        const runtime: MockCodexRuntime = {
          id: runtimeId,
          transport: 'stdio',
          processMock,
          server: null,
          socket: null,
          turnStartBehavior: defaultTurnStartBehavior,
          nextTurnStartServerRequest: null,
          threadReadResult: defaultThreadReadResult,
          threadReadError: defaultThreadReadError,
        }
        runtimes.set(runtimeId, runtime)
        return processMock.cp as never
      }
    }

    if (command !== 'codex' || !Array.isArray(args)) {
      return createMockChildProcess().cp as never
    }

    const listenIndex = args.indexOf('--listen')
    if (listenIndex === -1 || typeof args[listenIndex + 1] !== 'string') {
      throw new Error('Missing --listen URL for mocked Codex sidecar')
    }

    const listenUrl = new URL(args[listenIndex + 1])
    const processMock = createMockChildProcess()
    const runtimeId = ++runtimeCounter
    const server = new WebSocketServer({
      host: listenUrl.hostname,
      port: Number(listenUrl.port),
    })
    const runtime: MockCodexRuntime = {
      id: runtimeId,
      transport: 'ws',
      processMock,
      server,
      socket: null,
      turnStartBehavior: defaultTurnStartBehavior,
      nextTurnStartServerRequest: null,
      threadReadResult: defaultThreadReadResult,
      threadReadError: defaultThreadReadError,
    }
    runtimes.set(runtimeId, runtime)

    server.on('connection', (client) => {
      runtime.socket = client as unknown as WebSocket
      client.on('close', () => {
        if (runtime.socket === (client as unknown as WebSocket)) {
          runtime.socket = null
        }
      })
      client.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown }
        handleRequest(runtime, parsed)
      })
    })

    return processMock.cp as never
  })

  return {
    async closeConnection(code = 1011, reason = 'Injected transport failure') {
      const runtime = resolveRuntime()
      const socket = runtimeSocket(runtime)
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve())
        if (code === 1006) {
          socket.terminate()
          return
        }
        socket.close(code, reason)
      })
    },
    async closeConnectionForThread(threadId, code = 1011, reason = 'Injected transport failure') {
      const runtime = resolveRuntime(threadId)
      const socket = runtimeSocket(runtime)
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve())
        if (code === 1006) {
          socket.terminate()
          return
        }
        socket.close(code, reason)
      })
    },
    async closeServer() {
      const closeJobs = [...runtimes.values()].map(async (runtime) => {
        if (!runtime.server) {
          runtime.processMock.emitExit(0, null)
          return
        }
        for (const client of runtime.server.clients) {
          client.terminate()
        }
        await new Promise<void>((resolve, reject) => {
          runtime.server!.close((error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
        runtime.socket = null
        runtime.processMock.emitExit(0, null)
      })
      await Promise.all(closeJobs)
      runtimes.clear()
      threadToRuntime.clear()
    },
    emitProcessError(error: Error) {
      const runtime = resolveRuntime()
      runtime.processMock.emitError(error)
    },
    emitProcessErrorForThread(threadId: string, error: Error) {
      const runtime = resolveRuntime(threadId)
      runtime.processMock.emitError(error)
    },
    emitProcessExit(code = 1, signal: string | null = null) {
      const runtime = resolveRuntime()
      runtime.processMock.emitExit(code, signal)
    },
    emitProcessExitForThread(threadId: string, code = 1, signal: string | null = null) {
      const runtime = resolveRuntime(threadId)
      runtime.processMock.emitExit(code, signal)
    },
    emitNotification(method, params) {
      const runtime = resolveRuntime(typeof params.threadId === 'string' ? params.threadId : undefined)
      sendRuntimeMessage(runtime, {
        jsonrpc: '2.0',
        method,
        params,
      })
    },
    emitServerRequest(id, method, params) {
      const runtime = resolveRuntime(typeof params.threadId === 'string' ? params.threadId : undefined)
      sendRuntimeMessage(runtime, {
        jsonrpc: '2.0',
        id,
        method,
        params,
      })
    },
    emitStderr(data) {
      const runtime = resolveRuntime()
      runtime.processMock.cp.stderr.emit('data', Buffer.from(data))
    },
    getProcessKillCallCount(threadId) {
      const runtime = resolveRuntime(threadId)
      const kill = runtime.processMock.cp.kill as unknown as { mock?: { calls: unknown[][] } }
      return kill.mock?.calls.length ?? 0
    },
    getRequests(method) {
      return method ? requests.filter((request) => request.method === method) : [...requests]
    },
    getResponseById(id) {
      return requests.find((request) => request.id === id && request.method === undefined)
    },
    getRuntimeSpawnCount() {
      return runtimes.size
    },
    getStartedThreadIds() {
      return [...startedThreadIds]
    },
    queueTurnStartServerRequest(method, params) {
      const runtime = resolveRuntime(typeof params.threadId === 'string' ? params.threadId : undefined)
      runtime.nextTurnStartServerRequest = {
        method,
        params: { ...params },
      }
    },
    setThreadReadResult(result) {
      defaultThreadReadResult = result
      defaultThreadReadError = null
      hasCustomThreadReadResult = true
      for (const runtime of runtimes.values()) {
        runtime.threadReadResult = result
        runtime.threadReadError = null
      }
    },
    setThreadReadError(message) {
      defaultThreadReadError = message
      for (const runtime of runtimes.values()) {
        runtime.threadReadError = message
      }
    },
    setTurnStartBehavior(behavior) {
      defaultTurnStartBehavior = behavior
      for (const runtime of runtimes.values()) {
        runtime.turnStartBehavior = behavior
      }
    },
    suppressPongResponses() {
      const runtime = resolveRuntime()
      const socket = runtimeSocket(runtime)
      const interceptedPong = vi.fn(() => socket)
      Object.defineProperty(socket, 'pong', {
        value: interceptedPong,
        configurable: true,
      })
    },
  }
}

export {
  AUTH_HEADERS,
  ADMIN_ONLY_AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
  INTERNAL_TOKEN,
  READ_ONLY_AUTH_HEADERS,
  WRITE_ONLY_AUTH_HEADERS,
  appendTranscriptEvent,
  connectWs,
  connectWsWithReplay,
  createMissingMachinesRegistryPath,
  createMockChildProcess,
  createMockPtyHandle,
  createMockPtySpawner,
  createTempMachinesRegistry,
  installMockCodexSidecar,
  installMockGeminiAcpRuntime,
  mockedNodePtySpawn,
  mockedSpawn,
  resetTranscriptStoreRoot,
  setTranscriptStoreRoot,
  startServer,
  writeSessionMeta,
}

export type {
  MockCodexClientMessage,
  MockCodexSidecar,
  MockGeminiAcpRuntime,
  MockPtyHandle,
  RunningServer,
  TempMachinesRegistry,
}
