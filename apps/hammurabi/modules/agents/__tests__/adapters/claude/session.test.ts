import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeStreamSession, type ClaudeStreamSessionDeps } from '../../../adapters/claude/session'

const UNSET_CLAUDE_CHILD_ENV = 'unset CLAUDECODE ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL'

function createFakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  child.stdout = new EventEmitter() as ChildProcess['stdout']
  child.stderr = new EventEmitter() as ChildProcess['stderr']
  child.stdin = new EventEmitter() as ChildProcess['stdin']
  return child
}

function createDeps(spawnImpl: NonNullable<ClaudeStreamSessionDeps['spawnImpl']>): ClaudeStreamSessionDeps {
  return {
    appendEvent: vi.fn(),
    broadcastEvent: vi.fn(),
    clearExitedSession: vi.fn(),
    deleteLiveSession: vi.fn(),
    getActiveSession: vi.fn(),
    resetActiveTurnState: vi.fn(),
    schedulePersistedSessionsWrite: vi.fn(),
    setCompletedSession: vi.fn(),
    setExitedSession: vi.fn(),
    spawnImpl,
    writeToStdin: vi.fn().mockReturnValue(true),
    writeTranscriptMeta: vi.fn(),
  }
}

describe('agents/adapters/claude/session', () => {
  const originalShell = process.env.SHELL

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  it('launches local Claude stream sessions through a non-interactive login shell bootstrap', () => {
    process.env.SHELL = '/bin/zsh'

    const child = createFakeChildProcess()
    const spawnImpl = vi.fn().mockReturnValue(child)
    const deps = createDeps(spawnImpl)

    createClaudeStreamSession(
      'local-claude-auth',
      'default',
      '',
      '/tmp/project alpha',
      undefined,
      {},
      deps,
    )

    expect(spawnImpl).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnImpl.mock.calls[0]!

    expect(command).toBe('/bin/zsh')
    expect(args).toEqual([
      '-lc',
      expect.stringContaining('. "$HOME/.bashrc" >/dev/null 2>&1 || true'),
    ])
    expect(args[1]).toContain('. "$HOME/.zshrc" >/dev/null 2>&1 || true')
    expect(args[1]).toContain(`cd '/tmp/project alpha' && export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=0; ${UNSET_CLAUDE_CHILD_ENV}; claude`)
    expect(options).toMatchObject({
      cwd: '/tmp/project alpha',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })

  it('reverse-tunnels the approval daemon and propagates the internal token when launching Claude on a remote machine (issue/1225)', () => {
    const child = createFakeChildProcess()
    const spawnImpl = vi.fn().mockReturnValue(child)
    const deps = createDeps(spawnImpl)
    deps.internalToken = 'remote-bridge-token'

    const originalPort = process.env.HAMMURABI_PORT
    process.env.HAMMURABI_PORT = '20001'

    try {
      createClaudeStreamSession(
        'remote-claude-bridge',
        'default',
        '',
        '/Users/yugu/.factory/example',
        {
          id: 'yus-mac-mini',
          label: "Yu's Mac Mini",
          host: 'yus-mac-mini',
          user: 'yugu',
          cwd: '/Users/yugu/Desktop',
          envFile: '/Users/yugu/.hammurabi-env',
        },
        {},
        deps,
      )
    } finally {
      if (originalPort === undefined) {
        delete process.env.HAMMURABI_PORT
      } else {
        process.env.HAMMURABI_PORT = originalPort
      }
    }

    expect(spawnImpl).toHaveBeenCalledTimes(1)
    const [command, args] = spawnImpl.mock.calls[0]!

    expect(command).toBe('ssh')
    // Reverse tunnel: remote 127.0.0.1:20001 reaches the EC2 daemon.
    const rIdx = (args as string[]).indexOf('-R')
    expect(rIdx).toBeGreaterThan(-1)
    expect((args as string[])[rIdx + 1]).toBe('127.0.0.1:20001:127.0.0.1:20001')
    expect(args).toContain('ControlMaster=auto')
    expect(args).toContain('ControlPersist=600')
    expect((args as string[]).find((arg: string) => arg.startsWith('ControlPath='))).toBeTruthy()
    // Internal token propagated via SendEnv without leaking the value into argv.
    expect(args).toContain('SendEnv=HAMMURABI_INTERNAL_TOKEN')
    expect((args as string[]).join(' ')).not.toContain('remote-bridge-token')
    // Bridge flags appear before the user@host destination so SSH parses them as options.
    const destinationIdx = (args as string[]).indexOf('yugu@yus-mac-mini')
    const sendEnvIdx = (args as string[]).findIndex((arg: string) =>
      arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN',
    )
    expect(rIdx).toBeLessThan(destinationIdx)
    expect(sendEnvIdx).toBeLessThan(destinationIdx)
  })

  it('does not add the reverse-tunnel or SendEnv flags for local Claude launches', () => {
    process.env.SHELL = '/bin/bash'

    const child = createFakeChildProcess()
    const spawnImpl = vi.fn().mockReturnValue(child)
    const deps = createDeps(spawnImpl)
    deps.internalToken = 'local-token'

    createClaudeStreamSession(
      'local-claude-no-bridge',
      'default',
      '',
      '/tmp',
      undefined,
      {},
      deps,
    )

    expect(spawnImpl).toHaveBeenCalledTimes(1)
    const [, args] = spawnImpl.mock.calls[0]!
    expect(args).not.toContain('-R')
    expect(
      (args as string[]).find((arg: string) => arg === 'SendEnv=HAMMURABI_INTERNAL_TOKEN'),
    ).toBeUndefined()
  })
})
