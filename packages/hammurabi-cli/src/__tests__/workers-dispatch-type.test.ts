import { describe, expect, it, vi } from 'vitest'
import { createHammurabiConfig } from '../config.js'
import { runWorkersCli } from '../workers.js'

interface BufferWriter {
  writer: { write: (chunk: string) => boolean }
  read: () => string
}

function createBufferWriter(): BufferWriter {
  let buffer = ''
  return {
    writer: {
      write(chunk: string): boolean {
        buffer += chunk
        return true
      },
    },
    read(): string {
      return buffer
    },
  }
}

const config = createHammurabiConfig({
  endpoint: 'https://hervald.gehirn.ai',
  apiKey: 'hmrb_test_key',
  agents: ['claude-code'],
  configuredAt: new Date('2026-03-01T00:00:00.000Z'),
})

describe('runWorkersCli command surface', () => {
  it('rejects legacy --type flags', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runWorkersCli(
      [
        'dispatch',
        '--type',
        'agent',
        '--task',
        'Investigate flaky tests',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects legacy issue flags', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runWorkersCli(
      [
        'dispatch',
        '--issue',
        'https://github.com/NickGuAI/Hervald/issues/123',
        '--task',
        'Investigate flaky tests',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows dispatch without an initial task', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'worker-1710000000000' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(
      ['dispatch', '--session', 'commander-main'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('rejects legacy prefab flags', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runWorkersCli(
      ['dispatch', '--prefab', 'legion-implement'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects non-absolute cwd values for dispatch', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const exitCode = await runWorkersCli(
      ['dispatch', '--task', 'Investigate flaky tests', '--cwd', 'relative/path'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
