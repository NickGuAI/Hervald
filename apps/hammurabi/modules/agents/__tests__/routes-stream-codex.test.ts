import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import { ActionPolicyGate } from '../../policies/action-policy-gate'
import { ApprovalCoordinator } from '../../policies/pending-store'
import { PolicyStore } from '../../policies/store'
import type { PtySpawner } from '../routes'
import {
  AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
  READ_ONLY_AUTH_HEADERS,
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
} from './routes-test-harness'
import type { MockCodexSidecar, MockGeminiAcpRuntime, RunningServer } from './routes-test-harness'

function getTurnStartText(request: { params?: unknown } | undefined): string | null {
  const params = request?.params
  if (!params || typeof params !== 'object') {
    return null
  }

  const input = Array.isArray((params as { input?: unknown }).input)
    ? (params as { input: Array<{ text?: unknown }> }).input[0]
    : undefined
  return typeof input?.text === 'string' ? input.text : null
}

const ALWAYS_ON_CODEX_APPROVAL_POLICY = {
  granular: {
    sandbox_approval: true,
    mcp_elicitations: true,
    rules: true,
    request_permissions: true,
    skill_approval: true,
  },
} as const

function buildCodexThreadReadResult(item: Record<string, unknown>) {
  return {
    thread: {
      id: 'thread-1',
      turns: [
        {
          id: 'turn-1',
          items: [item],
        },
      ],
    },
  }
}

