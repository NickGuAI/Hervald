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

describe('runWorkersCli', () => {
  it('lists worker sessions with visible lifecycle badges, including exited workers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: 'worker-1710000000000',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-athena' },
            status: 'active',
            cwd: '/tmp/worktree-a',
          },
          {
            name: 'worker-1710000000002',
            sessionType: 'worker',
            creator: { kind: 'commander', id: 'cmdr-athena' },
            status: 'exited',
            processAlive: false,
            host: 'mac-mini',
          },
          {
            name: 'worker-human',
            sessionType: 'worker',
            creator: { kind: 'human', id: 'api-key' },
            status: 'stale',
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['list', '--all', '--all-creators'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Workers:')
    expect(stdout.read()).toContain('worker-1710000000000 type=worker creator=commander/cmdr-athena lifecycle=running')
    expect(stdout.read()).toContain('cwd=/tmp/worktree-a')
    expect(stdout.read()).toContain('worker-1710000000002 type=worker creator=commander/cmdr-athena lifecycle=exited')
    expect(stdout.read()).toContain('host=mac-mini')
    expect(stdout.read()).toContain('worker-human type=worker creator=human/api-key lifecycle=stale')
  })

  it('dispatches a worker task via the dispatch-worker endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'worker-1710000000000',
          cwd: '/tmp/worktree-a',
        }),
        {
          status: 202,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(
      [
        'dispatch',
        '--session',
        'commander-main',
        '--task',
        'Handle edge cases',
        '--cwd',
        '/tmp/worktree-a',
        '--machine',
        'gpu-1',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Worker dispatched: worker-1710000000000')
    expect(stdout.read()).toContain('Cwd: /tmp/worktree-a')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/dispatch-worker',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          spawnedBy: 'commander-main',
          task: 'Handle edge cases',
          machine: 'gpu-1',
          cwd: '/tmp/worktree-a',
        }),
      }),
    )
  })

  it('prints keystore recovery guidance on 401 from dispatch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(
      ['dispatch', '--session', 'commander-main', '--task', 'Handle edge cases'],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('.hammurabi.json')
    expect(stderr.read()).toContain('api-keys/keys.json')
    expect(stderr.read()).toContain('HAMMURABI_ALLOW_DEFAULT_MASTER_KEY=1')
    expect(stderr.read()).toContain('hammurabi onboard')
  })

  it('dispatches a worker without an initial task', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'worker-1710000000000',
          cwd: '/Users/yugu/Desktop/TheG/worktrees/issue-963',
        }),
        {
          status: 202,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(
      [
        'dispatch',
        '--session',
        'commander-main',
        '--cwd',
        '/Users/yugu/Desktop/TheG/worktrees/issue-963',
      ],
      {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      },
    )

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/dispatch-worker',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          spawnedBy: 'commander-main',
          cwd: '/Users/yugu/Desktop/TheG/worktrees/issue-963',
        }),
      }),
    )
  })

  it('falls back to HAMMURABI_SESSION_NAME env when --session is not passed', async () => {
    vi.stubEnv('HAMMURABI_SESSION_NAME', 'commander-d66a5217-ace6-4f00-b2ac-bbd64a9a7e7e')
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ name: 'worker-env-fallback', cwd: '/tmp/worktree-env' }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runWorkersCli(
        ['dispatch', '--task', 'Auto-attribute to commander'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/agents/sessions/dispatch-worker',
        expect.objectContaining({
          body: JSON.stringify({
            spawnedBy: 'commander-d66a5217-ace6-4f00-b2ac-bbd64a9a7e7e',
            task: 'Auto-attribute to commander',
          }),
        }),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lets explicit --session override HAMMURABI_SESSION_NAME env', async () => {
    vi.stubEnv('HAMMURABI_SESSION_NAME', 'commander-from-env-should-lose')
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ name: 'worker-explicit', cwd: '/tmp/worktree-explicit' }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runWorkersCli(
        ['dispatch', '--session', 'commander-explicit-wins', '--task', 'Pinned parent'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/agents/sessions/dispatch-worker',
        expect.objectContaining({
          body: JSON.stringify({
            spawnedBy: 'commander-explicit-wins',
            task: 'Pinned parent',
          }),
        }),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ignores empty/whitespace HAMMURABI_SESSION_NAME env when --session is not passed', async () => {
    vi.stubEnv('HAMMURABI_SESSION_NAME', '   ')
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ name: 'worker-no-parent', cwd: '/tmp/worktree-orphan' }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runWorkersCli(
        ['dispatch', '--task', 'No parent expected'],
        {
          fetchImpl,
          readConfig: async () => config,
          stdout: stdout.writer,
          stderr: stderr.writer,
        },
      )

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://hervald.gehirn.ai/api/agents/sessions/dispatch-worker',
        expect.objectContaining({
          body: JSON.stringify({ task: 'No parent expected' }),
        }),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('prints running status for an active session', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'worker-1710000000000', completed: false, status: 'running' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('session: worker-1710000000000')
    expect(stdout.read()).toContain('status: running')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/worker-1710000000000',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('renders a tail section when --tail is provided', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T12:00:05.000Z'))

    try {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
        const target = String(url)
        if (target.endsWith('/api/agents/sessions/worker-1710000000000')) {
          return new Response(JSON.stringify({
            name: 'worker-1710000000000',
            completed: false,
            status: 'running',
            sessionType: 'worker',
            transportType: 'stream',
            host: 'home-mac',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        if (target.endsWith('/api/agents/sessions/worker-1710000000000/messages?last=3&includeToolUse=true')) {
          return new Response(JSON.stringify({
            session: 'worker-1710000000000',
            total: 206,
            returned: 3,
            messages: [
              {
                ts: '2026-04-22T12:00:02.000Z',
                type: 'assistant',
                kind: 'text',
                preview: 'Creating kaizen-review SKILL.md...',
              },
              {
                ts: '2026-04-22T12:00:02.000Z',
                type: 'assistant',
                kind: 'tool_use',
                tool: 'apply_patch',
                preview: 'apply_patch: agent-skills/pkos/kaizen-review/SKILL.md',
              },
              {
                ts: '2026-04-22T12:00:02.000Z',
                type: 'user',
                kind: 'tool_result',
                tool: 'apply_patch',
                preview: 'Applied',
              },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({ error: `Unexpected URL: ${target}` }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      })
      const stdout = createBufferWriter()
      const stderr = createBufferWriter()

      const exitCode = await runWorkersCli(['status', 'worker-1710000000000', '--tail', '3'], {
        fetchImpl,
        readConfig: async () => config,
        stdout: stdout.writer,
        stderr: stderr.writer,
      })

      expect(exitCode).toBe(0)
      expect(stderr.read()).toBe('')
      expect(stdout.read()).toContain('status: running')
      expect(stdout.read()).toContain('last 3:')
      expect(stdout.read()).toContain('assistant/text')
      expect(stdout.read()).toContain('"Creating kaizen-review SKILL.md..."')
      expect(stdout.read()).toContain('assistant/tool_use')
      expect(stdout.read()).toContain('apply_patch  agent-skills/pkos/kaizen-review/SKILL.md')
      expect(stdout.read()).toContain('user/tool_result')
      expect(stdout.read()).toContain('apply_patch  "Applied"')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits JSON when --json is provided', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = String(url)
      if (target.endsWith('/api/agents/sessions/worker-1710000000000')) {
        return new Response(JSON.stringify({
          name: 'worker-1710000000000',
          completed: false,
          status: 'running',
          sessionType: 'worker',
          transportType: 'stream',
          host: 'home-mac',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (target.endsWith('/api/agents/sessions/worker-1710000000000/messages?last=5&includeToolUse=true')) {
        return new Response(JSON.stringify({
          session: 'worker-1710000000000',
          total: 206,
          returned: 5,
          messages: [
            {
              ts: '2026-04-22T12:00:02.000Z',
              type: 'assistant',
              kind: 'text',
              preview: 'peek 1',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: `Unexpected URL: ${target}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000', '--json'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const payload = JSON.parse(stdout.read()) as {
      session: string
      status: string
      transport: string
      host: string
      events: { total: number; returned: number }
      messages: Array<{ preview: string }>
    }

    expect(payload).toMatchObject({
      session: 'worker-1710000000000',
      status: 'running',
      transport: 'stream',
      host: 'home-mac',
      events: {
        total: 206,
        returned: 5,
      },
    })
    expect(payload.messages[0]?.preview).toBe('peek 1')
  })

  it('prints completed status for a finished session', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'worker-1710000000000', completed: true, status: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('status: completed')
    expect(stdout.read()).toContain('result: success')
  })

  it('prints exited status for terminated sessions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'worker-1710000000000', completed: false, status: 'exited' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('session: worker-1710000000000')
    expect(stdout.read()).toContain('status: exited')
    expect(stdout.read()).not.toContain('status: running')
  })

  it('kills a session via DELETE', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ killed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['kill', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('Session worker-1710000000000 killed.')

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/worker-1710000000000',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
        }),
      }),
    )
  })

  it('sends a message via POST /sessions/:name/send', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sent: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['send', 'worker-1710000000000', 'hello worker'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('sent: true')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hervald.gehirn.ai/api/agents/sessions/worker-1710000000000/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer hmrb_test_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ text: 'hello worker' }),
      }),
    )
  })

  it('requires a session name and text for send', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()

    const missingTextExitCode = await runWorkersCli(['send', 'worker-1710000000000'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })
    expect(missingTextExitCode).toBe(1)

    const blankTextExitCode = await runWorkersCli(['send', 'worker-1710000000000', '   '], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
    })
    expect(blankTextExitCode).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects negative tail values', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000', '--tail', '-5'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stdout.read()).toContain('Usage:')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('degrades gracefully when the messages endpoint fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'worker-1710000000000', completed: false, status: 'running' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new Error('network down'))
    const stdout = createBufferWriter()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['status', 'worker-1710000000000', '--tail', '3'], {
      fetchImpl,
      readConfig: async () => config,
      stdout: stdout.writer,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(0)
    expect(stderr.read()).toBe('')
    expect(stdout.read()).toContain('session: worker-1710000000000')
    expect(stdout.read()).toContain('status: running')
    expect(stdout.read()).toContain('warning: could not fetch messages: network down')
  })

  it('fails when config is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const stderr = createBufferWriter()

    const exitCode = await runWorkersCli(['list'], {
      fetchImpl,
      readConfig: async () => null,
      stderr: stderr.writer,
    })

    expect(exitCode).toBe(1)
    expect(stderr.read()).toContain('Hammurabi config not found')
  })
})
