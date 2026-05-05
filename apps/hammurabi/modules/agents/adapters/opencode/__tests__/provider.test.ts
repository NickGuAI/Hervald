import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { opencodeProvider } from '../provider'

function createMockRuntime() {
  const stdin = new PassThrough()
  const process = Object.assign(new EventEmitter(), {
    pid: 1234,
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })

  return {
    process: process as unknown as import('node:child_process').ChildProcess,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn().mockResolvedValue({ sessionId: 'opencode-session-1' }),
    sendNotification: vi.fn(),
    sendResponse: vi.fn(),
    addNotificationListener: vi.fn().mockReturnValue(vi.fn()),
    teardown: vi.fn().mockResolvedValue(undefined),
    teardownOnProcessExit: vi.fn(),
  }
}

function createProviderDeps(runtimeFactory: ReturnType<typeof vi.fn>) {
  return {
    appendEvent: vi.fn(),
    broadcastEvent: vi.fn(),
    clearExitedSession: vi.fn(),
    deleteLiveSession: vi.fn(),
    deleteSessionEventHandlers: vi.fn(),
    getActiveSession: vi.fn(),
    resetActiveTurnState: vi.fn(),
    runtimeFactory,
    schedulePersistedSessionsWrite: vi.fn(),
    setCompletedSession: vi.fn(),
    setExitedSession: vi.fn(),
    writeTranscriptMeta: vi.fn(),
  } as const
}

describe('opencodeProvider', () => {
  it('forwards ProviderCreateOptions.model into OpenCode runtime creation', async () => {
    const runtime = createMockRuntime()
    const runtimeFactory = vi.fn(() => runtime)

    const session = await opencodeProvider.create(
      {
        sessionName: 'opencode-worker-1',
        mode: 'default',
        task: '',
        cwd: '/tmp/opencode-worker',
        model: 'anthropic/claude-sonnet-4',
      },
      createProviderDeps(runtimeFactory) as Parameters<typeof opencodeProvider.create>[1],
    )

    expect(runtimeFactory).toHaveBeenCalledWith(
      'opencode-worker-1',
      undefined,
      'anthropic/claude-sonnet-4',
    )
    expect(runtime.sendRequest).toHaveBeenCalledWith('session/new', {
      cwd: '/tmp/opencode-worker',
      mcpServers: [],
    })
    expect(session.model).toBe('anthropic/claude-sonnet-4')
    expect(session.providerContext.providerId).toBe('opencode')
  })
})