describe("stream sessions", () => {
  function installMockProcess() {
      const mock = createMockChildProcess()
      mockedSpawn.mockReturnValue(mock.cp as never)
      return mock
    }

  afterEach(() => {
      mockedSpawn.mockRestore()
    })

  it('creates remote codex stream sessions over ssh', async () => {
      const sidecar = installMockCodexSidecar()
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'gpu-1',
            label: 'GPU',
            host: '10.0.1.50',
            user: 'builder',
            envFile: '/Users/builder/.hammurabi-env',
          },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-remote-codex',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            host: 'gpu-1',
            task: 'Run remotely',
          }),
        })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({
          sessionName: 'stream-remote-codex',
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'human', id: 'api-key' },
          transportType: 'stream',
          agentType: 'codex',
          host: 'gpu-1',
          created: true,
        })

        expect(mockedSpawn).toHaveBeenCalledWith(
          'ssh',
          expect.arrayContaining(['builder@10.0.1.50']),
          expect.objectContaining({
            stdio: ['pipe', 'pipe', 'pipe'],
          }),
        )
        const sshArgs = mockedSpawn.mock.calls[0][1]
        const remoteCommand = sshArgs[sshArgs.length - 1]
        expect(remoteCommand).toContain('exec "${SHELL:-/bin/bash}" -lc')
        expect(remoteCommand).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('/Users/builder/.hammurabi-env')
        expect(remoteCommand).toContain('codex')
        expect(remoteCommand).toContain('app-server')
        expect(remoteCommand).toContain('stdio://')
        expect(sidecar.getRequests('thread/start')).toHaveLength(1)
        expect(sidecar.getRequests('turn/start')).toHaveLength(1)
      } finally {
        await sidecar.closeServer()
        await server.close()
        await registry.cleanup()
      }
    })

  it('bootstraps Codex commander sessions with developer instructions and readiness as first turn', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const systemPrompt = 'You are the Codex commander seed prompt.'
        await server.agents.sessionsInterface.createCommanderSession({
          name: 'commander-codex-bootstrap',
          commanderId: 'codex-bootstrap',
          systemPrompt,
          agentType: 'codex',
        })

        const threadRequests = sidecar.getRequests('thread/start')
        expect(threadRequests).toHaveLength(1)
        expect(threadRequests[0].params).toEqual(expect.objectContaining({
          sandbox: 'danger-full-access',
          approvalPolicy: ALWAYS_ON_CODEX_APPROVAL_POLICY,
          developerInstructions: systemPrompt,
        }))

        expect(sidecar.getRequests('turn/start')).toHaveLength(0)

        const sent = await server.agents.sessionsInterface.sendToSession(
          'commander-codex-bootstrap',
          'Commander runtime started. Acknowledge readiness and await instructions.',
        )
        expect(sent).toBe(true)

        const turnRequests = sidecar.getRequests('turn/start')
        expect(turnRequests).toHaveLength(1)
        expect(turnRequests[0].params).toEqual({
          threadId: 'thread-1',
          input: [{ type: 'text', text: 'Commander runtime started. Acknowledge readiness and await instructions.' }],
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('advertises experimentalApi when initializing Codex runtime for granular approvals', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-experimental-capability',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })

        expect(createResponse.status).toBe(201)

        const initializeRequests = sidecar.getRequests('initialize')
        expect(initializeRequests).toHaveLength(1)
        expect(initializeRequests[0]?.params).toEqual({
          clientInfo: { name: 'hammurabi', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('makes Codex commander sessions visible to Agents Monitor without the old sidecar stall', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const startedAt = Date.now()
        await server.agents.sessionsInterface.createCommanderSession({
          name: 'commander-codex-visible',
          commanderId: 'codex-visible',
          systemPrompt: 'You are a Codex commander.',
          agentType: 'codex',
        })
        const elapsedMs = Date.now() - startedAt

        expect(elapsedMs).toBeLessThan(1200)

        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)

        const sessions = await response.json() as Array<{
          name: string
          sessionType?: string
          transportType?: string
          agentType?: string
          processAlive?: boolean
        }>
        expect(sessions).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'commander-codex-visible',
            sessionType: 'commander',
            transportType: 'stream',
            agentType: 'codex',
            processAlive: true,
          }),
        ]))
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('keeps Codex stream session task bootstrap as first user turn', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const initialTask = 'Summarize open pull requests.'
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-task-bootstrap',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task: initialTask,
          }),
        })
        expect(createResponse.status).toBe(201)

        const [, , spawnOptions] = mockedSpawn.mock.calls[0] ?? []
        expect(spawnOptions).toEqual(expect.objectContaining({
          env: expect.objectContaining({
            ANTHROPIC_MODEL: undefined,
            ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
            ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
          }),
        }))

        const threadRequests = sidecar.getRequests('thread/start')
        expect(threadRequests).toHaveLength(1)
        const threadStartParams = threadRequests[0].params as Record<string, unknown>
        expect(Object.prototype.hasOwnProperty.call(threadStartParams, 'developerInstructions')).toBe(false)

        const turnRequests = sidecar.getRequests('turn/start')
        expect(turnRequests).toHaveLength(1)
        expect(turnRequests[0].params).toEqual({
          threadId: 'thread-1',
          input: [{ type: 'text', text: initialTask }],
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('passes the requested model into Codex thread bootstrap', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-model-bootstrap',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            model: 'claude-opus-4-6',
            task: 'Review failing tests.',
          }),
        })
        expect(createResponse.status).toBe(201)

        const threadStartParams = sidecar.getRequests('thread/start')[0]?.params as
          | Record<string, unknown>
          | undefined
        expect(threadStartParams?.model).toBe('claude-opus-4-6')
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('auto-rotates non-commander Codex sessions at the completed-turn threshold', async () => {
      const sidecar = installMockCodexSidecar()
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-rotate-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const server = await startServer({
        autoRotateEntryThreshold: 1,
        sessionStorePath,
      })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-auto-rotate',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            model: 'claude-opus-4-6',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-auto-rotate')
        const streamedEvents: Array<Record<string, unknown>> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>
          if (parsed.type !== 'replay') {
            streamedEvents.push(parsed)
          }
        })

        const firstMessageResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-auto-rotate/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'first codex turn' }),
        })
        expect(firstMessageResponse.status).toBe(200)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(1)
          expect(turnStarts[0]?.params).toEqual({
            threadId: 'thread-1',
            input: [{ type: 'text', text: 'first codex turn' }],
          })
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        })
        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        })

        await vi.waitFor(() => {
          expect(sidecar.getStartedThreadIds()).toEqual(['thread-1', 'thread-2'])
        })

        await vi.waitFor(() => {
          expect(streamedEvents.some((event) => (
            event.type === 'system' && event.subtype === 'session_rotated'
          ))).toBe(true)
        })

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string; codexThreadId?: string; conversationEntryCount?: number }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'codex-auto-rotate')
          expect(saved?.codexThreadId).toBe('thread-2')
          expect(saved?.conversationEntryCount).toBe(0)
        })

        const threadStartParams = sidecar.getRequests('thread/start').map((request) => (
          request.params as Record<string, unknown>
        ))
        expect(threadStartParams).toHaveLength(2)
        expect(threadStartParams[0]?.model).toBe('claude-opus-4-6')
        expect(threadStartParams[1]?.model).toBe('claude-opus-4-6')

        const secondMessageResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-auto-rotate/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'second codex turn' }),
        })
        expect(secondMessageResponse.status).toBe(200)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(2)
          expect(turnStarts[1]?.params).toEqual({
            threadId: 'thread-2',
            input: [{ type: 'text', text: 'second codex turn' }],
          })
        })

        const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionsResponse.status).toBe(200)
        const listed = await sessionsResponse.json() as Array<{ name: string }>
        expect(listed.filter((session) => session.name === 'codex-auto-rotate')).toHaveLength(1)

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
        await new Promise((resolve) => setTimeout(resolve, 50))
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    }, 15000)

  it('rotates commander Codex transcript JSONL files when auto-rotation swaps threads', async () => {
      const sidecar = installMockCodexSidecar()
      const workDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-codex-jsonl-'))
      const sessionStorePath = join(workDir, 'stream-sessions.json')
      const originalDataDir = process.env.HAMMURABI_DATA_DIR
      const originalCommanderDataDir = process.env.COMMANDER_DATA_DIR
      process.env.HAMMURABI_DATA_DIR = join(workDir, 'data')
      delete process.env.COMMANDER_DATA_DIR
      setTranscriptStoreRoot(join(workDir, 'data', 'agents', 'sessions'))
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir)
      let server: RunningServer | null = null

      try {
        server = await startServer({
          autoRotateEntryThreshold: 1,
          sessionStorePath,
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'commander-codex-rotate',
            mode: 'default',
            sessionType: 'commander',
            creator: { kind: 'commander', id: 'codex-rotate' },
            transportType: 'stream',
            agentType: 'codex',
            model: 'claude-opus-4-6',
          }),
        })
        expect(createResponse.status).toBe(201)

        const firstMessageResponse = await fetch(`${server.baseUrl}/api/agents/sessions/commander-codex-rotate/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'first commander codex turn' }),
        })
        expect(firstMessageResponse.status).toBe(200)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(1)
          expect(turnStarts[0]?.params).toEqual({
            threadId: 'thread-1',
            input: [{ type: 'text', text: 'first commander codex turn' }],
          })
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        })
        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        })

        await vi.waitFor(() => {
          expect(sidecar.getStartedThreadIds()).toEqual(['thread-1', 'thread-2'])
        })

        const secondMessageResponse = await fetch(`${server.baseUrl}/api/agents/sessions/commander-codex-rotate/message`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'second commander codex turn' }),
        })
        expect(secondMessageResponse.status).toBe(200)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(2)
          expect(turnStarts[1]?.params).toEqual({
            threadId: 'thread-2',
            input: [{ type: 'text', text: 'second commander codex turn' }],
          })
        })

        const oldTranscriptPath = join(
          workDir,
          'data',
          'commander',
          'codex-rotate',
          'sessions',
          'thread-1.jsonl',
        )
        const newTranscriptPath = join(
          workDir,
          'data',
          'commander',
          'codex-rotate',
          'sessions',
          'thread-2.jsonl',
        )

        await vi.waitFor(async () => {
          const raw = await readFile(oldTranscriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as { type?: string; subtype?: string; message?: { content?: string } })

          expect(events.some((event) => event.subtype === 'session_rotated')).toBe(true)
          expect(events.some((event) => event.type === 'user' && event.message?.content === 'first commander codex turn')).toBe(true)
        })

        await vi.waitFor(async () => {
          const raw = await readFile(newTranscriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as { type?: string; message?: { content?: string } })

          expect(events.some((event) => event.type === 'user' && event.message?.content === 'second commander codex turn')).toBe(true)
        })
      } finally {
        await sidecar.closeServer()
        if (server) {
          await server.close()
        }
        cwdSpy.mockRestore()
        if (originalDataDir === undefined) {
          delete process.env.HAMMURABI_DATA_DIR
        } else {
          process.env.HAMMURABI_DATA_DIR = originalDataDir
        }
        if (originalCommanderDataDir === undefined) {
          delete process.env.COMMANDER_DATA_DIR
        } else {
          process.env.COMMANDER_DATA_DIR = originalCommanderDataDir
        }
        resetTranscriptStoreRoot()
        await new Promise((resolve) => setTimeout(resolve, 100))
        await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }, 15_000)

  it('tears down the Codex runtime when initial task bootstrap fails during session creation', async () => {
      const sidecar = installMockCodexSidecar()
      sidecar.setTurnStartBehavior('error')
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-bootstrap-failure',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task: 'bootstrap me',
          }),
        })

        expect(createResponse.status).toBe(500)
        expect(await createResponse.json()).toEqual({
          error: expect.stringContaining('Injected turn/start failure'),
        })

        await vi.waitFor(() => {
          expect(sidecar.getStartedThreadIds()).toEqual(['thread-1'])
          expect(sidecar.getProcessKillCallCount('thread-1')).toBeGreaterThan(0)
        })

        const archiveRequests = sidecar.getRequests('thread/archive').filter((request) => {
          const params = (request.params ?? {}) as { threadId?: unknown }
          return params.threadId === 'thread-1'
        })
        expect(archiveRequests.length).toBeGreaterThan(0)

        const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-bootstrap-failure`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionResponse.status).toBe(404)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    }, 10_000)

  it('delivers REST send requests to Codex sessions through the sidecar transport', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-rest-send',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-rest-send')
        const received: Array<{ type: string; message?: { content?: string } }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; message?: { content?: string } }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-rest-send/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })

        expect(sendResponse.status).toBe(200)
        expect(await sendResponse.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          const userEvent = received.find((event) => event.type === 'user')
          expect(userEvent).toBeDefined()
          expect(userEvent?.message?.content).toBe('status?')
        })

        const turnRequests = sidecar.getRequests('turn/start')
        expect(turnRequests).toHaveLength(1)
        expect(turnRequests[0].params).toEqual({
          threadId: 'thread-1',
          input: [{ type: 'text', text: 'status?' }],
        })

        const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-rest-send`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionResponse.status).toBe(200)
        expect(await sessionResponse.json()).toMatchObject({
          name: 'codex-rest-send',
          completed: false,
          status: 'running',
          agentType: 'codex',
        })

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('does not spin hot Codex direct-send retries while a busy turn is falling back to queue', async () => {
      const sidecar = installMockCodexSidecar()
      sidecar.setTurnStartBehavior('busy')
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-direct-send-hot-retry',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-direct-send-hot-retry/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'interrupt follow-up' }),
        })

        expect(sendResponse.status).toBe(202)
        expect(await sendResponse.json()).toEqual({ sent: false, queued: true })

        await new Promise((resolve) => setTimeout(resolve, 900))

        const turnStarts = sidecar.getRequests('turn/start')
        expect(turnStarts.length).toBeGreaterThanOrEqual(1)
        expect(turnStarts.length).toBeLessThan(5)
        expect(turnStarts[turnStarts.length - 1]?.params).toEqual({
          threadId: 'thread-1',
          input: [{ type: 'text', text: 'interrupt follow-up' }],
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    }, 10_000)

  it('preempts pending direct sends and drains stop before earlier sends and visible queued drafts', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-direct-send-preemption',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task: 'initial busy turn',
          }),
        })
        expect(createResponse.status).toBe(201)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(1)
          expect(getTurnStartText(turnStarts[0])).toBe('initial busy turn')
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        })
        sidecar.setTurnStartBehavior('busy')

        const sendAResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-direct-send-preemption/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'A' }),
        })
        expect(sendAResponse.status).toBe(202)
        expect(await sendAResponse.json()).toEqual({ sent: false, queued: true })

        const visibleQueueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-direct-send-preemption/message?queue=true`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ text: 'visible queue' }),
          },
        )
        expect(visibleQueueResponse.status).toBe(202)

        const stopResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-direct-send-preemption/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'stop' }),
        })
        expect(stopResponse.status).toBe(202)
        expect(await stopResponse.json()).toEqual({ sent: false, queued: true })

        await vi.waitFor(async () => {
          const queueResponse = await fetch(
            `${server.baseUrl}/api/agents/sessions/codex-direct-send-preemption/queue`,
            { headers: AUTH_HEADERS },
          )
          expect(queueResponse.status).toBe(200)
          expect(await queueResponse.json()).toMatchObject({
            currentMessage: { text: 'stop', priority: 'high' },
            items: [
              { text: 'A', priority: 'high' },
              { text: 'visible queue', priority: 'normal' },
            ],
            totalCount: 3,
          })
        })

        const requestCountBeforeStop = sidecar.getRequests('turn/start').length
        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        })
        sidecar.setTurnStartBehavior('success')

        await vi.waitFor(() => {
          const newTurnStarts = sidecar.getRequests('turn/start').slice(requestCountBeforeStop)
          expect(newTurnStarts.length).toBeGreaterThan(0)
          expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('stop')
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-2', status: 'inProgress' },
        })
        const requestCountBeforeA = sidecar.getRequests('turn/start').length
        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-2', status: 'completed' },
        })

        await vi.waitFor(() => {
          const newTurnStarts = sidecar.getRequests('turn/start').slice(requestCountBeforeA)
          expect(newTurnStarts.length).toBeGreaterThan(0)
          expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('A')
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-3', status: 'inProgress' },
        })
        const requestCountBeforeVisibleQueue = sidecar.getRequests('turn/start').length
        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-3', status: 'completed' },
        })

        await vi.waitFor(() => {
          const newTurnStarts = sidecar.getRequests('turn/start').slice(requestCountBeforeVisibleQueue)
          expect(newTurnStarts.length).toBeGreaterThan(0)
          expect(getTurnStartText(newTurnStarts[newTurnStarts.length - 1])).toBe('visible queue')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    }, 10_000)

  it('clears a pending direct-send preemption slot instead of leaving it hidden behind the queue', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-direct-send-clear',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task: 'initial busy turn',
          }),
        })
        expect(createResponse.status).toBe(201)

        await vi.waitFor(() => {
          const turnStarts = sidecar.getRequests('turn/start')
          expect(turnStarts).toHaveLength(1)
          expect(getTurnStartText(turnStarts[0])).toBe('initial busy turn')
        })

        sidecar.emitNotification('turn/started', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'inProgress' },
        })
        sidecar.setTurnStartBehavior('busy')

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-direct-send-clear/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'stop' }),
        })
        expect(sendResponse.status).toBe(202)

        await vi.waitFor(async () => {
          const queueResponse = await fetch(
            `${server.baseUrl}/api/agents/sessions/codex-direct-send-clear/queue`,
            { headers: AUTH_HEADERS },
          )
          expect(queueResponse.status).toBe(200)
          expect(await queueResponse.json()).toMatchObject({
            currentMessage: { text: 'stop', priority: 'high' },
            items: [],
            totalCount: 1,
          })
        })

        const turnStartCountBeforeClear = sidecar.getRequests('turn/start').length
        const clearResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-direct-send-clear/queue`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(clearResponse.status).toBe(200)
        expect(await clearResponse.json()).toEqual({ cleared: true })

        const clearedQueueResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-direct-send-clear/queue`,
          { headers: AUTH_HEADERS },
        )
        expect(clearedQueueResponse.status).toBe(200)
        expect(await clearedQueueResponse.json()).toMatchObject({
          currentMessage: null,
          items: [],
          totalCount: 0,
        })

        sidecar.emitNotification('turn/completed', {
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'completed' },
        })
        sidecar.setTurnStartBehavior('success')
        await new Promise((resolve) => setTimeout(resolve, 350))

        expect(sidecar.getRequests('turn/start')).toHaveLength(turnStartCountBeforeClear)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    }, 10_000)

  it('does not duplicate user events when Codex echoes item/started userMessage after send', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-user-echo-dedupe',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-user-echo-dedupe')
        const received: Array<{ type: string; message?: { content?: string } }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; message?: { content?: string } }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-user-echo-dedupe/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })

        expect(sendResponse.status).toBe(200)
        expect(await sendResponse.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          const userEvents = received.filter(
            (event) => event.type === 'user' && event.message?.content === 'status?',
          )
          expect(userEvents).toHaveLength(1)
        })

        sidecar.emitNotification('item/started', {
          threadId: 'thread-1',
          item: {
            id: 'user-item-1',
            type: 'userMessage',
            content: [{ type: 'input_text', text: 'status?' }],
          },
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        const userEvents = received.filter(
          (event) => event.type === 'user' && event.message?.content === 'status?',
        )
        expect(userEvents).toHaveLength(1)

        const session = server.agents.sessionsInterface.getSession('codex-user-echo-dedupe')
        const storedUserEvents = (session?.events ?? []).filter((event) => {
          if (event.type !== 'user') {
            return false
          }
          const userEvent = event as { message?: { content?: unknown } }
          return userEvent.message?.content === 'status?'
        })
        expect(storedUserEvents).toHaveLength(1)

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('surfaces Codex turn/start rejection and marks the session failed instead of running', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-turn-start-error',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-turn-start-error')
        const received: Array<{ type: string; text?: string; message?: { content?: string } }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string; message?: { content?: string } }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        sidecar.setTurnStartBehavior('error')
        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-turn-start-error/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })

        expect(sendResponse.status).toBe(503)
        expect(await sendResponse.json()).toEqual({
          sent: false,
          error: 'Stream session unavailable',
        })

        await vi.waitFor(() => {
          const systemEvent = received.find((event) => event.type === 'system')
          expect(systemEvent?.text).toContain('Injected turn/start failure')
        })

        expect(received.some((event) => event.type === 'user' && event.message?.content === 'status?')).toBe(false)
        expect(received.some((event) => event.type === 'exit')).toBe(true)

        await vi.waitFor(async () => {
          const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-turn-start-error`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionResponse.status).toBe(200)
          expect(await sessionResponse.json()).toMatchObject({
            name: 'codex-turn-start-error',
            completed: true,
            status: 'failed',
            result: {
              status: 'failed',
              finalComment: expect.stringContaining('Injected turn/start failure'),
            },
          })
        })

        const listResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const sessions = await listResponse.json() as Array<{ name: string; processAlive?: boolean }>
        const exited = sessions.find((session) => session.name === 'codex-turn-start-error')
        expect(exited?.processAlive).toBe(false)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('recovers Codex sessions after abnormal close when the thread remains resumable', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-sidecar-close',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-sidecar-close')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        await sidecar.closeConnection(1006)

        await vi.waitFor(() => {
          const systemEvent = received.find(
            (event) => event.type === 'system' && event.text?.includes('transport recovered'),
          )
          expect(systemEvent?.text).toContain('code 1006')
        })
        expect(received.some((event) => event.type === 'exit')).toBe(false)

        await vi.waitFor(async () => {
          const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-sidecar-close`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionResponse.status).toBe(200)
          expect(await sessionResponse.json()).toMatchObject({
            name: 'codex-sidecar-close',
            completed: false,
            status: 'running',
          })
        })

        await vi.waitFor(() => {
          const resumeRequest = sidecar.getRequests('thread/resume')[0]
          expect(resumeRequest?.params).toEqual(expect.objectContaining({
            threadId: 'thread-1',
            sandbox: 'danger-full-access',
            approvalPolicy: ALWAYS_ON_CODEX_APPROVAL_POLICY,
          }))
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('prefers the concrete runtime exit reason when abnormal close races a real process exit', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-sidecar-exit-race',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-sidecar-exit-race')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        await sidecar.closeConnection(1006)
        sidecar.emitProcessExit(17)

        await vi.waitFor(() => {
          const systemEvent = received.find((event) => event.type === 'system')
          expect(systemEvent?.text).toContain('exited with code 17')
          expect(systemEvent?.text).not.toContain('code 1006')
        })
        expect(received.some((event) => event.type === 'exit')).toBe(true)

        await vi.waitFor(async () => {
          const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-sidecar-exit-race`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionResponse.status).toBe(200)
          expect(await sessionResponse.json()).toMatchObject({
            name: 'codex-sidecar-exit-race',
            completed: true,
            status: 'failed',
            result: {
              status: 'failed',
              finalComment: expect.stringContaining('exited with code 17'),
            },
          })
        })

        expect(sidecar.getRequests('thread/resume')).toHaveLength(0)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('isolates Codex transport recovery to the affected session', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createA = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-isolation-a',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createA.status).toBe(201)

        const createB = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-isolation-b',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createB.status).toBe(201)

        await vi.waitFor(() => {
          expect(sidecar.getRuntimeSpawnCount()).toBe(2)
          expect(sidecar.getStartedThreadIds()).toHaveLength(2)
        })

        const [threadA, threadB] = sidecar.getStartedThreadIds()
        expect(threadA).toBeDefined()
        expect(threadB).toBeDefined()
        expect(threadA).not.toBe(threadB)

        const wsA = await connectWs(server.baseUrl, 'codex-isolation-a')
        const wsB = await connectWs(server.baseUrl, 'codex-isolation-b')
        const receivedA: Array<{ type: string; text?: string }> = []
        const receivedB: Array<{ type: string; text?: string }> = []

        wsA.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            receivedA.push(parsed)
          }
        })
        wsB.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            receivedB.push(parsed)
          }
        })

        await sidecar.closeConnectionForThread(threadA!, 1006)

        await vi.waitFor(() => {
          const systemEvent = receivedA.find(
            (event) => event.type === 'system' && event.text?.includes('transport recovered'),
          )
          expect(systemEvent?.text).toContain('code 1006')
        })
        expect(receivedA.some((event) => event.type === 'exit')).toBe(false)

        await vi.waitFor(() => {
          const resumeRequest = sidecar.getRequests('thread/resume').find((request) => {
            const params = (request.params ?? {}) as { threadId?: unknown }
            return params.threadId === threadA
          })
          expect(resumeRequest).toBeDefined()
        })

        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(receivedB.some((event) => event.type === 'exit')).toBe(false)
        expect(receivedB.some((event) => event.type === 'system' && event.text?.includes('transport recovered'))).toBe(false)

        const sendB = await fetch(`${server.baseUrl}/api/agents/sessions/codex-isolation-b/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'still alive?' }),
        })
        expect(sendB.status).toBe(200)
        expect(await sendB.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          const turnRequest = sidecar.getRequests('turn/start').find((request) => {
            const params = (request.params ?? {}) as {
              threadId?: unknown
              input?: Array<{ text?: unknown }>
            }
            const turnText = Array.isArray(params.input) && typeof params.input[0]?.text === 'string'
              ? params.input[0].text
              : undefined
            return params.threadId === threadB && turnText === 'still alive?'
          })
          expect(turnRequest).toBeDefined()
        })

        const sessionB = await fetch(`${server.baseUrl}/api/agents/sessions/codex-isolation-b`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionB.status).toBe(200)
        expect(await sessionB.json()).toMatchObject({
          name: 'codex-isolation-b',
          completed: false,
          status: 'running',
        })

        const sessionA = await fetch(`${server.baseUrl}/api/agents/sessions/codex-isolation-a`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionA.status).toBe(200)
        expect(await sessionA.json()).toMatchObject({
          name: 'codex-isolation-a',
          completed: false,
          status: 'running',
        })

        wsA.close()
        wsB.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('tears down only the deleted Codex runtime when two sessions are active', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createA = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-delete-a',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createA.status).toBe(201)

        const createB = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-delete-b',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createB.status).toBe(201)

        await vi.waitFor(() => {
          expect(sidecar.getStartedThreadIds()).toHaveLength(2)
        })
        const [threadA, threadB] = sidecar.getStartedThreadIds()

        const deleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-delete-a`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toEqual({ killed: true })

        await vi.waitFor(() => {
          expect(sidecar.getProcessKillCallCount(threadA!)).toBeGreaterThan(0)
        })
        expect(sidecar.getProcessKillCallCount(threadB!)).toBe(0)

        const archiveRequests = sidecar.getRequests('thread/archive').filter((request) => {
          const params = (request.params ?? {}) as { threadId?: unknown }
          return params.threadId === threadA
        })
        expect(archiveRequests.length).toBeGreaterThan(0)

        const sendB = await fetch(`${server.baseUrl}/api/agents/sessions/codex-delete-b/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'session b still active' }),
        })
        expect(sendB.status).toBe(200)
        expect(await sendB.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          const turnRequest = sidecar.getRequests('turn/start').find((request) => {
            const params = (request.params ?? {}) as {
              threadId?: unknown
              input?: Array<{ text?: unknown }>
            }
            const turnText = Array.isArray(params.input) && typeof params.input[0]?.text === 'string'
              ? params.input[0].text
              : undefined
            return params.threadId === threadB && turnText === 'session b still active'
          })
          expect(turnRequest).toBeDefined()
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('reaps all active Codex runtimes on sessions shutdown when runtime API exposes shutdown', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createA = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-shutdown-a',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createA.status).toBe(201)

        const createB = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-shutdown-b',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createB.status).toBe(201)

        await vi.waitFor(() => {
          expect(sidecar.getStartedThreadIds()).toHaveLength(2)
        })

        const [threadA, threadB] = sidecar.getStartedThreadIds()
        const maybeShutdown = (server.agents.sessionsInterface as { shutdown?: () => void | Promise<void> }).shutdown
        if (typeof maybeShutdown !== 'function') {
          return
        }

        await maybeShutdown()

        await vi.waitFor(() => {
          expect(sidecar.getProcessKillCallCount(threadA!)).toBeGreaterThan(0)
          expect(sidecar.getProcessKillCallCount(threadB!)).toBeGreaterThan(0)
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('recovers Codex sessions when runtime keepalive stops receiving pong frames', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        wsKeepAliveIntervalMs: 20,
        codexTurnWatchdogTimeoutMs: 1000,
      })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-sidecar-keepalive-timeout',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.suppressPongResponses()

        const ws = await connectWs(server.baseUrl, 'codex-sidecar-keepalive-timeout')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        await vi.waitFor(() => {
          const systemEvent = received.find(
            (event) => event.type === 'system' && event.text?.includes('transport recovered'),
          )
          expect(systemEvent?.text).toContain('keepalive timeout')
        })
        expect(received.some((event) => event.type === 'exit')).toBe(false)

        await vi.waitFor(async () => {
          const sessionResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-sidecar-keepalive-timeout`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionResponse.status).toBe(200)
          expect(await sessionResponse.json()).toMatchObject({
            completed: false,
            status: 'running',
          })
        })

        await vi.waitFor(() => {
          expect(sidecar.getRequests('thread/resume')).toHaveLength(1)
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('logs Codex runtime stderr output for diagnostics', async () => {
      const sidecar = installMockCodexSidecar()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-sidecar-stderr-log',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.emitStderr('Injected sidecar stderr line')

        await vi.waitFor(() => {
          expect(warnSpy.mock.calls.some(
            ([message]) => typeof message === 'string'
              && message.includes('[agents][codex')
              && message.includes('[stderr]')
              && message.includes('Injected sidecar stderr line'),
          )).toBe(true)
        })
      } finally {
        warnSpy.mockRestore()
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('routes colliding id approval requests as server requests instead of client responses', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-approval-id-collision',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'cmd-collision',
          type: 'commandExecution',
          command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
        }))

        sidecar.queueTurnStartServerRequest('item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-collision',
          itemId: 'cmd-collision',
          reason: 'Collision repro path',
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-approval-id-collision/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'run colliding request-id turn' }),
        })
        expect(sendResponse.status).toBe(200)

        let collidingRequestId = 0
        await vi.waitFor(() => {
          const turnRequest = sidecar.getRequests('turn/start')[0]
          expect(typeof turnRequest?.id).toBe('number')
          collidingRequestId = turnRequest?.id as number
        })

        let pendingApprovalId = ''
        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          pendingApprovalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            source: 'codex',
            actionId: 'send-email',
            sessionId: 'codex-approval-id-collision',
          }))
        })

        await server.approvalCoordinator.resolve(pendingApprovalId, 'approve')

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(collidingRequestId)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('tracks command approval requests and sends explicit accept decisions', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-approval-request-log',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
        }))

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-approval-request-log/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'run diagnostics' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(901, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'cmd-1',
          reason: 'Command writes outside the workspace',
          risk: 'Potentially destructive shell command',
        })

        let pendingApprovalId = ''
        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          pendingApprovalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            source: 'codex',
            actionId: 'send-email',
            sessionId: 'codex-approval-request-log',
          }))
          expect(String(approvals[0].context.summary ?? '')).toContain('matt.feroz@example.com')
        })

        await server.approvalCoordinator.resolve(pendingApprovalId, 'approve')

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(901)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('sends explicit decline decisions for file approval requests', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-approval-request-decline',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'edit-1',
          type: 'fileChange',
          filePath: '/outside/project/config.json',
          content: '{"danger":true}',
        }))

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-approval-request-decline/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'edit config files' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(902, 'item/fileChange/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'edit-1',
          reason: 'Would modify tracked config',
        })

        let pendingApprovalId = ''
        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          pendingApprovalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            source: 'codex',
            toolName: 'Edit',
            sessionId: 'codex-approval-request-decline',
          }))
        })

        await server.approvalCoordinator.resolve(pendingApprovalId, 'reject')

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(902)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('decline')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('enqueues reviewed action-policy approvals for Codex command executions before accepting the native request', async () => {
      const sidecar = installMockCodexSidecar()
      const policyDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-policy-review-'))
      const policyStore = new PolicyStore({
        filePath: join(policyDir, 'policies.json'),
      })
      const approvalCoordinator = new ApprovalCoordinator({
        snapshotFilePath: join(policyDir, 'pending.json'),
        auditFilePath: join(policyDir, 'audit.jsonl'),
      })
      let actionPolicyGate: ActionPolicyGate | null = null
      const server = await startServer({
        getActionPolicyGate: () => actionPolicyGate,
      })
      actionPolicyGate = new ActionPolicyGate({
        policyStore,
        approvalCoordinator,
        getApprovalSessionsInterface: () => server.agents.approvalSessionsInterface,
      })

      try {
        await policyStore.putPolicy('global', 'send-email', {
          policy: 'review',
          allowlist: [],
          blocklist: [],
        })

        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [{
              id: 'turn-1',
              items: [{
                id: 'cmd-email-review',
                type: 'commandExecution',
                command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
              }],
            }],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-policy-review',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-policy-review/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'email the external partner' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(904, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'cmd-email-review',
          reason: 'Command requires approval',
        })

        let approvalId = ''
        await vi.waitFor(async () => {
          const approvals = await approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          approvalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            actionId: 'send-email',
            sessionId: 'codex-policy-review',
            source: 'codex',
          }))
        })

        await approvalCoordinator.resolvePendingApproval(approvalId, 'approve')

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(904)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
        await rm(policyDir, { recursive: true, force: true })
      }
    })

  it('auto-allows allowlisted Codex send-email commands without enqueueing approval', async () => {
      const sidecar = installMockCodexSidecar()
      const policyDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-policy-auto-'))
      const policyStore = new PolicyStore({
        filePath: join(policyDir, 'policies.json'),
      })
      const approvalCoordinator = new ApprovalCoordinator({
        snapshotFilePath: join(policyDir, 'pending.json'),
        auditFilePath: join(policyDir, 'audit.jsonl'),
      })
      let actionPolicyGate: ActionPolicyGate | null = null
      const server = await startServer({
        getActionPolicyGate: () => actionPolicyGate,
      })
      actionPolicyGate = new ActionPolicyGate({
        policyStore,
        approvalCoordinator,
        getApprovalSessionsInterface: () => server.agents.approvalSessionsInterface,
      })

      try {
        await policyStore.putPolicy('global', 'send-email', {
          policy: 'review',
          allowlist: ['teammate@example.com'],
          blocklist: [],
        })

        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [{
              id: 'turn-1',
              items: [{
                id: 'cmd-email-auto',
                type: 'commandExecution',
                command: 'gog gmail send --to teammate@example.com --subject "Allowed"',
              }],
            }],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-policy-auto',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-policy-auto/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'email the teammate' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(905, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'cmd-email-auto',
          reason: 'Command requires approval',
        })

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(905)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })
        expect(await approvalCoordinator.listPending()).toEqual([])
      } finally {
        await sidecar.closeServer()
        await server.close()
        await rm(policyDir, { recursive: true, force: true })
      }
    })

  it('does not mark a Codex turn stale while waiting on approval', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 80,
      })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-approval-wait-no-stale',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-approval-wait-no-stale')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-approval-wait-no-stale/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'run migration check' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'cmd-approval-stall',
          type: 'commandExecution',
          command: 'gog gmail send --to matt.feroz@example.com --subject "Wait on approval"',
        }))

        sidecar.emitServerRequest(903, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'cmd-approval-stall',
          reason: 'Needs user confirmation',
        })

        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          expect(approvals[0]).toEqual(expect.objectContaining({
            source: 'codex',
            actionId: 'send-email',
            sessionId: 'codex-approval-wait-no-stale',
          }))
        })

        await new Promise((resolve) => setTimeout(resolve, 240))

        expect(received.some((event) => event.type === 'system' && event.text?.includes('Codex turn is stale'))).toBe(false)
        expect(sidecar.getRequests('thread/read').length).toBeGreaterThan(0)

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('synthesizes Codex turn completion from thread/read when notifications stall after turn acceptance', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            tokenUsage: {
              inputTokens: 40,
              outputTokens: 12,
              totalCostUsd: 0.07,
            },
            turns: [
              {
                id: 'turn-1',
                status: 'completed',
                tokenUsage: {
                  inputTokens: 40,
                  outputTokens: 12,
                  totalCostUsd: 0.07,
                },
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-watchdog-complete',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-watchdog-complete')
        const received: Array<{ type: string; result?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; result?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-watchdog-complete/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })
        expect(sendResponse.status).toBe(200)

        await vi.waitFor(() => {
          const resultEvent = received.find((event) => event.type === 'result')
          expect(resultEvent?.result).toBe('Turn completed')
        })

        await vi.waitFor(() => {
          const threadReadRequests = sidecar.getRequests('thread/read')
          expect(threadReadRequests.length).toBeGreaterThan(0)
        })

        await vi.waitFor(async () => {
          const worldResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
            headers: AUTH_HEADERS,
          })
          expect(worldResponse.status).toBe(200)
          const world = await worldResponse.json() as Array<{ id: string; status: string; usage: { costUsd: number } }>
          const entry = world.find((item) => item.id === 'codex-watchdog-complete')
          expect(entry?.status).toBe('completed')
          expect(entry?.usage.costUsd).toBe(0.07)
        })

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('marks Codex sessions stale when watchdog cannot confirm turn completion', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [
              {
                id: 'turn-1',
                status: 'inProgress',
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-watchdog-stale',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-watchdog-stale')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-watchdog-stale/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })
        expect(sendResponse.status).toBe(200)

        await vi.waitFor(() => {
          const staleEvent = received.find((event) => event.type === 'system')
          expect(staleEvent?.text).toContain('Codex turn is stale')
        })

        await vi.waitFor(async () => {
          const worldResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
            headers: AUTH_HEADERS,
          })
          expect(worldResponse.status).toBe(200)
          const world = await worldResponse.json() as Array<{ id: string; status: string; phase: string }>
          const entry = world.find((item) => item.id === 'codex-watchdog-stale')
          expect(entry?.status).toBe('stale')
          expect(entry?.phase).toBe('stale')
        })

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            status?: string
            resumeAvailable?: boolean
          }>
          const entry = listedSessions.find((item) => item.name === 'codex-watchdog-stale')
          expect(entry?.status).toBe('stale')
          expect(entry?.resumeAvailable).toBe(true)
        })

        expect(received.some((event) => event.type === 'result')).toBe(false)
        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('declines unhandled Codex approval methods so the turn cannot deadlock waiting on a JSON-RPC response (#1220)', async () => {
      const sidecar = installMockCodexSidecar()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [
              {
                id: 'turn-1',
                status: 'completed',
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-unhandled-approval',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-unhandled-approval')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-unhandled-approval/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'send the gmail draft' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(910, 'item/connector/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-mcp-stall',
          itemId: 'mcp-elicitation-stall',
          reason: 'connector handoff requires approval',
        })

        await vi.waitFor(() => {
          const sidecarResponse = sidecar.getResponseById(910)
          expect((sidecarResponse?.result as { decision?: string } | undefined)?.decision).toBe('decline')
        })

        await vi.waitFor(() => {
          const unhandledEvent = received.find(
            (event) => event.type === 'system'
              && event.text?.includes('item/connector/requestApproval')
              && event.text?.includes('Hammurabi automatically declined'),
          )
          expect(unhandledEvent).toBeDefined()
        })

        expect(warnSpy.mock.calls.some(
          ([message]) => typeof message === 'string'
            && message.includes('Codex approval request used unhandled method'),
        )).toBe(true)

        ws.close()
      } finally {
        warnSpy.mockRestore()
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('emits diagnostic detail in stale-turn message when watchdog fires after unclassified incoming requests', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [
              {
                id: 'turn-1',
                status: 'inProgress',
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-stale-diagnostics',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-stale-diagnostics')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-stale-diagnostics/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })
        expect(sendResponse.status).toBe(200)

        sidecar.emitServerRequest(911, 'item/connector/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'unknown-1',
          reason: 'unknown approval flavor',
        })

        await vi.waitFor(() => {
          const staleEvent = received.find(
            (event) => event.type === 'system' && event.text?.includes('Codex turn is stale'),
          )
          expect(staleEvent).toBeDefined()
          expect(staleEvent?.text).toContain('item/connector/requestApproval')
          expect(staleEvent?.text).toContain('1 unclassified incoming approval request')
        })

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('logs watchdog reconciliation failures before marking Codex sessions stale', async () => {
      const sidecar = installMockCodexSidecar()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadError('Injected thread/read failure')

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-watchdog-thread-read-error',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const ws = await connectWs(server.baseUrl, 'codex-watchdog-thread-read-error')
        const received: Array<{ type: string; text?: string }> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
        })

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-watchdog-thread-read-error/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'status?' }),
        })
        expect(sendResponse.status).toBe(200)

        await vi.waitFor(() => {
          const staleEvent = received.find(
            (event) => event.type === 'system' && event.text?.includes('Codex turn is stale'),
          )
          expect(staleEvent).toBeDefined()
        })

        await vi.waitFor(() => {
          expect(warnSpy.mock.calls.some(
            ([message]) => typeof message === 'string'
              && message.includes('Codex watchdog thread/read reconciliation failed')
              && message.includes('Injected thread/read failure'),
          )).toBe(true)
        })
      } finally {
        warnSpy.mockRestore()
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('resumes stale live Codex sessions in place', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [
              {
                id: 'turn-1',
                status: 'inProgress',
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-stale-resume-source',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-stale-resume-source/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'resume this turn' }),
        })
        expect(sendResponse.status).toBe(200)

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            status?: string
            resumeAvailable?: boolean
          }>
          const entry = listedSessions.find((item) => item.name === 'codex-stale-resume-source')
          expect(entry?.status).toBe('stale')
          expect(entry?.resumeAvailable).toBe(true)
        })

        const resumeResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-stale-resume-source/resume`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        expect(resumeResponse.status).toBe(201)
        const resumed = await resumeResponse.json() as { name: string; resumedFrom: string }
        expect(resumed.name).toBe('codex-stale-resume-source')
        expect(resumed.resumedFrom).toBe('codex-stale-resume-source')

        expect(sidecar.getRequests('thread/resume')).toHaveLength(1)

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            processAlive?: boolean
            resumedFrom?: string
            status?: string
            resumeAvailable?: boolean
          }>
          const matching = listedSessions.filter((item) => item.name === 'codex-stale-resume-source')
          expect(matching).toHaveLength(1)
          expect(matching[0]?.processAlive).toBe(true)
          expect(matching[0]?.resumeAvailable).toBe(false)
          expect(matching[0]?.resumedFrom).toBeUndefined()
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('hides Resume for exited Codex sessions when the rollout file is missing', async () => {
      const homeDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-home-'))
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const originalHome = process.env.HOME

      await writeFile(
        sessionStorePath,
        JSON.stringify({
          sessions: [
            {
              name: 'hamkid',
              agentType: 'codex',
              mode: 'default',
              cwd: '/home/builder/App',
              createdAt: '2026-04-07T23:24:35.181Z',
              codexThreadId: '019d6a43-1781-70b2-b8e0-eb1fda3dead3',
              sessionState: 'exited',
              hadResult: false,
              events: [],
            },
          ],
        }),
        'utf8',
      )

      process.env.HOME = homeDir
      const server = await startServer({
        autoResumeSessions: true,
        sessionStorePath,
      })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)

        const sessions = await response.json() as Array<{
          name: string
          resumeAvailable?: boolean
          status?: string
        }>
        const hamkid = sessions.find((session) => session.name === 'hamkid')
        expect(hamkid?.status).toBe('exited')
        expect(hamkid?.resumeAvailable).toBe(false)
      } finally {
        await server.close()
        if (originalHome === undefined) {
          delete process.env.HOME
        } else {
          process.env.HOME = originalHome
        }
        await rm(homeDir, { recursive: true, force: true })
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('returns 409 and clears stale Codex resume metadata when rollout is gone', async () => {
      const homeDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-home-'))
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-codex-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const originalHome = process.env.HOME

      await writeFile(
        sessionStorePath,
        JSON.stringify({
          sessions: [
            {
              name: 'hamkid',
              agentType: 'codex',
              mode: 'default',
              cwd: '/home/builder/App',
              createdAt: '2026-04-07T23:24:35.181Z',
              codexThreadId: '019d6a43-1781-70b2-b8e0-eb1fda3dead3',
              sessionState: 'exited',
              hadResult: false,
              events: [],
            },
          ],
        }),
        'utf8',
      )

      process.env.HOME = homeDir
      const server = await startServer({
        autoResumeSessions: true,
        sessionStorePath,
      })

      try {
        const resumeResponse = await fetch(`${server.baseUrl}/api/agents/sessions/hamkid/resume`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        expect(resumeResponse.status).toBe(409)
        expect(await resumeResponse.json()).toEqual({
          error: 'Session "hamkid" can no longer be resumed because its Codex rollout is unavailable',
        })

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as { sessions: Array<{ name: string; codexThreadId?: string }> }
          expect(parsed.sessions.find((session) => session.name === 'hamkid')).toBeUndefined()
        })

        const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionsResponse.status).toBe(200)
        const sessions = await sessionsResponse.json() as Array<{
          name: string
          resumeAvailable?: boolean
        }>
        expect(sessions.find((session) => session.name === 'hamkid')).toEqual(
          expect.objectContaining({
            name: 'hamkid',
            resumeAvailable: false,
          }),
        )
      } finally {
        await server.close()
        if (originalHome === undefined) {
          delete process.env.HOME
        } else {
          process.env.HOME = originalHome
        }
        await rm(homeDir, { recursive: true, force: true })
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('accounts for Codex thread/tokenUsage/updated notifications in replay usage totals', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-usage-notifications',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.emitNotification('thread/tokenUsage/updated', {
          threadId: 'thread-1',
          tokenUsage: {
            inputTokens: 90,
            outputTokens: 33,
            totalCostUsd: 0.11,
          },
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        const wsUrl = server.baseUrl.replace('http://', 'ws://') +
          '/api/agents/sessions/codex-usage-notifications/terminal?api_key=test-key'
        const ws = new WebSocket(wsUrl)
        const replayPromise = new Promise<{
          type: string
          events: Array<{ type: string; usage?: unknown; usage_is_total?: boolean }>
          usage: { inputTokens: number; outputTokens: number; costUsd: number }
        }>((resolve) => {
          ws.on('message', (data) => {
            const parsed = JSON.parse(data.toString()) as {
              type: string
              events?: Array<{ type: string; usage?: unknown; usage_is_total?: boolean }>
              usage?: { inputTokens: number; outputTokens: number; costUsd: number }
            }
            if (parsed.type === 'replay' && parsed.events && parsed.usage) {
              resolve({
                type: parsed.type,
                events: parsed.events,
                usage: parsed.usage,
              })
            }
          })
        })
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve())
          ws.on('error', reject)
        })

        const replay = await replayPromise

        expect(replay.usage).toEqual({
          inputTokens: 90,
          outputTokens: 33,
          costUsd: 0.11,
        })
        const usageEvent = replay.events.find((event) => event.type === 'message_delta')
        expect(usageEvent).toMatchObject({
          usage: { input_tokens: 90, output_tokens: 33 },
          usage_is_total: true,
        })

        ws.close()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('routes sessionsInterface.sendToSession through Codex transport', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-interface-send',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sent = await server.agents.sessionsInterface.sendToSession('codex-interface-send', 'heartbeat')
        expect(sent).toBe(true)

        await vi.waitFor(() => {
          const turnRequests = sidecar.getRequests('turn/start')
          expect(turnRequests).toHaveLength(1)
          expect(turnRequests[0].params).toEqual({
            threadId: 'thread-1',
            input: [{ type: 'text', text: 'heartbeat' }],
          })
        })

        const session = server.agents.sessionsInterface.getSession('codex-interface-send')
        expect(session?.events.some((event) => event.type === 'user')).toBe(true)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('bootstraps Codex commander sessions with developerInstructions and no seed turn', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const systemPrompt = 'You are Athena. Follow commander runtime policy.'
        await server.agents.sessionsInterface.createCommanderSession({
          name: 'commander-codex-bootstrap',
          commanderId: 'codex-bootstrap',
          systemPrompt,
          agentType: 'codex',
          cwd: '/tmp',
        })

        await vi.waitFor(() => {
          const threadRequests = sidecar.getRequests('thread/start')
          expect(threadRequests).toHaveLength(1)
          expect(threadRequests[0]?.params).toEqual(expect.objectContaining({
            cwd: '/tmp',
            sandbox: 'danger-full-access',
            approvalPolicy: ALWAYS_ON_CODEX_APPROVAL_POLICY,
            developerInstructions: systemPrompt,
          }))
        })
        expect(sidecar.getRequests('turn/start')).toHaveLength(0)

        const startupMessage = 'Commander runtime started. Acknowledge readiness and await instructions.'
        const sent = await server.agents.sessionsInterface.sendToSession('commander-codex-bootstrap', startupMessage)
        expect(sent).toBe(true)

        await vi.waitFor(() => {
          const turnRequests = sidecar.getRequests('turn/start')
          expect(turnRequests).toHaveLength(1)
          expect(turnRequests[0]?.params).toEqual({
            threadId: 'thread-1',
            input: [{ type: 'text', text: startupMessage }],
          })
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('keeps non-commander Codex task bootstrap as the first user turn', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const task = 'Summarize failing tests before coding.'
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-task-bootstrap',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
            task,
          }),
        })
        expect(createResponse.status).toBe(201)

        await vi.waitFor(() => {
          const threadRequests = sidecar.getRequests('thread/start')
          expect(threadRequests).toHaveLength(1)
        })

        const threadStartParams = sidecar.getRequests('thread/start')[0]?.params as
          | Record<string, unknown>
          | undefined
        expect(threadStartParams?.developerInstructions).toBeUndefined()

        await vi.waitFor(() => {
          const turnRequests = sidecar.getRequests('turn/start')
          expect(turnRequests).toHaveLength(1)
          expect(turnRequests[0]?.params).toEqual({
            threadId: 'thread-1',
            input: [{ type: 'text', text: task }],
          })
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('routes default-mode Codex sessions through the unified gate and auto-approves safe internal actions', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-yolo-auto-accept',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'cmd-yolo',
          type: 'commandExecution',
          command: 'ls -la',
        }))

        sidecar.emitServerRequest(904, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-yolo',
          itemId: 'cmd-yolo',
          reason: 'safe internal command still emits requestApproval',
        })

        await vi.waitFor(() => {
          const response = sidecar.getResponseById(904)
          expect((response?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })

        expect(await server.approvalCoordinator.listPending()).toEqual([])

        const session = server.agents.sessionsInterface.getSession('codex-yolo-auto-accept')
        expect(session?.codexPendingApprovals.size).toBe(0)
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('routes default-mode Codex sessions through the unified gate for non-allowlisted gmail sends', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-yolo-reviewed-send',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        sidecar.setThreadReadResult(buildCodexThreadReadResult({
          id: 'cmd-send-review',
          type: 'commandExecution',
          command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
        }))

        sidecar.emitServerRequest(905, 'item/commandExecution/requestApproval', {
          threadId: 'thread-1',
          turnId: 'turn-send-review',
          itemId: 'cmd-send-review',
          reason: 'outbound send requires approval in default mode',
        })

        let pendingApprovalId = ''
        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          pendingApprovalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            actionId: 'send-email',
            sessionId: 'codex-yolo-reviewed-send',
            source: 'codex',
          }))
        })

        await server.approvalCoordinator.resolve(pendingApprovalId, 'approve')

        await vi.waitFor(() => {
          const response = sidecar.getResponseById(905)
          expect((response?.result as { decision?: string } | undefined)?.decision).toBe('accept')
        })
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('forwards sandbox and always-on approvalPolicy on thread/resume after stale-turn recovery', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer({
        codexTurnWatchdogTimeoutMs: 40,
      })

      try {
        sidecar.setThreadReadResult({
          thread: {
            id: 'thread-1',
            turns: [
              {
                id: 'turn-1',
                status: 'inProgress',
              },
            ],
          },
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-yolo-resume',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-yolo-resume/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'trigger stale turn' }),
        })
        expect(sendResponse.status).toBe(200)

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            status?: string
            resumeAvailable?: boolean
          }>
          const entry = listedSessions.find((item) => item.name === 'codex-yolo-resume')
          expect(entry?.status).toBe('stale')
          expect(entry?.resumeAvailable).toBe(true)
        })

        const resumeResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-yolo-resume/resume`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        expect(resumeResponse.status).toBe(201)

        const resumeRequests = sidecar.getRequests('thread/resume')
        expect(resumeRequests).toHaveLength(1)
        expect(resumeRequests[0].params).toEqual(expect.objectContaining({
          threadId: 'thread-1',
          sandbox: 'danger-full-access',
          approvalPolicy: ALWAYS_ON_CODEX_APPROVAL_POLICY,
        }))
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('accepts requestId=0 on /codex-approvals/:requestId as a parseable request id', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-approval-zero',
            mode: 'default',
            transportType: 'stream',
            agentType: 'codex',
          }),
        })
        expect(createResponse.status).toBe(201)

        const approveResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-approval-zero/codex-approvals/0`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ decision: 'accept' }),
          },
        )
        expect(approveResponse.status).toBe(404)
        const body = await approveResponse.json() as { error: string }
        expect(body.error).not.toContain('Invalid Codex approval request id')

        const malformedResponse = await fetch(
          `${server.baseUrl}/api/agents/sessions/codex-approval-zero/codex-approvals/0abc`,
          {
            method: 'POST',
            headers: {
              ...AUTH_HEADERS,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ decision: 'accept' }),
          },
        )
        expect(malformedResponse.status).toBe(400)
        const malformedBody = await malformedResponse.json() as { error: string }
        expect(malformedBody.error).toBe('Invalid Codex approval request id')
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })
})
