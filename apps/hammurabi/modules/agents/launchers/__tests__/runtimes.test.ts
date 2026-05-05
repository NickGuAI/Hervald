import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSpawn = vi.fn()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: mockSpawn,
  }
})

function createMockChildProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  }) as unknown as ChildProcess
}

describe('OpenCodeAcpRuntime', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mockSpawn.mockReset()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rewrites spawn ENOENT into a friendly PATH error', async () => {
    const childProcess = createMockChildProcess()
    const error = new Error('spawn opencode ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'

    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        ;(childProcess as unknown as EventEmitter).emit('error', error)
      })
      return childProcess
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { OpenCodeAcpRuntime } = await import('../runtimes')
    const runtime = new OpenCodeAcpRuntime('opencode-worker-1')

    await expect(runtime.ensureConnected()).rejects.toThrow(
      'OpenCode binary not found on PATH. Run install.sh or symlink /home/builder/.opencode/bin/opencode to a PATH directory.',
    )

    expect(mockSpawn).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
    expect(errorSpy).toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalled()
  })
})
