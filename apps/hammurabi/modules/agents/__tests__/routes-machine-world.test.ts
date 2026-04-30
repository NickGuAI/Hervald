import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import type { PtySpawner } from '../routes'
import {
  AUTH_HEADERS,
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
  setTranscriptStoreRoot,
  startServer,
  writeSessionMeta,
} from './routes-test-harness'
import type { MockCodexSidecar, MockGeminiAcpRuntime, RunningServer } from './routes-test-harness'


describe("agents routes", () => {
  it('returns empty world agent list initially', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })
      const response = await fetch(`${server.baseUrl}/api/agents/world`, {
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])

      await server.close()
    })

  it('returns PTY world agent with idle phase, zero usage, empty task, and null lastToolUse', async () => {
      const { spawner } = createMockPtySpawner()
      const server = await startServer({ ptySpawner: spawner })

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'world-pty-01',
          mode: 'default',
        }),
      })
      expect(createResponse.status).toBe(201)

      const response = await fetch(`${server.baseUrl}/api/agents/world`, {
        headers: AUTH_HEADERS,
      })
      const payload = await response.json() as Array<{
        id: string
        agentType: string
        transportType: string
        status: string
        phase: string
        usage: { inputTokens: number; outputTokens: number; costUsd: number }
        task: string
        lastToolUse: string | null
        lastUpdatedAt: string
      }>

      expect(response.status).toBe(200)
      expect(payload).toHaveLength(1)
      expect(payload[0].id).toBe('world-pty-01')
      expect(payload[0].agentType).toBe('claude')
      expect(payload[0].transportType).toBe('pty')
      expect(payload[0].status).toBe('active')
      expect(payload[0].phase).toBe('idle')
      expect(payload[0].usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })
      expect(payload[0].task).toBe('')
      expect(payload[0].lastToolUse).toBeNull()
      expect(payload[0].lastUpdatedAt).toEqual(expect.any(String))

      await server.close()
    })

  it('returns stream world agent with tool_use phase and includes usage + task + lastToolUse', async () => {
      const streamMock = createMockChildProcess()
      mockedSpawn.mockReturnValueOnce(streamMock.cp as never)
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'world-stream-01',
          mode: 'default',
          sessionType: 'stream',
          task: 'Fix login retries',
        }),
      })
      expect(createResponse.status).toBe(201)

      streamMock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      streamMock.emitStdout('{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool_1","name":"Bash","input":{"command":"ls -la"}}]}}\n')

      const response = await fetch(`${server.baseUrl}/api/agents/world`, {
        headers: AUTH_HEADERS,
      })
      const payload = await response.json() as Array<{
        id: string
        phase: string
        usage: { inputTokens: number; outputTokens: number; costUsd: number }
        task: string
        lastToolUse: string | null
      }>

      expect(response.status).toBe(200)
      expect(payload).toHaveLength(1)
      expect(payload[0].id).toBe('world-stream-01')
      expect(payload[0].phase).toBe('tool_use')
      expect(payload[0].usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })
      expect(payload[0].task).toBe('Fix login retries')
      expect(payload[0].lastToolUse).toBe('Bash')

      await server.close()
    })

  it('classifies world status as active/idle/stale/completed based on event recency and completion', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        const baseTime = new Date('2026-03-05T00:00:00.000Z')
        vi.setSystemTime(baseTime)

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
              name: 'world-status-01',
              mode: 'default',
              sessionType: 'stream',
            }),
          })
          expect(createResponse.status).toBe(201)

          // Mark turn in-progress so status derives from recency windows.
          streamMock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')

          const statusAt = async (iso: string): Promise<string> => {
            vi.setSystemTime(new Date(iso))
            const response = await fetch(`${server.baseUrl}/api/agents/world`, {
              headers: AUTH_HEADERS,
            })
            expect(response.status).toBe(200)
            const payload = await response.json() as Array<{ status: string }>
            expect(payload).toHaveLength(1)
            return payload[0].status
          }

          expect(await statusAt('2026-03-05T00:00:30.000Z')).toBe('active')
          expect(await statusAt('2026-03-05T00:01:00.000Z')).toBe('idle')
          expect(await statusAt('2026-03-05T00:05:00.000Z')).toBe('idle')
          expect(await statusAt('2026-03-05T00:05:01.000Z')).toBe('stale')
          const stalePhaseResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
            headers: AUTH_HEADERS,
          })
          expect(stalePhaseResponse.status).toBe(200)
          const stalePhasePayload = await stalePhaseResponse.json() as Array<{ phase: string }>
          expect(stalePhasePayload[0].phase).toBe('stale')

          streamMock.emitStdout('{"type":"result","result":"done"}\n')
          const completedResponse = await fetch(`${server.baseUrl}/api/agents/world`, {
            headers: AUTH_HEADERS,
          })
          expect(completedResponse.status).toBe(200)
          const completedPayload = await completedResponse.json() as Array<{ status: string; phase: string }>
          expect(completedPayload[0].status).toBe('completed')
          expect(completedPayload[0].phase).toBe('completed')
        } finally {
          await server.close()
        }
      } finally {
        vi.useRealTimers()
      }
    })

  it('requires authentication to access world agents', async () => {
      const server = await startServer()
      const response = await fetch(`${server.baseUrl}/api/agents/world`)

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Unauthorized',
      })

      await server.close()
    })

  it('returns configured machines from /machines', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          {
            id: 'gpu-1',
            label: 'GPU',
            host: '10.0.1.50',
            user: 'builder',
            port: 22,
            envFile: '/Users/builder/.hammurabi-env',
          },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/machines`, {
          headers: AUTH_HEADERS,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([
          { id: 'local', label: 'Local', host: null },
          {
            id: 'gpu-1',
            label: 'GPU',
            host: '10.0.1.50',
            user: 'builder',
            port: 22,
            envFile: '/Users/builder/.hammurabi-env',
          },
        ])
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('returns empty machines list when registry file is missing', async () => {
      const registry = await createMissingMachinesRegistryPath()
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/machines`, {
          headers: AUTH_HEADERS,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual([])
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('returns 500 for malformed machines registry', async () => {
      const registry = await createTempMachinesRegistry({})
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/machines`, {
          headers: AUTH_HEADERS,
        })

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({
          error: 'Invalid machines config: expected "machines" array',
        })
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('adds a machine via POST /machines and persists it to the registry', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const response = await fetch(`${server.baseUrl}/api/agents/machines`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id: 'gpu-2',
            label: 'GPU 2',
            host: '10.0.1.60',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
            envFile: '/Users/builder/.hammurabi-env',
          }),
        })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({
          id: 'gpu-2',
          label: 'GPU 2',
          host: '10.0.1.60',
          user: 'builder',
          port: 2222,
          cwd: '/srv/workspace',
          envFile: '/Users/builder/.hammurabi-env',
        })

        const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as { machines: unknown[] }
        expect(stored.machines).toEqual([
          { id: 'local', label: 'Local', host: null },
          {
            id: 'gpu-2',
            label: 'GPU 2',
            host: '10.0.1.60',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
            envFile: '/Users/builder/.hammurabi-env',
          },
        ])
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('verifies a tailscale hostname before registration and persists the resolved host metadata', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        mockedSpawn.mockImplementationOnce(() => {
          const mock = createMockChildProcess()
          queueMicrotask(() => {
            mock.emitStdout('pong from home-mac.tail2bb6ea.ts.net (100.101.102.103) via DERP(sea) in 18ms\n')
            mock.emitExit(0)
          })
          return mock.cp as never
        })

        const response = await fetch(`${server.baseUrl}/api/agents/machines`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id: 'home-mac',
            label: 'Home Mac',
            tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
            user: 'yugu',
            cwd: '/Users/yugu',
          }),
        })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({
          id: 'home-mac',
          label: 'Home Mac',
          host: '100.101.102.103',
          tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
          user: 'yugu',
          cwd: '/Users/yugu',
        })

        expect(mockedSpawn).toHaveBeenCalledWith(
          'tailscale',
          ['ping', '--c', '1', '--timeout', '5s', 'home-mac.tail2bb6ea.ts.net'],
          expect.objectContaining({
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        )

        const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as { machines: unknown[] }
        expect(stored.machines).toEqual([
          { id: 'local', label: 'Local', host: null },
          {
            id: 'home-mac',
            label: 'Home Mac',
            host: '100.101.102.103',
            tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
            user: 'yugu',
            cwd: '/Users/yugu',
          },
        ])
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('verifies a tailscale hostname through the dedicated machine route', async () => {
      const server = await startServer()

      try {
        mockedSpawn.mockImplementationOnce(() => {
          const mock = createMockChildProcess()
          queueMicrotask(() => {
            mock.emitStdout('pong from home-mac.tail2bb6ea.ts.net (100.101.102.103) via DERP(sea) in 18ms\n')
            mock.emitExit(0)
          })
          return mock.cp as never
        })

        const response = await fetch(`${server.baseUrl}/api/agents/machines/verify-tailscale`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            hostname: 'home-mac.tail2bb6ea.ts.net',
          }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          tailscaleHostname: 'home-mac.tail2bb6ea.ts.net',
          resolvedHost: '100.101.102.103',
        })
      } finally {
        await server.close()
      }
    })

  it('rejects duplicate machine IDs and invalid add payloads', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          { id: 'gpu-1', label: 'GPU 1', host: '10.0.1.50' },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const duplicate = await fetch(`${server.baseUrl}/api/agents/machines`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id: 'gpu-1',
            label: 'GPU 1 copy',
            host: '10.0.1.60',
          }),
        })

        expect(duplicate.status).toBe(409)
        expect(await duplicate.json()).toEqual({
          error: 'Machine "gpu-1" already exists',
        })

        const invalid = await fetch(`${server.baseUrl}/api/agents/machines`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            id: 'gpu-2',
            label: 'GPU 2',
            host: null,
          }),
        })

        expect(invalid.status).toBe(400)
        expect(await invalid.json()).toEqual({
          error: 'Invalid machines config: machine "gpu-2" host must be string',
        })
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('removes remote machines and rejects removing the local machine', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          { id: 'gpu-1', label: 'GPU 1', host: '10.0.1.50' },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        const deleteRemote = await fetch(`${server.baseUrl}/api/agents/machines/gpu-1`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteRemote.status).toBe(204)

        const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as { machines: unknown[] }
        expect(stored.machines).toEqual([
          { id: 'local', label: 'Local', host: null },
        ])

        const deleteLocal = await fetch(`${server.baseUrl}/api/agents/machines/local`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteLocal.status).toBe(400)
        expect(await deleteLocal.json()).toEqual({
          error: 'Machine "local" is the local machine and cannot be removed',
        })

        const deleteMissing = await fetch(`${server.baseUrl}/api/agents/machines/missing-host`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteMissing.status).toBe(404)
        expect(await deleteMissing.json()).toEqual({
          error: 'Machine "missing-host" not found',
        })
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('returns structured health data for remote machines', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'gpu-1',
            label: 'GPU 1',
            host: '10.0.1.50',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
            envFile: '/Users/builder/.hammurabi-env',
          },
        ],
      })
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
        expect(await response.json()).toEqual({
          machineId: 'gpu-1',
          mode: 'ssh',
          ssh: {
            ok: true,
            destination: 'builder@10.0.1.50',
          },
          tools: {
            claude: { ok: true, version: '1.0.31', raw: '1.0.31' },
            codex: { ok: true, version: '0.1.2503271400', raw: '0.1.2503271400' },
            gemini: { ok: false, version: null, raw: 'missing' },
            git: { ok: true, version: 'git version 2.45.1', raw: 'git version 2.45.1' },
            node: { ok: true, version: 'v22.14.0', raw: 'v22.14.0' },
          },
        })

        expect(mockedSpawn).toHaveBeenCalledWith(
          'ssh',
          expect.arrayContaining([
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            '-p',
            '2222',
            'builder@10.0.1.50',
          ]),
          expect.objectContaining({
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        )
        const sshArgs = mockedSpawn.mock.calls[0][1]
        const remoteCommand = sshArgs[sshArgs.length - 1]
        expect(remoteCommand).toContain('exec "${SHELL:-/bin/bash}" -lc')
        expect(remoteCommand).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('/Users/builder/.hammurabi-env')
        expect(remoteCommand).toContain('cd ')
        expect(remoteCommand).toContain('/srv/workspace')
        expect(remoteCommand.indexOf('/Users/builder/.hammurabi-env')).toBeLessThan(
          remoteCommand.indexOf('/srv/workspace'),
        )
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('returns provider auth status for remote machines', async () => {
      const registry = await createTempMachinesRegistry({
        machines: [
          {
            id: 'gpu-1',
            label: 'GPU 1',
            host: '10.0.1.50',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
            envFile: '/Users/builder/.hammurabi-env',
          },
        ],
      })
      const server = await startServer({ machinesFilePath: registry.filePath })

      try {
        mockedSpawn.mockImplementationOnce(() => {
          const mock = createMockChildProcess()
          queueMicrotask(() => {
            mock.emitStdout([
              'version:claude:1.0.31',
              'env:claude:CLAUDE_CODE_OAUTH_TOKEN',
              'login:claude:1',
              'version:codex:0.1.2503271400',
              'env:codex:missing',
              'login:codex:0',
              'version:gemini:0.1.18',
              'env:gemini:GEMINI_API_KEY',
              'login:gemini:n/a',
              '',
            ].join('\n'))
            mock.emitExit(0)
          })
          return mock.cp as never
        })

        const response = await fetch(`${server.baseUrl}/api/agents/machines/gpu-1/auth-status`, {
          headers: AUTH_HEADERS,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          machineId: 'gpu-1',
          envFile: '/Users/builder/.hammurabi-env',
          checkedAt: expect.any(String),
          providers: {
            claude: {
              provider: 'claude',
              label: 'Claude',
              installed: true,
              version: '1.0.31',
              envConfigured: true,
              envSourceKey: 'CLAUDE_CODE_OAUTH_TOKEN',
              loginConfigured: false,
              configured: true,
              currentMethod: 'setup-token',
              verificationCommand: 'claude --version && (test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status)',
            },
            codex: {
              provider: 'codex',
              label: 'Codex',
              installed: true,
              version: '0.1.2503271400',
              envConfigured: false,
              envSourceKey: null,
              loginConfigured: true,
              configured: true,
              currentMethod: 'device-auth',
              verificationCommand: 'codex --version && (test -n "$OPENAI_API_KEY" || codex login status)',
            },
            gemini: {
              provider: 'gemini',
              label: 'Gemini',
              installed: true,
              version: '0.1.18',
              envConfigured: true,
              envSourceKey: 'GEMINI_API_KEY',
              loginConfigured: false,
              configured: true,
              currentMethod: 'api-key',
              verificationCommand: 'gemini --version && (test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY")',
            },
          },
        })

        const sshArgs = mockedSpawn.mock.calls[0]?.[1] ?? []
        const remoteCommand = typeof sshArgs[sshArgs.length - 1] === 'string' ? sshArgs[sshArgs.length - 1] : ''
        expect(remoteCommand).toContain('claude auth status')
        expect(remoteCommand).toContain('codex login status')
        expect(remoteCommand).toContain('/Users/builder/.hammurabi-env')
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('writes provider secrets only to the worker env file during auth setup', async () => {
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
      const server = await startServer({ machinesFilePath: registry.filePath })
      let writtenEnvFile = ''

      try {
        mockedSpawn.mockImplementation((command, args) => {
          if (command !== 'ssh' || !Array.isArray(args)) {
            return createMockChildProcess().cp as never
          }

          const remoteCommand = typeof args[args.length - 1] === 'string' ? args[args.length - 1] : ''

          if (remoteCommand.includes('printf %s "$HOME"')) {
            const mock = createMockChildProcess()
            queueMicrotask(() => {
              mock.emitStdout('/Users/builder')
              mock.emitExit(0)
            })
            return mock.cp as never
          }

          if (remoteCommand.includes('if [ -f') && remoteCommand.includes('/Users/builder/.hammurabi-env')) {
            const mock = createMockChildProcess()
            queueMicrotask(() => {
              mock.emitStdout('export KEEP_ME=\'1\'\n')
              mock.emitExit(0)
            })
            return mock.cp as never
          }

          if (remoteCommand.includes('cat >') && remoteCommand.includes('/Users/builder/.hammurabi-env')) {
            const mock = createMockChildProcess((data) => {
              writtenEnvFile += data
            })
            queueMicrotask(() => {
              mock.emitExit(0)
            })
            return mock.cp as never
          }

          if (remoteCommand.includes('version:claude:') && remoteCommand.includes('login:gemini:')) {
            const mock = createMockChildProcess()
            queueMicrotask(() => {
              mock.emitStdout([
                'version:claude:1.0.31',
                'env:claude:CLAUDE_CODE_OAUTH_TOKEN',
                'login:claude:1',
                'version:codex:0.1.2503271400',
                'env:codex:missing',
                'login:codex:1',
                'version:gemini:0.1.18',
                'env:gemini:missing',
                'login:gemini:n/a',
                '',
              ].join('\n'))
              mock.emitExit(0)
            })
            return mock.cp as never
          }

          const mock = createMockChildProcess()
          queueMicrotask(() => {
            mock.emitError(new Error(`Unhandled SSH command: ${remoteCommand}`))
          })
          return mock.cp as never
        })

        const response = await fetch(`${server.baseUrl}/api/agents/machines/gpu-1/auth-setup`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'claude',
            mode: 'setup-token',
            secret: 'claude-token-value',
          }),
        })
        const payload = await response.json()

        expect(response.status).toBe(200)
        expect(payload).toEqual({
          machineId: 'gpu-1',
          envFile: '/Users/builder/.hammurabi-env',
          checkedAt: expect.any(String),
          providers: expect.objectContaining({
            claude: expect.objectContaining({
              configured: true,
              currentMethod: 'setup-token',
              envSourceKey: 'CLAUDE_CODE_OAUTH_TOKEN',
            }),
          }),
        })

        expect(writtenEnvFile).toContain('export KEEP_ME=')
        expect(writtenEnvFile).toContain('export CLAUDE_CODE_OAUTH_TOKEN=')
        expect(writtenEnvFile).toContain('claude-token-value')

        const stored = JSON.parse(await readFile(registry.filePath, 'utf8')) as {
          machines: Array<{ id: string; envFile?: string }>
        }
        expect(stored.machines).toEqual([
          {
            id: 'gpu-1',
            label: 'GPU 1',
            host: '10.0.1.50',
            user: 'builder',
            port: 2222,
            cwd: '/srv/workspace',
            envFile: '/Users/builder/.hammurabi-env',
          },
        ])

        const writeCall = mockedSpawn.mock.calls.find(([, sshArgs]) => {
          const remoteCommand = Array.isArray(sshArgs) ? sshArgs[sshArgs.length - 1] : ''
          return (
            typeof remoteCommand === 'string'
            && remoteCommand.includes('cat >')
            && remoteCommand.includes('/Users/builder/.hammurabi-env')
          )
        })
        expect(JSON.stringify(writeCall?.[1] ?? [])).not.toContain('claude-token-value')
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('rejects unknown host machine IDs on create', async () => {
      const { spawner } = createMockPtySpawner()
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          { id: 'gpu-1', label: 'GPU', host: '10.0.1.50' },
        ],
      })
      const server = await startServer({
        ptySpawner: spawner,
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
            name: 'agent-host-unknown',
            mode: 'default',
            host: 'missing-host',
          }),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          error: 'Unknown host machine "missing-host"',
        })
        expect(spawner.spawn).not.toHaveBeenCalled()
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })
})
