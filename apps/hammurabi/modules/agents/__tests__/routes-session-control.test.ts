import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import type { PtySpawner } from '../routes'
import {
  AUTH_HEADERS,
  INTERNAL_AUTH_HEADERS,
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
  setTranscriptStoreRoot,
  startServer,
  writeSessionMeta,
} from './routes-test-harness'
import type { MockCodexSidecar, MockGeminiAcpRuntime, RunningServer } from './routes-test-harness'


describe("agents routes", () => {
  it('requires authentication to access sessions', async () => {
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`)

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Unauthorized',
      })

      await server.close()
    })

  it('returns empty session list initially', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })
      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload).toEqual([])

      await server.close()
    })

  it('merges commander sessions with role and excludes stopped commanders', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const commanderSessions: CommanderSession[] = [
        {
          id: 'alpha',
          host: 'localhost',
          pid: 101,
          state: 'running',
          created: '2026-03-06T00:00:00.000Z',
          agentType: 'codex',
          heartbeat: {
            intervalMs: 300000,
            messageTemplate: 'ping',
            lastSentAt: null,
          },
          lastHeartbeat: '2026-03-06T00:01:00.000Z',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g' },
          currentTask: {
            issueNumber: 331,
            issueUrl: 'https://github.com/NickGuAI/Hervald/issues/331',
            startedAt: '2026-03-06T00:00:30.000Z',
          },
          completedTasks: 0,
          totalCostUsd: 1.25,
        },
        {
          id: 'commander-beta',
          host: 'localhost',
          pid: 202,
          state: 'paused',
          created: '2026-03-06T00:02:00.000Z',
          heartbeat: {
            intervalMs: 300000,
            messageTemplate: 'ping',
            lastSentAt: null,
          },
          lastHeartbeat: '2026-03-06T00:03:00.000Z',
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g' },
          currentTask: null,
          completedTasks: 0,
          totalCostUsd: 0.5,
        },
        {
          id: 'gamma',
          host: 'localhost',
          pid: null,
          state: 'stopped',
          created: '2026-03-06T00:04:00.000Z',
          heartbeat: {
            intervalMs: 300000,
            messageTemplate: 'ping',
            lastSentAt: null,
          },
          lastHeartbeat: null,
          taskSource: { owner: 'NickGuAI', repo: 'monorepo-g' },
          currentTask: null,
          completedTasks: 1,
          totalCostUsd: 2.0,
        },
      ]

      vi.mocked(CommanderSessionStore.prototype.list).mockResolvedValue(commanderSessions)

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'world-worker-01',
            mode: 'default',
          }),
        })
        expect(createResponse.status).toBe(201)

        const response = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        const payload = await response.json() as Array<{
          id: string
          role: string
          status: string
          phase: string
        }>

        expect(response.status).toBe(200)
        expect(payload).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: 'world-worker-01',
            role: 'worker',
          }),
          expect.objectContaining({
            id: 'commander-alpha',
            agentType: 'codex',
            role: 'commander',
            status: 'active',
            phase: 'thinking',
          }),
          expect.objectContaining({
            id: 'commander-beta',
            role: 'commander',
            status: 'idle',
            phase: 'blocked',
          }),
        ]))
        expect(payload.some((agent) => agent.id === 'commander-gamma')).toBe(false)
      } finally {
        await server.close()
      }
    })

  it('classifies stream phase as blocked for pending AskUserQuestion and thinking after tool_result', async () => {
      const streamMock = createMockChildProcess()
      mockedSpawn.mockReturnValueOnce(streamMock.cp as never)
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'world-blocked-01',
            mode: 'default',
            sessionType: 'stream',
            task: 'Need clarification',
          }),
        })
        expect(createResponse.status).toBe(201)

        streamMock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
        streamMock.emitStdout('{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"ask_1","name":"AskUserQuestion","input":{"questions":[{"question":"Pick one","multiSelect":false,"options":[{"label":"A","description":"A"}]}]}}]}}\n')

        const blockedResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        expect(blockedResponse.status).toBe(200)
        const blockedPayload = await blockedResponse.json() as Array<{ phase: string; lastToolUse: string | null }>
        expect(blockedPayload).toHaveLength(1)
        expect(blockedPayload[0].phase).toBe('blocked')
        expect(blockedPayload[0].lastToolUse).toBe('AskUserQuestion')

        streamMock.emitStdout('{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"ask_1","content":"{\\"answers\\":{\\"Pick one\\":\\"A\\"},\\"annotations\\":{}}"}]}}\n')

        const thinkingResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        expect(thinkingResponse.status).toBe(200)
        const thinkingPayload = await thinkingResponse.json() as Array<{ phase: string; lastToolUse: string | null }>
        expect(thinkingPayload).toHaveLength(1)
        expect(thinkingPayload[0].phase).toBe('thinking')
        expect(thinkingPayload[0].lastToolUse).toBe('AskUserQuestion')
      } finally {
        await server.close()
      }
    })

  it('resolves remote login shells on the target host instead of copying the local SHELL', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'gpu-1',
            label: 'GPU 1',
            host: '10.0.1.50',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
          },
        ],
      })
      const originalShell = process.env.SHELL
      process.env.SHELL = '/opt/homebrew/bin/zsh'

      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        mockedSpawn.mockImplementationOnce(() => {
          const mock = createMockChildProcess()
          queueMicrotask(() => {
            mock.emitStdout([
              'ssh:ok',
              'claude:1.0.31',
              'codex:0.1.2503271400',
              'gemini:missing',
              'git:git version 2.45.1',
              'node:v22.14.0',
              '',
            ].join('\n'))
            mock.emitExit(0)
          })
          return mock.cp as never
        })

        const response = await fetch(`${server.baseUrl}/api/agents/machines/gpu-1/health`, {
          headers: AUTH_HEADERS,
        })

        expect(response.status).toBe(200)
        const sshArgs = mockedSpawn.mock.calls[0][1]
        const remoteCommand = sshArgs[sshArgs.length - 1]
        expect(remoteCommand).toContain('exec "${SHELL:-/bin/bash}" -lc')
        expect(remoteCommand).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).not.toContain('/opt/homebrew/bin/zsh')
      } finally {
        process.env.SHELL = originalShell
        await server.close()
        await registry.cleanup()
      }
    })

  it('rejects unsafe session names', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: ':0.1',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(400)
      expect(spawner.spawn).not.toHaveBeenCalled()

      await server.close()
    })

  it('rejects invalid host payloads on create', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-host-invalid',
          mode: 'default',
          host: { id: 'gpu-1' },
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid host: expected machine ID string' })
      expect(spawner.spawn).not.toHaveBeenCalled()

      await server.close()
    })

  it('creates a remote PTY session over SSH when host is provided', async () => {
      const { spawner } = createMockPtySpawner()
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          {
            id: 'gpu-1',
            label: 'GPU',
            host: '10.0.1.50',
            user: 'builder',
            port: 2222,
            cwd: '/home/builder/workspace',
          },
        ],
      })
      const server = await startServer({
        ptySpawner: spawner,
        machinesFilePath: registry.filePath,
      })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'agent-remote-pty',
            mode: 'default',
            host: 'gpu-1',
          }),
        })

        expect(createResponse.status).toBe(201)
        expect(await createResponse.json()).toEqual({
          sessionName: 'agent-remote-pty',
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'human', id: 'api-key' },
          transportType: 'pty',
          agentType: 'claude',
          host: 'gpu-1',
          created: true,
        })

        expect(spawner.spawn).toHaveBeenCalledWith(
          'ssh',
          expect.arrayContaining(['-tt', '-p', '2222', 'builder@10.0.1.50']),
          expect.objectContaining({
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
          }),
        )

        const sshArgs = vi.mocked(spawner.spawn).mock.calls[0][1]
        const remoteCommand = sshArgs[sshArgs.length - 1]
        expect(remoteCommand).toContain('cd ')
        expect(remoteCommand).toContain('/home/builder/workspace')
        expect(remoteCommand).toContain('exec "${SHELL:-/bin/bash}" -l')

        const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const sessions = await sessionsResponse.json() as Array<{ name: string; host?: string }>
        expect(sessions).toHaveLength(1)
        expect(sessions[0].name).toBe('agent-remote-pty')
        expect(sessions[0].host).toBe('gpu-1')
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('returns clear error when remote PTY SSH spawn fails', async () => {
      const failingSpawner: PtySpawner = {
        spawn: vi.fn(() => {
          throw new Error('Permission denied')
        }),
      }
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'gpu-1', label: 'GPU', host: '10.0.1.50', user: 'builder' },
        ],
      })
      const server = await startServer({
        ptySpawner: failingSpawner,
        machinesFilePath: registry.filePath,
      })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'agent-remote-fail',
            mode: 'default',
            host: 'gpu-1',
          }),
        })

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({
          error: 'Failed to create remote PTY session: Permission denied',
        })
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('creates a PTY-backed claude session', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-create-01',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        sessionName: 'agent-create-01',
        mode: 'default',
        sessionType: 'worker',
        creator: { kind: 'human', id: 'api-key' },
        transportType: 'pty',
        agentType: 'claude',
        created: true,
      })
      expect(spawner.spawn).toHaveBeenCalledWith('bash', ['-l'], expect.objectContaining({
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
      }))
      expect(lastHandle()!.write).toHaveBeenCalledWith(
        'export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL && claude --effort max\r',
      )

      await server.close()
    })

  it('creates a PTY-backed claude session with the default PTY loader', async () => {
      const handle = createMockPtyHandle()
      mockedNodePtySpawn.mockReturnValue(handle)
      const server = await startServer()

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'agent-default-loader-01',
            mode: 'default',
          }),
        })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({
          sessionName: 'agent-default-loader-01',
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'human', id: 'api-key' },
          transportType: 'pty',
          agentType: 'claude',
          created: true,
        })
        expect(mockedNodePtySpawn).toHaveBeenCalledWith(
          'bash',
          ['-l'],
          expect.objectContaining({
            name: 'xterm-256color',
            cols: 120,
            rows: 40,
          }),
        )
        expect(handle.write).toHaveBeenCalledWith(
          'export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL && claude --effort max\r',
        )
      } finally {
        await server.close()
      }
    })

  it('uses the requested Claude effort for PTY sessions', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'agent-effort-pty-01',
            mode: 'default',
            effort: 'high',
          }),
        })

        expect(response.status).toBe(201)
        expect(lastHandle()!.write).toHaveBeenCalledWith(
          'export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL && claude --effort high\r',
        )
      } finally {
        await server.close()
      }
    })

  it('disables adaptive thinking for PTY sessions when requested', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'agent-adaptive-disabled-pty-01',
            mode: 'default',
            adaptiveThinking: 'disabled',
          }),
        })

        expect(response.status).toBe(201)
        expect(lastHandle()!.write).toHaveBeenCalledWith(
          'export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1 && unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL && claude --effort max\r',
        )
      } finally {
        await server.close()
      }
    })

  it('returns 409 when session already exists on create', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const first = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-dup',
          mode: 'default',
        }),
      })
      expect(first.status).toBe(201)

      const second = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-dup',
          mode: 'default',
        }),
      })

      expect(second.status).toBe(409)
      expect(spawner.spawn).toHaveBeenCalledTimes(1)

      await server.close()
    })

  it('ignores invalid mode values on create and falls back to default mode', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-create-01',
          mode: 'plan',
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual(expect.objectContaining({
        sessionName: 'agent-create-01',
        mode: 'default',
      }))
      expect(spawner.spawn).toHaveBeenCalledTimes(1)

      await server.close()
    })

  it('requires authentication for create session', async () => {
      const server = await startServer()

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-create-01',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Unauthorized',
      })

      await server.close()
    })

  it('returns 403 for create session when key lacks write scope', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...READ_ONLY_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-create-01',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Insufficient API key scope',
      })
      expect(spawner.spawn).not.toHaveBeenCalled()

      await server.close()
    })

  it('creates default-mode sessions with agents:write scope only', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...WRITE_ONLY_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-default-write-only',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(201)
      expect(spawner.spawn).toHaveBeenCalledTimes(1)

      await server.close()
    })

  it('returns 429 when max tracked sessions limit is reached', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({
        ptySpawner: spawner,
        maxSessions: 1,
      })

      const firstResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-limit-1',
          mode: 'default',
        }),
      })
      expect(firstResponse.status).toBe(201)

      const secondResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-limit-2',
          mode: 'default',
        }),
      })

      expect(secondResponse.status).toBe(429)
      expect(spawner.spawn).toHaveBeenCalledTimes(1)

      await server.close()
    })

  it('sends initial task after session creation', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({
        ptySpawner: spawner,
        taskDelayMs: 0,
      })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-task-01',
          mode: 'default',
          task: 'Fix the auth bug in login.ts',
        }),
      })

      expect(response.status).toBe(201)
      await vi.waitFor(() => {
        expect(lastHandle()!.write).toHaveBeenCalledTimes(2)
      })
      expect(lastHandle()!.write).toHaveBeenNthCalledWith(
        1,
        'export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0 && unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL && claude --effort max\r',
      )
      expect(lastHandle()!.write).toHaveBeenNthCalledWith(
        2,
        'Fix the auth bug in login.ts\r',
      )

      await server.close()
    })

  it('lists created sessions', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-list-01',
          mode: 'default',
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      const payload = (await response.json()) as Array<{
        name: string
        created: string
        pid: number
      }>

      expect(response.status).toBe(200)
      expect(payload).toHaveLength(1)
      expect(payload[0].name).toBe('agent-list-01')
      expect(payload[0].pid).toBe(12345)

      await server.close()
    })

  it('uses commander host as the session label', async () => {
      vi.mocked(CommanderSessionStore.prototype.list).mockResolvedValue([
        {
          id: 'cmdr-athena',
          host: 'athena',
        } as unknown as CommanderSession,
      ])

      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'commander-cmdr-athena',
          mode: 'default',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-athena' },
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      const payload = (await response.json()) as Array<{
        name: string
        label?: string
        sessionType?: string
        creator?: { kind?: string; id?: string }
      }>

      expect(response.status).toBe(200)
      expect(payload).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'commander-cmdr-athena',
          label: 'athena',
          sessionType: 'commander',
          creator: { kind: 'commander', id: 'cmdr-athena' },
        }),
      ]))

      await server.close()
    })

  it('kills a session', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-kill-01',
          mode: 'default',
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions/agent-kill-01`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ killed: true })
      expect(lastHandle()!.kill).toHaveBeenCalled()

      await server.close()
    })

  it('clears Codex watchdog state before deleting a stream session', async () => {
      const sidecar = installMockCodexSidecar()
      const server = await startServer()
      let watchdogTimer: ReturnType<typeof setTimeout> | undefined

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'codex-delete-watchdog',
            mode: 'default',
            sessionType: 'stream',
            agentType: 'codex',
            task: 'Delete this session',
          }),
        })

        expect(createResponse.status).toBe(201)

        const session = server.agents.sessionsInterface.getSession('codex-delete-watchdog')
        expect(session?.agentType).toBe('codex')

        watchdogTimer = setTimeout(() => {}, 60_000)
        if (session) {
          session.codexTurnWatchdogTimer = watchdogTimer
          session.codexTurnStaleAt = '2026-04-16T03:35:04.000Z'
        }

        const deleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-delete-watchdog`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })

        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toEqual({ killed: true })
        expect(session?.codexTurnWatchdogTimer).toBeUndefined()
        expect(session?.codexTurnStaleAt).toBeUndefined()
      } finally {
        if (watchdogTimer) {
          clearTimeout(watchdogTimer)
        }
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('preserves a resumable stream as exited on first delete, then removes it on exited cleanup delete', async () => {
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
            name: 'codex-dismiss-worker',
            mode: 'default',
            sessionType: 'stream',
            agentType: 'codex',
            task: 'Preserve my rollout',
          }),
        })

        expect(createResponse.status).toBe(201)

        const session = server.agents.sessionsInterface.getSession('codex-dismiss-worker')
        expect(session?.agentType).toBe('codex')
        if (session?.kind === 'stream') {
          session.codexThreadId = 'thread-dismiss-worker'
        }

        const firstDeleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-dismiss-worker`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })

        expect(firstDeleteResponse.status).toBe(200)
        expect(await firstDeleteResponse.json()).toEqual({ killed: true })

        const afterFirstDelete = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const afterFirstDeletePayload = await afterFirstDelete.json() as Array<{
          name: string
          status: string
        }>

        expect(afterFirstDeletePayload).toEqual(expect.arrayContaining([
          expect.objectContaining({
            name: 'codex-dismiss-worker',
            status: 'exited',
          }),
        ]))

        const secondDeleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/codex-dismiss-worker`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })

        expect(secondDeleteResponse.status).toBe(200)
        expect(await secondDeleteResponse.json()).toEqual({ killed: true })

        const afterSecondDelete = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const afterSecondDeletePayload = await afterSecondDelete.json() as Array<{
          name: string
        }>

        expect(afterSecondDeletePayload.find((entry) => entry.name === 'codex-dismiss-worker')).toBeUndefined()
      } finally {
        await sidecar.closeServer()
        await server.close()
      }
    })

  it('returns 404 when killing a missing session', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions/nonexistent`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(404)

      await server.close()
    })

  it('requires authentication for killing sessions', async () => {
      const server = await startServer()

      const response = await fetch(`${server.baseUrl}/api/agents/sessions/alpha`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Unauthorized',
      })

      await server.close()
    })

  it('returns 403 for kill session when key lacks write scope', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions/alpha`, {
        method: 'DELETE',
        headers: READ_ONLY_AUTH_HEADERS,
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Insufficient API key scope',
      })

      await server.close()
    })

  it('connects via WebSocket and receives PTY output', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-test',
          mode: 'default',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'ws-test')

      const received: string[] = []
      const messagePromise = new Promise<void>((resolve) => {
        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            received.push(data.toString())
          }
          if (received.length >= 1) {
            resolve()
          }
        })
      })

      lastHandle()!.emitData('hello world\r\n')

      await messagePromise
      expect(received).toContain('hello world\r\n')

      ws.close()
      await server.close()
    })

  it('sends scrollback buffer on WebSocket connect', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-scrollback',
          mode: 'default',
        }),
      })

      // Emit data before WebSocket connects
      lastHandle()!.emitData('previous output\r\n')

      // Attach message listener before open to avoid race condition with scrollback
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-scrollback/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: string[] = []

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          messages.push(data.toString())
        }
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      // Wait for buffered scrollback message to arrive
      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      expect(messages.join('')).toContain('previous output\r\n')

      ws.close()
      await server.close()
    })

  it('replays PTY scrollback after a client reconnect', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-reconnect-scrollback',
          mode: 'default',
        }),
      })

      const firstWs = await connectWs(server.baseUrl, 'ws-reconnect-scrollback')
      const firstChunks: string[] = []
      firstWs.on('message', (data, isBinary) => {
        if (isBinary) {
          firstChunks.push(data.toString())
        }
      })

      lastHandle()!.emitData('before reconnect\r\n')

      await vi.waitFor(() => {
        expect(firstChunks.join('')).toContain('before reconnect\r\n')
      })

      firstWs.close()
      await new Promise<void>((resolve) => firstWs.on('close', () => resolve()))

      // Data produced while disconnected should be included in replay on reconnect.
      lastHandle()!.emitData('after reconnect\r\n')

      const replayChunks: string[] = []
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-reconnect-scrollback/terminal?api_key=test-key'
      const secondWs = new WebSocket(wsUrl)
      secondWs.on('message', (data, isBinary) => {
        if (isBinary) {
          replayChunks.push(data.toString())
        }
      })

      await new Promise<void>((resolve, reject) => {
        secondWs.on('open', () => resolve())
        secondWs.on('error', reject)
      })

      await vi.waitFor(() => {
        const replay = replayChunks.join('')
        expect(replay).toContain('before reconnect\r\n')
        expect(replay).toContain('after reconnect\r\n')
        expect(replay.split('before reconnect\r\n').length - 1).toBe(1)
        expect(replay.split('after reconnect\r\n').length - 1).toBe(1)
      })

      secondWs.close()
      await server.close()
    })

  it('writes WebSocket binary messages to PTY', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-input',
          mode: 'default',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'ws-input')

      ws.send(Buffer.from('ls -la\r'), { binary: true })

      await vi.waitFor(() => {
        // First call is the Claude command, second is our input
        expect(lastHandle()!.write).toHaveBeenCalledWith('ls -la\r')
      })

      ws.close()
      await server.close()
    })

  it('handles resize control messages via WebSocket', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-resize',
          mode: 'default',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'ws-resize')

      ws.send(JSON.stringify({ type: 'resize', cols: 200, rows: 50 }))

      await vi.waitFor(() => {
        expect(lastHandle()!.resize).toHaveBeenCalledWith(200, 50)
      })

      ws.close()
      await server.close()
    })

  it('sends keepalive ping frames to connected sockets', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({
        ptySpawner: spawner,
        wsKeepAliveIntervalMs: 20,
      })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-keepalive-ping',
          mode: 'default',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'ws-keepalive-ping')
      let pingCount = 0
      ws.on('ping', () => {
        pingCount += 1
      })

      await vi.waitFor(() => {
        expect(pingCount).toBeGreaterThan(0)
      })

      ws.close()
      await server.close()
    })

  it('terminates stale sockets that stop responding to keepalive pings', async () => {
      const { spawner, lastHandle } = createMockPtySpawner()
      const server = await startServer({
        ptySpawner: spawner,
        wsKeepAliveIntervalMs: 20,
      })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-keepalive-stale',
          mode: 'default',
        }),
      })

      const staleWs = await connectWs(server.baseUrl, 'ws-keepalive-stale')
      staleWs.on('error', () => {
        // socket may emit ECONNRESET when server terminates stale connection
      })

      const interceptedPong = vi.fn(() => staleWs)
      Object.defineProperty(staleWs, 'pong', {
        value: interceptedPong,
        configurable: true,
      })

      let staleCloseCode: number | undefined
      staleWs.on('close', (code) => {
        staleCloseCode = code
      })

      await vi.waitFor(() => {
        expect(staleCloseCode).toBeDefined()
      })

      expect(interceptedPong).toHaveBeenCalled()
      expect([1005, 1006]).toContain(staleCloseCode)

      // Server should continue accepting healthy clients after stale cleanup.
      const healthyWs = await connectWs(server.baseUrl, 'ws-keepalive-stale')
      const messages: string[] = []
      healthyWs.on('message', (data, isBinary) => {
        if (isBinary) {
          messages.push(data.toString())
        }
      })

      lastHandle()!.emitData('recovered after stale socket\r\n')

      await vi.waitFor(() => {
        expect(messages.join('')).toContain('recovered after stale socket\r\n')
      })

      healthyWs.close()
      await server.close()
    })

  it('rejects WebSocket connection without auth', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-noauth',
          mode: 'default',
        }),
      })

      await expect(connectWs(server.baseUrl, 'ws-noauth', 'bad-key')).rejects.toThrow()

      await server.close()
    })

  it('rejects WebSocket connection for nonexistent session', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await expect(connectWs(server.baseUrl, 'nonexistent')).rejects.toThrow()

      await server.close()
    })

  it('rejects WebSocket connection when key lacks write scope', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ws-readonly',
          mode: 'default',
        }),
      })

      await expect(connectWs(server.baseUrl, 'ws-readonly', 'read-only-key')).rejects.toThrow()

      await server.close()
    })

  it('creates session with custom cwd', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-cwd-01',
          mode: 'default',
          cwd: '/home/builder/projects/my-repo',
        }),
      })

      expect(response.status).toBe(201)
      expect(spawner.spawn).toHaveBeenCalledWith('bash', ['-l'], expect.objectContaining({
        cwd: '/home/builder/projects/my-repo',
      }))

      await server.close()
    })

  it('uses default cwd when cwd is omitted', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-cwd-default',
          mode: 'default',
        }),
      })

      expect(response.status).toBe(201)
      expect(spawner.spawn).toHaveBeenCalledWith('bash', ['-l'], expect.objectContaining({
        cwd: expect.any(String),
      }))

      await server.close()
    })

  it('rejects relative path for cwd', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-cwd-relative',
          mode: 'default',
          cwd: 'relative/path',
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid cwd: must be an absolute path' })
      expect(spawner.spawn).not.toHaveBeenCalled()

      await server.close()
    })

  it('rejects non-string cwd', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-cwd-number',
          mode: 'default',
          cwd: 42,
        }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid cwd: must be an absolute path' })
      expect(spawner.spawn).not.toHaveBeenCalled()

      await server.close()
    })

  it('normalizes cwd with .. traversal sequences', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'agent-cwd-traversal',
          mode: 'default',
          cwd: '/home/builder/../../etc',
        }),
      })

      expect(response.status).toBe(201)
      expect(spawner.spawn).toHaveBeenCalledWith('bash', ['-l'], expect.objectContaining({
        cwd: '/etc',
      }))

      await server.close()
    })

  it('handles malformed percent-encoding in WebSocket URL without crashing', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/%E0%A4%A/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)

      await expect(
        new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve())
          ws.on('error', reject)
          ws.on('unexpected-response', (_req, res) => {
            reject(new Error(`Status ${res.statusCode}`))
          })
        }),
      ).rejects.toThrow()

      await server.close()
    })

  it('accepts WebSocket upgrade on /ws alias path (used by commander sessions)', async () => {
      // The agents router accepts both /terminal (legacy) and /ws (new commander usage).
      // Verify the /ws suffix correctly routes to the same session as /terminal.
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ws-alias-test', mode: 'default' }),
      })

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/ws-alias-test/ws?api_key=test-key'
      const ws = new WebSocket(wsUrl)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out')), 3_000)
        ws.on('open', () => { clearTimeout(timeout); resolve() })
        ws.on('error', (err) => { clearTimeout(timeout); reject(err) })
        ws.on('unexpected-response', (_req, res) => {
          clearTimeout(timeout)
          reject(new Error(`WebSocket upgrade rejected with status ${res.statusCode}`))
        })
      })

      ws.close()
      await server.close()
    })
})
