import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { CommanderSessionStore, type CommanderSession } from '../../commanders/store'
import { createDefaultHeartbeatState } from '../../commanders/heartbeat'
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

const CLAUDE_SOURCE = {
  source: {
    backend: 'cli',
    provider: 'claude',
  },
} as const

const UNSET_CLAUDE_CHILD_ENV = 'unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL'

function withClaudeSource<T extends Record<string, unknown>>(event: T) {
  return {
    ...event,
    ...CLAUDE_SOURCE,
  }
}

describe("stream sessions", () => {
  function installMockProcess() {
      const mock = createMockChildProcess()
      mockedSpawn.mockReturnValue(mock.cp as never)
      return mock
    }

  function isLocalClaudeLoginShellSpawn(command: unknown, args: unknown): args is string[] {
      return (
        command === (process.env.SHELL || '/bin/bash') &&
        Array.isArray(args) &&
        args[0] === '-lc' &&
        typeof args[1] === 'string'
      )
    }

  function findLocalClaudeLoginShellSpawn(
    matcher: (script: string) => boolean,
  ): [unknown, string[], unknown] | undefined {
      return mockedSpawn.mock.calls.find(([command, args]) => {
        return isLocalClaudeLoginShellSpawn(command, args) && matcher(args[1].replace(/'/g, ''))
      })
    }

  function escapeSingleQuotes(value: string): string {
      return value.replace(/'/g, `'\\''`)
    }

  function extractShellArg(script: string, flag: string): string | null {
      const marker = `'${flag}' `
      const start = script.indexOf(marker)
      if (start === -1) {
        return null
      }

      let index = start + marker.length
      while (index < script.length && /\s/.test(script[index])) {
        index += 1
      }

      let token = ''
      let inSingleQuote = false
      while (index < script.length) {
        const char = script[index]
        if (!inSingleQuote && /\s/.test(char)) {
          break
        }
        if (char === '\'') {
          inSingleQuote = !inSingleQuote
          token += char
          index += 1
          continue
        }
        if (!inSingleQuote && char === '\\' && script[index + 1] === '\'') {
          token += '\\\''
          index += 2
          continue
        }
        token += char
        index += 1
      }

      return token.length > 0 ? token : null
    }

  function decodeShellSingleQuotedArg(token: string): string {
      if (!token.startsWith('\'') || !token.endsWith('\'')) {
        return token
      }
      return token.slice(1, -1).replace(/'\\''/g, '\'')
    }

  function expectInlineClaudeApprovalSettings(script: string) {
      const token = extractShellArg(script, '--settings')
      expect(token).toBeTruthy()
      const settings = JSON.parse(decodeShellSingleQuotedArg(token ?? '{}')) as {
        hooks?: {
          PreToolUse?: Array<{
            matcher?: string
            hooks?: Array<{ type?: string; command?: string }>
          }>
        }
      }
      expect(settings.hooks?.PreToolUse?.[0]?.matcher).toBe('*')
      expect(settings.hooks?.PreToolUse?.[0]?.hooks?.[0]).toEqual(expect.objectContaining({
        type: 'command',
      }))
      expect(settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toContain('node -e ')
    }

  function expectLocalClaudeScript(
    script: string,
    effort: 'max' | 'medium' = 'max',
    adaptiveThinking: '0' | '1' = '0',
    options: {
      cwd?: string
      includeSettings?: boolean
      resumeSessionId?: string
    } = {},
  ) {
      const normalizedScript = script.replace(/'/g, '')
      expect(script).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
      expect(script).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
      if (options.cwd) {
        expect(script).toContain(`cd '${escapeSingleQuotes(options.cwd)}' &&`)
      }
      expect(script).toContain(`export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=${adaptiveThinking}`)
      expect(script).toContain(UNSET_CLAUDE_CHILD_ENV)
      expect(script).toContain('claude ')
      expect(normalizedScript).toContain(`--effort ${effort}`)
      if (options.includeSettings) {
        expect(script).toContain('--settings')
        expect(script).not.toContain('claude-approval-hook.mjs')
        expectInlineClaudeApprovalSettings(script)
      }
      if (options.resumeSessionId) {
        expect(normalizedScript).toContain(`--resume ${options.resumeSessionId}`)
      }
    }

  function expectDefaultClaudeSpawn(effort: 'max' | 'medium' = 'max', adaptiveThinking: '0' | '1' = '0') {
      const [command, args, options] = mockedSpawn.mock.calls.at(-1) ?? []
      expect(isLocalClaudeLoginShellSpawn(command, args)).toBe(true)
      expectLocalClaudeScript(String(args?.[1]), effort, adaptiveThinking, {
        includeSettings: true,
      })

      expect(options).toEqual(expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: adaptiveThinking,
          CLAUDECODE: undefined,
          ANTHROPIC_MODEL: undefined,
          ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
          ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      }))
    }

  afterEach(() => {
      mockedSpawn.mockRestore()
    })

  it('creates a stream session via POST /sessions with sessionType=stream', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-01',
          mode: 'default',
          sessionType: 'stream',
          task: 'Fix the auth bug',
        }),
      })

      expect(createResponse.status).toBe(201)
      const body = await createResponse.json()
      expect(body).toEqual({
        sessionName: 'stream-01',
        mode: 'default',
        sessionType: 'worker',
        creator: { kind: 'human', id: 'api-key' },
        transportType: 'stream',
        agentType: 'claude',
        created: true,
      })

      // Verify spawn was called with correct args
      expectDefaultClaudeSpawn()

      // Verify initial task was written to stdin
      expect(mock.getStdinWrites().length).toBeGreaterThan(0)
      const firstWrite = mock.getStdinWrites()[0]
      const parsed = JSON.parse(firstWrite.replace('\n', ''))
      expect(parsed).toEqual({
        type: 'user',
        message: { role: 'user', content: 'Fix the auth bug' },
      })

      await server.close()
    })

  it('rejects non-worker sessionType overrides for non-internal callers', async () => {
      installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-worker-01',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'cron',
        }),
      })

      expect(createResponse.status).toBe(403)
      expect(await createResponse.json()).toEqual({
        error: 'Only internal callers can create non-worker session types',
      })

      await server.close()
    })

  it('uses the requested Claude effort for stream sessions and exposes it in the session list', async () => {
      installMockProcess()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-effort-01',
            mode: 'default',
            sessionType: 'stream',
            effort: 'medium',
          }),
        })

        expect(createResponse.status).toBe(201)
        expectDefaultClaudeSpawn('medium')

        const listResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(listResponse.status).toBe(200)
        const sessions = await listResponse.json() as Array<{ name: string; effort?: string }>
        expect(sessions.find((session) => session.name === 'stream-effort-01')?.effort).toBe('medium')
      } finally {
        await server.close()
      }
    })

  it('appends commander stream events to JSONL transcript', async () => {
      const mock = installMockProcess()
      const workDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-jsonl-'))
      const originalDataDir = process.env.HAMMURABI_DATA_DIR
      const originalCommanderDataDir = process.env.COMMANDER_DATA_DIR
      process.env.HAMMURABI_DATA_DIR = join(workDir, 'data')
      delete process.env.COMMANDER_DATA_DIR
      setTranscriptStoreRoot(join(workDir, 'data', 'agents', 'sessions'))
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir)
      let server: RunningServer | null = null

      try {
        server = await startServer()

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'commander-alpha',
            mode: 'default',
            transportType: 'stream',
            sessionType: 'commander',
            creator: { kind: 'commander', id: 'alpha' },
          }),
        })
        expect(createResponse.status).toBe(201)

        const initEvent = {
          type: 'system',
          subtype: 'init',
          session_id: 'claude-commander-123',
          source: CLAUDE_SOURCE,
        }
        const deltaEvent = {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { input_tokens: 3, output_tokens: 1 },
          source: CLAUDE_SOURCE,
        }

        mock.emitStdout(`${JSON.stringify(initEvent)}\n`)
        mock.emitStdout(`${JSON.stringify(deltaEvent)}\n`)

        const transcriptPath = join(
          workDir,
          'data',
          'commander',
          'alpha',
          'sessions',
          'claude-commander-123.jsonl',
        )
        const sharedTranscriptPath = join(
          workDir,
          'data',
          'agents',
          'sessions',
          'commander-alpha',
          'transcript.v1.jsonl',
        )
        const metaPath = join(
          workDir,
          'data',
          'agents',
          'sessions',
          'commander-alpha',
          'meta.json',
        )

        await vi.waitFor(async () => {
          const raw = await readFile(transcriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)

          expect(events).toHaveLength(2)
          expect(events[0]).toEqual(withClaudeSource(initEvent))
          expect(events[1]).toEqual(withClaudeSource(deltaEvent))

          const sharedRaw = await readFile(sharedTranscriptPath, 'utf8')
          const sharedEvents = sharedRaw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)

          expect(sharedEvents).toEqual(events)

          const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
            agentType?: string
            claudeSessionId?: string
          }
          expect(meta.agentType).toBe('claude')
          expect(meta.claudeSessionId).toBe('claude-commander-123')
        })
      } finally {
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
        await rm(workDir, { recursive: true, force: true })
      }
    })

  it('auto-rotates commander Claude sessions at the completed-turn threshold', async () => {
      const processMocks: Array<ReturnType<typeof createMockChildProcess>> = []
      mockedSpawn.mockImplementation(() => {
        const mock = createMockChildProcess()
        processMocks.push(mock)
        return mock.cp as never
      })

      const workDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-rotate-'))
      const commanderDataDir = join(workDir, 'commander-data')
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
          commanderSessionStorePath: join(commanderDataDir, 'sessions.json'),
          sessionStorePath,
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'commander-alpha',
            mode: 'default',
            transportType: 'stream',
            sessionType: 'commander',
            creator: { kind: 'commander', id: 'alpha' },
          }),
        })
        expect(createResponse.status).toBe(201)
        expect(processMocks).toHaveLength(1)

        const ws = await connectWs(server.baseUrl, 'commander-alpha')
        const streamedEvents: Array<Record<string, unknown>> = []
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>
          if (parsed.type !== 'replay') {
            streamedEvents.push(parsed)
          }
        })

        processMocks[0].emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
        processMocks[0].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotate-old"}\n')
        processMocks[0].emitStdout('{"type":"result","result":"turn-1 done"}\n')

        await vi.waitFor(() => {
          expect(processMocks).toHaveLength(2)
        })

        await vi.waitFor(() => {
          expect(streamedEvents.some((event) => (
            event.type === 'system' && event.subtype === 'session_rotated'
          ))).toBe(true)
        })

        processMocks[1].emitStdout('{"type":"system","subtype":"init","session_id":"claude-rotate-new"}\n')

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string; claudeSessionId?: string; conversationEntryCount?: number }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'commander-alpha')
          expect(saved?.claudeSessionId).toBe('claude-rotate-new')
          expect(saved?.conversationEntryCount).toBe(0)
        })

        const oldTranscriptPath = join(
          workDir,
          'data',
          'commander',
          'alpha',
          'sessions',
          'claude-rotate-old.jsonl',
        )
        const newTranscriptPath = join(
          workDir,
          'data',
          'commander',
          'alpha',
          'sessions',
          'claude-rotate-new.jsonl',
        )

        await vi.waitFor(async () => {
          const raw = await readFile(oldTranscriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
          expect(events.some((event) => event.subtype === 'session_rotated')).toBe(true)
        })

        await vi.waitFor(async () => {
          const raw = await readFile(newTranscriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
          expect(events).toEqual([
            withClaudeSource({ type: 'system', subtype: 'init', session_id: 'claude-rotate-new' }),
          ])
        })

        expect(mockedSpawn.mock.calls.some(([command, args]) => (
          isLocalClaudeLoginShellSpawn(command, args)
          && args[1].replace(/'/g, '').includes('--resume claude-rotate-old')
        ))).toBe(false)

        ws.close()
      } finally {
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
        await new Promise((resolve) => setTimeout(resolve, 50))
        await rm(workDir, { recursive: true, force: true })
      }
    }, 15000)

  it('re-seeds commander Claude rotations from current workflow, memory, task, and max-turn inputs', async () => {
      const processMocks: Array<ReturnType<typeof createMockChildProcess>> = []
      mockedSpawn.mockImplementation(() => {
        const mock = createMockChildProcess()
        processMocks.push(mock)
        return mock.cp as never
      })

      const commanderId = '11111111-1111-4111-8111-111111111111'
      const sessionName = `commander-${commanderId}`
      const workDir = await mkdtemp(join(tmpdir(), 'hammurabi-commander-reseed-rotate-'))
      const commanderDataDir = join(workDir, 'commander-data')
      const commanderSessionStorePath = join(commanderDataDir, 'sessions.json')
      const sessionStorePath = join(workDir, 'stream-sessions.json')
      const originalDataDir = process.env.HAMMURABI_DATA_DIR
      const originalCommanderDataDir = process.env.COMMANDER_DATA_DIR
      process.env.HAMMURABI_DATA_DIR = join(workDir, 'data')
      delete process.env.COMMANDER_DATA_DIR
      setTranscriptStoreRoot(join(workDir, 'data', 'agents', 'sessions'))
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir)
      const commanderStore = new CommanderSessionStore(commanderSessionStorePath)
      const rotatedSession: CommanderSession = {
        id: commanderId,
        host: 'worker-alpha',
        pid: null,
        state: 'running',
        created: '2026-04-25T12:00:00.000Z',
        agentType: 'claude',
        effort: 'max',
        cwd: workDir,
        maxTurns: 9,
        contextMode: 'fat',
        heartbeat: createDefaultHeartbeatState(),
        lastHeartbeat: null,
        heartbeatTickCount: 0,
        taskSource: {
          owner: 'NickGuAI',
          repo: 'example-repo',
          label: 'bug',
        },
        currentTask: {
          issueNumber: 77,
          issueUrl: 'https://github.com/example-org/example-repo/issues/77',
          startedAt: '2026-04-25T12:00:00.000Z',
        },
        completedTasks: 0,
        totalCostUsd: 0,
      }
      await commanderStore.create(rotatedSession)
      let server: RunningServer | null = null

      try {
        server = await startServer({
          autoRotateEntryThreshold: 1,
          commanderSessionStorePath,
          sessionStorePath,
        })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: sessionName,
            mode: 'default',
            transportType: 'stream',
            sessionType: 'commander',
            creator: { kind: 'commander', id: commanderId },
            systemPrompt: 'stale commander prompt',
            maxTurns: 1,
            cwd: workDir,
          }),
        })
        expect(createResponse.status).toBe(201)
        expect(processMocks).toHaveLength(1)

        await mkdir(join(commanderDataDir, commanderId, '.memory', 'backlog'), { recursive: true })

        await writeFile(
          join(workDir, 'COMMANDER.md'),
          [
            '---',
            'contextMode: fat',
            '---',
            '',
            'You are the rotated commander prompt.',
          ].join('\n'),
          'utf8',
        )
        await writeFile(
          join(commanderDataDir, commanderId, '.memory', 'MEMORY.md'),
          '# Commander Memory\n\n- Fresh durable fact from reseed path.\n',
          'utf8',
        )
        await writeFile(
          join(commanderDataDir, commanderId, '.memory', 'LONG_TERM_MEM.md'),
          '# Commander Long-Term Memory\n\n- Narrative note.\n',
          'utf8',
        )
        await writeFile(
          join(commanderDataDir, commanderId, '.memory', 'backlog', 'thin-index.md'),
          '- #77 Fix auth bug\n',
          'utf8',
        )

        processMocks[0].emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
        processMocks[0].emitStdout('{"type":"system","subtype":"init","session_id":"claude-reseed-old"}\n')
        processMocks[0].emitStdout('{"type":"result","result":"turn-1 done"}\n')

        await vi.waitFor(() => {
          expect(processMocks).toHaveLength(2)
        })

        const [, secondArgs] = mockedSpawn.mock.calls[1] ?? []
        const rotatedScript = String((secondArgs as string[] | undefined)?.[1] ?? '').replace(/'/g, '')

        expect(rotatedScript).toContain('You are the rotated commander prompt.')
        expect(rotatedScript).toContain('Fresh durable fact from reseed path.')
        expect(rotatedScript).toContain('Issue #77')
        expect(rotatedScript).toContain('--max-turns 9')
        expect(rotatedScript).not.toContain('stale commander prompt')
        expect(rotatedScript).not.toContain('--max-turns 1')
      } finally {
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
        await new Promise((resolve) => setTimeout(resolve, 50))
        await rm(workDir, { recursive: true, force: true })
      }
    }, 15000)

  it('writes Claude stream events to the shared transcript store without dropping persisted replay events', async () => {
      const mock = installMockProcess()
      const transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-stream-transcript-'))
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      setTranscriptStoreRoot(transcriptRoot)

      let server: RunningServer | null = null

      try {
        server = await startServer({ sessionStorePath })

        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-transcript-01',
            mode: 'default',
            sessionType: 'stream',
            cwd: '/home/builder/projects/transcript-demo',
          }),
        })
        expect(createResponse.status).toBe(201)

        const initEvent = {
          type: 'system',
          subtype: 'init',
          session_id: 'claude-stream-123',
          source: CLAUDE_SOURCE,
        }
        const messageStartEvent = { type: 'message_start', source: CLAUDE_SOURCE }
        const resultEvent = {
          type: 'result',
          subtype: 'success',
          result: 'done',
          source: CLAUDE_SOURCE,
        }

        mock.emitStdout(`${JSON.stringify(initEvent)}\n`)
        mock.emitStdout(`${JSON.stringify(messageStartEvent)}\n`)
        mock.emitStdout(`${JSON.stringify(resultEvent)}\n`)

        const transcriptPath = join(transcriptRoot, 'stream-transcript-01', 'transcript.v1.jsonl')
        const metaPath = join(transcriptRoot, 'stream-transcript-01', 'meta.json')

        await vi.waitFor(async () => {
          const raw = await readFile(transcriptPath, 'utf8')
          const events = raw
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)

          expect(events).toEqual([
            withClaudeSource(initEvent),
            withClaudeSource(messageStartEvent),
            withClaudeSource(resultEvent),
          ])

          const meta = JSON.parse(await readFile(metaPath, 'utf8')) as {
            agentType?: string
            cwd?: string
            claudeSessionId?: string
          }
          expect(meta).toEqual(expect.objectContaining({
            agentType: 'claude',
            cwd: '/home/builder/projects/transcript-demo',
            claudeSessionId: 'claude-stream-123',
          }))

          const persisted = JSON.parse(await readFile(sessionStorePath, 'utf8')) as {
            sessions: Array<{ name: string; events?: unknown[] }>
          }
          expect(persisted.sessions.find((session) => session.name === 'stream-transcript-01')?.events).toEqual([
            withClaudeSource(initEvent),
            withClaudeSource(messageStartEvent),
            withClaudeSource(resultEvent),
          ])
        })
      } finally {
        if (server) {
          await server.close()
        }
        await rm(transcriptRoot, { recursive: true, force: true })
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('reports command-room stream sessions as completed after result without waiting for exit', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'command-room-task-01',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'cron',
          creator: { kind: 'cron', id: 'cron-task-1' },
          task: '/daily-review',
        }),
      })
      expect(createResponse.status).toBe(201)

      mock.emitStdout('{"type":"result","subtype":"success","result":"Daily review complete.","total_cost_usd":0.12}\n')

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/command-room-task-01`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result).toMatchObject({
          status: 'success',
          finalComment: 'Daily review complete.',
          costUsd: 0.12,
        })
      })

      const listResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      expect(listResponse.status).toBe(200)
      const listed = await listResponse.json() as Array<{ name: string }>
      expect(listed.some((session) => session.name === 'command-room-task-01')).toBe(false)

      expect(mock.cp.kill).not.toHaveBeenCalled()

      await server.close()
    })

  it('reports command-room stream sessions as completed on exit without result (cron fix)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'command-room-task-exit-no-result',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'cron',
          creator: { kind: 'cron', id: 'cron-task-1' },
          task: 'test',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Exit without emitting result — e.g. AskUserQuestion block, crash, or Codex format.
      mock.emitExit(0)

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/command-room-task-exit-no-result`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = (await response.json()) as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result?.finalComment).toContain('Process exited with code 0')
      })

      await server.close()
    })

  // Issue #1217: sentinel-creator stream sessions must follow the same
  // synthetic-completion contract as cron sessions. A sentinel that exits
  // fast on a 429 (or any path where `result` arrives but exit fires before
  // the sentinel executor's GET poll) must report `completed: true` so the
  // executor's monitorSession() loop resolves on the next poll instead of
  // running the misleading "did not complete after 30 status checks"
  // fallback. See PR #462 for the original cron-only fix.
  it('reports sentinel stream sessions as completed when result + exit arrive (issue #1217)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'sentinel-rate-limited',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: 'sentinel-context-hygiene' },
          task: 'Run sentinel sweep',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Real-world repro shape from issue #1217: 429 result followed by exit.
      mock.emitStdout('{"type":"result","subtype":"failed","is_error":true,"api_error_status":429,"result":"rate_limit (429)"}\n')
      mock.emitExit(0)

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/sentinel-rate-limited`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('failed')
        expect(payload.result?.finalComment).toBe('rate_limit (429)')
      })

      await server.close()
    })

  it('reports sentinel stream sessions as completed on exit without result (issue #1217)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'sentinel-fast-exit',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: 'sentinel-fast-exit' },
          task: 'Run sentinel sweep',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Exit BEFORE any result emerges — same race the cron fix covers.
      mock.emitExit(0)

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/sentinel-fast-exit`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result?.finalComment).toContain('Process exited with code 0')
      })

      await server.close()
    })

  it('flushes a result line missing trailing newline before exit (issue #1217 fix #4)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'sentinel-buffered-result',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: 'sentinel-buffered-result' },
          task: 'Run sentinel sweep',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Result arrives WITHOUT trailing '\n'. Without the stdout 'end'
      // listener, this would stay in stdoutBuffer and never be parsed.
      mock.emitStdout('{"type":"result","subtype":"success","result":"All good","total_cost_usd":0.05}')
      mock.cp.stdout.emit('end')
      mock.emitExit(0)

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/sentinel-buffered-result`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result).toMatchObject({
          status: 'success',
          finalComment: 'All good',
          costUsd: 0.05,
        })
      })

      await server.close()
    })

  it('preserves sentinel completion when message_start arrives after result (issue #1217 fix #1)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'sentinel-trailing-message-start',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: 'sentinel-trailing-message-start' },
          task: 'Run sentinel sweep',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Newer Claude CLI envelope formats can emit a trailing message_start
      // after the result. Without the guard, this would wipe finalResultEvent
      // and the executor would see completed: false on its next poll.
      mock.emitStdout('{"type":"result","subtype":"success","result":"sentinel completed"}\n')
      mock.emitStdout('{"type":"message_start","message":{"id":"trailing","role":"assistant"}}\n')

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/sentinel-trailing-message-start`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { finalComment: string }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result?.finalComment).toBe('sentinel completed')
      })

      await server.close()
    })

  // Issue #1217 P1 (codex review on PR #1244): the trailing-buffer drain
  // alone is not enough — a one-shot run can still lose its real `result`
  // event when Node fires `'exit'` before stdout has flushed. Without the
  // defer-completion fix, the synchronous 'exit' handler stores a synthetic
  // completion BEFORE the (later) stdout drain has a chance to parse the
  // real `result`, leaving polling clients with the fallback text/status.
  // This test pins the fix: we deliberately fire 'exit' BEFORE stdout 'end'
  // and assert that the real result still wins in completedSessions.
  it('defers completion until stdout drains when exit fires first (issue #1217 P1)', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'sentinel-exit-before-end',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'sentinel',
          creator: { kind: 'sentinel', id: 'sentinel-exit-before-end' },
          task: 'Run sentinel sweep',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Result line WITHOUT trailing '\n' sits in stdoutBuffer.
      mock.emitStdout('{"type":"result","subtype":"success","result":"REAL completion","total_cost_usd":0.07}')
      // Process exits BEFORE stdout drains. In the buggy version this is
      // where synthetic completion gets committed.
      mock.emitExit(0)
      // Stdout 'end' fires after the exit handler has already returned.
      // With the fix, the 'close' backstop (auto-emitted alongside 'exit'
      // by the mock) drains the buffer before completion is finalized,
      // so this 'end' is a no-op; without the fix, the real result is
      // parsed too late and never reaches completedSessions.
      mock.cp.stdout.emit('end')

      await vi.waitFor(async () => {
        const response = await fetch(`${server.baseUrl}/api/agents/sessions/sentinel-exit-before-end`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const payload = await response.json() as {
          completed: boolean
          status: string
          result?: { status: string; finalComment: string; costUsd: number }
        }
        expect(payload.completed).toBe(true)
        expect(payload.status).toBe('success')
        expect(payload.result).toMatchObject({
          status: 'success',
          finalComment: 'REAL completion',
          costUsd: 0.07,
        })
      })

      await server.close()
    })

  it('never persists command-room sessions for auto-resume', async () => {
      const mock = installMockProcess()
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const server = await startServer({ sessionStorePath })

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'command-room-task-02',
            mode: 'default',
            transportType: 'stream',
            sessionType: 'cron',
            creator: { kind: 'cron', id: 'cron-task-2' },
          }),
        })
        expect(createResponse.status).toBe(201)

        mock.emitStdout('{"type":"system","subtype":"init","session_id":"claude-command-room-123"}\n')

        mock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'command-room-task-02')
          expect(saved).toBeUndefined()
        })
      } finally {
        await server.close()
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('creates a new Claude stream session from a previous resumable session', async () => {
      const firstMock = createMockChildProcess()
      const secondMock = createMockChildProcess()
      mockedSpawn
        .mockImplementationOnce(() => firstMock.cp as never)
        .mockImplementationOnce(() => secondMock.cp as never)

      const server = await startServer()

      try {
        const createSourceResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'claude-source',
            mode: 'default',
            sessionType: 'stream',
            agentType: 'claude',
          }),
        })
        expect(createSourceResponse.status).toBe(201)

        firstMock.emitStdout('{"type":"system","subtype":"init","session_id":"claude-source-session-id"}\n')
        firstMock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')
        firstMock.emitExit(0)

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            processAlive?: boolean
            resumeAvailable?: boolean
          }>
          const source = listedSessions.find((session) => session.name === 'claude-source')
          expect(source?.processAlive).toBe(false)
          expect(source?.resumeAvailable).toBe(true)
        })

        const createResumedResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'claude-resumed-custom',
          mode: 'default',
          sessionType: 'stream',
          resumeFromSession: 'claude-source',
          task: 'Continue from the previous context',
          }),
        })
        expect(createResumedResponse.status).toBe(201)

        const resumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-source-session-id')
        })
        expect(resumeCall).toBeDefined()
        expect(secondMock.getStdinWrites()).toContain(
          `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue from the previous context' } })}\n`,
        )

        const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(sessionsResponse.status).toBe(200)
        const listedSessions = await sessionsResponse.json() as Array<{
          name: string
          processAlive?: boolean
          resumedFrom?: string
        }>
        const resumed = listedSessions.find((session) => session.name === 'claude-resumed-custom')
        expect(resumed?.processAlive).toBe(true)
        expect(resumed?.resumedFrom).toBe('claude-source')
      } finally {
        await server.close()
      }
    })

  it('keeps manually deleted Claude stream sessions available in the resume picker', async () => {
      const firstMock = createMockChildProcess()
      const secondMock = createMockChildProcess()
      mockedSpawn
        .mockImplementationOnce(() => firstMock.cp as never)
        .mockImplementationOnce(() => secondMock.cp as never)

      const server = await startServer()

      try {
        const createSourceResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'claude-killed-source',
            mode: 'default',
            sessionType: 'stream',
            agentType: 'claude',
          }),
        })
        expect(createSourceResponse.status).toBe(201)

        firstMock.emitStdout('{"type":"system","subtype":"init","session_id":"claude-killed-source-session-id"}\n')
        firstMock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')

        const deleteResponse = await fetch(`${server.baseUrl}/api/agents/sessions/claude-killed-source`, {
          method: 'DELETE',
          headers: AUTH_HEADERS,
        })
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toEqual({ killed: true })

        await vi.waitFor(async () => {
          const sessionsResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(sessionsResponse.status).toBe(200)
          const listedSessions = await sessionsResponse.json() as Array<{
            name: string
            processAlive?: boolean
            status?: string
            resumeAvailable?: boolean
          }>
          const source = listedSessions.find((session) => session.name === 'claude-killed-source')
          expect(source).toEqual(expect.objectContaining({
            name: 'claude-killed-source',
            processAlive: false,
            status: 'exited',
            resumeAvailable: true,
          }))
        })

        const createResumedResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'claude-killed-resumed',
          mode: 'default',
          sessionType: 'stream',
          resumeFromSession: 'claude-killed-source',
          task: 'Continue after manual stop',
          }),
        })
        expect(createResumedResponse.status).toBe(201)

        const resumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-killed-source-session-id')
        })
        expect(resumeCall).toBeDefined()
        expect(secondMock.getStdinWrites()).toContain(
          `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Continue after manual stop' } })}\n`,
        )
      } finally {
        await server.close()
      }
    })

  it('auto-resumes persisted claude stream sessions on server restart', async () => {
      const firstMock = installMockProcess()
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      let firstServer: RunningServer | null = null
      let secondServer: RunningServer | null = null

      try {
        firstServer = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        const createResponse = await fetch(`${firstServer.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-resume-01',
            mode: 'default',
            sessionType: 'stream',
          }),
        })
        expect(createResponse.status).toBe(201)

        firstMock.emitStdout(
          '{"type":"system","subtype":"init","session_id":"claude-resume-123"}\n',
        )

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string; claudeSessionId?: string }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'stream-resume-01')
          expect(saved?.claudeSessionId).toBe('claude-resume-123')
        })

        await firstServer.close()
        firstServer = null

        mockedSpawn.mockClear()
        installMockProcess()

        secondServer = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        await vi.waitFor(async () => {
          const response = await fetch(`${secondServer.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(response.status).toBe(200)
          const sessions = await response.json() as Array<{ name: string }>
          expect(sessions.some((session) => session.name === 'stream-resume-01')).toBe(true)
        })

        const resumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-resume-123')
        })
        expect(resumeCall).toBeDefined()
      } finally {
        if (secondServer) {
          await secondServer.close()
        }
        if (firstServer) {
          await firstServer.close()
        }
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('restores startup replay from transcript tail before persisted fallback events', async () => {
      installMockProcess()
      const transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-transcript-restore-'))
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const sessionName = 'stream-transcript-tail-restore'
      const createdAt = '2026-04-08T00:00:00.000Z'
      const expectedReplayEvents: Array<Record<string, unknown>> = []
      let server: RunningServer | null = null

      setTranscriptStoreRoot(transcriptRoot)

      try {
        await writeFile(
          sessionStorePath,
          JSON.stringify({
            sessions: [
              {
                name: sessionName,
                agentType: 'claude',
                mode: 'default',
                cwd: '/home/builder/projects/transcript-restore',
                createdAt,
                claudeSessionId: 'claude-stale-from-store',
                events: [{ type: 'system', marker: 'persisted-fallback-only' }],
              },
            ],
          }),
          'utf8',
        )

        await writeSessionMeta(sessionName, {
          agentType: 'claude',
          cwd: '/home/builder/projects/transcript-restore',
          createdAt,
          claudeSessionId: 'claude-transcript-123',
        })

        for (let turn = 1; turn <= 22; turn += 1) {
          const turnId = String(turn).padStart(2, '0')
          const userEvent = { type: 'user', marker: `turn-${turnId}-user` }
          const resultEvent = turn === 22
            ? {
                type: 'result',
                marker: `turn-${turnId}-result`,
                usage: { input_tokens: 222, output_tokens: 111 },
                total_cost_usd: 0.12,
              }
            : { type: 'result', marker: `turn-${turnId}-result` }
          await appendTranscriptEvent(sessionName, userEvent)
          await appendTranscriptEvent(sessionName, resultEvent)
          if (turn > 2) {
            expectedReplayEvents.push(userEvent, resultEvent)
          }
        }

        const partialAssistant = { type: 'assistant', marker: 'partial-assistant' }
        const partialAsk = {
          type: 'tool_use',
          id: 'ask-1',
          name: 'AskUserQuestion',
          marker: 'partial-ask',
        }
        await appendTranscriptEvent(sessionName, partialAssistant)
        await appendTranscriptEvent(sessionName, partialAsk)
        expectedReplayEvents.push(partialAssistant, partialAsk)

        server = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        await vi.waitFor(async () => {
          const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(response.status).toBe(200)
          const sessions = await response.json() as Array<{ name: string }>
          expect(sessions.some((session) => session.name === sessionName)).toBe(true)
        })

        const { ws, replay } = await connectWsWithReplay(server.baseUrl, sessionName)
        expect(replay.events).toEqual(expectedReplayEvents)
        expect(replay.events).not.toContainEqual({ type: 'system', marker: 'persisted-fallback-only' })
        expect(replay.usage).toEqual({
          inputTokens: 222,
          outputTokens: 111,
          costUsd: 0.12,
        })

        const transcriptResumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-transcript-123')
        })
        expect(transcriptResumeCall).toBeDefined()
        expect(mockedSpawn.mock.calls.some(([command, args]) => {
          return isLocalClaudeLoginShellSpawn(command, args) &&
            args[1].replace(/'/g, '').includes('--resume claude-stale-from-store')
        })).toBe(false)

        ws.close()
      } finally {
        if (server) {
          await server.close()
        }
        await rm(transcriptRoot, { recursive: true, force: true })
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('falls back to persisted replay events on startup when transcript tail is unavailable', async () => {
      installMockProcess()
      const transcriptRoot = await mkdtemp(join(tmpdir(), 'hammurabi-transcript-fallback-'))
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      const sessionName = 'stream-persisted-fallback-restore'
      const persistedEvents: Array<Record<string, unknown>> = [
        {
          type: 'message_delta',
          delta: { type: 'text_delta', text: 'persisted-only' },
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          type: 'result',
          marker: 'persisted-result',
          usage: { input_tokens: 120, output_tokens: 60 },
          total_cost_usd: 0.09,
        },
      ]
      let server: RunningServer | null = null

      setTranscriptStoreRoot(transcriptRoot)

      try {
        await writeFile(
          sessionStorePath,
          JSON.stringify({
            sessions: [
              {
                name: sessionName,
                agentType: 'claude',
                mode: 'default',
                cwd: '/home/builder/projects/persisted-fallback',
                createdAt: '2026-04-08T00:00:00.000Z',
                claudeSessionId: 'claude-fallback-123',
                events: persistedEvents,
              },
            ],
          }),
          'utf8',
        )

        server = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        await vi.waitFor(async () => {
          const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
            headers: AUTH_HEADERS,
          })
          expect(response.status).toBe(200)
          const sessions = await response.json() as Array<{ name: string }>
          expect(sessions.some((session) => session.name === sessionName)).toBe(true)
        })

        const { ws, replay } = await connectWsWithReplay(server.baseUrl, sessionName)
        expect(replay.events).toEqual(persistedEvents)
        expect(replay.usage).toEqual({
          inputTokens: 120,
          outputTokens: 60,
          costUsd: 0.09,
        })

        const fallbackResumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-fallback-123')
        })
        expect(fallbackResumeCall).toBeDefined()

        ws.close()
      } finally {
        if (server) {
          await server.close()
        }
        await rm(transcriptRoot, { recursive: true, force: true })
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('does not auto-resume interrupted claude stream sessions on server restart', async () => {
      const firstMock = installMockProcess()
      const sessionStoreDir = await mkdtemp(join(tmpdir(), 'hammurabi-stream-session-store-'))
      const sessionStorePath = join(sessionStoreDir, 'stream-sessions.json')
      let firstServer: RunningServer | null = null
      let secondServer: RunningServer | null = null

      try {
        firstServer = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        const createResponse = await fetch(`${firstServer.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-interrupted-01',
            mode: 'default',
            sessionType: 'stream',
          }),
        })
        expect(createResponse.status).toBe(201)

        firstMock.emitStdout(
          '{"type":"system","subtype":"init","session_id":"claude-interrupted-123"}\n',
        )

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string; claudeSessionId?: string }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'stream-interrupted-01')
          expect(saved?.claudeSessionId).toBe('claude-interrupted-123')
        })

        // Simulate a server restart while Claude is still mid-assistant turn.
        firstMock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')

        await vi.waitFor(async () => {
          const raw = await readFile(sessionStorePath, 'utf8')
          const parsed = JSON.parse(raw) as {
            sessions: Array<{ name: string; claudeSessionId?: string }>
          }
          const saved = parsed.sessions.find((session) => session.name === 'stream-interrupted-01')
          expect(saved).toBeUndefined()
        })

        await firstServer.close()
        firstServer = null

        mockedSpawn.mockClear()
        installMockProcess()

        secondServer = await startServer({
          autoResumeSessions: true,
          sessionStorePath,
        })

        const resumeCall = findLocalClaudeLoginShellSpawn((script) => {
          return script.includes('--effort max') &&
            script.includes('--resume claude-interrupted-123')
        })
        expect(resumeCall).toBeUndefined()

        const response = await fetch(`${secondServer.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        expect(response.status).toBe(200)
        const sessions = await response.json() as Array<{ name: string }>
        expect(sessions.some((session) => session.name === 'stream-interrupted-01')).toBe(false)
      } finally {
        if (secondServer) {
          await secondServer.close()
        }
        if (firstServer) {
          await firstServer.close()
        }
        await rm(sessionStoreDir, { recursive: true, force: true })
      }
    })

  it('creates a remote stream session over SSH when host is provided', async () => {
      installMockProcess()
      const registry = await createTempMachinesRegistry({
        machines: [
          { id: 'local', label: 'Local', host: null },
          {
            id: 'gpu-1',
            label: 'GPU',
            host: '10.0.1.50',
            user: 'builder',
            port: 22,
            cwd: '/home/builder/workspace',
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
            name: 'stream-remote-01',
            mode: 'default',
            sessionType: 'stream',
            host: 'gpu-1',
          }),
        })

        expect(response.status).toBe(201)
        expect(await response.json()).toEqual({
          sessionName: 'stream-remote-01',
          mode: 'default',
          sessionType: 'worker',
          creator: { kind: 'human', id: 'api-key' },
          transportType: 'stream',
          agentType: 'claude',
          host: 'gpu-1',
          created: true,
        })

        expect(mockedSpawn).toHaveBeenCalledWith(
          'ssh',
          expect.arrayContaining(['-p', '22', 'builder@10.0.1.50']),
          expect.objectContaining({
            env: expect.objectContaining({
              CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '0',
              CLAUDECODE: undefined,
              ANTHROPIC_MODEL: undefined,
              ANTHROPIC_DEFAULT_OPUS_MODEL: undefined,
              ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
            }),
            stdio: ['pipe', 'pipe', 'pipe'],
          }),
        )
        const sshArgs = mockedSpawn.mock.calls[0][1]
        const remoteCommand = sshArgs[sshArgs.length - 1]
        expect(remoteCommand).toContain('cd ')
        expect(remoteCommand).toContain('/home/builder/workspace')
        expect(remoteCommand).toContain('exec "${SHELL:-/bin/bash}" -lc')
        expect(remoteCommand).toContain('. "$HOME/.bashrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
        expect(remoteCommand).toContain('/Users/builder/.hammurabi-env')
        expect(remoteCommand).toContain('export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0')
        expect(remoteCommand).toContain(UNSET_CLAUDE_CHILD_ENV)
        expect(remoteCommand).toContain('claude')
        expect(remoteCommand).toContain('--effort')
        expect(remoteCommand).toContain('max')
        expect(remoteCommand).toContain('--settings')
        expect(remoteCommand).toContain('node -e ')
        expect(remoteCommand.indexOf('/Users/builder/.hammurabi-env')).toBeLessThan(
          remoteCommand.indexOf('/home/builder/workspace'),
        )
      } finally {
        await server.close()
        await registry.cleanup()
      }
    })

  it('pre-kill-debrief returns immediately for stream sessions so kill can proceed', async () => {
      installMockProcess()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-kill-debrief',
            mode: 'default',
            sessionType: 'stream',
          }),
        })
        expect(createResponse.status).toBe(201)

        const preResp = await fetch(`${server.baseUrl}/api/agents/sessions/stream-kill-debrief/pre-kill-debrief`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        expect(preResp.status).toBe(200)
        expect(await preResp.json()).toEqual({
          debriefStarted: false,
          reason: 'not-supported-yet',
        })

        const statusResp = await fetch(`${server.baseUrl}/api/agents/sessions/stream-kill-debrief/debrief-status`, {
          headers: AUTH_HEADERS,
        })
        expect(statusResp.status).toBe(200)
        expect(await statusResp.json()).toEqual({ status: 'none' })
      } finally {
        await server.close()
      }
    })

  it('stream session appears in session list with sessionType=stream', async () => {
      installMockProcess()
      const server = await startServer()

      const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-list-01',
          mode: 'default',
          sessionType: 'stream',
        }),
      })
      expect(createResponse.status).toBe(201)

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      const sessions = (await response.json()) as Array<{ name: string; sessionType?: string; transportType?: string; pid: number }>

      expect(sessions).toHaveLength(1)
      expect(sessions[0].name).toBe('stream-list-01')
      expect(sessions[0].sessionType).toBe('worker')
      expect(sessions[0].transportType).toBe('stream')
      expect(sessions[0].pid).toBe(99999)

      await server.close()
    })

  it('routes default-mode Claude sessions through the unified gate for non-allowlisted gmail sends', async () => {
      installMockProcess()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-dangerous-approval',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

        expect(createResponse.status).toBe(201)

        const checkPromise = fetch(`${server.baseUrl}/api/approval/check`, {
          method: 'POST',
          headers: {
            ...INTERNAL_AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            hammurabi_session_name: 'stream-dangerous-approval',
            tool_name: 'Bash',
            tool_input: {
              command: 'gog gmail send --to matt.feroz@example.com --subject "Need approval"',
            },
          }),
        })

        let pendingApprovalId = ''
        await vi.waitFor(async () => {
          const approvals = await server.approvalCoordinator.listPending()
          expect(approvals).toHaveLength(1)
          pendingApprovalId = approvals[0].id
          expect(approvals[0]).toEqual(expect.objectContaining({
            actionId: 'send-email',
            sessionId: 'stream-dangerous-approval',
            source: 'claude',
          }))
        })

        await server.approvalCoordinator.resolve(pendingApprovalId, 'approve')

        const approvalResponse = await checkPromise
        expect(approvalResponse.status).toBe(200)
        expect(await approvalResponse.json()).toEqual({
          decision: 'allow',
        })
      } finally {
        await server.close()
      }
    })

  it('disables adaptive thinking for stream sessions when requested', async () => {
      installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-adaptive-disabled',
          mode: 'default',
          sessionType: 'stream',
          adaptiveThinking: 'disabled',
        }),
      })

      expectDefaultClaudeSpawn('max', '1')

      await server.close()
    })

  it('parses NDJSON from stdout and broadcasts to WebSocket clients', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-ndjson',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-ndjson')
      const received: unknown[] = []

      const messagePromise = new Promise<void>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString())
          // Skip replay messages
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
          if (received.length >= 2) {
            resolve()
          }
        })
      })

      // Emit two NDJSON events as a single stdout chunk with newlines
      mock.emitStdout(
        '{"type":"message_start","message":{"id":"msg1","role":"assistant"}}\n' +
        '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n',
      )

      await messagePromise
      expect(received).toHaveLength(2)
      expect((received[0] as { type: string }).type).toBe('message_start')
      expect((received[1] as { type: string }).type).toBe('content_block_start')

      ws.close()
      await server.close()
    })

  it('handles partial NDJSON lines split across stdout chunks', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-partial',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-partial')
      const received: unknown[] = []

      const messagePromise = new Promise<void>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString())
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
          if (received.length >= 1) {
            resolve()
          }
        })
      })

      // Split a single JSON line across two stdout chunks
      mock.emitStdout('{"type":"message_sta')
      mock.emitStdout('rt","message":{"id":"m1","role":"assistant"}}\n')

      await messagePromise
      expect(received).toHaveLength(1)
      expect((received[0] as { type: string }).type).toBe('message_start')

      ws.close()
      await server.close()
    })

  it('sends buffered events as replay on WebSocket connect', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-replay',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Emit events BEFORE WebSocket connects
      mock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      mock.emitStdout('{"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n')

      // Small delay to ensure events are buffered
      await new Promise((r) => setTimeout(r, 50))

      // Register message handler BEFORE open to catch the replay sent on upgrade
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-replay/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; events?: unknown[] }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      // Wait for the replay message to arrive
      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      expect(replay!.events).toHaveLength(2)
      expect((replay!.events![0] as { type: string }).type).toBe('message_start')
      expect((replay!.events![1] as { type: string }).type).toBe('content_block_start')

      ws.close()
      await server.close()
    })

  it('normalizes Claude plan-mode events before replay while keeping AskUserQuestion intact', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-plan-mode',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      mock.emitStdout('{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"tool_use","id":"plan-enter","name":"EnterPlanMode"}]}}\n')
      mock.emitStdout('{"type":"assistant","message":{"id":"m2","role":"assistant","content":[{"type":"tool_use","id":"plan-exit","name":"ExitPlanMode","input":{"plan":"1. Inspect stream handling\\n2. Patch replay"}}]}}\n')
      mock.emitStdout('{"type":"assistant","message":{"id":"m3","role":"assistant","content":[{"type":"tool_use","id":"ask-1","name":"AskUserQuestion","input":{"questions":[{"question":"Proceed?","header":"Confirm","multiSelect":false,"options":[{"label":"Yes","description":"Continue"}]}]}}]}}\n')
      mock.emitStdout('{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"plan-exit","content":"{\\"approved\\":true,\\"message\\":\\"Proceeding with the approved plan.\\"}"}]}}\n')

      await new Promise((resolve) => setTimeout(resolve, 50))

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-plan-mode/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; events?: unknown[] }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((message) => message.type === 'replay')
      expect(replay).toBeDefined()

      const replayEvents = replay!.events as Array<Record<string, unknown>>
      expect(replayEvents).toEqual([
        withClaudeSource({
          type: 'planning',
          action: 'enter',
        }),
        withClaudeSource({
          type: 'planning',
          action: 'proposed',
          plan: '1. Inspect stream handling\n2. Patch replay',
        }),
        withClaudeSource({
          type: 'assistant',
          message: {
            id: 'm3',
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'ask-1',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    {
                      question: 'Proceed?',
                      header: 'Confirm',
                      multiSelect: false,
                      options: [{ label: 'Yes', description: 'Continue' }],
                    },
                  ],
                },
              },
            ],
          },
        }),
        withClaudeSource({
          type: 'planning',
          action: 'decision',
          approved: true,
          message: 'Proceeding with the approved plan.',
        }),
      ])

      ws.close()
      await server.close()
    })

  it('replays buffered stream events and usage after client reconnect', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-replay-reconnect',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // First client attaches, then disconnects.
      const firstWs = await connectWs(server.baseUrl, 'stream-replay-reconnect')
      firstWs.close()
      await new Promise<void>((resolve) => firstWs.on('close', () => resolve()))

      // Events that happen across disconnect windows must be replayed together.
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":20,"output_tokens":10}}\n')
      mock.emitStdout('{"type":"result","result":"done","total_cost_usd":0.02,"usage":{"input_tokens":35,"output_tokens":15}}\n')
      await new Promise((r) => setTimeout(r, 50))

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-replay-reconnect/terminal?api_key=test-key'
      const secondWs = new WebSocket(wsUrl)
      const messages: Array<{
        type: string
        events?: Array<{ type: string }>
        usage?: { inputTokens: number; outputTokens: number; costUsd: number }
      }> = []

      secondWs.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        secondWs.on('open', () => resolve())
        secondWs.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((message) => message.type === 'replay')
      expect(replay).toBeDefined()
      expect(replay!.events?.map((event) => event.type)).toEqual(['message_delta', 'result'])
      expect(replay!.usage).toEqual({
        inputTokens: 35,
        outputTokens: 15,
        costUsd: 0.02,
      })

      secondWs.close()
      await server.close()
    })

  it('forwards user input from WebSocket to process stdin', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-input',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-input')

      // Send user input through WebSocket
      ws.send(JSON.stringify({ type: 'input', text: 'What files handle auth?' }))

      await vi.waitFor(() => {
        // First write is the initial task (empty string task still won't write),
        // the user input should appear as a stdin write
        const writes = mock.getStdinWrites()
        const userWrites = writes.filter((w) => w.includes('What files handle auth?'))
        expect(userWrites.length).toBeGreaterThan(0)
      })

      const userWrite = mock.getStdinWrites().find((w) => w.includes('What files handle auth?'))!
      const parsed = JSON.parse(userWrite.replace('\n', ''))
      expect(parsed).toEqual({
        type: 'user',
        message: { role: 'user', content: 'What files handle auth?' },
      })

      ws.close()
      await server.close()
    })

  it('clears lastTurnCompleted immediately when WS input is received for completed session', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'completed-input-test',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Drive the session through a full turn so lastTurnCompleted is set.
      mock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      mock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')

      // Confirm session is 'completed' before sending new input.
      await vi.waitFor(async () => {
        const resp = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        const payload = await resp.json() as Array<{ id: string; status: string }>
        const entry = payload.find((e) => e.id === 'completed-input-test')
        expect(entry?.status).toBe('completed')
      })

      // Connect via WebSocket and send new input.
      const ws = await connectWs(server.baseUrl, 'completed-input-test')
      ws.send(JSON.stringify({ type: 'input', text: 'new task after completion' }))

      // World status should immediately flip back to non-completed after input.
      await vi.waitFor(async () => {
        const resp = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        const payload = await resp.json() as Array<{ id: string; status: string }>
        const entry = payload.find((e) => e.id === 'completed-input-test')
        expect(entry?.status).not.toBe('completed')
      })

      ws.close()
      await server.close()
    })

  it('does not clear lastTurnCompleted for command-room sessions on WS input', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...INTERNAL_AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'command-room-no-clear-test',
          mode: 'default',
          transportType: 'stream',
          sessionType: 'cron',
          creator: { kind: 'cron', id: 'cron-task-no-clear' },
        }),
      })

      // Drive to completed.
      mock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')
      mock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')

      await vi.waitFor(async () => {
        const resp = await fetch(`${server.baseUrl}/api/agents/world`, {
          headers: AUTH_HEADERS,
        })
        const payload = await resp.json() as Array<{ id: string; status: string }>
        const entry = payload.find((e) => e.id === 'command-room-no-clear-test')
        expect(entry?.status).toBe('completed')
      })

      // Send input — command-room sessions should stay completed.
      const ws = await connectWs(server.baseUrl, 'command-room-no-clear-test')
      ws.send(JSON.stringify({ type: 'input', text: 'more input' }))

      // Wait briefly to let the WS message be processed.
      await new Promise((r) => setTimeout(r, 100))

      const resp = await fetch(`${server.baseUrl}/api/agents/world`, {
        headers: AUTH_HEADERS,
      })
      const payload = await resp.json() as Array<{ id: string; status: string }>
      const entry = payload.find((e) => e.id === 'command-room-no-clear-test')
      expect(entry?.status).toBe('completed')

      ws.close()
      await server.close()
    })

  it('broadcasts exit event and cleans up on process exit', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-exit',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-exit')
      const exitPromise = new Promise<{ type: string; exitCode: number }>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; exitCode?: number }
          if (parsed.type === 'exit') {
            resolve(parsed as { type: string; exitCode: number })
          }
        })
      })

      mock.emitExit(0)

      const exitEvent = await exitPromise
      expect(exitEvent.type).toBe('exit')
      expect(exitEvent.exitCode).toBe(0)

      // Session should be removed from the list
      await vi.waitFor(async () => {
        const resp = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const sessions = await resp.json() as Array<{ name: string; processAlive?: boolean }>
        const exited = sessions.find((session) => session.name === 'stream-exit')
        expect(exited?.processAlive).toBe(false)
      })

      const infoResponse = await fetch(`${server.baseUrl}/api/agents/sessions/stream-exit`, {
        headers: AUTH_HEADERS,
      })
      expect(infoResponse.status).toBe(200)
      const infoPayload = await infoResponse.json() as {
        name: string
        status: string
        completed: boolean
        processAlive?: boolean
        sessionType?: string
      }
      expect(infoPayload.name).toBe('stream-exit')
      expect(infoPayload.status).toBe('exited')
      expect(infoPayload.completed).toBe(false)
      expect(infoPayload.processAlive).toBe(false)
      expect(infoPayload.sessionType).toBe('worker')

      await server.close()
    })

  it('includes stderr summary in exit event payload', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-exit-stderr',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-exit-stderr')
      const exitPromise = new Promise<{ type: string; exitCode: number; stderr?: string; text?: string }>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as {
            type: string
            exitCode?: number
            stderr?: string
            text?: string
          }
          if (parsed.type === 'exit') {
            resolve(parsed as { type: string; exitCode: number; stderr?: string; text?: string })
          }
        })
      })

      mock.cp.stderr.emit('data', Buffer.from('prep line\nclaude: command not found\n'))
      mock.emitExit(127)

      const exitEvent = await exitPromise
      expect(exitEvent.type).toBe('exit')
      expect(exitEvent.exitCode).toBe(127)
      expect(exitEvent.stderr).toBe('claude: command not found')
      expect(exitEvent.text).toContain('Process exited with code 127')
      expect(exitEvent.text).toContain('stderr: claude: command not found')

      ws.close()
      await server.close()
    })

  it('broadcasts system event on process error and cleans up session', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-error',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Register message handler before open to avoid missing events
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-error/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const received: Array<{ type: string; text?: string }> = []

      ws.on('message', (data) => {
        received.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      // Emit error after WS is connected
      mock.emitError(new Error('spawn ENOENT'))

      await vi.waitFor(() => {
        const systemMsg = received.find((m) => m.type === 'system')
        expect(systemMsg).toBeDefined()
      })

      const errorEvent = received.find((m) => m.type === 'system')!
      expect(errorEvent.text).toContain('spawn ENOENT')

      // Session should be cleaned up after process error (prevents zombie entries)
      await vi.waitFor(async () => {
        const resp = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          headers: AUTH_HEADERS,
        })
        const sessions = await resp.json() as Array<{ name: string; processAlive?: boolean }>
        const exited = sessions.find((session) => session.name === 'stream-error')
        expect(exited?.processAlive).toBe(false)
      })

      ws.close()
      await server.close()
    })

  it('relays stderr output as system events', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-stderr',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-stderr')
      const received: Array<{ type: string; text?: string }> = []

      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
        if (parsed.type !== 'replay') {
          received.push(parsed)
        }
      })

      // Emit stderr data from the child process
      mock.cp.stderr.emit('data', Buffer.from('Error: auth token expired'))

      await vi.waitFor(() => {
        const stderrMsg = received.find((m) => m.type === 'system' && m.text?.includes('stderr:'))
        expect(stderrMsg).toBeDefined()
      })

      const stderrEvent = received.find((m) => m.type === 'system' && m.text?.includes('stderr:'))!
      expect(stderrEvent.text).toContain('auth token expired')

      ws.close()
      await server.close()
    })

  it('kills stream session process on DELETE', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-kill',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const response = await fetch(`${server.baseUrl}/api/agents/sessions/stream-kill`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ killed: true })
      expect(mock.cp.kill).toHaveBeenCalledWith('SIGTERM')

      await server.close()
    })

  it('tracks usage from message_delta events', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-usage',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Emit a message_delta with usage info
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":100,"output_tokens":50}}\n')

      // Wait for processing
      await new Promise((r) => setTimeout(r, 50))

      // Register message handler before open to catch the replay
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-usage/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; events?: Array<{ type: string; usage?: unknown }> }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      // Wait for replay
      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      const usageEvent = replay!.events!.find((e) => e.type === 'message_delta')
      expect(usageEvent).toBeDefined()
      expect(usageEvent?.usage).toEqual({ input_tokens: 100, output_tokens: 50 })

      ws.close()
      await server.close()
    })

  it('skips unparseable NDJSON lines without crashing', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-badjson',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-badjson')
      const received: unknown[] = []

      const messagePromise = new Promise<void>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString())
          if (parsed.type !== 'replay') {
            received.push(parsed)
          }
          if (received.length >= 1) {
            resolve()
          }
        })
      })

      // Send a bad line followed by a good line
      mock.emitStdout('this is not json\n')
      mock.emitStdout('{"type":"message_start","message":{"id":"m1","role":"assistant"}}\n')

      await messagePromise
      // Only the valid line should come through
      expect(received).toHaveLength(1)
      expect((received[0] as { type: string }).type).toBe('message_start')

      ws.close()
      await server.close()
    })

  it('caps event buffer at MAX_STREAM_EVENTS', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-cap',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Emit more than 1000 events (the MAX_STREAM_EVENTS constant)
      const batch: string[] = []
      for (let i = 0; i < 1010; i++) {
        batch.push(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `chunk-${i}` } }))
      }
      // Send in chunks to avoid enormous single write
      mock.emitStdout(batch.slice(0, 500).join('\n') + '\n')
      mock.emitStdout(batch.slice(500).join('\n') + '\n')

      // Wait for processing
      await new Promise((r) => setTimeout(r, 100))

      // Connect and check replay
      const ws = await connectWs(server.baseUrl, 'stream-cap')
      const replayPromise = new Promise<{ events: unknown[] }>((resolve) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string; events?: unknown[] }
          if (parsed.type === 'replay') {
            resolve(parsed as { events: unknown[] })
          }
        })
      })

      const replay = await replayPromise
      // Should be capped at 1000
      expect(replay.events.length).toBeLessThanOrEqual(1000)
      // The last event should be the most recent (chunk-1009)
      const lastEvent = replay.events[replay.events.length - 1] as { delta: { text: string } }
      expect(lastEvent.delta.text).toBe('chunk-1009')

      ws.close()
      await server.close()
    })

  it('does not write to stdin when task is empty', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-no-task',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // No task was provided, so stdin should not have been written to
      expect(mock.getStdinWrites()).toHaveLength(0)

      await server.close()
    })

  it('ignores invalid WebSocket messages for stream sessions', async () => {
      installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-bad-ws',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-bad-ws')

      // Send various invalid messages - should not crash
      ws.send('not json')
      ws.send(JSON.stringify({ type: 'unknown' }))
      ws.send(JSON.stringify({ type: 'input' })) // missing text
      ws.send(JSON.stringify({ type: 'input', text: '' })) // empty text
      ws.send(JSON.stringify({ type: 'input', text: '   ' })) // whitespace-only

      // Give time for messages to be processed
      await new Promise((r) => setTimeout(r, 100))

      // WebSocket should still be open (not crashed)
      expect(ws.readyState).toBe(WebSocket.OPEN)

      ws.close()
      await server.close()
    })

  it('includes accumulated usage in replay message to prevent double-counting', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-replay-usage',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Emit message_delta with usage and a result with cost
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":100,"output_tokens":50}}\n')
      mock.emitStdout('{"type":"result","result":"done","cost_usd":0.05,"usage":{"input_tokens":200,"output_tokens":80}}\n')

      // Wait for processing
      await new Promise((r) => setTimeout(r, 50))

      // Connect and check the replay message includes usage totals
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-replay-usage/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; events?: unknown[]; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      // The replay must include pre-accumulated usage so the client can set
      // totals directly instead of re-processing individual events additively
      expect(replay!.usage).toBeDefined()
      // result event overrides totals: inputTokens=200, outputTokens=80
      // message_delta added 100+50, then result set absolute 200+80
      expect(replay!.usage!.inputTokens).toBe(200)
      expect(replay!.usage!.outputTokens).toBe(80)
      expect(replay!.usage!.costUsd).toBe(0.05)

      ws.close()
      await server.close()
    })

  it('accumulates usage across multiple message_delta events from different turns', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-multi-usage',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Simulate two turns, each with their own message_delta usage.
      // Turn 1: input_tokens=100, output_tokens=50
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":100,"output_tokens":50}}\n')
      // Turn 2: input_tokens=120, output_tokens=60
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":120,"output_tokens":60}}\n')

      // Wait for processing
      await new Promise((r) => setTimeout(r, 50))

      // Connect and check accumulated usage in replay
      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-multi-usage/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      // Usage should be accumulated: 100+120=220 input, 50+60=110 output
      expect(replay!.usage!.inputTokens).toBe(220)
      expect(replay!.usage!.outputTokens).toBe(110)

      ws.close()
      await server.close()
    })

  it('result event overrides accumulated usage with session-level totals', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-result-override',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Two turns accumulate usage
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":100,"output_tokens":50}}\n')
      mock.emitStdout('{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":120,"output_tokens":60}}\n')
      // Result event carries session-level cumulative totals — should override
      mock.emitStdout('{"type":"result","result":"done","cost_usd":0.10,"usage":{"input_tokens":500,"output_tokens":200}}\n')

      await new Promise((r) => setTimeout(r, 50))

      const wsUrl = server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-result-override/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{ type: string; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      // result.usage should override: 500 input, 200 output (not accumulated 220+500)
      expect(replay!.usage!.inputTokens).toBe(500)
      expect(replay!.usage!.outputTokens).toBe(200)
      expect(replay!.usage!.costUsd).toBe(0.10)

      ws.close()
      await server.close()
    })

  it('uses result.total_cost_usd when cost_usd is not present', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-total-cost',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      mock.emitStdout(
        '{"type":"result","result":"done","total_cost_usd":0.12,"usage":{"input_tokens":10,"output_tokens":5}}\n',
      )

      await new Promise((r) => setTimeout(r, 50))

      const wsUrl =
        server.baseUrl.replace('http://', 'ws://') +
        '/api/agents/sessions/stream-total-cost/terminal?api_key=test-key'
      const ws = new WebSocket(wsUrl)
      const messages: Array<{
        type: string
        usage?: { inputTokens: number; outputTokens: number; costUsd: number }
      }> = []

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
      })

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0)
      })

      const replay = messages.find((m) => m.type === 'replay')
      expect(replay).toBeDefined()
      expect(replay!.usage).toBeDefined()
      expect(replay!.usage!.inputTokens).toBe(10)
      expect(replay!.usage!.outputTokens).toBe(5)
      expect(replay!.usage!.costUsd).toBe(0.12)

      ws.close()
      await server.close()
    })

  it('uses custom cwd for stream sessions', async () => {
      installMockProcess()
      const server = await startServer()

      const response = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-cwd',
          mode: 'default',
          sessionType: 'stream',
          cwd: '/home/builder/projects/my-repo',
        }),
      })
      expect(response.status).toBe(201)
      await response.json()

      const [command, args, options] = mockedSpawn.mock.calls.at(-1) ?? []
      expect(isLocalClaudeLoginShellSpawn(command, args)).toBe(true)
      expectLocalClaudeScript(String(args?.[1]), 'max', '0', {
        cwd: '/home/builder/projects/my-repo',
        includeSettings: true,
      })
      expect(options).toEqual(expect.objectContaining({
        cwd: '/home/builder/projects/my-repo',
      }))

      await server.close()
    })

  it('delivers /send directly to an active Claude turn instead of deferring behind the queue', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-active-send-direct',
            mode: 'default',
            sessionType: 'stream',
            task: 'Initial busy turn',
          }),
        })
        expect(createResponse.status).toBe(201)

        mock.emitStdout('{"type":"message_start","message":{"id":"assistant-1","role":"assistant"}}\n')

        const sendResponse = await fetch(`${server.baseUrl}/api/agents/sessions/stream-active-send-direct/send`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: 'interrupt follow-up' }),
        })

        expect(sendResponse.status).toBe(200)
        expect(await sendResponse.json()).toEqual({ sent: true })

        await vi.waitFor(() => {
          expect(mock.getStdinWrites().some((chunk) => chunk.includes('interrupt follow-up'))).toBe(true)
        })

        const queueResponse = await fetch(`${server.baseUrl}/api/agents/sessions/stream-active-send-direct/queue`, {
          headers: AUTH_HEADERS,
        })
        expect(queueResponse.status).toBe(200)
        expect(await queueResponse.json()).toMatchObject({
          items: [],
          currentMessage: null,
          totalCount: 0,
        })
      } finally {
        await server.close()
      }
    })

  it('queues image prompts and drains them as rich user content blocks', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      try {
        const createResponse = await fetch(`${server.baseUrl}/api/agents/sessions`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            name: 'stream-queued-images',
            mode: 'default',
            sessionType: 'stream',
            task: 'Initial busy turn',
          }),
        })
        expect(createResponse.status).toBe(201)

        mock.emitStdout('{"type":"message_start","message":{"id":"assistant-1","role":"assistant"}}\n')

        const queueResponse = await fetch(`${server.baseUrl}/api/agents/sessions/stream-queued-images/message?queue=true`, {
          method: 'POST',
          headers: {
            ...AUTH_HEADERS,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            text: 'Review this screenshot',
            images: [
              {
                mediaType: 'image/png',
                data: 'ZmFrZS1pbWFnZQ==',
              },
            ],
          }),
        })

        expect(queueResponse.status).toBe(202)
        expect(await queueResponse.json()).toMatchObject({ queued: true, position: 1 })

        const snapshotResponse = await fetch(`${server.baseUrl}/api/agents/sessions/stream-queued-images/queue`, {
          headers: AUTH_HEADERS,
        })
        expect(snapshotResponse.status).toBe(200)
        expect(await snapshotResponse.json()).toMatchObject({
          items: [
            {
              text: 'Review this screenshot',
              images: [
                {
                  mediaType: 'image/png',
                  data: 'ZmFrZS1pbWFnZQ==',
                },
              ],
            },
          ],
          totalCount: 1,
        })

        mock.emitStdout('{"type":"result","subtype":"success","result":"done"}\n')

        await vi.waitFor(() => {
          expect(mock.getStdinWrites().some((chunk) => chunk.includes('Review this screenshot'))).toBe(true)
        })

        const queuedWrite = mock.getStdinWrites().find((chunk) => chunk.includes('Review this screenshot'))
        expect(queuedWrite).toBeDefined()
        expect(JSON.parse(queuedWrite!.trim())).toEqual({
          type: 'user',
          subtype: 'queued_message',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'Review this screenshot' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'ZmFrZS1pbWFnZQ==',
                },
              },
            ],
          },
        })
      } finally {
        await server.close()
      }
    })

  it('handles error followed by exit without double-cleanup', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-race',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      const ws = await connectWs(server.baseUrl, 'stream-race')
      const received: Array<{ type: string; text?: string }> = []

      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string; text?: string }
        if (parsed.type !== 'replay') {
          received.push(parsed)
        }
      })

      // Fire error first, then exit — simulates spawn ENOENT where both
      // events fire.  The second handler should be a no-op (idempotent guard).
      mock.emitError(new Error('spawn ENOENT'))
      mock.emitExit(1)

      // Give time for both events to process
      await new Promise((r) => setTimeout(r, 100))

      // The error system event should have been broadcast, but NOT the exit
      // event (session was already deleted when error handler ran).
      const systemMsgs = received.filter((m) => m.type === 'system')
      expect(systemMsgs).toHaveLength(1)
      expect(systemMsgs[0].text).toContain('spawn ENOENT')

      // No exit event should have been sent (guard prevented it)
      const exitMsgs = received.filter((m) => m.type === 'exit')
      expect(exitMsgs).toHaveLength(0)

      // Session should be cleaned up
      const resp = await fetch(`${server.baseUrl}/api/agents/sessions`, {
        headers: AUTH_HEADERS,
      })
      const sessions = await resp.json() as Array<{ name: string; processAlive?: boolean }>
      const exited = sessions.find((session) => session.name === 'stream-race')
      expect(exited?.processAlive).toBe(false)

      await server.close()
    })

  it('registers stdin error handler to prevent unhandled error crashes', async () => {
      const mock = installMockProcess()
      const server = await startServer()

      await fetch(`${server.baseUrl}/api/agents/sessions`, {
        method: 'POST',
        headers: {
          ...AUTH_HEADERS,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'stream-stdin-error',
          mode: 'default',
          sessionType: 'stream',
        }),
      })

      // Verify the stdin error handler was registered (via the EventEmitter).
      // Without this handler, emitting 'error' on stdin would throw an
      // unhandled error and crash the process.
      expect(mock.cp.stdin.listenerCount('error')).toBeGreaterThan(0)

      // Emitting an error on stdin should NOT throw (handler swallows it).
      expect(() => {
        mock.cp.stdin.emit('error', new Error('write EPIPE'))
      }).not.toThrow()

      await server.close()
    })
})
