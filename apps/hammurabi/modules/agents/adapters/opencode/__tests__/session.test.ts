import { describe, expect, it, vi } from 'vitest'
import { createOpenCodeAcpSession } from '../session'

function createRuntime() {
  return {
    process: null,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    sendResponse: vi.fn(),
    addNotificationListener: vi.fn().mockReturnValue(() => {}),
    teardown: vi.fn().mockResolvedValue(undefined),
    teardownOnProcessExit: vi.fn(),
  }
}

function createDeps(runtimeFactory: ReturnType<typeof vi.fn>) {
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

describe('createOpenCodeAcpSession', () => {
  it('tears down and rethrows a friendly startup error when ensureConnected rejects', async () => {
    const runtime = createRuntime()
    runtime.ensureConnected.mockRejectedValue(new Error('spawn opencode ENOENT'))
    const runtimeFactory = vi.fn(() => runtime)

    await expect(createOpenCodeAcpSession(
      'opencode-worker-1',
      'default',
      '',
      '/tmp/opencode-worker',
      {},
      createDeps(runtimeFactory) as Parameters<typeof createOpenCodeAcpSession>[5],
    )).rejects.toThrow('OpenCode runtime failed to start: spawn opencode ENOENT')

    expect(runtime.teardown).toHaveBeenCalledWith({
      reason: 'OpenCode runtime failed to start: spawn opencode ENOENT',
    })
    expect(runtime.sendRequest).not.toHaveBeenCalled()
  })
})
